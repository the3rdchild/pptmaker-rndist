import type Konva from "konva";
import {
  childArrayInfo,
  clamp,
  componentBox,
  elementBox,
  isRecord,
  layoutChildren,
  positionFromNodeInParent,
  readArray,
  resizeComponent,
  resizeComponentElementBounds,
  resizeComponentFrame,
  STAGE_BOX,
  type Box,
  type Point,
  type RawComponent,
  type RawElement,
} from "@/components/slide-editor/model/model";

type ComponentTransformAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "rotater";

type ComponentResizeMode =
  | "scale-content"
  | "resize-element-bounds"
  | "resize-frame";

type ComponentTransformBox = Box & {
  scaleX: number;
  scaleY: number;
  rawWidth: number;
  rawHeight: number;
};

export const HORIZONTAL_RESIZE_ANCHORS = new Set<ComponentTransformAnchor>([
  "middle-left",
  "middle-right",
]);
export const VERTICAL_RESIZE_ANCHORS = new Set<ComponentTransformAnchor>([
  "top-center",
  "bottom-center",
]);

export function componentTransformAnchorForNode(
  node: Konva.Node,
): ComponentTransformAnchor | null {
  const stage = node.getStage();
  if (!stage) return null;
  const transformer = stage
    .find<Konva.Transformer>("Transformer")
    .find((candidate) => candidate.getNodes().includes(node));
  const activeAnchor = transformer?.getActiveAnchor();
  return isComponentTransformAnchor(activeAnchor) ? activeAnchor : null;
}

function isComponentTransformAnchor(
  value: string | null | undefined,
): value is ComponentTransformAnchor {
  return (
    value === "top-left" ||
    value === "top-center" ||
    value === "top-right" ||
    value === "middle-left" ||
    value === "middle-right" ||
    value === "bottom-left" ||
    value === "bottom-center" ||
    value === "bottom-right" ||
    value === "rotater"
  );
}

function componentResizeModeForTransform(
  anchor: ComponentTransformAnchor | null,
  scaleX: number,
  scaleY: number,
): ComponentResizeMode {
  if (anchor === "rotater") return "resize-frame";
  if (
    anchor &&
    (HORIZONTAL_RESIZE_ANCHORS.has(anchor) ||
      VERTICAL_RESIZE_ANCHORS.has(anchor))
  ) {
    return "resize-element-bounds";
  }
  if (anchor) return "scale-content";

  const changedX = Math.abs(scaleX - 1) > 0.001;
  const changedY = Math.abs(scaleY - 1) > 0.001;
  if (changedX && changedY) return "scale-content";
  if (changedX || changedY) return "resize-element-bounds";
  return "resize-frame";
}

function componentBoxFromTransform(
  component: RawComponent,
  box: Box,
  scaleX: number,
  scaleY: number,
  anchor: ComponentTransformAnchor | null,
): ComponentTransformBox {
  const isVerticalOnly = anchor ? VERTICAL_RESIZE_ANCHORS.has(anchor) : false;
  const isHorizontalOnly = anchor ? HORIZONTAL_RESIZE_ANCHORS.has(anchor) : false;
  const nextScaleX = isVerticalOnly || anchor === "rotater" ? 1 : scaleX;
  const nextScaleY = isHorizontalOnly || anchor === "rotater" ? 1 : scaleY;
  const rawWidth = Math.max(1, box.width * nextScaleX);
  const rawHeight = Math.max(1, box.height * nextScaleY);
  const minimumSize = minimumComponentSizeForElementBoundsResize(component);
  const width = isHorizontalOnly ? Math.max(rawWidth, minimumSize.width) : rawWidth;
  const height = isVerticalOnly ? Math.max(rawHeight, minimumSize.height) : rawHeight;

  return {
    ...box,
    width,
    height,
    scaleX: box.width > 0 ? width / box.width : 1,
    scaleY: box.height > 0 ? height / box.height : 1,
    rawWidth,
    rawHeight,
  };
}

function minimumComponentSizeForElementBoundsResize(component: RawComponent) {
  let width = 1;
  let height = 1;

  const visitElement = (
    element: RawElement,
    box: Box,
    offsetX: number,
    offsetY: number,
  ) => {
    const x = offsetX + box.x;
    const y = offsetY + box.y;
    if (x > 0) width = Math.max(width, x + box.width);
    if (y > 0) height = Math.max(height, y + box.height);

    const childInfo = childArrayInfo(element);
    if (!childInfo) return;
    layoutChildren(element, childInfo.items, box).forEach((childLayout) => {
      visitElement(
        childLayout.child,
        childLayout.box ?? elementBox(childLayout.child),
        x,
        y,
      );
    });
  };

  readArray(component.elements)
    .filter(isRecord)
    .forEach((element) => {
      visitElement(element as RawElement, elementBox(element), 0, 0);
    });

  return { width, height };
}

function positionFromComponentTransform(
  node: Konva.Node,
  nextBox: ComponentTransformBox,
  anchor: ComponentTransformAnchor | null,
): Point {
  const rawPosition = positionFromNodeInParent(node, STAGE_BOX, {
    ...nextBox,
    width: nextBox.rawWidth,
    height: nextBox.rawHeight,
  });
  let x = rawPosition.x;
  let y = rawPosition.y;

  if (anchor === "middle-left") {
    x = rawPosition.x + nextBox.rawWidth - nextBox.width;
  }
  if (anchor === "top-center") {
    y = rawPosition.y + nextBox.rawHeight - nextBox.height;
  }

  return {
    x: clamp(x, 0, Math.max(0, STAGE_BOX.width - nextBox.width)),
    y: clamp(y, 0, Math.max(0, STAGE_BOX.height - nextBox.height)),
  };
}

export function componentFromNodeTransform(
  component: RawComponent,
  node: Konva.Group,
  anchor: ComponentTransformAnchor | null,
) {
  const box = componentBox(component);
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  const nextBox = componentBoxFromTransform(component, box, scaleX, scaleY, anchor);
  const resizeMode = componentResizeModeForTransform(anchor, scaleX, scaleY);
  node.scaleX(1);
  node.scaleY(1);
  const position = positionFromComponentTransform(node, nextBox, anchor);
  const nextComponentBox = {
    ...position,
    width: nextBox.width,
    height: nextBox.height,
    rotation: node.rotation(),
  };

  if (resizeMode === "resize-frame") {
    return resizeComponentFrame(component, nextComponentBox);
  }
  if (resizeMode === "resize-element-bounds") {
    return resizeComponentElementBounds(component, {
      ...nextComponentBox,
      scaleX: nextBox.scaleX,
      scaleY: nextBox.scaleY,
    });
  }
  return resizeComponent(component, {
    ...nextComponentBox,
    scaleX: nextBox.scaleX,
    scaleY: nextBox.scaleY,
  });
}
