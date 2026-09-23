import type { TextRun } from "@/components/slide-editor/types";
import type {
  TemplateV2InlineEditKind,
  TemplateV2TextEditStyle,
} from "@/components/slide-editor/text/template-v2-text-editing";
import {
  applyTextStyle,
  fontScaleFromResize,
  normalizeRawTextMarkdownElement,
  rawTextContent,
  scaleRawTextMetrics,
  setRawTextContent,
  setRawTextListContent,
  setRawTextListRunsContent,
  setRawTextRunsContent,
} from "@/components/slide-editor/text/template-v2-text";
import { deleteLayoutChildFromArray } from "@/components/slide-editor/layout/layoutResize";
import {
  asRecord,
  readArray,
  readNumber,
  readOptionalSize,
  readPoint,
  readSize,
  readString,
  ROOT_ELEMENTS_COMPONENT_INDEX,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Box,
  type ElementSelection,
  type Point,
  type RawComponent,
  type RawElement,
  type RawUi,
  type Selection,
} from "@/components/slide-editor/model/core";
import {
  childArrayInfo,
  elementBox,
  layoutChildren,
  withUpdatedChildItems,
} from "@/components/slide-editor/model/geometry";

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
    if (elements === currentElements) return sourceUi;
    // Deleting a component's last element leaves nothing to select or see —
    // drop the empty shell with it.
    if (elements.length === 0) components.splice(selection.componentIndex, 1);
    else components[selection.componentIndex] = { ...component, elements };
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

export type RootElementResizeMode = "resize-bounds" | "scale-content";

/**
 * Applies a root-level canvas resize without imposing stage boundaries.
 * Side handles resize only the element frame so text can reflow naturally;
 * corner handles scale the text metrics along with the frame.
 */
export function resizeRootElement(
  element: RawElement,
  next: Box & { scaleX: number; scaleY: number; rotation?: number },
  mode: RootElementResizeMode,
): RawElement {
  const resized =
    mode === "scale-content"
      ? scaleRawElementTextMetrics(
          element,
          fontScaleFromResize(next.scaleX, next.scaleY),
        )
      : element;
  return {
    ...resized,
    position: { x: next.x, y: next.y },
    size: { width: Math.max(1, next.width), height: Math.max(1, next.height) },
    rotation: next.rotation ?? readNumber(element.rotation) ?? 0,
  };
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
