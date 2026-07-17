// Fills AI-generated slide content into one of the existing hand-designed
// template layouts (public/templates/*/template.json) instead of authoring
// a slide from scratch. Picks a layout matching the slide's role, then
// walks its component tree filling only non-decorative text placeholders —
// every other design decision (colors, decorative shapes, positions,
// chart/table example data) is left exactly as the template author made it.
//
// This mirrors the old PPTist "AIPPT" template-filling behaviour (see
// worker/services/deck_service.py's AIPPTSlide contract) that got dropped
// when the flat hardcoded layouts in map-slide.ts were written as a stub.

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

  constructor(seed: string) {
    const packs = PACK_NAMES;
    this.packName = packs[hashSeed(seed) % packs.length];
  }

  async ensureLoaded(): Promise<void> {
    if (this.buckets) return;
    const packs = await loadAllPacks();
    const pack = packs[this.packName] ?? packs["general"];
    this.buckets = bucketLayouts(pack.layouts);
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

type TextLeaf = { el: Rec; fontSize: number };

/** One "item slot" is a repeated child of a grid/flex (a card, a row, …). */
type ItemSlot = { leaves: TextLeaf[] };

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
 * mismatched item slots. */
function walkElement(el: Rec, global: TextLeaf[], slots: ItemSlot[]): void {
  if (isTextLike(el)) {
    global.push({ el, fontSize: fontSizeOf(el) });
    return;
  }

  const type = el.type;
  const children = el.children as Rec[] | undefined;
  if ((type === "grid" || type === "flex") && Array.isArray(children) && children.length > 1) {
    for (const child of children) {
      const leaves: TextLeaf[] = [];
      collectAllTextLeaves(child, leaves);
      if (leaves.length) slots.push({ leaves });
    }
    return;
  }
  if (Array.isArray(children)) {
    for (const child of children) walkElement(child, global, slots);
    return;
  }

  const child = el.child as Rec | undefined;
  if (child) {
    walkElement(child, global, slots);
  }
}

function collectComponent(component: Rec): { global: TextLeaf[]; slots: ItemSlot[] } {
  const global: TextLeaf[] = [];
  const slots: ItemSlot[] = [];
  const elements = (component.elements as Rec[]) ?? [];
  for (const el of elements) walkElement(el, global, slots);
  return { global, slots };
}

function truncate(text: string, maxLength?: number): string {
  if (!maxLength || text.length <= maxLength) return text;
  const cut = text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  return `${cut}…`;
}

function setText(el: Rec, text: string): void {
  const maxLength = typeof el.max_length === "number" ? el.max_length : undefined;
  const finalText = truncate(text, maxLength);
  if (el.type === "text-list") {
    const items = (el.items as unknown[][]) ?? [];
    const firstRun = items[0]?.[0] as Rec | undefined;
    const font = (firstRun?.font as Rec) ?? (el.font as Rec) ?? {};
    el.items = finalText
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => [{ text: line, font }]);
    return;
  }
  const runs = (el.runs as Rec[]) ?? [];
  const font = (runs[0]?.font as Rec) ?? (el.font as Rec) ?? {};
  el.runs = [{ text: finalText, font }];
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
 * AIPPTSlide's content. Returns a Ui record ({id, components}) ready to
 * assign to a slide. */
export function fillLayout(layout: TemplateLayout, slide: AIPPTSlide): Rec {
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
      break;
    case "content": {
      fillGlobalText(allGlobal, [slide.data.title]);
      const items = slide.data.items;
      if (items.length && allSlots.length) {
        allSlots.forEach((slot, i) => fillItemSlot(slot, items[i % items.length]));
      } else if (items.length) {
        // Layout has no repeated item slots — fold the item content into
        // whatever secondary global text slot exists instead of leaving the
        // template's own placeholder paragraph behind.
        const sorted = [...allGlobal].sort((a, b) => b.fontSize - a.fontSize);
        const secondary = sorted[1];
        if (secondary) {
          const combined = items.map((i) => (i.title ? `${i.title}: ${i.text}` : i.text)).join(" ");
          setText(secondary.el, combined);
        }
      }
      break;
    }
    case "contents": {
      const items = slide.data.items.map((title) => ({ title, text: "" }));
      fillGlobalText(allGlobal, ["Contents"]);
      if (items.length && allSlots.length) {
        allSlots.forEach((slot, i) => fillItemSlot(slot, items[i % items.length]));
      }
      break;
    }
    case "end":
      fillGlobalText(allGlobal, ["Thank You"]);
      break;
  }

  return { id: layout.id, components };
}

/** High-level entry point: pick a layout for this slide's role and fill it. */
export async function mapAIPPTSlideToTemplateUi(
  slide: AIPPTSlide,
  picker: DeckLayoutPicker
): Promise<Rec | null> {
  await picker.ensureLoaded();
  const layout = picker.pickFor(slide.type);
  if (!layout) return null;
  return fillLayout(layout, slide);
}
