import {
  asRecord,
  isRecord,
  normalizeId,
  readArray,
  readPoint,
  readString,
  type Box,
  type RawComponent,
  type RawElement,
  type RawUi,
} from "@/components/slide-editor/model/core";
import { boxContainingBoxes, componentBox } from "@/components/slide-editor/model/geometry";
import { setComponentPositionsInUi } from "@/components/slide-editor/model/ui-mutations";

function offsetElementPosition(element: RawElement, dx: number, dy: number): RawElement {
  const position = readPoint(element.position);
  return { ...element, position: { x: position.x + dx, y: position.y + dy } };
}

export type ComponentGroupSelection = {
  kind: "component";
  componentIndex: number;
};

// Merges the given components into a single component whose box is the
// union of theirs, re-based so every child element keeps its on-canvas
// position. Inverse of ungroupTemplateV2ComponentInUi. Keeps the merged
// component's z-order at the lowest of the selected indexes.
export function groupComponentsInUi(
  sourceUi: RawUi,
  componentIndexes: number[],
): { ui: RawUi; selection: ComponentGroupSelection } | null {
  const sortedIndexes = Array.from(new Set(componentIndexes))
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b);
  if (sortedIndexes.length < 2) return null;

  const components = readArray(sourceUi.components);
  const sourceComponents = sortedIndexes.map((index) => asRecord(components[index]));
  if (sourceComponents.some((component) => !component)) return null;
  const validComponents = sourceComponents as RawComponent[];

  const boxes = validComponents.map((component) => componentBox(component));
  const groupBox = boxContainingBoxes(boxes);

  const mergedElements = validComponents.flatMap((component, i) => {
    const origin = boxes[i];
    const dx = origin.x - groupBox.x;
    const dy = origin.y - groupBox.y;
    return readArray(component.elements)
      .filter(isRecord)
      .map((element) => offsetElementPosition(element as RawElement, dx, dy));
  });

  const idLabel =
    readString(validComponents[0].id) ??
    readString(validComponents[0].description) ??
    `group_${sortedIndexes[0] + 1}`;
  const mergedComponent = {
    id: `${normalizeId(idLabel)}_group`,
    description: "Grouped component",
    position: { x: groupBox.x, y: groupBox.y },
    size: { width: groupBox.width, height: groupBox.height },
    elements: mergedElements,
  } as unknown as RawComponent;

  const groupedSet = new Set(sortedIndexes);
  const firstIndex = sortedIndexes[0];
  const nextComponents: unknown[] = [];
  components.forEach((component, index) => {
    if (!groupedSet.has(index)) {
      nextComponents.push(component);
      return;
    }
    if (index === firstIndex) nextComponents.push(mergedComponent);
  });

  return {
    ui: { ...sourceUi, components: nextComponents },
    selection: {
      kind: "component",
      componentIndex: nextComponents.indexOf(mergedComponent),
    },
  };
}

export type AlignAction =
  | "align-left"
  | "align-center-h"
  | "align-right"
  | "align-top"
  | "align-middle-v"
  | "align-bottom";

function componentBoxesByIndex(
  ui: RawUi,
  componentIndexes: number[],
): Array<{ componentIndex: number; box: Box }> {
  const components = readArray(ui.components);
  const indexes = Array.from(new Set(componentIndexes)).filter(
    (index) => Number.isInteger(index) && index >= 0,
  );
  const entries: Array<{ componentIndex: number; box: Box }> = [];
  for (const componentIndex of indexes) {
    const component = asRecord(components[componentIndex]);
    if (!component) continue;
    entries.push({ componentIndex, box: componentBox(component) });
  }
  return entries;
}

// Aligns each selected component against the edge/center of the combined
// bounding box of the whole selection (matches Figma/PowerPoint convention
// — "align left" snaps every box to the leftmost edge among them, not to
// each other pairwise).
export function alignComponentsInUi(
  sourceUi: RawUi,
  componentIndexes: number[],
  action: AlignAction,
): RawUi {
  const entries = componentBoxesByIndex(sourceUi, componentIndexes);
  if (entries.length < 2) return sourceUi;
  const groupBox = boxContainingBoxes(entries.map((entry) => entry.box));

  const positions = entries.map(({ componentIndex, box }) => {
    switch (action) {
      case "align-left":
        return { componentIndex, position: { x: groupBox.x, y: box.y } };
      case "align-right":
        return {
          componentIndex,
          position: { x: groupBox.x + groupBox.width - box.width, y: box.y },
        };
      case "align-center-h":
        return {
          componentIndex,
          position: { x: groupBox.x + (groupBox.width - box.width) / 2, y: box.y },
        };
      case "align-top":
        return { componentIndex, position: { x: box.x, y: groupBox.y } };
      case "align-bottom":
        return {
          componentIndex,
          position: { x: box.x, y: groupBox.y + groupBox.height - box.height },
        };
      case "align-middle-v":
        return {
          componentIndex,
          position: { x: box.x, y: groupBox.y + (groupBox.height - box.height) / 2 },
        };
    }
  });

  return setComponentPositionsInUi(sourceUi, positions);
}

export type DistributeAxis = "horizontal" | "vertical";

// Evenly spaces the gaps between components along an axis, keeping the
// first and last (by position) fixed. A no-op below 3 components — with
// only 2 there's a single gap and nothing to redistribute.
export function distributeComponentsInUi(
  sourceUi: RawUi,
  componentIndexes: number[],
  axis: DistributeAxis,
): RawUi {
  const entries = componentBoxesByIndex(sourceUi, componentIndexes);
  if (entries.length < 3) return sourceUi;

  const sorted = [...entries].sort((a, b) =>
    axis === "horizontal" ? a.box.x - b.box.x : a.box.y - b.box.y,
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSpan =
    axis === "horizontal"
      ? last.box.x + last.box.width - first.box.x
      : last.box.y + last.box.height - first.box.y;
  const totalSize = sorted.reduce(
    (sum, entry) => sum + (axis === "horizontal" ? entry.box.width : entry.box.height),
    0,
  );
  const gap = (totalSpan - totalSize) / (sorted.length - 1);

  let cursor = axis === "horizontal" ? first.box.x : first.box.y;
  const positions = sorted.map((entry) => {
    const position =
      axis === "horizontal"
        ? { x: cursor, y: entry.box.y }
        : { x: entry.box.x, y: cursor };
    cursor += (axis === "horizontal" ? entry.box.width : entry.box.height) + gap;
    return { componentIndex: entry.componentIndex, position };
  });

  return setComponentPositionsInUi(sourceUi, positions);
}
