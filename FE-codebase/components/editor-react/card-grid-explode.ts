import {
  childArrayInfo,
  cloneJson,
  componentBox,
  elementBox,
  layoutChildren,
  normalizeId,
} from "@/components/slide-editor/model/model";
import { type Rec } from "@/components/editor-react/deck-layout-picker";

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
export function explodeCardGridsIntoComponents(components: Rec[]): Rec[] {
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
