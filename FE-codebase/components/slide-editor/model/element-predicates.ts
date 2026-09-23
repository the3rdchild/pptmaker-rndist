import {
  asRecord,
  clamp,
  readBoolean,
  readNumber,
  readString,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type ChildArrayInfo,
  type RawComponent,
  type RawElement,
} from "@/components/slide-editor/model/core";
import { componentBox } from "@/components/slide-editor/model/geometry";

export function componentKey(component: RawComponent, index: number) {
  return `${readString(component.id) ?? "component"}:${index}`;
}

export function rawElementKey(element: RawElement, index: number) {
  return `${readString(element.id) ?? readString(element.name) ?? readString(element.type) ?? "element"}:${index}`;
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
