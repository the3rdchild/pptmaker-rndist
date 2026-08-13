// Fills AI-generated slide content into one of the existing hand-designed
// template layouts (templates/*/template.json in storage) instead of authoring
// a slide from scratch. Picks a layout matching the slide's role, then
// walks its component tree filling only non-decorative text placeholders —
// every other design decision (colors, decorative shapes, positions,
// chart/table example data) is left exactly as the template author made it,
// EXCEPT icon placeholders (every pack ships every icon slot as the exact
// same generic /static/icons/placeholder.svg) — those get swapped for a
// real, content-relevant icon below.
//
// This mirrors the old PPTist "AIPPT" template-filling behaviour (see
// worker/services/deck_service.py's AIPPTSlide contract) that got dropped
// when the flat hardcoded layouts in map-slide.ts were written as a stub.

import { PresentationGenerationApi } from "@/app/(presentation-generator)/services/api/presentation-generation";
import {
  rawFont,
  layoutRenderTextRuns,
  lineRenderHeight,
  type RenderTextFont,
  type RenderTextRun,
} from "@/components/slide-editor/text/template-v2-text";
import {
  layoutChildren,
  elementBox,
  componentBox,
  childArrayInfo,
  normalizeId,
  cloneJson,
  type Point,
  type Size,
} from "@/components/slide-editor/model/model";
import {
  DEFAULT_THEME_ID,
  loadAllThemes,
} from "@/lib/templates/themes";
import { isImageFrameElement } from "@/components/editor-react/image-frames";

export type AIPPTSlide =
  | { type: "cover"; data: { title: string; text: string } }
  | { type: "contents"; data: { items: string[] } }
  | { type: "transition"; data: { title: string; text: string } }
  | { type: "content"; data: { title: string; items: { title: string; text: string }[] } }
  | { type: "end" };

type Rec = Record<string, unknown>;

interface TemplateLayout {
  id: string;
  description?: string;
  /** Authoring metadata from the template engine (slide_role, topics, items). */
  meta?: Rec;
  components: Rec[];
}

interface TemplatePack {
  layouts: TemplateLayout[];
  fonts?: Record<string, string> | null;
}

let packCache: Record<string, TemplatePack> | null = null;
let packNamesCache: string[] | null = null;

/** Every theme in the registry that actually has layouts to pick from, keyed
 *  by id. Themes hand back layouts whose asset paths are already resolved
 *  against their own folder, so filling a layout from any theme is safe.
 *  A theme id can be listed in index.json (so the template engine's picker
 *  still shows it for management) while holding zero layouts — never
 *  populated, or mid-rebuild. Excluded here so it can never be the pack a
 *  deck's seed hash lands on: an empty pack would leave that deck's
 *  generation with no layouts at all. */
async function loadAllPacks(): Promise<Record<string, TemplatePack>> {
  if (packCache) return packCache;
  const themes = (await loadAllThemes()).filter((theme) => theme.layouts.length > 0);
  packCache = Object.fromEntries(
    themes.map((theme) => [
      theme.id,
      { layouts: theme.layouts as unknown as TemplateLayout[], fonts: theme.fonts },
    ])
  );
  packNamesCache = themes.map((theme) => theme.id);
  return packCache;
}

// Derived from loadAllPacks() (not a separate listThemeIds() call) so the
// name pool a deck's seed hash picks from is always the SAME set that
// actually has a pack behind it — no window where an empty theme is
// choosable by name but resolves to nothing.
async function loadPackNames(): Promise<string[]> {
  if (packNamesCache) return packNamesCache;
  await loadAllPacks();
  return packNamesCache ?? [];
}

/** Lowercased, punctuation collapsed to single spaces, padded — so a key can be
 *  looked up with indexOf and still only match on whole words. */
function themeText(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Finds the theme the author asked for in the generation prompt, e.g.
 *  "buatkan ppt tentang kerjaan, gunakan theme cassual".
 *
 *  Matching is deliberately anchored to an explicit theme/tema/template word
 *  rather than scanning the whole prompt: theme NAMES here include `modern`,
 *  `general` and `standard`, so a deck that merely talks about "arsitektur
 *  modern" must not silently switch packs. Text after the anchor wins over text
 *  before it, which is what separates "…arsitektur modern, gunakan theme
 *  cassual" (cassual) from "use the modern theme" (modern).
 *
 *  Returns null when no theme is named, leaving the seed hash in charge. */
export async function resolveThemeFromPrompt(
  prompt: string,
): Promise<string | null> {
  if (!prompt) return null;
  const themes = await loadAllThemes();
  if (themes.length === 0) return null;

  // Longest first so a name that contains another still wins outright.
  const keys = themes
    .flatMap((theme) => {
      const names = [theme.name ?? "", theme.id].filter(Boolean);
      return names.map((name) => ({ id: theme.id, key: themeText(name) }));
    })
    .filter((entry) => entry.key.trim().length > 0)
    .sort((a, b) => b.key.length - a.key.length);

  const lower = prompt.toLowerCase();
  const anchor = /\b(?:themes?|tema(?:nya)?|templates?)\b/g;

  const pick = (window: string, fromEnd: boolean): string | null => {
    const haystack = themeText(window);
    let best: { id: string; at: number } | null = null;
    for (const { id, key } of keys) {
      const at = fromEnd ? haystack.lastIndexOf(key) : haystack.indexOf(key);
      if (at < 0) continue;
      const closer = fromEnd ? at > (best?.at ?? -1) : at < (best?.at ?? Infinity);
      if (!best || closer) best = { id, at };
    }
    return best?.id ?? null;
  };

  for (let m = anchor.exec(lower); m; m = anchor.exec(lower)) {
    const end = m.index + m[0].length;
    const after = pick(lower.slice(end, end + 32), false);
    if (after) return after;
    const before = pick(lower.slice(Math.max(0, m.index - 26), m.index), true);
    if (before) return before;
  }
  return null;
}

function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33) ^ seed.charCodeAt(i);
  return hash >>> 0;
}

/** The author's own `slide_role`, when the layout carries one. Authored in the
 *  template engine, so it beats guessing from id/description text. */
function slideRoleOf(layout: TemplateLayout): string | null {
  const meta = layout.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const role = (meta as Rec).slide_role;
  return typeof role === "string" && role ? role : null;
}

function isCoverLayout(layout: TemplateLayout): boolean {
  const role = slideRoleOf(layout);
  if (role) return role === "cover";
  const s = `${layout.id} ${layout.description ?? ""}`.toLowerCase();
  return s.includes("cover");
}

function isContentsLayout(layout: TemplateLayout): boolean {
  const role = slideRoleOf(layout);
  if (role) return role === "agenda";
  const s = `${layout.id} ${layout.description ?? ""}`.toLowerCase();
  return s.includes("index") || s.includes("contents") || s.includes("agenda") || s.includes("toc");
}

interface Buckets {
  cover: TemplateLayout[];
  contents: TemplateLayout[];
  /** Sign-off layouts. Without these an `end` slide fell back to the cover, so
   *  a deck opened and closed on the same design. */
  closing: TemplateLayout[];
  /** Chapter breaks. Same story: `transition` used to reuse the cover, which is
   *  why a deck showed its cover design three or four times over. */
  section: TemplateLayout[];
  content: TemplateLayout[];
  /** Layouts that need numeric/stat data the AI can't supply yet. Parked
   *  here so the picker never rotates them into a generated deck; they stay
   *  available for manual insert from the Templates panel. */
  metrics: TemplateLayout[];
}

// Layouts audited as needing real numeric data (big figures / stat cards).
// Excluded from AI generation until the AI can research actual figures — a
// metric card filled with prose reads as fabricated ("92% — [unrelated
// sentence]"). Detected by structure too (hasMetricCardSlot) so new layouts
// with the same shape are caught automatically.
const METRIC_LAYOUT_IDS = new Set([
  "centered_metrics_layout_9752",
  "split_content_metrics_4327",
  "stat_row_layout_4821",
  "two_column_metrics_7973",
  "top_header_metric_cards_2015",
  "icon_stat_tiles_5602",
  "two_column_layout_2710",
  "two_column_info_layout_8378",
]);

// True if the layout contains a grid/flex card whose subtree has a text leaf
// named like a metric/stat value — i.e. it expects numeric data per card.
function hasMetricCardSlot(layout: TemplateLayout): boolean {
  if (METRIC_LAYOUT_IDS.has(layout.id)) return true;
  const components = Array.isArray(layout.components) ? (layout.components as Rec[]) : [];
  for (const component of components) {
    const elements = Array.isArray(component?.elements) ? (component.elements as Rec[]) : [];
    for (const el of elements) {
      if (gridFlexHasMetricLeaf(el)) return true;
    }
  }
  return false;
}

function gridFlexHasMetricLeaf(el: Rec | null): boolean {
  if (!el) return false;
  const type = el.type;
  const children = el.children as Rec[] | undefined;
  if ((type === "grid" || type === "flex") && Array.isArray(children) && children.length > 1) {
    for (const card of children) {
      if (subtreeHasMetricLeaf(card)) return true;
    }
    return false;
  }
  return false;
}

function subtreeHasMetricLeaf(node: Rec | null | undefined): boolean {
  if (!node) return false;
  const type = node.type;
  if (type === "text" || type === "text-list") {
    if (/metric|stat/i.test(String(node.name ?? ""))) return true;
    return false;
  }
  const children = node.children as Rec[] | undefined;
  if (Array.isArray(children)) {
    for (const c of children) if (subtreeHasMetricLeaf(c)) return true;
    return false;
  }
  const child = node.child as Rec | undefined;
  if (child) return subtreeHasMetricLeaf(child);
  return false;
}

function bucketLayouts(layouts: TemplateLayout[]): Buckets {
  const cover: TemplateLayout[] = [];
  const contents: TemplateLayout[] = [];
  const closing: TemplateLayout[] = [];
  const section: TemplateLayout[] = [];
  const content: TemplateLayout[] = [];
  const metrics: TemplateLayout[] = [];
  for (const l of layouts) {
    const role = slideRoleOf(l);
    if (isCoverLayout(l)) cover.push(l);
    else if (isContentsLayout(l)) contents.push(l);
    else if (role === "closing") closing.push(l);
    else if (role === "section") section.push(l);
    // An authored `metrics` role is the layout author saying outright that this
    // one needs real figures — the structural sniff below only catches metric
    // cards nested in a grid/flex, which flat imported layouts never have.
    else if (role === "metrics" || hasMetricCardSlot(l)) metrics.push(l);
    else content.push(l);
  }
  return { cover, contents, closing, section, content, metrics };
}

/** Picks one template pack per deck (deterministic from a seed) and rotates
 * through its content layouts so consecutive content slides don't repeat. */
export class DeckLayoutPicker {
  private buckets: Buckets | null = null;
  private layouts: TemplateLayout[] = [];
  private contentCursor = 0;
  private seed: string;
  /** Resolved in ensureLoaded() — the theme list is fetched, not compiled in,
   *  so a theme added to storage is picked up without a code change. */
  private packName: string | null = null;
  private packFonts: Record<string, string> | null = null;

  /** A theme the author named in the prompt. Wins over the seed hash, which is
   *  arbitrary by design (it only exists to spread decks across the packs). */
  private preferred: string | null;

  constructor(seed: string, preferredThemeId?: string | null) {
    this.seed = seed;
    this.preferred = preferredThemeId ?? null;
  }

  async ensureLoaded(): Promise<void> {
    if (this.buckets) return;
    const names = await loadPackNames();
    const asked =
      this.preferred && names.includes(this.preferred) ? this.preferred : null;
    this.packName =
      this.packName ?? asked ?? names[hashSeed(this.seed) % Math.max(1, names.length)];
    const packs = await loadAllPacks();
    // this.packName (seed-hashed or explicitly asked for) and DEFAULT_THEME_ID
    // both name IDS, not guaranteed entries in `packs` — loadAllPacks already
    // dropped any theme with zero layouts, so either can be missing here.
    // Object.values(packs)[0] is the last resort: any real pack beats none.
    const pack = packs[this.packName] ?? packs[DEFAULT_THEME_ID] ?? Object.values(packs)[0];
    if (!pack) throw new Error("No template layouts are available in any theme.");
    this.layouts = pack.layouts;
    this.buckets = bucketLayouts(pack.layouts);
    this.packFonts = (pack.fonts ?? null) as Record<string, string> | null;
  }

  /** The theme this deck was assigned. Available after ensureLoaded(). */
  getThemeId(): string | null {
    return this.packName;
  }

  /** Every layout in the chosen pack, in authored order — used by the
   *  manifest-driven fill path where the MODEL picks the layout id. */
  getLayouts(): TemplateLayout[] {
    return this.layouts;
  }

  /** Looks up one layout in the chosen pack by its authored id. */
  getLayoutById(id: string): TemplateLayout | null {
    return this.layouts.find((l) => l.id === id) ?? null;
  }

  /** The chosen pack's font map ({ family: cssUrl }). Available after
   *  ensureLoaded(). Used so the editor/present render path loads the right
   *  per-pack typeface instead of only the generic Google-Fonts fallback. */
  getFonts(): Record<string, string> | null {
    return this.packFonts;
  }

  private fallbackContent(): TemplateLayout {
    const b = this.buckets!;
    const pool = b.content.length ? b.content : [...b.cover, ...b.contents];
    const layout = pool[this.contentCursor % pool.length];
    this.contentCursor++;
    return layout;
  }

  pickFor(type: AIPPTSlide["type"]): TemplateLayout {
    const b = this.buckets;
    if (!b) throw new Error("DeckLayoutPicker not loaded — call ensureLoaded() first");
    switch (type) {
      case "cover":
        return b.cover[0] ?? this.fallbackContent();
      case "end":
        // Falling through to the cover is the last resort, not the default: a
        // deck that opens and closes on the same slide design reads as a bug.
        return b.closing[0] ?? b.cover[0] ?? this.fallbackContent();
      case "contents":
        return b.contents[0] ?? this.fallbackContent();
      case "transition":
        // A chapter break is not a cover. With no section layout authored,
        // rotating a content layout still beats showing the cover again.
        return b.section[0] ?? this.fallbackContent();
      case "content":
      default:
        return this.fallbackContent();
    }
  }
}

/* ------------------------------ Fill logic -------------------------------- */

type TextLeaf = { el: Rec; fontSize: number; remove?: () => void };

/** One "item slot" is a repeated child of a grid/flex (a card, a row, …).
 * `remove()` splices this slot's own card out of its parent grid/flex's
 * `children` array (which flowLayout.ts sizes/positions purely from
 * `children.length`, so removing a card reflows the rest instead of leaving
 * a gap) — used when there's no AI content to put in it, instead of either
 * duplicating another card's text into it or leaving the template's literal
 * "Lorem ipsum" sample copy on screen. */
type ItemSlot = { leaves: TextLeaf[]; remove: () => void };

function fontSizeOf(el: Rec): number {
  const font = el.font as Rec | undefined;
  const n = font?.size;
  return typeof n === "number" ? n : 0;
}

function isTextLike(el: Rec): boolean {
  return (el.type === "text" || el.type === "text-list") && el.decorative !== true;
}

// Template-authored metric/stat/unit text elements carry numeric samples like
// "95%", "92%", "150", or a lone "%" (metric_unit). The AI supplies prose
// (titles + paragraphs), never numbers, so filling these leaves with item
// text produced nonsense (a long sentence crammed into a tiny metric box,
// wrapping one character per line). Treat such leaves as non-fillable so
// they keep their authored sample instead — they read as a placeholder figure
// rather than broken overflowing copy.
function textSample(el: Rec): string {
  const runs = el.runs as Rec[] | undefined;
  if (Array.isArray(runs)) {
    return runs.map((r) => String((r as Rec)?.text ?? "")).join("");
  }
  return "";
}

function isMetricOrStatSample(el: Rec): boolean {
  if (!isTextLike(el)) return false;
  const name = String(el.name ?? "");
  const looksStat = /metric|stat|value|unit|figure|number|percent/i.test(name);
  if (!looksStat) return false;
  // A leading number, an optional short unit word (K, h, Billion, Million…),
  // an optional trailing symbol — e.g. "92%", "150K", "1.4 Billion", "24h".
  // Anything starting with a digit-looking figure is treated as numeric
  // chrome the AI (which only supplies prose) shouldn't overwrite. A real
  // prose field ("metric_description": "These forests absorb…") doesn't start
  // with a bare number, so it stays fillable.
  return /^[\d.,+\-]+\s*[a-zA-Z]{0,12}[%+\-]*$/.test(textSample(el).trim());
}

function isFillableText(el: Rec): boolean {
  return isTextLike(el) && !isMetricOrStatSample(el);
}

/** Flattens every text leaf under `node`, regardless of further nesting —
 * used to gather the (title, body, ...) leaves that belong to one item slot. */
function collectAllTextLeaves(node: Rec, out: TextLeaf[]): void {
  if (isFillableText(node)) {
    out.push({ el: node, fontSize: fontSizeOf(node) });
    return;
  }
  const children = node.children as Rec[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) collectAllTextLeaves(child, out);
    return;
  }
  const child = node.child as Rec | undefined;
  if (child) collectAllTextLeaves(child, out);
}

/** Walks a component's element tree. Only `grid`/`flex` containers with more
 * than one child are treated as repeated item slots (cards, rows, ...) —
 * `group`/`container` wrappers are just layout grouping and get flattened
 * into the surrounding context instead, so e.g. a title+subtitle held
 * together in a `group` stay "global" text rather than becoming two
 * mismatched item slots.
 *
 * Global text leaves carry an optional `remove()` so surplus global text
 * (e.g. a 3rd overlapping copy of a tagline in some templates) can be
 * spliced out of its parent array instead of being filled with a duplicated
 * summary — which previously stacked the same paragraph 3× on the same spot.
 * The `removeSelf` arg threads the parent-array + index from the caller. */
function walkElement(
  el: Rec,
  global: TextLeaf[],
  slots: ItemSlot[],
  removeSelf?: () => void,
): void {
  if (isFillableText(el)) {
    global.push({ el, fontSize: fontSizeOf(el), remove: removeSelf });
    return;
  }

  const type = el.type;
  const children = el.children as Rec[] | undefined;
  if ((type === "grid" || type === "flex") && Array.isArray(children) && children.length > 1) {
    for (const child of children) {
      const leaves: TextLeaf[] = [];
      collectAllTextLeaves(child, leaves);
      if (leaves.length) {
        slots.push({
          leaves,
          remove: () => {
            const idx = children.indexOf(child);
            if (idx !== -1) children.splice(idx, 1);
          },
        });
      }
    }
    return;
  }
  if (Array.isArray(children)) {
    children.forEach((child, index) =>
      walkElement(child, global, slots, () => {
        const idx = children.indexOf(child);
        if (idx !== -1) children.splice(idx, 1);
        void index;
      }),
    );
    return;
  }

  const child = el.child as Rec | undefined;
  if (child) {
    walkElement(child, global, slots, () => {
      delete el.child;
    });
  }
}

function collectComponent(component: Rec): { global: TextLeaf[]; slots: ItemSlot[] } {
  const global: TextLeaf[] = [];
  const slots: ItemSlot[] = [];
  const elements = (component.elements as Rec[]) ?? [];
  // Give top-level component.elements entries a working remove() too — same
  // splice-out-of-parent-array pattern walkElement already uses one level
  // down. Without this, a global text leaf that happens to sit DIRECTLY in
  // component.elements (very common — e.g. a "name"/"date" caption card
  // authored as siblings, not nested in a wrapper) silently no-ops when
  // fillLayout tries to remove it as surplus, since `remove` stayed
  // undefined for it.
  for (const el of elements) {
    walkElement(el, global, slots, () => {
      const idx = elements.indexOf(el);
      if (idx !== -1) elements.splice(idx, 1);
    });
  }
  return { global, slots };
}

// NOTE: `el.max_length` is a template-authoring hint for the layout's own
// sample copy — nothing in the actual render/measure/edit path enforces it
// (no auto-shrink, no wrap-then-clip), so treating it as a hard character
// cap here just mid-word-truncates real AI titles ("Cara Menggunakan
// Python" -> "Cara Meng…") for no benefit. Text is written in full instead;
// see fittedFontSize below for how overflow is actually handled now.

const MIN_FONT_SCALE = 0.55;
const FIT_ITERATIONS = 6;

/* --------------------- Box-resize before font-shrink --------------------- *
 * The generator now has authority to RESIZE a text box before shrinking its
 * font. Overflow is handled in priority order:
 *   1. measure wrapped height at the original font size — if it already fits,
 *      leave everything alone;
 *   2. otherwise try to GROW the box into surrounding empty space (the widest
 *      gap to the nearest sibling or the stage edge, in the single best
 *      direction) so the text still fits at full size;
 *   3. only if growing is impossible or insufficient, shrink the font (down to
 *      MIN_FONT_SCALE) against whatever box size we ended up with.
 * Growing first keeps titles/headlines readable; font-shrink is the last
 * resort, not the first. `elementBox` from model/model.ts is NOT used here
 * because it returns the VISUAL box (auto-grown to content) for text — we need
 * the AUTHORED box (position+size as designed) to detect overflow at all. */

interface AuthoredBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function authoredBox(el: Rec): AuthoredBox | null {
  const pos = el.position as Rec | undefined;
  const size = el.size as Rec | undefined;
  const x = typeof pos?.x === "number" ? pos.x : undefined;
  const y = typeof pos?.y === "number" ? pos.y : undefined;
  const w = typeof size?.width === "number" ? size.width : undefined;
  const h = typeof size?.height === "number" ? size.height : undefined;
  if (x == null || y == null || w == null || h == null) return null;
  return { x, y, w, h };
}

/** Collects authored boxes of every OTHER element in the slide (siblings),
 *  walking the same children/child/elements nesting collectNamedTextSlots
 *  uses — so a box nested deep inside a card still counts as an obstacle. */
function collectObstacleBoxes(components: Rec[], skip: Rec): AuthoredBox[] {
  const out: AuthoredBox[] = [];
  const stack: Rec[] = [...components];
  while (stack.length) {
    const node = stack.pop()!;
    if (node && node !== skip) {
      const box = authoredBox(node);
      if (box) out.push(box);
    }
    const children = node?.children as Rec[] | undefined;
    if (Array.isArray(children)) stack.push(...children);
    const child = node?.child as Rec | undefined;
    if (child && typeof child === "object") stack.push(child);
    const elements = node?.elements as Rec[] | undefined;
    if (Array.isArray(elements)) stack.push(...elements);
  }
  return out;
}

function aabbOverlap(a: AuthoredBox, b: AuthoredBox, eps = 0.5): boolean {
  return (
    a.x < b.x + b.w - eps &&
    a.x + a.w > b.x + eps &&
    a.y < b.y + b.h - eps &&
    a.y + a.h > b.y + eps
  );
}

interface Space4 {
  up: number;
  down: number;
  left: number;
  right: number;
}

/** For each of the four directions, the distance from the box edge to the
 *  nearest blocker (a sibling or the stage boundary). A direction with zero
 *  room can't grow that way at all. */
function availableSpace(
  box: AuthoredBox,
  obstacles: AuthoredBox[],
  stage: { w: number; h: number },
): Space4 {
  let up = box.y; // distance to top stage edge
  let down = stage.h - (box.y + box.h);
  let left = box.x;
  let right = stage.w - (box.x + box.w);
  for (const o of obstacles) {
    // Only obstacles that are horizontally aligned constrain up/down growth.
    const horizontallyAligned = o.x < box.x + box.w && o.x + o.w > box.x;
    if (horizontallyAligned) {
      if (o.y + o.h <= box.y) up = Math.min(up, box.y - (o.y + o.h));
      if (o.y >= box.y + box.h) down = Math.min(down, o.y - (box.y + box.h));
    }
    const verticallyAligned = o.y < box.y + box.h && o.y + o.h > box.y;
    if (verticallyAligned) {
      if (o.x + o.w <= box.x) left = Math.min(left, box.x - (o.x + o.w));
      if (o.x >= box.x + box.w) right = Math.min(right, o.x - (box.x + box.w));
    }
  }
  return { up: Math.max(0, up), down: Math.max(0, down), left: Math.max(0, left), right: Math.max(0, right) };
}

/** Grows the box into its largest empty direction until the text fits or the
 *  space is exhausted. Returns the grown box, or null if no single direction
 *  offered enough room. Only one direction is chosen (the widest) to avoid the
 *  box sprawling diagonally into other content. */
function tryGrowBoxToFit(
  box: AuthoredBox,
  needed: { w: number; h: number },
  space: Space4,
): AuthoredBox | null {
  // Pick the single direction with the most room. Prefer the direction that
  // actually addresses the deficit (down/right for width, up/down for height).
  const dirs = [
    { key: "down" as const, room: space.down, axis: "v" as const },
    { key: "up" as const, room: space.up, axis: "v" as const },
    { key: "right" as const, room: space.right, axis: "h" as const },
    { key: "left" as const, room: space.left, axis: "h" as const },
  ];
  for (const dir of dirs.sort((a, b) => b.room - a.room)) {
    if (dir.room <= 0.5) continue;
    let next: AuthoredBox;
    if (dir.key === "down") {
      const grow = Math.min(dir.room, Math.max(0, needed.h - box.h));
      if (grow <= 0) continue;
      next = { ...box, h: box.h + grow };
    } else if (dir.key === "up") {
      const grow = Math.min(dir.room, Math.max(0, needed.h - box.h));
      if (grow <= 0) continue;
      next = { ...box, y: box.y - grow, h: box.h + grow };
    } else if (dir.key === "right") {
      const grow = Math.min(dir.room, Math.max(0, needed.w - box.w));
      if (grow <= 0) continue;
      next = { ...box, w: box.w + grow };
    } else {
      const grow = Math.min(dir.room, Math.max(0, needed.w - box.w));
      if (grow <= 0) continue;
      next = { ...box, x: box.x - grow, w: box.w + grow };
    }
    return next;
  }
  return null;
}

/** Measures the wrapped height of `text` at `font` within `width`, using the
 *  same layoutRenderTextRuns/lineRenderHeight the renderer uses. */
function wrappedHeight(text: string, font: RenderTextFont, width: number): number {
  const runs: RenderTextRun[] = [{ text, font }];
  const lines = layoutRenderTextRuns(runs, width, undefined);
  return lines.reduce((sum, line) => sum + lineRenderHeight(line, font.lineHeight), 0);
}

export interface SetTextOptions {
  /** Other elements on the slide — used as grow-obstacles. When omitted, only
   *  font-shrink runs (legacy behavior). */
  siblings?: Rec[];
  stage?: { w: number; h: number };
}

/** Resolves how to fit `text` into the element's authored box. Returns null
 *  if it already fits (no change), otherwise either a grown box (font kept),
 *  a shrunk font (box kept), or both. */
function fitTextToBox(
  el: Rec,
  text: string,
  opts: SetTextOptions,
): { font?: number; size?: Size; position?: Point } | null {
  const box = authoredBox(el);
  if (!box || !text.trim()) return null;
  const baseFont = rawFont(el as never);
  const stage = opts.stage ?? { w: 1280, h: 720 };

  const originalHeight = wrappedHeight(text, baseFont, box.w);
  if (originalHeight <= box.h) return null; // already fits, leave alone

  // Step 1: try to grow the box into empty space. Wider boxes wrap to fewer
  // lines so a horizontal grow can fix a vertical overflow too — re-measure
  // after each candidate to account for that.
  if (opts.siblings && opts.siblings.length > 0) {
    const obstacles = collectObstacleBoxes(opts.siblings, el);
    const space = availableSpace(box, obstacles, stage);
    // Try width-grow first (often resolves overflow via fewer wrap lines with
    // no font cost), then height-grow.
    const widthGrown = tryGrowBoxToFit(box, { w: box.w * 2, h: box.h }, space);
    if (widthGrown) {
      const hAfter = wrappedHeight(text, baseFont, widthGrown.w);
      if (hAfter <= widthGrown.h && !obstacles.some((o) => aabbOverlap(widthGrown, o))) {
        return {
          size: { width: widthGrown.w, height: widthGrown.h },
          position: { x: widthGrown.x, y: widthGrown.y },
        };
      }
    }
    const heightGrown = tryGrowBoxToFit(box, { w: box.w, h: originalHeight + 1 }, space);
    // Only accept the height grow if it actually reaches the text's needed
    // height (width unchanged ⇒ wrapped height is still originalHeight) AND the
    // grown box doesn't collide with a sibling — otherwise the box grew for
    // nothing and we fall through to font-shrink.
    if (heightGrown && heightGrown.h >= originalHeight) {
      if (!obstacles.some((o) => aabbOverlap(heightGrown, o))) {
        return {
          size: { width: heightGrown.w, height: heightGrown.h },
          position: { x: heightGrown.x, y: heightGrown.y },
        };
      }
    }
  }

  // Step 2: font-shrink against the (possibly unchanged) box. Iteratively
  // reduce scale until wrapped height fits, floor at MIN_FONT_SCALE.
  let scale = 1;
  let fittedSize = baseFont.size;
  for (let i = 0; i < FIT_ITERATIONS; i++) {
    const testFont = { ...baseFont, size: baseFont.size * scale };
    const totalHeight = wrappedHeight(text, testFont, box.w);
    fittedSize = testFont.size;
    if (totalHeight <= box.h || scale <= MIN_FONT_SCALE) break;
    scale = Math.max(MIN_FONT_SCALE, scale * (box.h / totalHeight));
  }
  if (fittedSize < baseFont.size - 0.5) return { font: fittedSize };
  return null;
}

export function setText(el: Rec, text: string, opts?: SetTextOptions): void {
  if (el.type === "text-list") {
    const items = (el.items as unknown[][]) ?? [];
    const firstRun = items[0]?.[0] as Rec | undefined;
    const font = (firstRun?.font as Rec) ?? (el.font as Rec) ?? {};
    el.items = text
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => [{ text: line, font }]);
    return;
  }
  const runs = (el.runs as Rec[]) ?? [];
  const font = (runs[0]?.font as Rec) ?? (el.font as Rec) ?? {};
  const fit = fitTextToBox(el, text, opts ?? {});
  const finalFont = fit?.font != null ? { ...font, size: fit.font } : font;
  el.runs = [{ text, font: finalFont }];
  if (fit?.font != null) {
    el.font = { ...((el.font as Rec) ?? {}), size: fit.font };
  }
  if (fit?.size) el.size = { width: fit.size.width, height: fit.size.height };
  if (fit?.position) el.position = { x: fit.position.x, y: fit.position.y };
}

function fillItemSlot(slot: ItemSlot, item: { title: string; text: string }): void {
  if (slot.leaves.length === 0) return;
  if (slot.leaves.length === 1) {
    setText(slot.leaves[0].el, item.text ? `${item.title} — ${item.text}` : item.title);
    return;
  }
  // Biggest font (or a name hinting at a title role) is the item's title.
  const sorted = [...slot.leaves].sort((a, b) => b.fontSize - a.fontSize);
  const titleLeaf =
    slot.leaves.find((l) => /title|head|label/i.test(String(l.el.name ?? ""))) ?? sorted[0];
  const bodyLeaf = slot.leaves.find((l) => l !== titleLeaf) ?? sorted[1];
  setText(titleLeaf.el, item.title);
  if (bodyLeaf && item.text) setText(bodyLeaf.el, item.text);
}

function fillGlobalText(global: TextLeaf[], values: string[]): void {
  const sorted = [...global].sort((a, b) => b.fontSize - a.fontSize);
  for (let i = 0; i < sorted.length && i < values.length; i++) {
    if (values[i]) setText(sorted[i].el, values[i]);
  }
}

/** Deep-clones the layout, then fills its text placeholders with the given
 * AIPPTSlide's content. Returns the Ui record ({id, components}) ready to
 * assign to a slide, plus the hero image slot (if any) for the caller to
 * fill asynchronously with a generated image. */
/** Fills each slot 1:1 with an item, in document order. When there are FEWER
 * items than slots, the surplus slots are REMOVED (via ItemSlot.remove())
 * instead of wrapping around and duplicating an earlier item's text into them
 * — the old `items[i % items.length]` behavior visibly repeated the same card
 * twice whenever the AI supplied fewer items than the picked layout has card
 * slots. When there are no items at all (cover/transition/end slide types
 * never carry an `items` array, yet several layouts' cover-bucketed variants
 * still contain a decorative card grid), every slot is removed — leaving the
 * template's literal "Lorem ipsum" sample copy on screen is worse than a
 * slightly smaller layout. Extra items beyond the slot count are simply
 * dropped (unchanged from previous behavior). */
function fillOrTrimSlots(allSlots: ItemSlot[], items: { title: string; text: string }[]): void {
  if (items.length >= allSlots.length) {
    allSlots.forEach((slot, i) => fillItemSlot(slot, items[i]));
    return;
  }
  for (let i = allSlots.length - 1; i >= items.length; i--) allSlots[i].remove();
  allSlots.slice(0, items.length).forEach((slot, i) => fillItemSlot(slot, items[i]));
}

/** Removes every global text leaf beyond the first `keep` (sorted by font
 * size, same ordering fillGlobalText itself uses) instead of leaving them at
 * the template's own sample copy. cover/transition/end slide types only ever
 * supply 1-2 values (title[, text]) to fillGlobalText — any further global
 * leaf a layout happens to carry (a "name"/"date" caption card, a secondary
 * tagline, ...) was never touched at all, so it silently kept showing
 * whatever sample text — or sample-text-on-a-colored-chip that reads as a
 * blank box once repainted with the deck's own palette — the template
 * author left there. Mirrors the same "remove don't leave stale copy"
 * decision `fillOrTrimSlots` already makes for item-slot cards. */
function trimSurplusGlobalText(allGlobal: TextLeaf[], keep: number): void {
  const sorted = [...allGlobal].sort((a, b) => b.fontSize - a.fontSize);
  for (let i = keep; i < sorted.length; i++) sorted[i].remove?.();
}

export function fillLayout(layout: TemplateLayout, slide: AIPPTSlide): FilledSlide {
  const components = JSON.parse(JSON.stringify(layout.components)) as Rec[];

  const allGlobal: TextLeaf[] = [];
  const allSlots: ItemSlot[] = [];
  for (const component of components) {
    const { global, slots } = collectComponent(component);
    allGlobal.push(...global);
    allSlots.push(...slots);
  }

  switch (slide.type) {
    case "cover":
    case "transition":
      fillGlobalText(allGlobal, [slide.data.title, slide.data.text]);
      // Beyond title+text, any further global leaf (a "name"/"date" caption
      // card, a secondary tagline, ...) was never touched at all — remove it
      // rather than leave the template's own sample copy on screen.
      trimSurplusGlobalText(allGlobal, 2);
      // Cover/transition slides never carry an items array, so any card grid
      // a cover-bucketed layout happens to contain (e.g. a decorative
      // highlight row under the hero title) can never be filled — remove it
      // rather than leave the template's literal sample copy on screen.
      fillOrTrimSlots(allSlots, []);
      break;
    case "content": {
      fillGlobalText(allGlobal, [slide.data.title]);
      const items = slide.data.items;

      // Beyond the title, at most ONE more global text slot (a subtitle/
      // tagline) gets a summary of the items. Any further global text slots
      // are surplus template chrome (e.g. a 3rd overlapping copy of a
      // tagline in some layouts) — filling them all with the same combined
      // paragraph used to stack identical text 3× on the same spot. Remove
      // the surplus instead so nothing leaks placeholder copy either.
      if (items.length) {
        const sorted = [...allGlobal].sort((a, b) => b.fontSize - a.fontSize);
        const combined = items.map((i) => (i.title ? `${i.title}: ${i.text}` : i.text)).join(" ");
        if (sorted[1]) setText(sorted[1].el, combined);
        for (let i = 2; i < sorted.length; i++) {
          sorted[i].remove?.();
        }
      }

      fillOrTrimSlots(allSlots, items);
      break;
    }
    case "contents": {
      const items = slide.data.items.map((title) => ({ title, text: "" }));
      fillGlobalText(allGlobal, ["Contents"]);
      trimSurplusGlobalText(allGlobal, 1);
      fillOrTrimSlots(allSlots, items);
      break;
    }
    case "end":
      fillGlobalText(allGlobal, ["Thank You"]);
      trimSurplusGlobalText(allGlobal, 1);
      fillOrTrimSlots(allSlots, []);
      break;
  }

  // Split each surviving card grid into standalone components BEFORE photo
  // slots are located, so HeroImageMarker.componentId ends up pointing at the
  // new per-card component (not the grid's original, now-gone, component).
  const exploded = explodeCardGridsIntoComponents(components);

  const photoSlots = findAllPhotoSlots(exploded);
  const heroImage = findHeroImage(photoSlots);
  const secondaryImages = findSecondaryImages(photoSlots, heroImage);

  // Filling can orphan a container/group: e.g. when its only child was a text
  // leaf removed as a surplus global slot, or when all its meaningful children
  // got pruned. Such an empty box would render as a floating chrome rectangle
  // with nothing in it. Walk each component's element tree and drop any
  // container/group whose child array ended up empty (single-`child` holders
  // that lost their child are handled too). Stops at the first non-empty
  // parent — a card that still has its background rectangle + content stays.
  for (const component of exploded) pruneEmptyContainers(component);

  return { ui: { id: layout.id, components: exploded }, heroImage, secondaryImages };
}

/** Splits every AI-filled card grid/flex (>1 surviving children after
 * fillOrTrimSlots trimmed it above) out of its shared component into N
 * standalone components — one per card — instead of leaving the cards
 * flow-managed inside one big component. Each new component's position/size
 * is computed ONCE here via the SAME layoutChildren() the renderer itself
 * uses (model.ts / flowLayout.ts), then baked in as the component's own
 * absolute position/size.
 *
 * Why this fixes "hard to move a single element" without touching any
 * selection/drag code: a component has always been the single click-select-
 * drag unit (component.position/size is never flow-managed), so once each
 * card IS its own component, per-card drag/select falls out of the existing,
 * already-stable component mechanics for free — no new drag logic, so
 * nothing can leave a reflow gap (the failure mode of the reverted 9153acd5
 * per-ELEMENT-drag attempt, where the grid engine still "owned" the element's
 * slot even after its position was pinned).
 *
 * Scoped to grids that are DIRECT top-level elements of a component. An
 * audit of every pack's template.json found item-slot grids nested one level
 * inside a wrapper container on only 2 layouts, both COVER layouts — and
 * cover/transition/end slides always trim their card grid to zero children
 * (fillOrTrimSlots(allSlots, []), since those slide types never carry an
 * items array), so by the time this runs there's nothing left in them to
 * explode anyway. Top-level-only has full practical coverage without needing
 * to track cumulative offsets through arbitrary wrapper nesting.
 *
 * Only runs on AI-generation-filled components (this function). Manually
 * inserting a layout from the editor's Templates panel is a separate code
 * path and is untouched — a human explicitly chose to insert one layout as
 * one unit there. */
function explodeCardGridsIntoComponents(components: Rec[]): Rec[] {
  const result: Rec[] = [];
  for (const component of components) {
    const compBox = componentBox(component);
    const elements = ((component.elements as Rec[] | undefined) ?? []).filter(Boolean);
    const keptElements: Rec[] = [];
    const extractedComponents: Rec[] = [];

    for (const el of elements) {
      const children = el.children as Rec[] | undefined;
      const isCardGrid =
        (el.type === "grid" || el.type === "flex") &&
        Array.isArray(children) &&
        children.length > 1;
      if (!isCardGrid) {
        keptElements.push(el);
        continue;
      }

      const gridBox = elementBox(el);
      const childInfo = childArrayInfo(el);
      if (!childInfo) {
        keptElements.push(el);
        continue;
      }
      const laidOut = layoutChildren(el, childInfo.items, {
        x: 0,
        y: 0,
        width: gridBox.width,
        height: gridBox.height,
      });

      laidOut.forEach((item, index) => {
        const card = item.child as Rec;
        const childBox = item.box ?? elementBox(card);
        const absBox = {
          x: compBox.x + gridBox.x + childBox.x,
          y: compBox.y + gridBox.y + childBox.y,
          width: childBox.width,
          height: childBox.height,
        };
        extractedComponents.push(makeCardComponent(component, absBox, card, index));
      });
    }

    if (extractedComponents.length === 0) {
      result.push(component);
      continue;
    }
    if (keptElements.length > 0) {
      result.push({ ...component, elements: keptElements });
    }
    result.push(...extractedComponents);
  }
  return result;
}

/** Wraps one exploded card in a fresh standalone component at its computed
 * absolute box. The card's own inner content (title/icon/body, whatever it
 * already had) is untouched — only rebased to origin (0,0) since the new
 * component itself now carries the absolute offset. `__presenton_manual_position`
 * pins it so nothing tries to flow-manage it again (mirrors the same flag
 * `ungroupTemplateV2ComponentInUi`'s editor-side "ungroup" action already
 * uses for exactly this purpose). */
function makeCardComponent(
  sourceComponent: Rec,
  box: { x: number; y: number; width: number; height: number },
  card: Rec,
  index: number,
): Rec {
  const idBase = normalizeId(
    String(sourceComponent.id ?? sourceComponent.name ?? "card"),
  );
  return {
    id: `${idBase}_card_${index + 1}_${cryptoRandomSuffix()}`,
    description: "AI-generated card (split into its own component for independent drag)",
    position: { x: box.x, y: box.y },
    size: { width: box.width, height: box.height },
    elements: [
      {
        ...cloneJson(card),
        position: { x: 0, y: 0 },
        size: { width: box.width, height: box.height },
        __presenton_manual_position: true,
      },
    ],
  };
}

function cryptoRandomSuffix(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

/** Removes container/group elements whose child array is empty after filling.
 *  Mutates the node in place. Recurses through `.elements`, `.children`, AND
 *  the singular `.child` (a container holding a single child via `child:`
 *  instead of `children:[]` also goes empty if that child is pruned). A
 *  non-empty holder (even one with only a background rectangle) is left. */
export function pruneEmptyContainers(node: Rec): void {
  const elements = (node.elements as Rec[] | undefined) ?? [];
  if (Array.isArray(node.elements)) {
    for (const el of elements) pruneEmptyContainers(el);
    node.elements = elements.filter((el) => !isEmptyHoldingNode(el));
    return;
  }
  const children = node.children as Rec[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) pruneEmptyContainers(child);
    node.children = children.filter((child) => !isEmptyHoldingNode(child));
    return;
  }
  const child = node.child as Rec | undefined;
  if (child) {
    pruneEmptyContainers(child);
    if (isEmptyHoldingNode(child)) delete node.child;
  }
}

// grid/flex included alongside container/group: a card grid trimmed down to
// zero children by fillOrTrimSlots (e.g. every card removed for a cover/
// transition/end slide, or every card removed because the AI supplied no
// items) has children.length===0 but ISN'T a "container"/"group" type, so it
// used to survive this filter untouched — a childless grid element sitting
// in the tree, occupying its authored size/position with nothing to render,
// which showed as a blank box wherever it (or a background chip behind it)
// had its own fill.
function isEmptyHoldingNode(el: Rec): boolean {
  const type = el.type;
  if (type !== "container" && type !== "group" && type !== "grid" && type !== "flex") return false;
  const children = el.children as Rec[] | undefined;
  if (Array.isArray(children)) return children.length === 0;
  return el.child == null;
}

/* --------------------------- Photo slots ------------------------------ */

// `occurrenceIndex` matters because several layouts repeat the SAME element
// name multiple times (e.g. a 4-portrait team grid has 4 elements all named
// "portrait_image") — componentId+elementName alone can't tell them apart,
// so patchHeroImage would always hit the first one and leave the other 3
// pointing at the placeholder forever.
export interface HeroImageMarker {
  componentId: string;
  elementName: string;
  occurrenceIndex: number;
}

type PhotoCandidate = HeroImageMarker & { area: number };

// Full-bleed background photos (near stage size, 1280x720) must stay
// sharp-cornered — rounding them would show the slide background through the
// corner gaps. Everything smaller (hero panels, card/portrait photos) gets
// rounded like Canva.
const STAGE_W = 1280;
const STAGE_H = 720;

/** Sets a generous uniform corner radius on a photo element, scaled to its
 * size, unless it's a full-bleed background. Mutates in place (components are
 * already deep-cloned by fillLayout). */
function roundPhotoCorners(el: Rec, w: number, h: number): void {
  if (w >= STAGE_W * 0.94 && h >= STAGE_H * 0.94) return;
  const radius = Math.round(Math.min(28, Math.max(14, Math.min(w, h) * 0.07)));
  el.border_radius = { tl: radius, tr: radius, br: radius, bl: radius };
}

/** Finds every fillable photo slot in the layout. Plain images qualify when
 * they are named, non-icon, non-decorative and big enough to matter. Image
 * CONTAINERS (frames — clipped images) always qualify, even decorative or
 * tiny ones: a frame is by definition a photo holder, and leaving it on the
 * placeholder landscape looks broken. Unnamed frames get a synthetic name so
 * the patch step can still target them. */
export function findAllPhotoSlots(components: Rec[]): PhotoCandidate[] {
  const candidates: PhotoCandidate[] = [];
  const occurrenceCounters = new Map<string, number>();

  const visit = (el: Rec, componentId: string) => {
    const frame = isImageFrameElement(el);
    if (
      el.type === "image" &&
      (frame || (el.is_icon !== true && el.decorative !== true && el.name))
    ) {
      const size = el.size as Rec | undefined;
      const w = typeof size?.width === "number" ? (size.width as number) : 0;
      const h = typeof size?.height === "number" ? (size.height as number) : 0;
      const area = w * h;
      if (!el.name) el.name = "frame_photo"; // unnamed frame — see docstring
      const key = `${componentId}::${el.name}`;
      const occurrenceIndex = occurrenceCounters.get(key) ?? 0;
      occurrenceCounters.set(key, occurrenceIndex + 1);
      if (frame || area > 20000) {
        // Corner rounding is for plain photos — a frame's clip already
        // shapes it, and rounding would cut into the shape's bounding box.
        if (!frame) roundPhotoCorners(el, w, h);
        candidates.push({ area, componentId, elementName: String(el.name), occurrenceIndex });
      }
      return;
    }
    const children = el.children as Rec[] | undefined;
    if (Array.isArray(children)) {
      for (const child of children) visit(child, componentId);
      return;
    }
    const child = el.child as Rec | undefined;
    if (child) visit(child, componentId);
  };

  for (const component of components) {
    const elements = (component.elements as Rec[]) ?? [];
    for (const el of elements) visit(el, component.id as string);
  }

  return candidates;
}

/** The largest photo slot — almost always the template's "hero photo"
 * (main_photo, header_photo, background_photo, ...). Used to drop an
 * AI-generated image in without flattening the slide — the image stays its
 * own editable element. */
export function findHeroImage(candidates: PhotoCandidate[]): HeroImageMarker | null {
  const sorted = [...candidates].sort((a, b) => b.area - a.area);
  const best = sorted[0];
  if (!best) return null;
  const { componentId, elementName, occurrenceIndex } = best;
  return { componentId, elementName, occurrenceIndex };
}

/** Every OTHER real photo slot in the layout besides the hero — e.g. the
 * remaining 3 portraits in a 4-person team grid, or the 2nd/3rd card photo
 * in a 3-card row. Each one gets its own AI-generated image too instead of
 * being left on the generic placeholder file (which used to blend into a
 * flat white background but now stands out against a colored theme). */
export function findSecondaryImages(candidates: PhotoCandidate[], hero: HeroImageMarker | null): HeroImageMarker[] {
  return candidates
    .filter(
      (c) =>
        !(
          hero &&
          c.componentId === hero.componentId &&
          c.elementName === hero.elementName &&
          c.occurrenceIndex === hero.occurrenceIndex
        ),
    )
    .map(({ componentId, elementName, occurrenceIndex }) => ({ componentId, elementName, occurrenceIndex }));
}

/** Deep-clones `ui` and swaps ONE photo slot's `data` for a generated image
 * URL/data-URL, using occurrenceIndex to pick out the right element among
 * same-named siblings. No-ops if the marker no longer matches anything.
 * `extra` optionally stamps attribution fields (stock-photo fills only —
 * AI-generated images have no photographer/source to credit). */
export function patchHeroImage(
  ui: Rec,
  marker: HeroImageMarker,
  dataUrl: string,
  extra?: Partial<Pick<Rec, "credit" | "credit_url" | "source_url">>,
): Rec {
  const cloned = JSON.parse(JSON.stringify(ui)) as Rec;
  const components = (cloned.components as Rec[]) ?? [];
  const component = components.find((c) => c.id === marker.componentId);
  if (!component) return cloned;

  let seen = 0;
  const visit = (el: Rec): boolean => {
    if (el.type === "image" && el.name === marker.elementName) {
      if (seen === marker.occurrenceIndex) {
        el.data = dataUrl;
        if (extra) Object.assign(el, extra);
        return true;
      }
      seen += 1;
      return false;
    }
    const children = el.children as Rec[] | undefined;
    if (Array.isArray(children)) return children.some(visit);
    const child = el.child as Rec | undefined;
    if (child) return visit(child);
    return false;
  };

  const elements = (component.elements as Rec[]) ?? [];
  elements.some(visit);
  return cloned;
}

/** The slot hint authored for one photo slot ("what photo belongs here") —
 *  used as the image-generation prompt guidance when present, so an
 *  auto-labelled frame ("smiling barista, warm tones") beats the generic
 *  per-slide subject prompt. Returns null when the slot has no hint. */
export function findPhotoSlotHint(ui: Rec, marker: HeroImageMarker): string | null {
  const components = (ui.components as Rec[]) ?? [];
  const component = components.find((c) => c.id === marker.componentId);
  if (!component) return null;

  let seen = 0;
  let found: string | null = null;
  const visit = (el: Rec): boolean => {
    if (el.type === "image" && el.name === marker.elementName) {
      if (seen === marker.occurrenceIndex) {
        const slot =
          el.slot && typeof el.slot === "object" && !Array.isArray(el.slot)
            ? (el.slot as Rec)
            : null;
        const hint = slot?.hint;
        found = typeof hint === "string" && hint.trim() ? hint.trim() : null;
        return true;
      }
      seen += 1;
      return false;
    }
    const children = el.children as Rec[] | undefined;
    if (Array.isArray(children)) return children.some(visit);
    const child = el.child as Rec | undefined;
    if (child) return visit(child);
    return false;
  };

  const elements = (component.elements as Rec[]) ?? [];
  elements.some(visit);
  return found;
}

export interface FilledSlide {
  ui: Rec;
  heroImage: HeroImageMarker | null;
  secondaryImages: HeroImageMarker[];
}

/* ---------------------------- Icon auto-fill ------------------------------ */
//
// Every template pack's icon slots are hardcoded to this exact placeholder
// SVG, never swapped — confirmed by inspecting all 4 packs' template.json.
// The slots themselves (position/size within a card) are already correctly
// authored; only the actual icon graphic needs to change per slide.

const PLACEHOLDER_ICON_SRC = "/static/icons/placeholder.svg";

function isPlaceholderIcon(el: Rec): boolean {
  return el.type === "image" && el.is_icon === true && el.data === PLACEHOLDER_ICON_SRC;
}

// The icon index is a small (~120) curated set of single-word Tabler icons
// (see searchIcons in presentation-generation.ts). Its matcher is AND-based —
// EVERY whitespace-separated term in the query must be a substring of an
// icon's "name category" haystack (hyphens flattened to spaces). A real card
// title like "Responsible Tourism Practices" therefore matches NOTHING, which
// is why the placeholder icons were never getting swapped in practice: the
// old code searched the full title verbatim. So instead we tokenize the title,
// map each keyword to a concept icon (below), and fall back to searching the
// individual words. Synonym VALUES must be space-separated words that appear
// in an icon's name/category (never hyphenated — the matcher won't find
// "trending-up" but will find "trending up").
const ICON_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "at", "by",
  "your", "our", "their", "its", "is", "are", "be", "how", "what", "why", "when",
  "this", "that", "these", "those", "as", "we", "you", "it", "from", "into",
  "dan", "atau", "yang", "di", "ke", "untuk", "dengan", "pada", "adalah", "cara",
  "kita", "kami", "para", "akan", "agar", "serta", "juga", "ini", "itu",
]);

const ICON_SYNONYMS: Record<string, string> = {
  growth: "trending up", grow: "trending up", growing: "trending up", increase: "trending up",
  scale: "trending up", scaling: "trending up", revenue: "report money", profit: "coin",
  income: "coin", money: "wallet", finance: "wallet", financial: "wallet", cost: "credit card",
  price: "credit card", pricing: "credit card", budget: "receipt", invoice: "receipt",
  sales: "shopping cart", sell: "shopping cart", ecommerce: "shopping cart", shop: "shopping cart",
  store: "building bank", bank: "building bank", banking: "building bank",
  market: "chart bar", marketing: "speakerphone", advertising: "speakerphone",
  analytics: "chart line", analysis: "chart line", metric: "gauge", metrics: "gauge",
  statistics: "chart bar", stats: "chart bar", performance: "gauge", measure: "gauge",
  report: "file text", reporting: "file text", dashboard: "gauge",
  strategy: "target", strategic: "target", goal: "target", goals: "target", objective: "target",
  target: "target", mission: "flag", vision: "bulb", plan: "checklist", planning: "checklist",
  roadmap: "route", journey: "route", path: "route", direction: "route", step: "checklist",
  steps: "checklist", process: "refresh", cycle: "refresh", workflow: "refresh",
  team: "users", teams: "users", teamwork: "users group", people: "users", staff: "users",
  collaboration: "users group", collaborate: "users group", partner: "users group",
  partnership: "users group", community: "users group", audience: "users", member: "user",
  members: "users", customer: "user circle", customers: "users", client: "user circle",
  clients: "users", user: "user", users: "users", leadership: "crown", leader: "crown",
  ceo: "crown", founder: "crown", idea: "bulb", ideas: "bulb", innovation: "bulb",
  innovative: "bulb", creative: "brush", creativity: "brush", design: "palette",
  branding: "palette", solution: "puzzle", solutions: "puzzle", integration: "puzzle",
  technology: "cpu", tech: "cpu", digital: "cpu", software: "code", develop: "code",
  development: "code", developer: "code", coding: "code", programming: "code",
  engineering: "settings", ai: "robot", automation: "robot", machine: "robot", robot: "robot",
  cloud: "cloud", hosting: "cloud", security: "shield lock", secure: "shield lock",
  privacy: "lock", protection: "shield check", safety: "shield check", compliance: "shield check",
  device: "device laptop", laptop: "device laptop", computer: "device laptop",
  mobile: "device mobile", phone: "phone", app: "device mobile", application: "device mobile",
  network: "wifi", internet: "wifi", connection: "wifi", connectivity: "wifi",
  infrastructure: "server", server: "server", hardware: "cpu", database: "database",
  data: "database", storage: "database", communication: "message", communicate: "message",
  chat: "message circle", messaging: "message", message: "message", email: "mail",
  contact: "mail", inbox: "mail", call: "phone", social: "share", sharing: "share",
  share: "share", global: "world", world: "world", international: "world", worldwide: "world",
  reach: "world", time: "clock", schedule: "calendar", timing: "clock", deadline: "alarm",
  timeline: "calendar event", event: "calendar event", events: "calendar event",
  history: "hourglass", duration: "hourglass", speed: "bolt", energy: "bolt", power: "bolt",
  fast: "rocket", launch: "rocket", startup: "rocket", start: "rocket", boost: "rocket",
  accelerate: "rocket", quality: "award", award: "award", achievement: "award",
  achieve: "award", success: "star", successful: "star", win: "star", winning: "star",
  best: "star", excellence: "star", premium: "star", rating: "star", review: "star",
  feedback: "star", document: "file text", documentation: "file text", file: "file",
  files: "folder", folder: "folder", content: "clipboard", checklist: "checklist",
  task: "clipboard check", tasks: "clipboard check", todo: "clipboard check",
  note: "notebook", notes: "notebook", book: "book", education: "book", learning: "book",
  learn: "book", knowledge: "book", training: "book", course: "book", study: "book",
  research: "book", guide: "book", location: "map pin", place: "map pin", travel: "map pin",
  tourism: "map pin", tourist: "map pin", trip: "map pin", map: "map pin",
  destination: "map pin", region: "map pin", area: "map pin", health: "heart",
  healthcare: "heart", care: "heart", wellness: "heart", love: "heart", passion: "heart",
  environment: "leaf", environmental: "leaf", nature: "leaf", natural: "leaf", green: "leaf",
  sustainability: "leaf", sustainable: "leaf", eco: "leaf", climate: "leaf", ocean: "world",
  marine: "world", forest: "leaf", forests: "leaf", tree: "leaf", trees: "leaf", woodland: "leaf",
  jungle: "leaf", plant: "leaf", plants: "leaf", flora: "leaf", biodiversity: "world",
  wildlife: "world", animal: "world", animals: "world", species: "world", ecosystem: "world",
  conservation: "leaf", habitat: "leaf", carbon: "cloud", emission: "cloud", emissions: "cloud",
  pollution: "cloud", smoke: "cloud", fire: "alert triangle", burning: "alert triangle",
  blaze: "alert triangle", deforest: "alert triangle", deforestation: "alert triangle",
  logging: "alert triangle", threat: "alert triangle", threats: "alert triangle",
  danger: "alert triangle", endangered: "alert triangle", protect: "shield check",
  preserve: "leaf", preservation: "leaf", restore: "refresh",
  restoration: "refresh", renewable: "refresh",
  water: "world", river: "world", lake: "world", sea: "world", benefit: "thumb up", benefits: "thumb up", advantage: "thumb up",
  pros: "thumb up", feature: "star", features: "star", value: "star", values: "heart",
  service: "headset", services: "headset", support: "headset", help: "headset",
  assistance: "headset", info: "info circle", information: "info circle", detail: "info circle",
  details: "info circle", about: "info circle", overview: "info circle", warning: "alert triangle",
  risk: "alert triangle", risks: "alert triangle", problem: "alert triangle",
  challenge: "alert triangle", challenges: "alert triangle", issue: "alert triangle",
  photo: "photo", image: "photo", picture: "photo", gallery: "photo", video: "video",
  media: "movie", music: "music", audio: "music", camera: "camera", product: "gift",
  products: "gift", gift: "gift", offer: "gift", company: "building skyscraper",
  business: "briefcase", corporate: "building skyscraper", office: "briefcase",
  enterprise: "building skyscraper", organization: "building skyscraper", industry: "building skyscraper",
  presentation: "presentation", meeting: "users group", conference: "users group",
  chart: "chart bar", graph: "chart line", trend: "trending up", percent: "percentage",
  percentage: "percentage", conversion: "percentage", productivity: "gauge",
  efficiency: "gauge", flexible: "puzzle", scalable: "trending up", secure2: "lock",
};

// Guaranteed-nonempty decorative pool: when a card's title maps to no concept
// icon, we still drop in one of these (rotated across the deck) so the slot is
// a real icon rather than the bland placeholder box. Same "space-separated,
// must exist in the index" rule as synonym values.
const ICON_DECOR_FALLBACK = [
  "bulb", "target", "star", "rocket", "checklist", "chart bar",
  "puzzle", "award", "leaf", "flag", "bolt", "thumb up",
];
let decorFallbackCursor = 0;

function iconQueryTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ICON_STOPWORDS.has(w));
}

async function searchOneIcon(term: string): Promise<string | null> {
  const r = await PresentationGenerationApi.searchIcons({ query: term, limit: 1 }).catch(
    () => [] as string[],
  );
  return r[0] ?? null;
}

/** Best content-relevant icon URL for a card title/label: concept synonyms
 * first (so "growth" → a trending-up icon, not a literal "growth" search that
 * matches nothing), then the individual words. Null if the title yields no
 * match at all (caller then uses the decorative fallback). */
async function pickIconUrl(query: string): Promise<string | null> {
  const tokens = iconQueryTokens(query);
  for (const t of tokens) {
    const syn = ICON_SYNONYMS[t];
    if (syn) {
      const url = await searchOneIcon(syn);
      if (url) return url;
    }
  }
  for (const t of tokens) {
    const url = await searchOneIcon(t);
    if (url) return url;
  }
  return null;
}

async function pickDecorFallbackIcon(): Promise<string | null> {
  for (let i = 0; i < ICON_DECOR_FALLBACK.length; i++) {
    const name = ICON_DECOR_FALLBACK[decorFallbackCursor++ % ICON_DECOR_FALLBACK.length];
    const url = await searchOneIcon(name);
    if (url) return url;
  }
  return null;
}

interface IconScope {
  icons: Rec[];
  text: string;
  /** Present when this scope's card has NO existing icon slot at all — the
   *  card node to synthesize+inject a new icon element into (see injectIcon).
   *  Nil for cards that already had a placeholder icon (swap-only path). */
  injectCard?: Rec;
}

function collectPlaceholderIcons(node: Rec, out: Rec[]): void {
  if (isPlaceholderIcon(node)) {
    out.push(node);
    return;
  }
  const children = node.children as Rec[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) collectPlaceholderIcons(child, out);
    return;
  }
  const child = node.child as Rec | undefined;
  if (child) collectPlaceholderIcons(child, out);
}

function firstTextUnder(node: Rec): string {
  if (isTextLike(node)) {
    const runs = (node.runs as Rec[] | undefined) ?? [];
    return runs.map((r) => String(r.text ?? "")).join("");
  }
  const children = node.children as Rec[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) {
      const t = firstTextUnder(child);
      if (t) return t;
    }
    return "";
  }
  const child = node.child as Rec | undefined;
  return child ? firstTextUnder(child) : "";
}

/** Splits a component element into icon "scopes" so each card in a grid gets
 * its OWN title as the icon query, instead of every card in the grid sharing
 * card #1's title (the old bug). A card grid (grid/flex with >1 children) →
 * one scope per card; anything else → one scope for the whole element.
 *
 * Cards that have NO placeholder icon at all still get a scope (with
 * `injectCard` set) so fillPlaceholderIcons can synthesize a new icon for
 * them — otherwise whole packs (e.g. `standard`, ~0 icon slots per layout)
 * would render decks with zero icons forever. */
function collectIconScopes(el: Rec, scopes: IconScope[]): void {
  const children = el.children as Rec[] | undefined;
  if ((el.type === "grid" || el.type === "flex") && Array.isArray(children) && children.length > 1) {
    for (const card of children) {
      const text = firstTextUnder(card);
      const icons: Rec[] = [];
      collectPlaceholderIcons(card, icons);
      if (icons.length) {
        scopes.push({ icons, text });
      } else if (text) {
        scopes.push({ icons, text, injectCard: card });
      }
    }
    return;
  }
  const text = firstTextUnder(el);
  const icons: Rec[] = [];
  collectPlaceholderIcons(el, icons);
  if (icons.length) {
    scopes.push({ icons, text });
  } else if (text) {
    scopes.push({ icons, text, injectCard: el });
  }
}

/** Replaces every placeholder icon in `ui` with a real, content-relevant icon
 * (per-card title as the query), falling back to `fallbackQuery` (the slide's
 * title) and then to a rotating decorative icon so NO slot is left as the
 * bland placeholder box.
 *
 * Also SYNTHESIZES a new icon element for cards that never had one (whole
 * packs like `standard` ship with ~0 icon slots, so without this their decks
 * render with no icons at all). */
export async function fillPlaceholderIcons(ui: Rec, fallbackQuery: string): Promise<Rec> {
  const components = (ui.components as Rec[]) ?? [];
  const scopes: IconScope[] = [];
  for (const component of components) {
    const elements = (component.elements as Rec[]) ?? [];
    for (const el of elements) collectIconScopes(el, scopes);
  }
  if (!scopes.length) return ui;

  const urlByIcon = new Map<Rec, string>();
  // injectCard → resolved icon URL to synthesize for that card.
  const injectByCard = new Map<Rec, string>();
  await Promise.all(
    scopes.map(async (scope) => {
      const relevant = await pickIconUrl(scope.text || fallbackQuery);
      for (const icon of scope.icons) {
        const url = relevant ?? (await pickDecorFallbackIcon());
        if (url) urlByIcon.set(icon, url);
      }
      if (scope.injectCard) {
        const url = relevant ?? (await pickDecorFallbackIcon());
        if (url) injectByCard.set(scope.injectCard, url);
      }
    }),
  );
  if (!urlByIcon.size && !injectByCard.size) return ui;

  // Inject synthesized icon elements into card nodes first (mutating the
  // captured card objects in place), so the patch walk below then sees them
  // as ordinary children to clone.
  injectByCard.forEach((url, card) => injectIconIntoCard(card, url));

  // fillLayout mutates elements in place (setText etc.) rather than cloning,
  // so the node references captured above are still the exact objects that
  // will be encountered here — safe to match by identity.
  function patch(node: Rec): Rec {
    if (isPlaceholderIcon(node) && urlByIcon.has(node)) {
      return { ...node, data: urlByIcon.get(node) };
    }
    let next = node;
    if (Array.isArray(next.children)) {
      next = { ...next, children: (next.children as Rec[]).map(patch) };
    }
    if (next.child && typeof next.child === "object") {
      next = { ...next, child: patch(next.child as Rec) };
    }
    return next;
  }

  return {
    ...ui,
    components: components.map((component) => ({
      ...component,
      elements: ((component.elements as Rec[]) ?? []).map(patch),
    })),
  };
}

/** Minimum card size (area) before we bother injecting an icon — tiny rows
 *  (e.g. a tight comparison bullet) would just get cluttered. */
const ICON_INJECT_MIN_AREA = 18000;
const ICON_TILE_SIZE = 72;

/** True if the card contains a text element whose box width is at least 85%
 *  of the card width AND sits in the card's top third (where the injected
 *  top-corner tile would land). Used to avoid overlapping a centered/wide
 *  heading. The threshold is high (0.85) so typical card titles — which span
 *  much of the card width but leave the corner clear — still get an icon;
 *  only genuinely full-bleed centered headings are skipped. */
function hasWideText(card: Rec, cardWidth: number): boolean {
  let found = false;
  const visit = (node: Rec | undefined): void => {
    if (!node) return;
    const type = node.type;
    if (type === "text" || type === "text-list") {
      const sz = node.size as { width?: number } | undefined;
      const pos = node.position as { y?: number } | undefined;
      const w = typeof sz?.width === "number" ? sz.width : 0;
      const y = typeof pos?.y === "number" ? pos.y : 0;
      const cardH = (card.size as { height?: number } | undefined)?.height ?? 0;
      if (w >= cardWidth * 0.85 && y < cardH / 3) found = true;
      return;
    }
    const children = node.children as Rec[] | undefined;
    if (Array.isArray(children)) {
      for (const c of children) visit(c);
      return;
    }
    if (node.child && typeof node.child === "object") visit(node.child as Rec);
  };
  visit(card);
  return found;
}

/** Synthesizes a rounded accent tile + tinted icon and appends it to the
 *  card's children (positioned in the card's top-right corner). Mutates the
 *  card node in place. No-op if the card has no readable size, is too small,
 *  or already carries a wide/centered title that the tile would overlap —
 *  overlapping a full-width centered heading is worse than having no icon.
 *  The tile's rectangle fill + the icon's tint both get recolored later by
 *  applyPaletteToUi (rectangle → shape, is_icon image → icon hue). */
function injectIconIntoCard(card: Rec, iconUrl: string): void {
  const size = card.size as { width?: number; height?: number } | undefined;
  const width = typeof size?.width === "number" ? size.width : 0;
  const height = typeof size?.height === "number" ? size.height : 0;
  if (!width || !height || width * height < ICON_INJECT_MIN_AREA) return;

  // Skip when a text element already spans most of the card width — its
  // rendered glyph run would collide with a top-corner tile. Cards like
  // `centered_card_row`'s portrait cards (centered full-width name) sit here.
  if (hasWideText(card, width)) return;

  const margin = Math.max(20, Math.round(Math.min(width, height) * 0.08));
  const tileSize = Math.min(ICON_TILE_SIZE, Math.round(Math.min(width, height) * 0.22));
  const iconSize = Math.round(tileSize * 0.6);
  const tileX = width - tileSize - margin;
  const tileY = margin;

  const tile = {
    type: "rectangle",
    position: { x: tileX, y: tileY },
    size: { width: tileSize, height: tileSize },
    fill: { color: "#9333EA", opacity: 1 },
    border_radius: {
      tl: tileSize / 2,
      tr: tileSize / 2,
      bl: tileSize / 2,
      br: tileSize / 2,
    },
    decorative: true,
    name: "injected_icon_tile",
  };
  const icon = {
    type: "image",
    position: {
      x: tileX + (tileSize - iconSize) / 2,
      y: tileY + (tileSize - iconSize) / 2,
    },
    size: { width: iconSize, height: iconSize },
    data: iconUrl,
    fit: "contain",
    color: "#FFFFFF",
    decorative: true,
    name: "injected_icon",
    is_icon: true,
  };

  // Card node is either a group/container with a `children` array, or a
  // container with a single `child`. Promote single-child containers to a
  // children array so the injected icon renders as a sibling.
  const children = (card.children as Rec[] | undefined) ?? [];
  if (Array.isArray(card.children)) {
    card.children = [...children, tile, icon];
    return;
  }
  if (card.child && typeof card.child === "object") {
    card.children = [card.child as Rec, tile, icon];
    delete card.child;
    return;
  }
  card.children = [tile, icon];
}

function slideTitleForIconFallback(slide: AIPPTSlide): string {
  if (slide.type === "cover" || slide.type === "transition" || slide.type === "content") {
    return slide.data.title;
  }
  return "presentation";
}

/** High-level entry point: pick a layout for this slide's role and fill it. */
export async function mapAIPPTSlideToTemplateUi(
  slide: AIPPTSlide,
  picker: DeckLayoutPicker
): Promise<FilledSlide | null> {
  await picker.ensureLoaded();
  const layout = picker.pickFor(slide.type);
  if (!layout) return null;
  const filled = fillLayout(layout, slide);
  filled.ui = await fillPlaceholderIcons(filled.ui, slideTitleForIconFallback(slide));
  return filled;
}
