import type { TemplateV2SurfaceSelectedDetail } from "@/components/slide-editor/events/events";
import {
  asRecord,
  readArray,
  readString,
  ROOT_ELEMENTS_COMPONENT_INDEX,
  type Box,
  type ElementSelection,
  type RawElement,
  type RawUi,
  type SelectOptions,
  type Selection,
  type UnknownRecord,
} from "@/components/slide-editor/model/core";
import {
  absoluteBoxForElementLocalFrame,
  absoluteBoxForSelection,
  boxesIntersect,
  childArrayInfo,
  componentBox,
  renderedLocalBoxForElementSelection,
} from "@/components/slide-editor/model/geometry";
import { isBackgroundComponent } from "@/components/slide-editor/model/element-predicates";

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
