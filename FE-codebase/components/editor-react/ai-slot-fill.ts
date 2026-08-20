// Manifest-driven slide fill — the "phase 3" contract.
//
// Unlike the legacy AIPPTSlide path (ai-layout-fill.ts's fillLayout, where the
// model outputs a fixed 5-type union and the client GUESSES which slot gets
// what), here the model sees the theme's layout manifest — every slot with
// its authored role/hint/fill_condition/max_words/max_lines — and answers
// with exactly which slot gets which text. The client then only:
//   1. writes each fill into the named element (in document order, so a name
//      that occurs N times gets its N fills in order),
//   2. ENFORCES the authored budgets itself (the model is asked nicely, the
//      client guarantees it),
//   3. prunes conditional slots the model legitimately left out, and
//   4. backstops "always" slots the model forgot.
// Colors, positions, decorative elements, and fonts are never touched by the
// normal fill path — the slide stays exactly as the template author designed
// it. The deliberate exceptions are applyFontBoostToUi and applyTextColorToUi
// below, which the visual review's "resize" and "contrast" fixes use to grow
// a slot's font or recolor it when the reviewer judged the rendered slide
// too small or too illegible to read — legibility, not taste.

import {
  findAllPhotoSlots,
  findHeroImage,
  findSecondaryImages,
  fillPlaceholderIcons,
  pruneEmptyContainers,
  setText,
  type FilledSlide,
  type SetTextOptions,
} from "@/components/editor-react/ai-layout-fill";
import {
  EDITOR_STAGE_HEIGHT,
  EDITOR_STAGE_WIDTH,
} from "@/components/slide-editor/types";
import {
  parseSlotMeta,
  type SlotMeta,
} from "@/components/slide-editor/templates/slot-meta";
import {
  chartDataFromSeriesWithColors,
  chartSupportsMultipleSeries,
  DEFAULT_CHART_COLORS,
} from "@/components/slide-editor/charts/chart-data";
import type { ChartType } from "@/components/slide-editor/types";
import {
  lineRenderHeight,
  layoutRenderTextRuns,
  rawFont,
  rawTextContent,
  scaleRawTextMetrics,
} from "@/components/slide-editor/text/template-v2-text";

type Rec = Record<string, unknown>;

interface TemplateLayout {
  id: string;
  description?: string;
  meta?: Rec;
  components: Rec[];
}

/** Chart data the model supplies for kind:"chart" slots — categories plus one
 *  or more series, matching the template's authored chart frame. */
export interface ChartSpec {
  title?: string;
  categories: string[];
  series: { name: string; values: number[] }[];
  x_axis_title?: string;
  y_axis_title?: string;
  source?: string;
}

/** One fill entry from the model: which named slot, what content. Text slots
 *  carry `text`; chart slots carry `chart`. */
export interface SlotFill {
  name: string;
  text?: string;
  chart?: ChartSpec;
}

/** One slide's fills in the manifest contract. Assembled client-side from the
 *  streamed sequence
 *    {"type":"slide_start","layout_id":"..."} → {"type":"fill",...} × N → {"type":"slide_end"}
 *  (the fills land live, one element at a time), or parsed from the legacy
 *  one-line-per-slide form {"type":"slide","layout_id":"...","fills":[...]}. */
export interface ManifestSlideLine {
  type: "slide";
  layout_id: string;
  fills: SlotFill[];
}

/** Model output for a chart slot is untrusted JSON — coerce it hard: ≤8
 *  categories, ≤4 series, numeric values padded/truncated to the category
 *  count so the renderer never sees a ragged dataset. */
function parseChartSpec(raw: unknown): ChartSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Rec;

  const categories = (Array.isArray(rec.categories) ? rec.categories : [])
    .map((c) => String(c ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (categories.length === 0) return null;

  const series: { name: string; values: number[] }[] = [];
  for (const s of (Array.isArray(rec.series) ? rec.series : []).slice(0, 4)) {
    if (!s || typeof s !== "object") continue;
    const sRec = s as Rec;
    const values = (Array.isArray(sRec.values) ? sRec.values : [])
      .map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      })
      .slice(0, categories.length);
    while (values.length < categories.length) values.push(0);
    series.push({
      name: typeof sRec.name === "string" && sRec.name.trim() ? sRec.name.trim() : "Series",
      values,
    });
  }
  if (series.length === 0) return null;

  const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : undefined);
  return {
    categories,
    series,
    ...(opt(rec.title) ? { title: opt(rec.title) } : {}),
    ...(opt(rec.x_axis_title) ? { x_axis_title: opt(rec.x_axis_title) } : {}),
    ...(opt(rec.y_axis_title) ? { y_axis_title: opt(rec.y_axis_title) } : {}),
    ...(opt(rec.source) ? { source: opt(rec.source) } : {}),
  };
}

/** Parses one streamed line into a ManifestSlideLine, or null when the line
 *  isn't the new contract (legacy AIPPTSlide / theme / error lines included). */
export function parseManifestSlideLine(line: string): ManifestSlideLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Rec;
  if (rec.type !== "slide") return null;
  if (typeof rec.layout_id !== "string" || !rec.layout_id) return null;
  const rawFills = Array.isArray(rec.fills) ? rec.fills : [];
  const fills: SlotFill[] = [];
  for (const f of rawFills) {
    if (!f || typeof f !== "object") continue;
    const { name, text } = f as Rec;
    if (typeof name !== "string" || !name) continue;
    if (typeof text === "string") {
      fills.push({ name, text });
      continue;
    }
    const chart = parseChartSpec((f as Rec).chart);
    if (chart) fills.push({ name, chart });
  }
  return { type: "slide", layout_id: rec.layout_id, fills };
}

/** Parses a streamed {"type":"slide_start","layout_id":"..."} line — the model
 *  has picked the layout, the client mounts the empty template immediately. */
export function parseSlideStartLine(line: string): { layout_id: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Rec;
  if (rec.type !== "slide_start") return null;
  if (typeof rec.layout_id !== "string" || !rec.layout_id) return null;
  return { layout_id: rec.layout_id };
}

/** Parses one streamed {"type":"fill","name":"...","text"|"chart":...} line. */
export function parseStreamFillLine(line: string): SlotFill | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Rec;
  if (rec.type !== "fill") return null;
  if (typeof rec.name !== "string" || !rec.name) return null;
  if (typeof rec.text === "string") return { name: rec.name, text: rec.text };
  const chart = parseChartSpec(rec.chart);
  return chart ? { name: rec.name, chart } : null;
}

/** The streamed {"type":"slide_end"} sentinel closing a slide sequence. */
export function isSlideEndLine(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as { type?: string };
    return parsed.type === "slide_end";
  } catch {
    return false;
  }
}

/* ------------------------- Constraint enforcement ------------------------- */

/** Truncates at a word boundary when `text` exceeds `maxWords`, appending an
 *  ellipsis. The model is TOLD the budget in the prompt; this is the
 *  guarantee for when it overshoots anyway. */
function enforceMaxWords(text: string, maxWords: number | null | undefined): string {
  if (!maxWords || maxWords <= 0) return text;
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ").replace(/[.,;:!?…]*$/, "") + "…";
}

/** Same story for the legacy character budget (`max_length`), which the new
 *  contract DOES treat as hard — unlike the old fill, where it was ignored
 *  (see the NOTE above fittedFontSize in ai-layout-fill.ts). Here the model
 *  saw the budget in the manifest, so a violation is a real violation. */
function enforceMaxLength(text: string, maxLength: unknown): string {
  const cap = typeof maxLength === "number" && Number.isFinite(maxLength) ? maxLength : null;
  if (!cap || cap <= 0 || text.length <= cap) return text;
  const sliced = text.slice(0, cap);
  const atSpace = sliced.lastIndexOf(" ");
  return (atSpace > cap * 0.6 ? sliced.slice(0, atSpace) : sliced).replace(/[.,;:!?…]*$/, "") + "…";
}

function enforceSlotBudgets(text: string, slot: SlotMeta | null, el: Rec): string {
  let out = text.trim();
  if (slot?.max_words != null) out = enforceMaxWords(out, slot.max_words);
  out = enforceMaxLength(out, el.max_length);
  return out;
}

/* ----------------------------- Slot collection ---------------------------- */

interface NamedTextSlot {
  el: Rec;
  name: string;
  kind: "text" | "chart";
  slot: SlotMeta | null;
  /** Splices this element out of its parent array (children/elements). */
  remove: () => void;
}

function visitNamedText(el: Rec, out: NamedTextSlot[]): void {
  const children = el.children as Rec[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (!child || typeof child !== "object") continue;
      // Removal is resolved by identity AT CALL TIME — several siblings can be
      // pruned in one pass without stale-index splices.
      collectOne(child, () => {
        const idx = children.indexOf(child);
        if (idx >= 0) children.splice(idx, 1);
      }, out);
    }
    return;
  }
  const child = el.child as Rec | undefined;
  if (child && typeof child === "object") {
    collectOne(child, () => {
      delete el.child;
    }, out);
  }
}

function collectOne(el: Rec, remove: () => void, out: NamedTextSlot[]): void {
  const type = el.type;
  if ((type === "text" || type === "text-list" || type === "chart") && el.decorative !== true) {
    const name = typeof el.name === "string" ? el.name.trim() : "";
    if (name) {
      out.push({
        el,
        name,
        kind: type === "chart" ? "chart" : "text",
        slot: parseSlotMeta(el.slot),
        remove,
      });
      return; // a named leaf has no fillable descendants
    }
  }
  visitNamedText(el, out);
}

/** Every named, non-decorative text/chart element in the layout, in document order. */
function collectNamedTextSlots(components: Rec[]): NamedTextSlot[] {
  const out: NamedTextSlot[] = [];
  for (const component of components) {
    const elements = (component.elements as Rec[]) ?? [];
    for (const el of elements) {
      if (!el || typeof el !== "object") continue;
      collectOne(el, () => {
        const idx = elements.indexOf(el);
        if (idx >= 0) elements.splice(idx, 1);
      }, out);
    }
  }
  return out;
}

/* ---------------------------- Chart slot writes ---------------------------- */

/** Writes the model's chart data into a chart element, replacing the authored
 *  sample data. Keeps the template's own colors — only the numbers, labels
 *  and titles change. The derived single-series `data` is refreshed too, so
 *  consumers that read `data` instead of categories/series (export, CSV)
 *  stay in sync. */
function writeChartData(el: Rec, spec: ChartSpec): void {
  const multi = chartSupportsMultipleSeries(el.chart_type as ChartType);
  const series = spec.series.slice(0, multi ? 4 : 1);

  el.categories = spec.categories;
  el.series = series;
  if (spec.title) el.title = spec.title;
  if (spec.x_axis_title) el.x_axis_title = spec.x_axis_title;
  if (spec.y_axis_title) el.y_axis_title = spec.y_axis_title;
  if (spec.source) el.source = spec.source;

  const colors =
    Array.isArray(el.colors) && el.colors.length > 0
      ? (el.colors as string[])
      : DEFAULT_CHART_COLORS;
  el.data = chartDataFromSeriesWithColors(
    spec.categories,
    series,
    colors,
    series.length <= 1,
  );
}

/* --------------------------- Unfilled-slot policy -------------------------- */

/** Backstop for a slot the model was REQUIRED to fill ("always") but didn't.
 *  Derived from the slide's other fills / the deck topic — never invented
 *  facts. Returns "" when there's genuinely nothing sensible, which at least
 *  beats leaving the template's sample copy on screen. */
function fallbackForAlwaysSlot(
  slot: SlotMeta | null,
  headline: string,
  topic: string,
): string {
  switch (slot?.role) {
    case "headline":
      return headline || topic;
    case "subheadline":
    case "body":
    case "bullet":
    case "caption":
      return headline && headline !== topic ? topic : "";
    case "date":
      return String(new Date().getFullYear());
    case "step-number":
      return "01";
    default:
      return headline;
  }
}

/* --------------------------------- Fill ----------------------------------- */

/**
 * Fills `layout` with the model's slot-by-slot copy. Enforcement summary:
 *  - page-number slots     → stamped with the slide's ordinal (ctx.pageNumber)
 *                            — the model never sees them, the client owns them.
 *  - fill present          → budgets enforced, text written (font auto-fits).
 *  - missing + always      → role-based fallback from the deck's own material.
 *  - missing + prune flag  → element removed, empty containers pruned after.
 *  - missing + optional    → text cleared (never the author's sample copy).
 */
export function fillLayoutWithSlotMap(
  layout: TemplateLayout,
  line: ManifestSlideLine,
  ctx: { topic: string; pageNumber?: number },
): FilledSlide {
  const components = JSON.parse(JSON.stringify(layout.components)) as Rec[];
  const namedSlots = collectNamedTextSlots(components);
  // Every element on the slide is a potential grow-obstacle for box-resize.
  // Page-number/chart slots below call setText without opts (their text is
  // short/structured, never overflows) — only real copy fills carry the slide
  // context so the box can grow into empty space before shrinking the font.
  const textOpts: SetTextOptions = {
    siblings: components,
    stage: { w: EDITOR_STAGE_WIDTH, h: EDITOR_STAGE_HEIGHT },
  };

  // Group fills by slot name, preserving order — the Nth fill for a name goes
  // to the Nth element carrying that name (layouts repeat names, e.g. two
  // "body_paragraph" elements in one layout).
  const fillsByName = new Map<string, SlotFill[]>();
  for (const fill of line.fills) {
    const list = fillsByName.get(fill.name) ?? [];
    list.push(fill);
    fillsByName.set(fill.name, list);
  }

  const headline =
    line.fills.find((f) => /title|headline|heading/i.test(f.name))?.text ?? "";

  for (const named of namedSlots) {
    // Page numbers are the client's job — stamped from the slide's position
    // in the deck, never asked from the model (it can't know the final order).
    if (named.slot?.role === "page-number") {
      setText(named.el, ctx.pageNumber != null ? String(ctx.pageNumber) : "");
      continue;
    }
    const queue = fillsByName.get(named.name);
    const fill = queue?.shift();

    // Chart slots take structured data, not prose. An unfilled chart keeps
    // whatever the template author left (usually an empty frame) unless it's
    // marked prune — there is no honest "fallback data" to invent here.
    if (named.kind === "chart") {
      if (fill?.chart) writeChartData(named.el, fill.chart);
      else if (named.slot?.prune_if_unfilled) named.remove();
      continue;
    }

    const text = fill?.text;
    if (text != null && text.trim()) {
      setText(named.el, enforceSlotBudgets(text, named.slot, named.el), textOpts);
      continue;
    }
    // Unfilled:
    const condition = named.slot?.fill_condition ?? "always";
    if (condition === "always") {
      const fallback = fallbackForAlwaysSlot(named.slot, headline, ctx.topic);
      setText(named.el, enforceSlotBudgets(fallback, named.slot, named.el), textOpts);
    } else if (named.slot?.prune_if_unfilled) {
      named.remove();
    } else {
      setText(named.el, "");
    }
  }

  // Removing elements can orphan container/group wrappers — drop the empties
  // so no hollow chrome box is left on the slide.
  for (const component of components) pruneEmptyContainers(component);

  const photoSlots = findAllPhotoSlots(components);
  const heroImage = findHeroImage(photoSlots);
  const secondaryImages = findSecondaryImages(photoSlots, heroImage);

  return { ui: { id: layout.id, components }, heroImage, secondaryImages };
}

/* --------------------------- Streamed slide mode --------------------------- */

/** Stream-mode slide mount (`slide_start`): the layout is cloned with every
 *  named text slot CLEARED — no fallbacks, no pruning — so the user sees the
 *  empty template the instant the model picks it, and each streamed fill then
 *  lands live via applyFillsToUi. The unfilled-slot policy (fallbacks/pruning)
 *  is deferred to finalizeStreamedSlide at `slide_end`, because a slot that is
 *  empty RIGHT NOW may simply not have streamed in yet. Photo markers are
 *  collected here (they don't move with text) so photo jobs can start before
 *  the first fill even arrives. */
export function buildEmptySlideUi(
  layout: TemplateLayout,
  pageNumber?: number,
): FilledSlide {
  const components = JSON.parse(JSON.stringify(layout.components)) as Rec[];
  const namedSlots = collectNamedTextSlots(components);
  for (const named of namedSlots) {
    if (named.kind === "chart") continue; // an unfilled chart keeps its frame
    if (named.slot?.role === "page-number") {
      setText(named.el, pageNumber != null ? String(pageNumber) : "");
      continue;
    }
    setText(named.el, "");
  }
  const photoSlots = findAllPhotoSlots(components);
  const heroImage = findHeroImage(photoSlots);
  const secondaryImages = findSecondaryImages(photoSlots, heroImage);
  return { ui: { id: layout.id, components }, heroImage, secondaryImages };
}

/** Stream-mode finalization (`slide_end`): the safety-net half of
 *  fillLayoutWithSlotMap, applied to a slide whose fills already streamed in
 *  via applyFillsToUi. Slots the model never sent a fill for get the batch
 *  path's exact treatment — "always" slots backstopped from the deck's own
 *  material, prune-marked elements removed, optional leftovers cleared —
 *  without touching the text/charts/photos that are already in place. Returns
 *  a new ui (input is not mutated). */
export function finalizeStreamedSlide(
  ui: Rec,
  line: ManifestSlideLine,
  ctx: { topic: string; pageNumber?: number },
): Rec {
  const next = JSON.parse(JSON.stringify(ui)) as Rec;
  const components = (next.components as Rec[]) ?? [];
  const namedSlots = collectNamedTextSlots(components);
  const textOpts: SetTextOptions = {
    siblings: components,
    stage: { w: EDITOR_STAGE_WIDTH, h: EDITOR_STAGE_HEIGHT },
  };

  const fillsByName = new Map<string, SlotFill[]>();
  for (const fill of line.fills) {
    const list = fillsByName.get(fill.name) ?? [];
    list.push(fill);
    fillsByName.set(fill.name, list);
  }

  const headline =
    line.fills.find((f) => /title|headline|heading/i.test(f.name))?.text ?? "";

  for (const named of namedSlots) {
    if (named.slot?.role === "page-number") continue; // stamped at slide_start
    // Shift EVERY occurrence with a fill to keep the Nth-fill → Nth-element
    // alignment — the fill itself was already applied when it streamed in.
    const fill = fillsByName.get(named.name)?.shift();
    if (fill) continue;
    if (named.kind === "chart") {
      if (named.slot?.prune_if_unfilled) named.remove();
      continue;
    }
    const condition = named.slot?.fill_condition ?? "always";
    if (condition === "always") {
      const fallback = fallbackForAlwaysSlot(named.slot, headline, ctx.topic);
      setText(named.el, enforceSlotBudgets(fallback, named.slot, named.el), textOpts);
    } else if (named.slot?.prune_if_unfilled) {
      named.remove();
    } else {
      setText(named.el, "");
    }
  }

  for (const component of components) pruneEmptyContainers(component);
  return next;
}

/** Compact per-slot descriptors (name/role/budgets) of a layout — the payload
 *  the visual reviewer checks a rendered slide against. */
export function describeLayoutSlots(
  layout: TemplateLayout,
): { name: string; role?: string; max_words?: number; ideal_words?: number }[] {
  const clone = JSON.parse(JSON.stringify(layout.components)) as Rec[];
  return collectNamedTextSlots(clone).map((named) => ({
    name: named.name,
    ...(named.slot?.role ? { role: named.slot.role } : {}),
    ...(named.slot?.max_words != null ? { max_words: named.slot.max_words } : {}),
    ...(named.slot?.ideal_words != null ? { ideal_words: named.slot.ideal_words } : {}),
  }));
}

/** Targeted fill application on an EXISTING slide ui: writes fills into the
 *  named slots in place. Used by both consumers that patch a live slide —
 *  the streamed per-element fills during generation (one fill at a time, as
 *  each `{"type":"fill"}` line arrives) and the visual review's repair pass.
 *  Unlike fillLayoutWithSlotMap nothing is pruned, fall-backed or re-laid
 *  out — photos and icons already patched into the slide survive. Returns a
 *  new ui (input is not mutated). */
export function applyFillsToUi(ui: Rec, fills: SlotFill[]): Rec {
  const next = JSON.parse(JSON.stringify(ui)) as Rec;
  const components = (next.components as Rec[]) ?? [];
  const namedSlots = collectNamedTextSlots(components);
  // Same box-resize context as the initial fill — a repaired fill can still be
  // longer than the box, and growing the box beats shrinking the font again.
  const textOpts: SetTextOptions = {
    siblings: components,
    stage: { w: EDITOR_STAGE_WIDTH, h: EDITOR_STAGE_HEIGHT },
  };

  const fillsByName = new Map<string, SlotFill[]>();
  for (const fill of fills) {
    const list = fillsByName.get(fill.name) ?? [];
    list.push(fill);
    fillsByName.set(fill.name, list);
  }

  for (const named of namedSlots) {
    const fill = fillsByName.get(named.name)?.shift();
    if (!fill) continue;
    if (named.kind === "chart") {
      if (fill.chart) writeChartData(named.el, fill.chart);
      continue;
    }
    if (fill.text != null && fill.text.trim()) {
      setText(named.el, enforceSlotBudgets(fill.text, named.slot, named.el), textOpts);
    }
  }

  return next;
}

/* ---------------------- Visual-review "resize" fix ------------------------ */

// Candidate scales tried largest-first — the biggest one that still fits the
// slot's AUTHORED box height wins. Small enough that a mildly-optimistic
// reviewer call doesn't blow past the box; large enough to read as an
// obvious size bump rather than a rounding error.
const FONT_BOOST_CANDIDATES = [1.25, 1.15, 1.08];

/** Wrapped height of a text element's current content at `fontScale`, within
 *  `width` — the same measurement setText's own fit check uses, run in the
 *  growth direction instead of the shrink direction. */
function wrappedHeightAtScale(el: Rec, fontScale: number, width: number): number {
  const font = rawFont(el as never);
  const scaledFont = { ...font, size: font.size * fontScale };
  const lines = layoutRenderTextRuns(
    [{ text: rawTextContent(el as never), font: scaledFont }],
    width,
    undefined,
  );
  return lines.reduce((sum, line) => sum + lineRenderHeight(line, scaledFont.lineHeight), 0);
}

/** Grows the font of named plain-text slots the reviewer flagged as too small
 *  for their empty space ("resize" issues). Box position/size are never
 *  touched — only font metrics — and only up to whichever candidate scale
 *  still fits the box's ORIGINAL height at its ORIGINAL width. A slot where
 *  even the smallest candidate would overflow is left untouched (`changed`
 *  reports whether anything actually moved, so a no-op fix doesn't fool the
 *  caller into re-verifying for nothing). Text-list/table/chart elements are
 *  skipped — this only handles plain "text" elements, which cover the
 *  headline/body-copy cases the reviewer actually flags. Returns a new ui
 *  (input is not mutated). */
export function applyFontBoostToUi(
  ui: Rec,
  slotNames: string[],
): { ui: Rec; changed: boolean } {
  const next = JSON.parse(JSON.stringify(ui)) as Rec;
  const components = (next.components as Rec[]) ?? [];
  const namedSlots = collectNamedTextSlots(components);
  const targets = new Set(slotNames);
  let changed = false;

  for (const named of namedSlots) {
    if (named.kind !== "text" || named.el.type !== "text" || !targets.has(named.name)) continue;
    const size = named.el.size as Rec | undefined;
    const width = typeof size?.width === "number" ? size.width : null;
    const height = typeof size?.height === "number" ? size.height : null;
    if (width == null || height == null) continue;

    const fitScale = FONT_BOOST_CANDIDATES.find(
      (scale) => wrappedHeightAtScale(named.el, scale, width) <= height,
    );
    if (!fitScale) continue;

    Object.assign(named.el, scaleRawTextMetrics(named.el as never, fitScale));
    changed = true;
  }

  return { ui: next, changed };
}

/* --------------------- Visual-review "contrast" fix ----------------------- */

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Sets a text element's color on both its base font and every run's font —
 *  mirrors how applyTextStyle (model.ts) propagates a color edit, since a
 *  renderer reading run-level font would otherwise keep the old color even
 *  after the base font changed. */
function setTextColor(el: Rec, color: string): void {
  el.font = { ...(el.font as Rec | undefined), color };
  const runs = el.runs as Rec[] | undefined;
  if (Array.isArray(runs) && runs.length > 0) {
    el.runs = runs.map((run) => ({
      ...run,
      font: { ...((run as Rec).font as Rec | undefined), color },
    }));
  }
}

/** One "contrast" fix: which text slot, and the hex color the reviewer judged
 *  would read clearly against what it actually saw behind the text. */
export interface TextColorFix {
  name: string;
  color: string;
}

/** Recolors named plain-text slots the reviewer flagged as too low-contrast
 *  to read ("contrast" issues) — box, size and every other style stay
 *  untouched, only font.color changes. Consumes fixes in document order the
 *  same way applyFillsToUi consumes fills, so a repeated slot name with two
 *  distinct fixes lands each on its own element instead of both on the
 *  first. A malformed color (not `#rgb`/`#rrggbb`) is skipped rather than
 *  written verbatim. Text-list/table/chart elements are skipped — same scope
 *  as applyFontBoostToUi. Returns a new ui (input is not mutated). */
export function applyTextColorToUi(ui: Rec, fixes: TextColorFix[]): { ui: Rec; changed: boolean } {
  const next = JSON.parse(JSON.stringify(ui)) as Rec;
  const components = (next.components as Rec[]) ?? [];
  const namedSlots = collectNamedTextSlots(components);
  let changed = false;

  const fixesByName = new Map<string, TextColorFix[]>();
  for (const fix of fixes) {
    if (!HEX_COLOR_RE.test(fix.color)) continue;
    const list = fixesByName.get(fix.name) ?? [];
    list.push(fix);
    fixesByName.set(fix.name, list);
  }

  for (const named of namedSlots) {
    if (named.kind !== "text" || named.el.type !== "text") continue;
    const fix = fixesByName.get(named.name)?.shift();
    if (!fix) continue;
    setTextColor(named.el, fix.color);
    changed = true;
  }

  return { ui: next, changed };
}

/** High-level entry: fill + swap placeholder icons, mirroring
 *  mapAIPPTSlideToTemplateUi's role in the legacy path. Returns null when the
 *  layout id isn't in the pack (model hallucinated an id). */
export async function fillManifestSlide(
  layout: TemplateLayout | null,
  line: ManifestSlideLine,
  ctx: { topic: string; pageNumber?: number },
): Promise<FilledSlide | null> {
  if (!layout) return null;
  const filled = fillLayoutWithSlotMap(layout, line, ctx);
  const iconFallback =
    line.fills.find((f) => /title|headline|heading/i.test(f.name))?.text || ctx.topic;
  filled.ui = await fillPlaceholderIcons(filled.ui, iconFallback);
  return filled;
}
