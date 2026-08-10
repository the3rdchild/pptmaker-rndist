// Flattens a layout's component tree into an addressable list.
//
// The metadata panel could only ever label whatever happened to be selected on
// the canvas, which makes small or overlapped elements (a 4px accent rule, a
// text box behind a shape) effectively unlabellable. This produces the same
// {componentIndex, elementPath} addresses the canvas uses, so the panel can
// drive the selection instead of waiting for it.

import { parseSlotMeta, type SlotMeta } from "@/components/slide-editor/templates/slot-meta";
import { isImageFrameElement } from "@/components/editor-react/image-frames";

type Rec = Record<string, unknown>;

export type OutlineEntry = {
  /** Address understood by TEMPLATE_V2_SELECT_ELEMENT_EVENT. */
  componentIndex: number;
  elementPath: number[];
  /** Nesting depth, for indentation. */
  depth: number;
  type: string;
  /** Image containers (clipped photos) get their own label + fill rules —
   *  they are internal shapes, not plain media images. */
  frame: boolean;
  /** The element's slot name, when it has one. */
  name: string | null;
  /** Human-readable line for the list. */
  label: string;
  decorative: boolean;
  slot: SlotMeta | null;
  /** Text/text-list elements are the ones the generator fills. */
  fillable: boolean;
};

function isRecord(value: unknown): value is Rec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Mirrors model.ts childArrayInfo so paths stay in sync with the canvas. */
function childItems(element: Rec): unknown[] | null {
  if (Array.isArray(element.children)) return element.children;
  if (Array.isArray(element.elements)) return element.elements;
  if (isRecord(element.child)) return [element.child];
  return null;
}

function previewText(element: Rec): string | null {
  if (Array.isArray(element.runs)) {
    const text = element.runs
      .map((run) => (isRecord(run) && typeof run.text === "string" ? run.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  if (Array.isArray(element.items)) {
    const first = element.items[0];
    if (Array.isArray(first)) {
      const text = first
        .map((run) => (isRecord(run) && typeof run.text === "string" ? run.text : ""))
        .join("")
        .trim();
      if (text) return text;
    }
  }
  return null;
}

function labelFor(element: Rec, type: string): string {
  const name = typeof element.name === "string" ? element.name.trim() : "";
  if (name) return name;
  const text = previewText(element);
  if (text) return text.length > 34 ? `${text.slice(0, 34)}…` : text;
  return type;
}

const FILLABLE_TYPES = new Set(["text", "text-list"]);

export function buildElementOutline(ui: Rec | null): OutlineEntry[] {
  if (!ui) return [];
  const components = Array.isArray(ui.components) ? ui.components : [];
  const entries: OutlineEntry[] = [];

  components.forEach((rawComponent, componentIndex) => {
    if (!isRecord(rawComponent)) return;
    const elements = Array.isArray(rawComponent.elements)
      ? rawComponent.elements
      : [];

    const walk = (items: unknown[], path: number[], depth: number) => {
      items.forEach((rawElement, index) => {
        if (!isRecord(rawElement)) return;
        const type = typeof rawElement.type === "string" ? rawElement.type : "element";
        const elementPath = [...path, index];

        entries.push({
          componentIndex,
          elementPath,
          depth,
          type,
          frame: isImageFrameElement(rawElement),
          name: typeof rawElement.name === "string" ? rawElement.name : null,
          label: labelFor(rawElement, type),
          decorative: rawElement.decorative === true,
          slot: parseSlotMeta(rawElement.slot),
          fillable: FILLABLE_TYPES.has(type) && rawElement.decorative !== true,
        });

        const children = childItems(rawElement);
        if (children) walk(children, elementPath, depth + 1);
      });
    };

    walk(elements, [], 0);
  });

  return entries;
}

export function sameAddress(
  a: { componentIndex: number; elementPath: number[] } | null,
  b: { componentIndex: number; elementPath: number[] } | null,
): boolean {
  if (!a || !b) return false;
  return (
    a.componentIndex === b.componentIndex &&
    a.elementPath.length === b.elementPath.length &&
    a.elementPath.every((value, index) => value === b.elementPath[index])
  );
}
