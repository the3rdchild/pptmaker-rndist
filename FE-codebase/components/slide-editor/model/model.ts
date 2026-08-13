"use client";

import type Konva from "konva";
import type { SlideElement, TextRun } from "@/components/slide-editor/types";
import type {
  TemplateV2InlineEditKind,
  TemplateV2TextEditStyle,
} from "@/components/slide-editor/text/template-v2-text-editing";
import { textRunsContent } from "@/components/slide-editor/text/text-runs";
import {
  applyTextStyle,
  displayText,
  editorFontRecordToRaw,
  fontScaleFromResize,
  rawFont,
  rawFontRecordForEditor,
  rawTableCellText,
  rawTextContent,
  rawTextListRenderTextRuns,
  rawTextListItemText,
  rawTextListRunsForEditor,
  rawTextRunsForEditor,
  scaleRawTextMetrics,
  setRawTextContent,
  setRawTextListContent,
  setRawTextListRunsContent,
  setRawTextRunsContent,
  normalizeRawTextMarkdownElement,
  textVisualLocalBox,
} from "@/components/slide-editor/text/template-v2-text";
import {
  intrinsicFlowSize,
  isFlowLayoutElement,
  layoutFlowChildren,
} from "@/components/slide-editor/layout/flowLayout";
import { deleteLayoutChildFromArray } from "@/components/slide-editor/layout/layoutResize";
import type { TemplateV2SurfaceSelectedDetail } from "@/components/slide-editor/events/events";
import { rawChartToEditorChart } from "@/components/slide-editor/model/chart-model";
import {
  alignmentOffset,
  asRecord,
  clamp,
  DECORATIVE_LINE_LENGTH,
  DECORATIVE_LINE_THICKNESS,
  isRecord,
  normalizeId,
  readArray,
  readBoolean,
  readNumber,
  readOptionalSize,
  readPadding,
  readPoint,
  readSize,
  readString,
  ROOT_ELEMENTS_COMPONENT_INDEX,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  TEXT_AVERAGE_CHAR_EM,
  type Box,
  type ChildArrayInfo,
  type ElementSelection,
  type LaidOutChild,
  type Point,
  type RawComponent,
  type RawElement,
  type RawUi,
  type SelectOptions,
  type Selection,
  type Size,
  type UnknownRecord,
} from "@/components/slide-editor/model/core";

export {
  alignmentOffset,
  asRecord,
  clamp,
  cloneJson,
  DECORATIVE_LINE_LENGTH,
  DECORATIVE_LINE_THICKNESS,
  isEditableTarget,
  isRecord,
  MAX_HISTORY_ENTRIES,
  normalizeId,
  readArray,
  readBoolean,
  readNumber,
  readOptionalSize,
  readPadding,
  readPoint,
  readSize,
  readString,
  ROOT_ELEMENTS_COMPONENT_INDEX,
  SCROLL_DISMISS_THRESHOLD_PX,
  STAGE_BOX,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  TEXT_AVERAGE_CHAR_EM,
  withHash,
} from "@/components/slide-editor/model/core";
export type {
  Box,
  ChildArrayInfo,
  ComponentSelection,
  ElementSelection,
  LaidOutChild,
  MultiComponentDragState,
  MultiComponentSelection,
  Point,
  RawComponent,
  RawElement,
  RawUi,
  SelectOptions,
  Selection,
  Size,
  UnknownRecord,
} from "@/components/slide-editor/model/core";
export {
  editorChartToRawChart,
  rawChartToEditorChart,
} from "@/components/slide-editor/model/chart-model";
export {
  appendInsertedContent,
  convertInsertedChildArrays,
  hasTemplateV2Metadata,
  insertedComponentToRaw,
  insertedElementToComponent,
  normalizeInsertedBorderRadius,
  normalizeInsertedElementGeometry,
  normalizeInsertedTableCells,
  normalizeInsertedTableRows,
  normalizeInsertedTextCollections,
  normalizeInsertedTextListItems,
  normalizeInsertedTextRuns,
  rawElementFromInsertedElement,
  sourceElementBox,
  sourceElementSize,
} from "@/components/slide-editor/model/inserted-content";
export {
  backgroundColor,
  borderRadius,
  colorWithOpacity,
  fillColor,
  fillOpacity,
  shadowProps,
  strokeColor,
  strokeDash,
  strokeOpacity,
  strokeWidth,
} from "@/components/slide-editor/model/render-style";

export function updateComponentInUi(
  sourceUi: RawUi,
  componentIndex: number,
  updater: (component: RawComponent) => RawComponent,
) {
  const components = [...readArray(sourceUi.components)];
  const current = asRecord(components[componentIndex]);
  if (!current) return sourceUi;
  const updated = updater(current);
  if (updated === current) return sourceUi;
  components[componentIndex] = updated;
  return { ...sourceUi, components };
}

export function setComponentPositionsInUi(
  sourceUi: RawUi,
  positions: Array<{ componentIndex: number; position: Point }>,
) {
  const positionByIndex = new Map<number, Point>();
  positions.forEach(({ componentIndex, position }) => {
    if (!Number.isInteger(componentIndex) || componentIndex < 0) return;
    positionByIndex.set(componentIndex, {
      x: position.x,
      y: position.y,
    });
  });
  if (positionByIndex.size === 0) return sourceUi;

  let changed = false;
  const components = readArray(sourceUi.components).map((component, index) => {
    const record = asRecord(component);
    const nextPosition = positionByIndex.get(index);
    if (!record || !nextPosition) return component;
    const currentPosition = readPoint(record.position);
    if (
      Math.abs(currentPosition.x - nextPosition.x) < 0.01 &&
      Math.abs(currentPosition.y - nextPosition.y) < 0.01
    ) {
      return component;
    }
    changed = true;
    return {
      ...record,
      position: {
        x: nextPosition.x,
        y: nextPosition.y,
      },
    };
  });

  return changed ? { ...sourceUi, components } : sourceUi;
}

export function updateElementInUi(
  sourceUi: RawUi,
  selection: ElementSelection,
  updater: (element: RawElement) => RawElement,
) {
  if (selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX) {
    const currentElements = readArray(sourceUi.elements);
    const elements = updateElementArray(
      currentElements,
      selection.elementPath,
      updater,
    );
    return elements === currentElements ? sourceUi : { ...sourceUi, elements };
  }

  const components = [...readArray(sourceUi.components)];
  const component = asRecord(components[selection.componentIndex]);
  if (!component) return sourceUi;
  const currentElements = readArray(component.elements);
  const elements = updateElementArray(
    currentElements,
    selection.elementPath,
    updater,
  );
  if (elements === currentElements) return sourceUi;
  components[selection.componentIndex] = normalizeSingleChartWrapperComponent(
    { ...component, elements },
    selection,
  );
  return { ...sourceUi, components };
}

export function syncComponentHeightToElement(
  sourceUi: RawUi,
  selection: ElementSelection,
) {
  if (
    selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX ||
    selection.elementPath.length !== 1
  ) {
    return sourceUi;
  }

  const components = [...readArray(sourceUi.components)];
  const component = asRecord(components[selection.componentIndex]);
  const componentElements = component ? readArray(component.elements) : [];
  const element = component
    ? asRecord(componentElements[selection.elementPath[0]])
    : null;
  if (!component || !element) return sourceUi;

  const componentSize = readSize(component.size, {
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
  });
  const box = elementBox(element);
  const contentHeight = Math.max(1, box.y + box.height);
  const height =
    componentElements.length === 1
      ? contentHeight
      : Math.max(componentSize.height, contentHeight);
  if (Math.abs(height - componentSize.height) < 0.01) return sourceUi;

  components[selection.componentIndex] = {
    ...component,
    size: { ...componentSize, height },
  };
  return { ...sourceUi, components };
}

export function normalizeSingleChartWrapperComponent(
  component: RawComponent,
  selection: ElementSelection,
): RawComponent {
  if (selection.elementPath.length !== 1) return component;
  const elements = readArray(component.elements);
  if (elements.length !== 1) return component;
  const child = asRecord(elements[0]);
  if (!child || readString(child.type) !== "chart") return component;
  if ((readNumber(component.rotation) ?? 0) !== 0) return component;

  const childBox = elementBox(child);
  const componentPosition = readPoint(component.position);
  return {
    ...component,
    position: {
      x: componentPosition.x + childBox.x,
      y: componentPosition.y + childBox.y,
    },
    size: {
      width: childBox.width,
      height: childBox.height,
    },
    elements: [
      {
        ...child,
        position: { x: 0, y: 0 },
        size: {
          width: childBox.width,
          height: childBox.height,
        },
      },
    ],
  };
}

export function updateElementArray(
  elements: unknown[],
  path: number[],
  updater: (element: RawElement) => RawElement,
): unknown[] {
  if (path.length === 0) return elements;
  const [index, ...rest] = path;
  const current = asRecord(elements[index]);
  if (!current) return elements;
  if (rest.length === 0) {
    const updated = updater(current);
    if (updated === current) return elements;
    const next = [...elements];
    next[index] = updated;
    return next;
  }
  const childInfo = childArrayInfo(current);
  if (!childInfo) return elements;
  const updatedChildren = updateElementArray(childInfo.items, rest, updater);
  if (updatedChildren === childInfo.items) return elements;
  const next = [...elements];
  next[index] = withUpdatedChildItems(current, childInfo, updatedChildren);
  return next;
}

export function deleteSelectionFromUi(sourceUi: RawUi, selection: Selection) {
  if (!selection) return sourceUi;

  const components = [...readArray(sourceUi.components)];
  if (selection.kind === "multi-component") {
    const indexes = Array.from(new Set(selection.componentIndexes))
      .filter((index) => Number.isInteger(index) && index >= 0)
      .sort((a, b) => b - a);
    indexes.forEach((componentIndex) => {
      if (componentIndex < components.length) {
        components.splice(componentIndex, 1);
      }
    });
    return { ...sourceUi, components };
  }
  if (selection?.kind === "component") {
    components.splice(selection.componentIndex, 1);
    return { ...sourceUi, components };
  }
  if (selection?.kind === "element") {
    if (selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX) {
      const currentElements = readArray(sourceUi.elements);
      const elements = deleteLayoutChildFromArray(
        currentElements,
        selection.elementPath,
      );
      return elements === currentElements ? sourceUi : { ...sourceUi, elements };
    }

    const component = asRecord(components[selection.componentIndex]);
    if (!component) return sourceUi;
    const currentElements = readArray(component.elements);
    const elements = deleteLayoutChildFromArray(
      currentElements,
      selection.elementPath,
    );
    if (elements !== currentElements) {
      components[selection.componentIndex] = { ...component, elements };
      return { ...sourceUi, components };
    }

    components.splice(selection.componentIndex, 1);
    return { ...sourceUi, components };
  }
  return sourceUi;
}

export function resizeComponent(
  component: RawComponent,
  next: Box & { scaleX: number; scaleY: number; rotation?: number },
) {
  const fontScale = fontScaleFromResize(next.scaleX, next.scaleY);
  return {
    ...component,
    position: { x: next.x, y: next.y },
    size: { width: next.width, height: next.height },
    rotation: next.rotation ?? readNumber(component.rotation) ?? 0,
    elements: scaleRawElements(
      readArray(component.elements),
      next.scaleX,
      next.scaleY,
      fontScale,
    ),
  };
}

export function resizeComponentFrame(
  component: RawComponent,
  next: Box & { rotation?: number },
) {
  return {
    ...component,
    position: { x: next.x, y: next.y },
    size: { width: next.width, height: next.height },
    rotation: next.rotation ?? readNumber(component.rotation) ?? 0,
  };
}

export function resizeComponentElementBounds(
  component: RawComponent,
  next: Box & { scaleX: number; scaleY: number; rotation?: number },
) {
  return {
    ...component,
    position: { x: next.x, y: next.y },
    size: { width: next.width, height: next.height },
    rotation: next.rotation ?? readNumber(component.rotation) ?? 0,
    elements: resizeRawElementBounds(
      readArray(component.elements),
      next.scaleX,
      next.scaleY,
    ),
  };
}

export function resizeRawElementBounds(
  elements: unknown[],
  scaleX: number,
  scaleY: number,
): unknown[] {
  const safeScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
  const safeScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;

  return elements.map((value) => {
    const element = asRecord(value);
    if (!element) return value;
    const explicitSize = readOptionalSize(element.size);
    const childInfo = childArrayInfo(element);
    const resizedChildren = childInfo
      ? resizeRawElementBounds(childInfo.items, safeScaleX, safeScaleY)
      : null;
    return {
      ...element,
      ...(explicitSize
        ? {
            size: {
              width: Math.max(1, explicitSize.width * safeScaleX),
              height: Math.max(1, explicitSize.height * safeScaleY),
            },
          }
        : {}),
      ...(childInfo && resizedChildren
        ? withUpdatedChildItems({}, childInfo, resizedChildren)
        : {}),
    };
  });
}

export function scaleRawElements(
  elements: unknown[],
  scaleX: number,
  scaleY: number,
  fontScale: number,
): unknown[] {
  return elements.map((value) => {
    const element = asRecord(value);
    if (!element) return value;
    const box = elementBox(element);
    const explicitSize = readOptionalSize(element.size);
    const childInfo = childArrayInfo(element);
    const scaledChildren = childInfo
      ? scaleRawElements(childInfo.items, scaleX, scaleY, fontScale)
      : null;
    const scaledElement = scaleRawElementTextMetrics(element, fontScale);
    return {
      ...scaledElement,
      position: { x: box.x * scaleX, y: box.y * scaleY },
      ...(explicitSize
        ? {
            size: {
              width: Math.max(1, explicitSize.width * scaleX),
              height: Math.max(1, explicitSize.height * scaleY),
            },
          }
        : {}),
      ...(childInfo && scaledChildren
        ? withUpdatedChildItems({}, childInfo, scaledChildren)
        : {}),
    };
  });
}

export function scaleRawElementTextMetrics(element: RawElement, fontScale: number) {
  if (!Number.isFinite(fontScale) || Math.abs(fontScale - 1) < 0.001) {
    return element;
  }
  const type = readString(element.type);
  if (type !== "text" && type !== "text-list" && type !== "table") {
    return element;
  }
  return scaleRawTextMetrics(element, fontScale);
}

export function positionFromNodeInParent(
  node: Konva.Node,
  parentBox: Box,
  renderedBox: Box,
): Point {
  const position = unclampedPositionFromNodeInParent(node, parentBox, renderedBox);
  return clampRelativePosition(position, renderedBox, parentBox);
}

export function unclampedPositionFromNodeInParent(
  node: Konva.Node,
  parentBox: Box,
  renderedBox: Box,
): Point {
  const absolute = node.absolutePosition();
  const offsetX = node.offsetX() ? renderedBox.width / 2 : 0;
  const offsetY = node.offsetY() ? renderedBox.height / 2 : 0;
  return {
    x: absolute.x - parentBox.x - offsetX,
    y: absolute.y - parentBox.y - offsetY,
  };
}

export function clampRelativePosition(pos: Point, box: Box, parentSize: Size): Point {
  return {
    x: clamp(pos.x, 0, Math.max(0, parentSize.width - box.width)),
    y: clamp(pos.y, 0, Math.max(0, parentSize.height - box.height)),
  };
}

export function layoutChildren(
  parent: RawElement,
  children: unknown[],
  parentBox: Box,
): LaidOutChild[] {
  const rawChildren = children.filter(isRecord) as RawElement[];
  const type = readString(parent.type);
  if (type === "container") {
    return layoutContainerChildren(parent, rawChildren, parentBox);
  }
  if (isFlowLayoutElement(parent)) {
    return layoutFlowChildren(parent, rawChildren, parentBox, {
      elementBox,
      elementSize,
      isManualPositioned,
    }) as LaidOutChild[];
  }
  return rawChildren.map((child, index) => ({
    child,
    index,
    box: null as Box | null,
    layoutManaged: false,
  }));
}

export function elementWithNormalizedLayoutChildren(
  element: RawElement,
  parentBox: Box,
): RawElement {
  const childInfo = childArrayInfo(element);
  if (!childInfo || childInfo.items.length === 0) {
    return element;
  }

  const laidOutChildren = layoutChildren(element, childInfo.items, parentBox);
  const nextChildren = childInfo.items.map((child, index) => {
    const record = asRecord(child);
    const laidOut = laidOutChildren.find((item) => item.index === index);
    if (!record || !laidOut?.box || !laidOut.layoutManaged) {
      return child;
    }
    return {
      ...record,
      position: {
        x: laidOut.box.x,
        y: laidOut.box.y,
      },
      size: {
        width: laidOut.box.width,
        height: laidOut.box.height,
      },
    };
  });

  return withUpdatedChildItems(element, childInfo, nextChildren);
}

export function shouldUseCenterOrigin(element: RawElement) {
  return Boolean(element);
}

export function layoutContainerChildren(
  parent: RawElement,
  children: RawElement[],
  parentBox: Box,
): LaidOutChild[] {
  if (children.length === 0) return [];
  const padding = readPadding(parent.padding);
  const content = {
    x: padding.left,
    y: padding.top,
    width: Math.max(1, parentBox.width - padding.left - padding.right),
    height: Math.max(1, parentBox.height - padding.top - padding.bottom),
  };
  const alignment = asRecord(parent.alignment) ?? {};

  return children.map((child, index) => {
    if (isManualPositioned(child)) {
      return { child, index, box: elementBox(child), layoutManaged: false };
    }

    const point = readPoint(child.position);
    const childType = readString(child.type);
    const explicitSize = readOptionalSize(child.size);
    const inferredSize =
      childType === "group" && explicitSize == null
        ? { width: content.width, height: content.height }
        : elementSize(child, content);
    const width = explicitSize?.width ?? inferredSize.width;
    const height = explicitSize?.height ?? inferredSize.height;

    if (childType === "group") {
      return {
        child,
        index,
        box: {
          x: content.x + point.x,
          y: content.y + point.y,
          width,
          height,
        },
        layoutManaged: true,
      };
    }

    const horizontal = readString(alignment.horizontal) ?? "left";
    const vertical = readString(alignment.vertical) ?? "top";
    return {
      child,
      index,
      box: {
        x:
          horizontal === "center"
            ? content.x + alignmentOffset("center", content.width, width)
            : horizontal === "right"
              ? content.x + alignmentOffset("right", content.width, width)
              : content.x + point.x,
        y:
          vertical === "middle"
            ? content.y + alignmentOffset("center", content.height, height)
            : vertical === "bottom"
              ? content.y + alignmentOffset("bottom", content.height, height)
              : content.y + point.y,
        width,
        height,
      },
      layoutManaged: true,
    };
  });
}

export function estimateTextWidth(text: string, font: ReturnType<typeof rawFont>) {
  const longestLine = text
    .split(/\r?\n/)
    .reduce((longest, line) => Math.max(longest, line.length), 0);
  const weight = font.bold ? 0.56 : TEXT_AVERAGE_CHAR_EM;
  return Math.max(font.size, longestLine * font.size * weight);
}

export function estimateTextHeight(
  text: string,
  font: ReturnType<typeof rawFont>,
  width: number,
) {
  const lineHeight = font.size * font.lineHeight;
  const averageCharWidth = Math.max(1, font.size * TEXT_AVERAGE_CHAR_EM);
  const charsPerLine = Math.max(1, Math.floor(width / averageCharWidth));
  const lines = text.split(/\r?\n/).reduce((count, line) => {
    return count + Math.max(1, Math.ceil(line.length / charsPerLine));
  }, 0);
  return Math.max(lineHeight, lines * lineHeight);
}

export function getElementAtSelection(ui: RawUi, selection: ElementSelection) {
  if (selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX) {
    return getElementFromArray(readArray(ui.elements), selection.elementPath);
  }

  const component = asRecord(readArray(ui.components)[selection.componentIndex]);
  if (!component) return null;
  return getElementFromArray(readArray(component.elements), selection.elementPath);
}

export function getElementFromArray(elements: unknown[], path: number[]): RawElement | null {
  const [index, ...rest] = path;
  const current = asRecord(elements[index]);
  if (!current) return null;
  if (rest.length === 0) return current;
  const childInfo = childArrayInfo(current);
  return childInfo ? getElementFromArray(childInfo.items, rest) : null;
}

export function absoluteBoxForSelection(ui: RawUi, selection: Selection): Box | null {
  if (!selection) return null;
  if (selection.kind === "multi-component") {
    const components = readArray(ui.components);
    const boxes = selection.componentIndexes.flatMap((componentIndex) => {
      const component = asRecord(components[componentIndex]);
      return component ? [componentBox(component)] : [];
    });
    return boxes.length > 0 ? boxContainingBoxes(boxes) : null;
  }
  if (
    selection.kind === "element" &&
    selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX
  ) {
    return absoluteElementBox(rootElementsComponent(ui), selection.elementPath);
  }

  const component = asRecord(readArray(ui.components)[selection.componentIndex]);
  if (!component) return null;
  const componentOrigin = readPoint(component.position);
  if (selection.kind === "component") return componentBox(component);
  const elementBoxValue = absoluteElementBox(component, selection.elementPath);
  if (!elementBoxValue) return null;
  return {
    x: componentOrigin.x + elementBoxValue.x,
    y: componentOrigin.y + elementBoxValue.y,
    width: elementBoxValue.width,
    height: elementBoxValue.height,
  };
}

export function boxContainingBoxes(boxes: Box[]): Box {
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Marquee/rubber-band selection: components whose box overlaps the dragged
// rectangle, skipping the full-bleed background component (sweeping a
// marquee across the slide shouldn't scoop up the backdrop).
export function componentIndexesIntersectingBox(ui: RawUi, box: Box): number[] {
  const components = readArray(ui.components);
  const indexes: number[] = [];
  components.forEach((raw, index) => {
    const component = asRecord(raw);
    if (!component) return;
    if (isBackgroundComponent(component)) return;
    if (boxesIntersect(componentBox(component), box)) indexes.push(index);
  });
  return indexes;
}

export function absoluteInlineEditBox(
  ui: RawUi,
  selection: ElementSelection,
  frame?: Box | null,
): Box | null {
  const element = getElementAtSelection(ui, selection);
  const localFrame =
    frame ?? renderedLocalBoxForElementSelection(ui, selection);
  if (!element || !localFrame) return absoluteBoxForSelection(ui, selection);

  return (
    absoluteBoxForElementLocalFrame(ui, selection, localFrame) ??
    absoluteBoxForSelection(ui, selection)
  );
}

export function absoluteBoxForElementLocalFrame(
  ui: RawUi,
  selection: ElementSelection,
  frame: Box,
): Box | null {
  if (selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX) {
    return absoluteElementLocalFrame(
      rootElementsComponent(ui),
      selection.elementPath,
      frame,
    );
  }

  const component = asRecord(readArray(ui.components)[selection.componentIndex]);
  if (!component) return null;
  const componentOrigin = readPoint(component.position);
  const elementFrame = absoluteElementLocalFrame(
    component,
    selection.elementPath,
    frame,
  );
  if (!elementFrame) return null;
  return {
    x: componentOrigin.x + elementFrame.x,
    y: componentOrigin.y + elementFrame.y,
    width: elementFrame.width,
    height: elementFrame.height,
  };
}

export function absoluteElementLocalFrame(
  component: RawComponent,
  path: number[],
  frame: Box,
) {
  let items = readArray(component.elements).filter(isRecord) as RawElement[];
  let parentElement: RawElement | null = null;
  let parentRenderBox: Box = {
    x: 0,
    y: 0,
    ...readSize(component.size, { width: STAGE_WIDTH, height: STAGE_HEIGHT }),
  };
  let x = 0;
  let y = 0;
  for (const index of path.slice(0, -1)) {
    const element = asRecord(items[index]);
    if (!element) return null;
    const laidOut =
      parentElement != null
        ? layoutChildren(parentElement, items, parentRenderBox).find(
          (item) => item.index === index,
        )
        : null;
    const box = laidOut?.box ?? elementBox(element);
    x += box.x;
    y += box.y;
    const childInfo = childArrayInfo(element);
    parentElement = element;
    parentRenderBox = { x: 0, y: 0, width: box.width, height: box.height };
    items = (childInfo?.items ?? []).filter(isRecord) as RawElement[];
  }
  return {
    x: x + frame.x,
    y: y + frame.y,
    width: frame.width,
    height: frame.height,
  };
}

export function renderedLocalBoxForElementSelection(
  ui: RawUi,
  selection: ElementSelection,
): Box | null {
  if (selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX) {
    return localElementBox(rootElementsComponent(ui), selection.elementPath);
  }

  const component = asRecord(readArray(ui.components)[selection.componentIndex]);
  if (!component) return null;
  return localElementBox(component, selection.elementPath);
}

export function rootElementsComponent(ui: RawUi): RawComponent {
  return {
    position: { x: 0, y: 0 },
    size: { width: STAGE_WIDTH, height: STAGE_HEIGHT },
    elements: readArray(ui.elements),
  };
}

export function absoluteElementBox(component: RawComponent, path: number[]) {
  const local = localElementBox(component, path);
  if (!local) return null;
  let items = readArray(component.elements).filter(isRecord) as RawElement[];
  let parentElement: RawElement | null = null;
  let parentRenderBox: Box = {
    x: 0,
    y: 0,
    ...readSize(component.size, { width: STAGE_WIDTH, height: STAGE_HEIGHT }),
  };
  let x = 0;
  let y = 0;
  for (const index of path.slice(0, -1)) {
    const element = asRecord(items[index]);
    if (!element) return null;
    const laidOut =
      parentElement != null
        ? layoutChildren(parentElement, items, parentRenderBox).find(
          (item) => item.index === index,
        )
        : null;
    const box = laidOut?.box ?? elementBox(element);
    x += box.x;
    y += box.y;
    const childInfo = childArrayInfo(element);
    parentElement = element;
    parentRenderBox = { x: 0, y: 0, width: box.width, height: box.height };
    items = (childInfo?.items ?? []).filter(isRecord) as RawElement[];
  }
  return {
    x: x + local.x,
    y: y + local.y,
    width: local.width,
    height: local.height,
  };
}

export function localElementBox(component: RawComponent, path: number[]) {
  let items = readArray(component.elements).filter(isRecord) as RawElement[];
  let parentElement: RawElement | null = null;
  let parentRenderBox: Box = {
    x: 0,
    y: 0,
    ...readSize(component.size, { width: STAGE_WIDTH, height: STAGE_HEIGHT }),
  };
  for (let depth = 0; depth < path.length; depth += 1) {
    const index = path[depth];
    const element = asRecord(items[index]);
    if (!element) return null;
    const laidOut =
      parentElement != null
        ? layoutChildren(parentElement, items, parentRenderBox).find(
          (item) => item.index === index,
        )
        : null;
    const box = laidOut?.box ?? elementBox(element);
    if (depth === path.length - 1) return box;
    const childInfo = childArrayInfo(element);
    parentElement = element;
    parentRenderBox = { x: 0, y: 0, width: box.width, height: box.height };
    items = (childInfo?.items ?? []).filter(isRecord) as RawElement[];
  }
  return null;
}

export function eventTargetsThisSlide(
  detail: {
    slideId?: string | number | null;
    slideIndex?: number | null;
  },
  slideId: string | number | null | undefined,
  slideIndex: number | null,
  isSurfaceActive: () => boolean,
) {
  const currentSlideId = slideId != null ? String(slideId) : null;
  const eventSlideId =
    detail.slideId !== undefined && detail.slideId !== null
      ? String(detail.slideId)
      : null;
  if (eventSlideId && currentSlideId && eventSlideId !== currentSlideId) {
    return false;
  }
  if (
    !eventSlideId &&
    typeof detail.slideIndex === "number" &&
    (slideIndex == null || detail.slideIndex !== slideIndex)
  ) {
    return false;
  }
  const hasTarget = Boolean(eventSlideId) || typeof detail.slideIndex === "number";
  return hasTarget || isSurfaceActive();
}

export function keyForSelection(selection: Selection) {
  if (!selection) return "";
  if (selection.kind === "component") return `component:${selection.componentIndex}`;
  if (selection.kind === "multi-component") {
    return `multi-component:${selection.componentIndexes.join(".")}`;
  }
  return `element:${selection.componentIndex}:${selection.elementPath.join(".")}`;
}

export function keysForSelection(selection: Selection) {
  if (!selection) return [];
  if (selection.kind === "multi-component") {
    return selection.componentIndexes.map((componentIndex) =>
      keyForSelection({ kind: "component", componentIndex }),
    );
  }
  return [keyForSelection(selection)];
}

export function selectionWithComponentToggle(
  currentSelection: Selection,
  nextSelection: Selection,
  options?: SelectOptions,
): Selection {
  if (!options?.additive || nextSelection?.kind !== "component") {
    return nextSelection;
  }

  const componentIndex = nextSelection.componentIndex;
  const currentIndexes = componentIndexesForSelection(currentSelection);
  const nextIndexes = currentIndexes.includes(componentIndex)
    ? currentIndexes.filter((index) => index !== componentIndex)
    : [...currentIndexes, componentIndex];

  return selectionForComponentIndexes(nextIndexes);
}

export function componentIndexesForSelection(selection: Selection) {
  if (!selection) return [];
  if (selection.kind === "component") return [selection.componentIndex];
  if (selection.kind === "multi-component") return selection.componentIndexes;
  return [];
}

export function selectionForComponentIndexes(indexes: number[]): Selection {
  const uniqueIndexes = Array.from(
    new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0)),
  );
  if (uniqueIndexes.length === 0) return null;
  if (uniqueIndexes.length === 1) {
    return { kind: "component", componentIndex: uniqueIndexes[0] };
  }
  return { kind: "multi-component", componentIndexes: uniqueIndexes };
}

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

export function surfaceSelectionTarget(
  ui: RawUi,
  selection: Selection,
  slideIndex: number | null,
): TemplateV2SurfaceSelectedDetail["selection"] {
  if (!selection) return null;
  if (selection.kind === "multi-component") {
    const components = selection.componentIndexes.map((componentIndex) => {
      const component = asRecord(readArray(ui.components)[componentIndex]);
      const componentLabel = componentDisplayLabel(component, componentIndex);
      return {
        kind: "component" as const,
        slideIndex,
        componentIndex,
        componentId: readString(component?.id) || undefined,
        componentLabel,
        targetLabel: componentLabel,
      };
    });
    return {
      kind: "multi-component",
      slideIndex,
      components,
      componentIds: components
        .map((component) => component.componentId)
        .filter((value): value is string => Boolean(value)),
      componentLabels: components.map((component) => component.componentLabel),
      targetLabel: `${components.length} components selected`,
    };
  }
  if (selection.kind === "component") {
    const component = asRecord(readArray(ui.components)[selection.componentIndex]);
    const componentLabel = componentDisplayLabel(component, selection.componentIndex);
    return {
      kind: "component",
      slideIndex,
      componentIndex: selection.componentIndex,
      componentId: readString(component?.id) || undefined,
      componentLabel,
      targetLabel: componentLabel,
    };
  }

  const element = getElementAtSelection(ui, selection);
  const component = asRecord(readArray(ui.components)[selection.componentIndex]);
  const componentLabel =
    selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX
      ? ""
      : componentDisplayLabel(component, selection.componentIndex);
  const elementType = readString(element?.type) || "Element";
  const elementName = readString(element?.name);
  const targetLabel =
    elementName ||
    (componentLabel ? `${elementType} in ${componentLabel}` : elementType);
  return {
    kind: "element",
    slideIndex,
    componentIndex:
      selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX
        ? undefined
        : selection.componentIndex,
    componentId: readString(component?.id) || undefined,
    componentLabel: componentLabel || undefined,
    elementPath: elementPathForSelection(ui, selection) || undefined,
    elementType,
    elementName: elementName || undefined,
    targetLabel,
  };
}

export function componentDisplayLabel(component: UnknownRecord | null, index: number) {
  return (
    readString(component?.description) ||
    readString(component?.name) ||
    readString(component?.id) ||
    `Component ${index + 1}`
  );
}

export function elementPathForSelection(ui: RawUi, selection: ElementSelection) {
  const parts: string[] =
    selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX
      ? []
      : [`components[${selection.componentIndex}]`];
  let items =
    selection.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX
      ? readArray(ui.elements)
      : readArray(asRecord(readArray(ui.components)[selection.componentIndex])?.elements);
  let current: RawElement | null = null;

  for (let depth = 0; depth < selection.elementPath.length; depth += 1) {
    const index = selection.elementPath[depth] ?? -1;
    if (!Number.isFinite(index) || index < 0 || index >= items.length) return "";
    if (depth === 0) {
      parts.push(`elements[${index}]`);
    } else if (current) {
      const childInfo = childArrayInfo(current);
      if (!childInfo) return "";
      parts.push(childInfo.key === "child" ? "child" : `${childInfo.key}[${index}]`);
    }
    current = asRecord(items[index]) as RawElement | null;
    items = current ? childArrayInfo(current)?.items ?? [] : [];
  }

  return parts.join(".");
}

export function selectionFromKey(key: string): Selection {
  if (key.startsWith("component:")) {
    const componentIndex = Number(key.split(":")[1]);
    return Number.isFinite(componentIndex)
      ? { kind: "component", componentIndex }
      : null;
  }
  if (key.startsWith("multi-component:")) {
    const componentIndexes = key
      .split(":")[1]
      ?.split(".")
      .map(Number)
      .filter((value) => Number.isInteger(value) && value >= 0) ?? [];
    return selectionForComponentIndexes(componentIndexes);
  }
  const [, component, path] = key.split(":");
  const componentIndex = Number(component);
  const elementPath = path
    ?.split(".")
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (!Number.isFinite(componentIndex) || !elementPath?.length) return null;
  return { kind: "element", componentIndex, elementPath };
}

export function selectionTouchesComponent(
  key: string | null,
  componentIndex: number,
) {
  return (
    key === `component:${componentIndex}` ||
    key?.startsWith(`element:${componentIndex}:`) === true
  );
}

export function selectionTouchesElement(
  key: string | null,
  componentIndex: number,
  elementPath: number[],
) {
  if (!key) return false;
  const ownKey = `element:${componentIndex}:${elementPath.join(".")}`;
  return key === ownKey || key.startsWith(`${ownKey}.`);
}

export function numberPathEqual(previous: number[], next: number[]) {
  return (
    previous.length === next.length &&
    previous.every((value, index) => value === next[index])
  );
}

export function boxEqual(previous: Box, next: Box) {
  return (
    previous.x === next.x &&
    previous.y === next.y &&
    previous.width === next.width &&
    previous.height === next.height
  );
}

export function nullableBoxEqual(
  previous: Box | null | undefined,
  next: Box | null | undefined,
) {
  if (previous == null || next == null) return previous == null && next == null;
  return boxEqual(previous, next);
}

export function componentKey(component: RawComponent, index: number) {
  return `${readString(component.id) ?? "component"}:${index}`;
}

export function rawElementKey(element: RawElement, index: number) {
  return `${readString(element.id) ?? readString(element.name) ?? readString(element.type) ?? "element"}:${index}`;
}

export function componentBox(component: RawComponent): Box {
  return {
    ...readPoint(component.position),
    ...readSize(component.size, { width: STAGE_WIDTH, height: STAGE_HEIGHT }),
  };
}

export type ComponentGroupSelection = {
  kind: "component";
  componentIndex: number;
};

function offsetElementPosition(element: RawElement, dx: number, dy: number): RawElement {
  const position = readPoint(element.position);
  return { ...element, position: { x: position.x + dx, y: position.y + dy } };
}

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

const CONTENT_ELEMENT_TYPES = new Set(["text", "text-list", "table", "chart"]);

function containsContentElement(elements: unknown): boolean {
  if (!Array.isArray(elements)) return false;
  return elements.some((raw) => {
    const element = asRecord(raw);
    if (!element) return false;
    const type = readString(element.type);
    if (type && CONTENT_ELEMENT_TYPES.has(type)) return true;
    if (containsContentElement(element.children)) return true;
    if (containsContentElement(element.elements)) return true;
    const child = asRecord(element.child);
    return child ? containsContentElement([child]) : false;
  });
}

/**
 * A component acts as the slide background when it covers the full stage
 * and holds only decorative elements (rectangles/images/svg) — no text,
 * tables, or charts. Background components are rendered but must not be
 * selectable or draggable in the editor.
 */
export function isBackgroundComponent(component: RawComponent): boolean {
  const box = componentBox(component);
  if (box.x > 0 || box.y > 0) return false;
  if (
    box.x + box.width < STAGE_WIDTH ||
    box.y + box.height < STAGE_HEIGHT
  ) {
    return false;
  }
  return !containsContentElement(component.elements);
}

export function elementBox(element: RawElement): Box {
  const box = {
    ...readPoint(element.position),
    ...elementSize(element),
  };
  const type = readString(element.type);
  if (type === "text") {
    return textVisualLocalBox(element, box);
  }
  if (type === "text-list") {
    return textVisualLocalBox(element, box, {
      runs: rawTextListRenderTextRuns(element),
    });
  }
  return box;
}

export function isManualPositioned(element: RawElement) {
  return element.__presenton_manual_position === true;
}

export function elementSize(element: RawElement, fallback?: Size): Size {
  const explicit = readOptionalSize(element.size);
  if (explicit) return explicit;

  const type = readString(element.type);
  if (type === "group") {
    return childrenBounds(childArrayInfo(element)?.items ?? []);
  }
  if (type === "container") {
    const padding = readPadding(element.padding);
    const child = asRecord(element.child);
    const childSize = child ? elementSize(child, fallback) : fallback;
    if (childSize) {
      return {
        width: Math.max(1, childSize.width + padding.left + padding.right),
        height: Math.max(1, childSize.height + padding.top + padding.bottom),
      };
    }
  }
  if (type === "text") {
    const font = rawFont(element);
    const text = displayText(rawTextContent(element));
    const width = fallback?.width ?? estimateTextWidth(text, font);
    return {
      width: Math.max(1, width),
      height: Math.max(1, estimateTextHeight(text, font, width)),
    };
  }
  if (type === "text-list") {
    const font = rawFont(element);
    const text = displayText(textRunsContent(rawTextListRunsForEditor(element)));
    const width = fallback?.width ?? estimateTextWidth(text, font);
    return {
      width: Math.max(1, width),
      height: Math.max(1, estimateTextHeight(text, font, width)),
    };
  }
  if (type === "line") {
    return {
      width: fallback?.width ?? DECORATIVE_LINE_LENGTH,
      height: fallback?.height ?? DECORATIVE_LINE_THICKNESS,
    };
  }
  if (type === "rectangle" || type === "ellipse") {
    return {
      width: fallback?.width ?? DECORATIVE_LINE_LENGTH,
      height: fallback?.height ?? DECORATIVE_LINE_LENGTH,
    };
  }
  if (
    type === "flex" ||
    type === "grid" ||
    type === "list-view" ||
    type === "grid-view"
  ) {
    return (
      fallback ??
      intrinsicFlowSize(
        element,
        (childArrayInfo(element)?.items ?? []).filter(isRecord) as RawElement[],
        {
          elementBox,
          elementSize,
          isManualPositioned,
        },
      )
    );
  }
  return fallback ?? { width: 1, height: 1 };
}

export function childrenBounds(children: unknown[]): Size {
  const records = children.filter(isRecord) as RawElement[];
  if (records.length === 0) return { width: 1, height: 1 };

  return records.reduce<Size>(
    (bounds, child) => {
      const box = elementBox(child);
      return {
        width: Math.max(bounds.width, box.x + box.width),
        height: Math.max(bounds.height, box.y + box.height),
      };
    },
    { width: 1, height: 1 },
  );
}

export function childArrayInfo(element: RawElement): ChildArrayInfo | null {
  if (Array.isArray(element.children)) return { key: "children", items: element.children };
  if (Array.isArray(element.elements)) return { key: "elements", items: element.elements };
  if (isRecord(element.child)) return { key: "child", items: [element.child] };
  return null;
}

export function withUpdatedChildItems(
  element: RawElement,
  childInfo: ChildArrayInfo,
  updatedChildren: unknown[],
) {
  if (childInfo.key === "child") {
    return { ...element, child: updatedChildren[0] ?? null };
  }
  return { ...element, [childInfo.key]: updatedChildren };
}

export function shouldClipElementChildren(
  element: RawElement,
  childInfo: ChildArrayInfo | null,
) {
  if (!childInfo) return false;
  const type = readString(element.type);
  return type === "container";
}

export function isBoxVisualType(type: string | null) {
  return (
    type === "rectangle" ||
    type === "container" ||
    type === "flex" ||
    type === "grid" ||
    type === "list-view" ||
    type === "grid-view" ||
    type === "group"
  );
}

function recolorFontRecord(font: unknown, color: string): UnknownRecord {
  return { ...(asRecord(font) ?? {}), color };
}

function recolorTextRuns(runs: unknown[], color: string): unknown[] {
  return runs.map((run) => {
    const record = asRecord(run);
    // Runs without an explicit font inherit the element font, which the
    // caller already recolored.
    if (!record || record.font == null) return run;
    return { ...record, font: recolorFontRecord(record.font, color) };
  });
}

function recolorTextListItems(items: unknown[], color: string): unknown[] {
  return items.map((item) => {
    if (Array.isArray(item)) return recolorTextRuns(item, color);
    const record = asRecord(item);
    if (record && Array.isArray(record.runs)) {
      return { ...record, runs: recolorTextRuns(record.runs, color) };
    }
    return item;
  });
}

function recolorTableCell(cell: unknown, color: string): unknown {
  const record = asRecord(cell);
  if (!record) return cell;
  const next: UnknownRecord = {
    ...record,
    font: recolorFontRecord(record.font, color),
  };
  if (Array.isArray(record.runs)) next.runs = recolorTextRuns(record.runs, color);
  return next;
}

function isTextLikeType(type: string | null) {
  return type === "text" || type === "text-list" || type === "table";
}

// Applies a palette color to whatever the element visually "is": text gets a
// font color, shapes get a fill, lines/icons/charts/infographics get their
// accent color. Returns the element unchanged (same reference) when nothing
// on it can take the color (e.g. a photo), so callers can detect no-ops.
export function recolorRawElement(element: RawElement, color: string): RawElement {
  const type = readString(element.type);

  if (type === "text" || type === "text-list") {
    const next: RawElement = {
      ...element,
      font: recolorFontRecord(element.font, color),
    };
    if (Array.isArray(element.runs)) next.runs = recolorTextRuns(element.runs, color);
    if (Array.isArray(element.items)) {
      next.items = recolorTextListItems(element.items, color);
    }
    return next;
  }

  if (type === "table") {
    // Cell backgrounds stay untouched — only the text color changes.
    return {
      ...element,
      font: recolorFontRecord(element.font, color),
      columns: readArray(element.columns).map((cell) => recolorTableCell(cell, color)),
      rows: readArray(element.rows).map((row) =>
        readArray(row).map((cell) => recolorTableCell(cell, color)),
      ),
    };
  }

  if (type === "rectangle" || type === "ellipse") {
    return { ...element, fill: { ...(asRecord(element.fill) ?? {}), color } };
  }

  if (type === "line") {
    return { ...element, stroke: { ...(asRecord(element.stroke) ?? {}), color } };
  }

  if (type === "image") {
    // Only icons are tintable; recoloring a photo does nothing.
    return isRawIconElement(element) ? { ...element, color } : element;
  }

  if (type === "chart") {
    // The base color drives the first series; explicit per-series colors
    // would keep overriding it, so drop them.
    return { ...element, color, colors: null };
  }

  if (type === "infographic") {
    return { ...element, highlight_color: color };
  }

  if (type === "formula") {
    return { ...element, color };
  }

  const childInfo = childArrayInfo(element);
  if (childInfo) {
    // A wrapper that paints its own background is "the shape" the user
    // selected — recolor just that, keeping the content readable on top.
    const fill = asRecord(element.fill);
    if (readString(fill?.color)) {
      return { ...element, fill: { ...fill, color } };
    }
    const updated = recolorRawElements(childInfo.items, color);
    return updated === childInfo.items
      ? element
      : withUpdatedChildItems(element, childInfo, updated);
  }

  return element;
}

// Recolors a collection of sibling elements (a group's children or a
// component's elements). Non-text elements take the color first; text only
// recolors when nothing else in the collection accepted the color, so a
// card's background doesn't end up the same color as its text.
export function recolorRawElements(elements: unknown[], color: string): unknown[] {
  const records = elements.map((child) => asRecord(child));
  const nonTextResults = records.map((record) =>
    record && !isTextLikeType(readString(record.type))
      ? recolorRawElement(record, color)
      : null,
  );
  const nonTextChanged = nonTextResults.some(
    (result, index) => result != null && result !== records[index],
  );
  let changed = false;
  const next = elements.map((child, index) => {
    const record = records[index];
    if (!record) return child;
    const result =
      nonTextResults[index] ??
      (nonTextChanged ? record : recolorRawElement(record, color));
    if (result !== record) changed = true;
    return result;
  });
  return changed ? next : elements;
}

export function elementWithInlineDraft(
  element: RawElement,
  kind: TemplateV2InlineEditKind,
  draft: string,
  style?: TemplateV2TextEditStyle,
  frame?: Box | null,
  runs?: TextRun[],
) {
  if (kind === "text") {
    const next =
      runs != null
        ? setRawTextRunsContent(element, runs)
        : draft === rawTextContent(element)
          ? element
          : setRawTextContent(element, draft, style);
    return preserveInlineEditFrame(next, frame);
  }
  if (kind === "text-list") {
    const next =
      runs != null
        ? setRawTextListRunsContent(element, runs)
        : setRawTextListContent(element, draft);
    const styled = style ? applyTextStyle(next, style) : next;
    return preserveInlineEditFrame(styled, frame);
  }
  return element;
}

export function preserveInlineEditFrame(element: RawElement, frame?: Box | null) {
  if (!frame) return element;
  return {
    ...element,
    position: {
      ...(asRecord(element.position) ?? {}),
      x: frame.x,
      y: frame.y,
    },
    size: {
      ...(asRecord(element.size) ?? {}),
      width: frame.width,
      height: frame.height,
    },
    __presenton_manual_position: true,
  };
}

export function normalizeMarkdownTextInUi(ui: RawUi): RawUi {
  let changed = false;
  const nextUi: RawUi = { ...ui };
  const elements = readArray(ui.elements);
  const normalizedElements = normalizeMarkdownTextElementArray(elements);
  if (normalizedElements !== elements) {
    nextUi.elements = normalizedElements;
    changed = true;
  }

  const components = readArray(ui.components);
  let componentsChanged = false;
  const normalizedComponents = components.map((component) => {
    const record = asRecord(component);
    if (!record) return component;
    const componentElements = readArray(record.elements);
    const normalizedComponentElements =
      normalizeMarkdownTextElementArray(componentElements);
    if (normalizedComponentElements === componentElements) return component;
    componentsChanged = true;
    return {
      ...record,
      elements: normalizedComponentElements,
    };
  });

  if (componentsChanged) {
    nextUi.components = normalizedComponents;
    changed = true;
  }

  return changed ? nextUi : ui;
}

export function normalizeMarkdownTextElementArray(elements: unknown[]): unknown[] {
  let changed = false;
  const normalized = elements.map((element) => {
    const next = normalizeMarkdownTextElementTree(element);
    if (next !== element) changed = true;
    return next;
  });
  return changed ? normalized : elements;
}

export function normalizeMarkdownTextElementTree(value: unknown): unknown {
  const element = asRecord(value);
  if (!element) return value;

  let next = element;
  if (readString(element.type) === "text") {
    const normalized = normalizeRawTextMarkdownElement(element);
    next = normalized.element;
  }

  const childInfo = childArrayInfo(next);
  if (!childInfo) return next;

  const normalizedChildren = normalizeMarkdownTextElementArray(childInfo.items);
  return normalizedChildren === childInfo.items
    ? next
    : withUpdatedChildItems(next, childInfo, normalizedChildren);
}

export function rawElementForEditorToolbar(
  element: RawElement,
  absoluteBox: Box,
): SlideElement | null {
  const type = readString(element.type);
  if (!type) return null;

  const projected: UnknownRecord = {
    ...element,
    type,
    position: {
      x: absoluteBox.x,
      y: absoluteBox.y,
    },
    size: {
      width: absoluteBox.width,
      height: absoluteBox.height,
    },
    font: rawFontRecordForEditor(element.font),
    stroke: rawStrokeForEditor(element.stroke),
    border_radius: rawBorderRadiusForEditor(
      element.border_radius ?? element.borderRadius,
    ),
  };

  if (type === "text") {
    projected.runs = rawTextRunsForEditor(element).map((run) => ({
      text: run.text,
      font: rawFontRecordForEditor(run.font),
    }));
  } else if (type === "text-list") {
    projected.items = readArray(element.items).map((item) => {
      if (Array.isArray(item)) {
        return item.map((value) => {
          const run = asRecord(value) ?? {};
          return { ...run, font: rawFontRecordForEditor(run.font) };
        });
      }
      return [{ text: rawTextListItemText(item) }];
    });
  } else if (type === "table") {
    projected.columns = readArray(element.columns).map(rawTableCellForEditor);
    projected.rows = readArray(element.rows).map((row) =>
      readArray(row).map(rawTableCellForEditor),
    );
  } else if (type === "chart") {
    Object.assign(projected, rawChartToEditorChart(element));
    projected.position = {
      x: absoluteBox.x,
      y: absoluteBox.y,
    };
    projected.size = {
      width: absoluteBox.width,
      height: absoluteBox.height,
    };
  }

  return projected as unknown as SlideElement;
}

export function mergeEditorToolbarElement(
  current: RawElement,
  editorElement: SlideElement,
  renderedBox: Box,
): RawElement {
  const editor = editorElement as unknown as UnknownRecord;
  const currentPosition = readPoint(current.position);
  const editorPosition = asRecord(editor.position);
  const editorSize = asRecord(editor.size);
  const editorX = readNumber(editorPosition?.x);
  const editorY = readNumber(editorPosition?.y);
  const editorWidth = readNumber(editorSize?.width);
  const editorHeight = readNumber(editorSize?.height);
  const nextPosition = {
    x:
      currentPosition.x +
      ((editorX ?? renderedBox.x) - renderedBox.x),
    y:
      currentPosition.y +
      ((editorY ?? renderedBox.y) - renderedBox.y),
  };
  const nextSize = {
    width: Math.max(
      1,
      editorWidth ?? renderedBox.width,
    ),
    height: Math.max(
      1,
      editorHeight ?? renderedBox.height,
    ),
  };
  const merged: RawElement = {
    ...current,
    ...editor,
    position: nextPosition,
    size: nextSize,
    font: editorFontRecordToRaw(editor.font, current.font),
    stroke: editorStrokeToRaw(editor.stroke, current.stroke),
    border_radius: editorBorderRadiusToRaw(
      editor.border_radius ?? editor.borderRadius,
      current.border_radius ?? current.borderRadius,
    ),
  };

  if (Array.isArray(editor.runs)) {
    const currentRuns = readArray(current.runs);
    merged.runs = editor.runs.map((value, index) => {
      const run = asRecord(value) ?? {};
      const currentRun = asRecord(currentRuns[index]) ?? {};
      return {
        ...currentRun,
        ...run,
        font: editorFontRecordToRaw(run.font, currentRun.font),
      };
    });
  }
  if (readString(current.type) === "table") {
    merged.columns = readArray(editor.columns).map((cell, index) =>
      editorTableCellToRaw(cell, readArray(current.columns)[index]),
    );
    merged.rows = readArray(editor.rows).map((row, rowIndex) =>
      readArray(row).map((cell, colIndex) =>
        editorTableCellToRaw(
          cell,
          readArray(readArray(current.rows)[rowIndex])[colIndex],
        ),
      ),
    );
  }
  if (
    Math.abs(nextPosition.x - currentPosition.x) > 0.01 ||
    Math.abs(nextPosition.y - currentPosition.y) > 0.01 ||
    Math.abs(nextSize.width - elementSize(current).width) > 0.01 ||
    Math.abs(nextSize.height - elementSize(current).height) > 0.01
  ) {
    merged.__presenton_manual_position = true;
  }
  return merged;
}

export function rawStrokeForEditor(value: unknown) {
  const stroke = asRecord(value);
  if (!stroke) return value;
  return { ...stroke };
}

export function editorStrokeToRaw(value: unknown, fallback: unknown) {
  const stroke = asRecord(value);
  if (!stroke) return fallback;
  return {
    ...(asRecord(fallback) ?? {}),
    ...stroke,
  };
}

export function rawBorderRadiusForEditor(value: unknown) {
  const radius = asRecord(value);
  const uniform = readNumber(value);
  if (!radius && uniform == null) return value;
  const raw = radius ?? { tl: uniform, tr: uniform, bl: uniform, br: uniform };
  return {
    tl: readNumber(raw.tl) ?? 0,
    tr: readNumber(raw.tr) ?? 0,
    bl: readNumber(raw.bl) ?? 0,
    br: readNumber(raw.br) ?? 0,
  };
}

export function editorBorderRadiusToRaw(value: unknown, fallback: unknown) {
  const radius = asRecord(value);
  if (!radius) return fallback;
  return {
    tl: readNumber(radius.tl) ?? 0,
    tr: readNumber(radius.tr) ?? 0,
    bl: readNumber(radius.bl) ?? 0,
    br: readNumber(radius.br) ?? 0,
  };
}

export function rawTableCellForEditor(value: unknown) {
  const cell = asRecord(value) ?? {};
  const rawRuns = readArray(cell.runs);
  const runs =
    rawRuns.length > 0
      ? rawRuns.map((value) => {
        const run = asRecord(value) ?? {};
        return { ...run, font: rawFontRecordForEditor(run.font) };
      })
      : [{ text: rawTableCellText(cell) }];
  return {
    ...cell,
    color: cell.color ?? cell.fill,
    font: rawFontRecordForEditor(cell.font),
    runs,
  };
}

export function editorTableCellToRaw(value: unknown, fallback: unknown) {
  const cell = asRecord(value) ?? {};
  const current = asRecord(fallback) ?? {};
  const currentRuns = readArray(current.runs);
  return {
    ...current,
    ...cell,
    color: cell.color ?? current.color ?? current.fill,
    font: editorFontRecordToRaw(cell.font, current.font),
    runs: readArray(cell.runs).map((value, index) => {
      const run = asRecord(value) ?? {};
      const currentRun = asRecord(currentRuns[index]) ?? {};
      return {
        ...currentRun,
        ...run,
        font: editorFontRecordToRaw(run.font, currentRun.font),
      };
    }),
  };
}

export function linePoints(width: number, height: number, strokeWidthValue: number) {
  if (height <= Math.max(2, strokeWidthValue * 2)) {
    return [0, height / 2, width, height / 2];
  }
  if (width <= Math.max(2, strokeWidthValue * 2)) {
    return [width / 2, 0, width / 2, height];
  }
  return [0, 0, width, height];
}

export function valueProgress(element: RawElement) {
  const min = readNumber(element.min_value) ?? readNumber(element.minValue) ?? 0;
  const max = readNumber(element.max_value) ?? readNumber(element.maxValue) ?? 100;
  const value = readNumber(element.value) ?? min;
  const range = max - min;
  if (!Number.isFinite(range) || range === 0) return 0;
  return clamp((value - min) / range, 0, 1);
}

export function pointOnCircle(x: number, y: number, radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: x + Math.cos(radians) * radius,
    y: y + Math.sin(radians) * radius,
  };
}

export function rawIconQuery(element: RawElement): string {
  for (const key of ["icon_query", "query", "__icon_query__"]) {
    const query = readString(element[key])?.trim();
    if (query) return query;
  }

  const name = (readString(element.name) ?? "").replace(/[_-]+/g, " ").trim();
  return name || "icon";
}

export function isRawIconElement(element: RawElement): boolean {
  return (
    readString(element.type) === "image" && readBoolean(element.is_icon) === true
  );
}

export function isStaticSvgIconSource(source: string, baseUrl: string): boolean {
  try {
    const pathname = new URL(source, baseUrl).pathname;
    return (
      pathname.startsWith("/static/icons/") &&
      pathname.toLowerCase().endsWith(".svg")
    );
  } catch {
    return false;
  }
}
