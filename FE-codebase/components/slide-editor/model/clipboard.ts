import {
  asRecord,
  normalizeId,
  readArray,
  readString,
  type Box,
  type RawComponent,
  type RawElement,
  type RawUi,
  type Selection,
} from "@/components/slide-editor/model/core";
import { absoluteBoxForSelection, componentBox } from "@/components/slide-editor/model/geometry";
import { getElementAtSelection } from "@/components/slide-editor/model/selection";

export function componentForClipboardSelection(
  ui: RawUi,
  selection: Selection,
): { components: Array<{ component: RawComponent; box: Box }>; box: Box } | null {
  if (!selection) return null;

  if (selection.kind === "multi-component") {
    const components = selection.componentIndexes.flatMap((componentIndex) => {
      const component = asRecord(readArray(ui.components)[componentIndex]);
      return component ? [{ component, box: componentBox(component) }] : [];
    });
    return components.length > 0
      ? { components, box: unionBoxes(components.map((item) => item.box)) }
      : null;
  }

  if (selection.kind === "component") {
    const component = asRecord(readArray(ui.components)[selection.componentIndex]);
    return component
      ? {
        components: [{ component, box: componentBox(component) }],
        box: componentBox(component),
      }
      : null;
  }

  if (selection.componentIndex >= 0) {
    const component = asRecord(readArray(ui.components)[selection.componentIndex]);
    return component
      ? {
        components: [{ component, box: componentBox(component) }],
        box: componentBox(component),
      }
      : null;
  }

  const element = getElementAtSelection(ui, selection);
  const box = absoluteBoxForSelection(ui, selection);
  return element && box
    ? {
      components: [{ component: rootElementClipboardComponent(element, box), box }],
      box,
    }
    : null;
}

export function rootElementClipboardComponent(element: RawElement, box: Box): RawComponent {
  const type = readString(element.type) ?? "element";
  const label =
    readString(element.name) || readString(element.id) || `Copied ${type}`;
  return {
    id: `${normalizeId(label)}_component`,
    description: label,
    position: { x: box.x, y: box.y },
    size: { width: box.width, height: box.height },
    elements: [
      {
        ...element,
        position: { x: 0, y: 0 },
        size: { width: box.width, height: box.height },
      },
    ],
  };
}

function unionBoxes(boxes: Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
