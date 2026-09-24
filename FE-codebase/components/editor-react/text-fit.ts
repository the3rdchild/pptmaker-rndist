import {
  layoutRenderTextRuns,
  lineRenderHeight,
  rawFont,
  type RenderTextFont,
  type RenderTextRun,
} from "@/components/slide-editor/text/template-v2-text";
import {
  type Point,
  type Size,
} from "@/components/slide-editor/model/model";
import {
  type AIPPTSlide,
  type Rec,
  type TemplateLayout,
} from "@/components/editor-react/deck-layout-picker";
import {
  explodeCardGridsIntoComponents,
  pruneEmptyContainers,
} from "@/components/editor-react/card-grid-explode";
import {
  findAllPhotoSlots,
  findHeroImage,
  findSecondaryImages,
  type HeroImageMarker,
} from "@/components/editor-react/photo-slots";

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

export function isTextLike(el: Rec): boolean {
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

export interface FilledSlide {
  ui: Rec;
  heroImage: HeroImageMarker | null;
  secondaryImages: HeroImageMarker[];
}
