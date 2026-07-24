// Fills AI-generated slide content into one of the existing hand-designed
// template layouts (public/templates/*/template.json) instead of authoring
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
  type RenderTextRun,
} from "@/components/slide-editor/text/template-v2-text";

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
  components: Rec[];
}

interface TemplatePack {
  layouts: TemplateLayout[];
  fonts?: Record<string, string> | null;
}

const PACK_NAMES = ["general", "modern", "standard", "swift"] as const;

let packCache: Record<string, TemplatePack> | null = null;

async function loadAllPacks(): Promise<Record<string, TemplatePack>> {
  if (packCache) return packCache;
  const entries = await Promise.all(
    PACK_NAMES.map(async (name) => {
      const res = await fetch(`/templates/${name}/template.json`);
      const json = (await res.json()) as TemplatePack;
      return [name, json] as const;
    })
  );
  packCache = Object.fromEntries(entries);
  return packCache;
}

function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33) ^ seed.charCodeAt(i);
  return hash >>> 0;
}

function isCoverLayout(layout: TemplateLayout): boolean {
  const s = `${layout.id} ${layout.description ?? ""}`.toLowerCase();
  return s.includes("cover");
}

function isContentsLayout(layout: TemplateLayout): boolean {
  const s = `${layout.id} ${layout.description ?? ""}`.toLowerCase();
  return s.includes("index") || s.includes("contents") || s.includes("agenda") || s.includes("toc");
}

interface Buckets {
  cover: TemplateLayout[];
  contents: TemplateLayout[];
  content: TemplateLayout[];
}

function bucketLayouts(layouts: TemplateLayout[]): Buckets {
  const cover: TemplateLayout[] = [];
  const contents: TemplateLayout[] = [];
  const content: TemplateLayout[] = [];
  for (const l of layouts) {
    if (isCoverLayout(l)) cover.push(l);
    else if (isContentsLayout(l)) contents.push(l);
    else content.push(l);
  }
  return { cover, contents, content };
}

/** Picks one template pack per deck (deterministic from a seed) and rotates
 * through its content layouts so consecutive content slides don't repeat. */
export class DeckLayoutPicker {
  private buckets: Buckets | null = null;
  private contentCursor = 0;
  private packName: string;
  private packFonts: Record<string, string> | null = null;

  constructor(seed: string) {
    const packs = PACK_NAMES;
    this.packName = packs[hashSeed(seed) % packs.length];
  }

  async ensureLoaded(): Promise<void> {
    if (this.buckets) return;
    const packs = await loadAllPacks();
    const pack = packs[this.packName] ?? packs["general"];
    this.buckets = bucketLayouts(pack.layouts);
    this.packFonts = (pack.fonts ?? null) as Record<string, string> | null;
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
      case "end":
        return b.cover[0] ?? this.fallbackContent();
      case "contents":
        return b.contents[0] ?? this.fallbackContent();
      case "transition":
        return b.cover[0] ?? this.fallbackContent();
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

/** Flattens every text leaf under `node`, regardless of further nesting —
 * used to gather the (title, body, ...) leaves that belong to one item slot. */
function collectAllTextLeaves(node: Rec, out: TextLeaf[]): void {
  if (isTextLike(node)) {
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
  if (isTextLike(el)) {
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
    walkElement(child, global, slots, undefined);
  }
}

function collectComponent(component: Rec): { global: TextLeaf[]; slots: ItemSlot[] } {
  const global: TextLeaf[] = [];
  const slots: ItemSlot[] = [];
  const elements = (component.elements as Rec[]) ?? [];
  for (const el of elements) walkElement(el, global, slots);
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

/** AI-generated text is routinely much longer than the template's own tiny
 * sample copy the box was originally sized for — written at full size with
 * no adjustment, it wraps to more lines than the box height allows and
 * visibly overflows into whatever sits below it (title text bleeding into
 * the next card, etc). Shrinks the font size (down to a floor) until the
 * text's ACTUAL wrapped height — measured with the same layoutRenderTextRuns/
 * lineRenderHeight functions the real renderer uses, not a rough guess —
 * fits within the element's own box height. Returns null if no box size is
 * known or the text already fits at the original size (leaves it alone). */
function fittedFontSize(text: string, el: Rec): number | null {
  const size = el.size as Rec | undefined;
  const width = typeof size?.width === "number" ? size.width : undefined;
  const height = typeof size?.height === "number" ? size.height : undefined;
  if (!width || !height || !text.trim()) return null;

  const baseFont = rawFont(el as never);
  let scale = 1;
  let fittedSize = baseFont.size;

  for (let i = 0; i < FIT_ITERATIONS; i++) {
    const testFont = { ...baseFont, size: baseFont.size * scale };
    const runs: RenderTextRun[] = [{ text, font: testFont }];
    const lines = layoutRenderTextRuns(runs, width, undefined);
    const totalHeight = lines.reduce(
      (sum, line) => sum + lineRenderHeight(line, testFont.lineHeight),
      0,
    );
    fittedSize = testFont.size;
    if (totalHeight <= height || scale <= MIN_FONT_SCALE) break;
    scale = Math.max(MIN_FONT_SCALE, scale * (height / totalHeight));
  }

  return fittedSize < baseFont.size - 0.5 ? fittedSize : null;
}

function setText(el: Rec, text: string): void {
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
  const fitted = fittedFontSize(text, el);
  const finalFont = fitted !== null ? { ...font, size: fitted } : font;
  el.runs = [{ text, font: finalFont }];
  if (fitted !== null) {
    el.font = { ...((el.font as Rec) ?? {}), size: fitted };
  }
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
      fillOrTrimSlots(allSlots, items);
      break;
    }
    case "end":
      fillGlobalText(allGlobal, ["Thank You"]);
      fillOrTrimSlots(allSlots, []);
      break;
  }

  const photoSlots = findAllPhotoSlots(components);
  const heroImage = findHeroImage(photoSlots);
  const secondaryImages = findSecondaryImages(photoSlots, heroImage);

  return { ui: { id: layout.id, components }, heroImage, secondaryImages };
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

/** Finds every non-icon, non-decorative image element in the layout still
 * pointing at a real (fillable) photo slot. */
function findAllPhotoSlots(components: Rec[]): PhotoCandidate[] {
  const candidates: PhotoCandidate[] = [];
  const occurrenceCounters = new Map<string, number>();

  const visit = (el: Rec, componentId: string) => {
    if (el.type === "image" && el.is_icon !== true && el.decorative !== true && el.name) {
      const size = el.size as Rec | undefined;
      const w = typeof size?.width === "number" ? (size.width as number) : 0;
      const h = typeof size?.height === "number" ? (size.height as number) : 0;
      const area = w * h;
      const key = `${componentId}::${el.name}`;
      const occurrenceIndex = occurrenceCounters.get(key) ?? 0;
      occurrenceCounters.set(key, occurrenceIndex + 1);
      if (area > 20000) {
        roundPhotoCorners(el, w, h);
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
function findHeroImage(candidates: PhotoCandidate[]): HeroImageMarker | null {
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
function findSecondaryImages(candidates: PhotoCandidate[], hero: HeroImageMarker | null): HeroImageMarker[] {
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
 * same-named siblings. No-ops if the marker no longer matches anything. */
export function patchHeroImage(ui: Rec, marker: HeroImageMarker, dataUrl: string): Rec {
  const cloned = JSON.parse(JSON.stringify(ui)) as Rec;
  const components = (cloned.components as Rec[]) ?? [];
  const component = components.find((c) => c.id === marker.componentId);
  if (!component) return cloned;

  let seen = 0;
  const visit = (el: Rec): boolean => {
    if (el.type === "image" && el.name === marker.elementName) {
      if (seen === marker.occurrenceIndex) {
        el.data = dataUrl;
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
  marine: "world", benefit: "thumb up", benefits: "thumb up", advantage: "thumb up",
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
async function fillPlaceholderIcons(ui: Rec, fallbackQuery: string): Promise<Rec> {
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
const ICON_TILE_SIZE = 36;

/** True if the card contains a text element whose box width is at least 75%
 *  of the card width AND sits in the card's top half (where the injected
 *  top-corner tile would land). Used to avoid overlapping a centered/wide
 *  heading. */
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
      if (w >= cardWidth * 0.75 && y < cardH / 2) found = true;
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

  const margin = Math.max(16, Math.round(Math.min(width, height) * 0.08));
  const tileSize = Math.min(ICON_TILE_SIZE, Math.round(Math.min(width, height) * 0.16));
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
