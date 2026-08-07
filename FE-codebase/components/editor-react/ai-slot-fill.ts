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
// Colors, positions, decorative elements, and fonts are never touched —
// the slide stays exactly as the template author designed it.

import {
  findAllPhotoSlots,
  findHeroImage,
  findSecondaryImages,
  fillPlaceholderIcons,
  pruneEmptyContainers,
  setText,
  type FilledSlide,
} from "@/components/editor-react/ai-layout-fill";
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

/** The new JSONL contract — one line per slide:
 *  {"type":"slide","layout_id":"...","fills":[{"name":"...","text":"..."}, ...]} */
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
      setText(named.el, enforceSlotBudgets(text, named.slot, named.el));
      continue;
    }
    // Unfilled:
    const condition = named.slot?.fill_condition ?? "always";
    if (condition === "always") {
      const fallback = fallbackForAlwaysSlot(named.slot, headline, ctx.topic);
      setText(named.el, enforceSlotBudgets(fallback, named.slot, named.el));
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

/** Targeted repair pass on an EXISTING slide ui (used by the post-generation
 *  visual review): writes corrected fills into the named slots in place.
 *  Unlike fillLayoutWithSlotMap nothing is pruned, fall-backed or re-laid
 *  out — photos and icons already patched into the slide survive. Returns a
 *  new ui (input is not mutated). */
export function applyFillsToUi(ui: Rec, fills: SlotFill[]): Rec {
  const next = JSON.parse(JSON.stringify(ui)) as Rec;
  const components = (next.components as Rec[]) ?? [];
  const namedSlots = collectNamedTextSlots(components);

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
      setText(named.el, enforceSlotBudgets(fill.text, named.slot, named.el));
    }
  }

  return next;
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
