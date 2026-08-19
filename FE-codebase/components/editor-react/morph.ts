// Morph transition ("match & move") matching logic — pure functions over ui
// records. The player lives in present-mode.tsx; this module only decides
// WHICH element on slide A is the same thing as WHICH element on slide B.
//
// Matching priority:
//   1. Manual link: both elements carry the same non-empty `morph_id`
//      (set from the Transition tab's link input). This is the escape hatch
//      for elements the heuristic can't pair — PowerPoint's `!!name`
//      convention, basically.
//   2. Heuristic: same `id` ?? `name`, and same `type`. Works out of the box
//      for the common morph workflow — duplicate a slide, then move/resize
//      things — because duplicateSlide deep-clones ids/names verbatim.

import {
  absoluteBoxForSelection,
  getElementAtSelection,
  keyForSelection,
} from "@/components/slide-editor/model/model";
import {
  ROOT_ELEMENTS_COMPONENT_INDEX,
  readNumber,
  readString,
  type Box,
  type RawElement,
  type RawUi,
  type ElementSelection,
} from "@/components/slide-editor/model/core";

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Mirrors model.ts childArrayInfo so walked paths stay in sync with the
 *  canvas (and with absoluteBoxForSelection / nodeRefs keys). */
function childItems(element: Rec): unknown[] | null {
  if (Array.isArray(element.children)) return element.children;
  if (Array.isArray(element.elements)) return element.elements;
  if (isRecord(element.child)) return [element.child];
  return null;
}

export interface MorphElementRef {
  selection: ElementSelection;
  /** keyForSelection(selection) — doubles as the nodeRefs lookup key. */
  key: string;
  element: RawElement;
}

/** Every element on the slide: root `ui.elements`, every component's
 *  elements, and nested children at any depth. */
export function walkSlideElements(ui: Rec | null | undefined): MorphElementRef[] {
  if (!ui) return [];
  const out: MorphElementRef[] = [];

  const walk = (
    items: unknown[],
    componentIndex: number,
    path: number[],
  ) => {
    items.forEach((raw, index) => {
      if (!isRecord(raw)) return;
      const elementPath = [...path, index];
      const selection: ElementSelection = {
        kind: "element",
        componentIndex,
        elementPath,
      };
      out.push({
        selection,
        key: keyForSelection(selection),
        element: raw as RawElement,
      });
      const children = childItems(raw);
      if (children) walk(children, componentIndex, elementPath);
    });
  };

  if (Array.isArray(ui.elements)) {
    walk(ui.elements, ROOT_ELEMENTS_COMPONENT_INDEX, []);
  }
  if (Array.isArray(ui.components)) {
    ui.components.forEach((rawComponent, componentIndex) => {
      if (!isRecord(rawComponent)) return;
      if (Array.isArray(rawComponent.elements)) {
        walk(rawComponent.elements, componentIndex, []);
      }
    });
  }
  return out;
}

/** All non-empty morph link names on a slide (for the panel's quick-pick
 *  chips). */
export function collectMorphLinks(ui: Rec | null | undefined): string[] {
  const links = new Set<string>();
  for (const ref of walkSlideElements(ui)) {
    const id = readString(ref.element.morph_id)?.trim();
    if (id) links.add(id);
  }
  return [...links];
}

/** The identity the heuristic pass matches on, or null when the element has
 *  neither an id nor a name (nothing stable to match by). */
function heuristicIdentity(element: RawElement): string | null {
  const id = readString(element.id)?.trim() || readString(element.name)?.trim();
  if (!id) return null;
  const type = readString(element.type) ?? "element";
  return `${type}:${id}`;
}

export interface MorphPair {
  keyA: string;
  keyB: string;
  selectionA: ElementSelection;
  selectionB: ElementSelection;
}

export interface MorphMatch {
  pairs: MorphPair[];
  /** Keys of B's elements with no counterpart on A — they fade in. */
  enteringB: string[];
  /** Keys of A's elements with no counterpart on B — they fade out. */
  exitingA: string[];
}

export function matchMorphPairs(
  uiA: Rec | null | undefined,
  uiB: Rec | null | undefined,
): MorphMatch {
  const elsA = walkSlideElements(uiA);
  const elsB = walkSlideElements(uiB);
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const pairs: MorphPair[] = [];

  // Pass 1 — manual links (`morph_id`).
  const bByMorphId = new Map<string, MorphElementRef>();
  for (const ref of elsB) {
    const id = readString(ref.element.morph_id)?.trim();
    if (id && !bByMorphId.has(id)) bByMorphId.set(id, ref);
  }
  for (const refA of elsA) {
    const id = readString(refA.element.morph_id)?.trim();
    if (!id) continue;
    const refB = bByMorphId.get(id);
    if (!refB || usedB.has(refB.key)) continue;
    pairs.push({
      keyA: refA.key,
      keyB: refB.key,
      selectionA: refA.selection,
      selectionB: refB.selection,
    });
    usedA.add(refA.key);
    usedB.add(refB.key);
  }

  // Pass 2 — heuristic identity (id ?? name, plus type).
  const bByIdentity = new Map<string, MorphElementRef[]>();
  for (const ref of elsB) {
    if (usedB.has(ref.key)) continue;
    const identity = heuristicIdentity(ref.element);
    if (!identity) continue;
    const bucket = bByIdentity.get(identity) ?? [];
    bucket.push(ref);
    bByIdentity.set(identity, bucket);
  }
  for (const refA of elsA) {
    if (usedA.has(refA.key)) continue;
    const identity = heuristicIdentity(refA.element);
    if (!identity) continue;
    const bucket = bByIdentity.get(identity);
    const refB = bucket?.find((ref) => !usedB.has(ref.key));
    if (!refB) continue;
    pairs.push({
      keyA: refA.key,
      keyB: refB.key,
      selectionA: refA.selection,
      selectionB: refB.selection,
    });
    usedA.add(refA.key);
    usedB.add(refB.key);
  }

  return {
    pairs,
    enteringB: elsB.filter((ref) => !usedB.has(ref.key)).map((ref) => ref.key),
    exitingA: elsA.filter((ref) => !usedA.has(ref.key)).map((ref) => ref.key),
  };
}

export interface MorphGeometry {
  box: Box;
  rotation: number;
  opacity: number;
}

/** Absolute slide-space geometry for one element, for the FLIP overlay. */
export function morphGeometry(
  ui: Rec | null | undefined,
  selection: ElementSelection,
): MorphGeometry | null {
  if (!ui) return null;
  const box = absoluteBoxForSelection(ui as RawUi, selection);
  if (!box) return null;
  const element = getElementAtSelection(ui as RawUi, selection);
  return {
    box,
    rotation: (element ? readNumber(element.rotation) : null) ?? 0,
    opacity: (element ? readNumber(element.opacity) : null) ?? 1,
  };
}
