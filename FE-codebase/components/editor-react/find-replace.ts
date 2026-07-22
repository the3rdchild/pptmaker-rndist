// Deck-wide Find & Replace (#18). Walks every text-bearing element across
// every slide — text/text-list runs, text-list items, and table cells —
// both root elements (ui.elements) and component elements (ui.components[].
// elements), recursing through container.child / flex-grid.children the
// same way agent-dispatch.ts's walkUi does.

import { ROOT_ELEMENTS_COMPONENT_INDEX } from "@/components/slide-editor/model/model";
import type { SlideData } from "@/store/presentationGeneration";

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type TextTransform = (text: string) => { text: string; count: number };

export function buildFindRegex(query: string, matchCase: boolean): RegExp | null {
  if (!query) return null;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, matchCase ? "g" : "gi");
}

export function countTransform(regex: RegExp): TextTransform {
  return (text) => ({ text, count: (text.match(regex) ?? []).length });
}

export function replaceTransform(regex: RegExp, replacement: string): TextTransform {
  return (text) => {
    let count = 0;
    const next = text.replace(regex, () => {
      count += 1;
      return replacement;
    });
    return { text: next, count };
  };
}

function transformRuns(
  runs: unknown[],
  transform: TextTransform,
  totals: { count: number },
): unknown[] {
  return runs.map((raw) => {
    if (!isRecord(raw) || typeof raw.text !== "string") return raw;
    const result = transform(raw.text);
    if (result.count === 0) return raw;
    totals.count += result.count;
    return { ...raw, text: result.text };
  });
}

function transformElement(
  element: AnyRecord,
  transform: TextTransform,
  totals: { count: number },
): AnyRecord {
  let next = element;
  const type = element.type;

  if ((type === "text" || type === "text-list") && Array.isArray(element.runs)) {
    next = { ...next, runs: transformRuns(element.runs, transform, totals) };
  }
  if (type === "text-list" && Array.isArray(element.items)) {
    next = {
      ...next,
      items: element.items.map((item) =>
        Array.isArray(item) ? transformRuns(item, transform, totals) : item,
      ),
    };
  }
  if (type === "table") {
    const transformCell = (cell: unknown) => {
      if (!isRecord(cell) || !Array.isArray(cell.runs)) return cell;
      return { ...cell, runs: transformRuns(cell.runs, transform, totals) };
    };
    if (Array.isArray(next.columns)) {
      next = { ...next, columns: next.columns.map(transformCell) };
    }
    if (Array.isArray(next.rows)) {
      next = {
        ...next,
        rows: next.rows.map((row) =>
          Array.isArray(row) ? row.map(transformCell) : row,
        ),
      };
    }
  }
  if (Array.isArray(next.children)) {
    next = {
      ...next,
      children: next.children.map((child) =>
        isRecord(child) ? transformElement(child, transform, totals) : child,
      ),
    };
  }
  if (isRecord(next.child)) {
    next = { ...next, child: transformElement(next.child, transform, totals) };
  }
  return next;
}

function transformElements(
  elements: unknown[],
  transform: TextTransform,
  totals: { count: number },
): unknown[] {
  return elements.map((el) =>
    isRecord(el) ? transformElement(el, transform, totals) : el,
  );
}

function transformUi(
  ui: AnyRecord,
  transform: TextTransform,
  totals: { count: number },
): AnyRecord {
  let next = ui;
  if (Array.isArray(ui.elements)) {
    next = { ...next, elements: transformElements(ui.elements, transform, totals) };
  }
  if (Array.isArray(ui.components)) {
    next = {
      ...next,
      components: ui.components.map((component) =>
        isRecord(component) && Array.isArray(component.elements)
          ? { ...component, elements: transformElements(component.elements, transform, totals) }
          : component,
      ),
    };
  }
  return next;
}

// Applies `transform` to every run of text across every slide. Returns the
// (possibly unchanged) slides array plus the total match/replacement count.
export function applyTextTransformToSlides(
  slides: SlideData[],
  transform: TextTransform,
): { slides: SlideData[]; count: number } {
  const totals = { count: 0 };
  const nextSlides = slides.map((slide) => {
    if (!isRecord(slide.ui)) return slide;
    const nextUi = transformUi(slide.ui, transform, totals);
    return { ...slide, ui: nextUi };
  });
  return { slides: nextSlides, count: totals.count };
}

/* ------------------------------ Match navigation ----------------------------- */
// Addresses a single element containing a match, in the same shape the
// canvas selection system already uses (ElementSelection), so Find &
// Replace can ask the Konva surface to select/highlight it directly.

export type FindMatchLocation = {
  slideIndex: number;
  componentIndex: number;
  elementPath: number[];
};

function runHasMatch(run: unknown, regex: RegExp): boolean {
  return isRecord(run) && typeof run.text === "string" && (run.text.match(regex) ?? []).length > 0;
}

function elementHasMatch(element: AnyRecord, regex: RegExp): boolean {
  const type = element.type;
  if ((type === "text" || type === "text-list") && Array.isArray(element.runs)) {
    if (element.runs.some((run) => runHasMatch(run, regex))) return true;
  }
  if (type === "text-list" && Array.isArray(element.items)) {
    if (element.items.some((item) => Array.isArray(item) && item.some((run) => runHasMatch(run, regex)))) {
      return true;
    }
  }
  if (type === "table") {
    const cellHasMatch = (cell: unknown) =>
      isRecord(cell) && Array.isArray(cell.runs) && cell.runs.some((run) => runHasMatch(run, regex));
    if (Array.isArray(element.columns) && element.columns.some(cellHasMatch)) return true;
    if (Array.isArray(element.rows) && element.rows.some((row) => Array.isArray(row) && row.some(cellHasMatch))) {
      return true;
    }
  }
  return false;
}

function findMatchesInElements(
  elements: unknown[],
  regex: RegExp,
  path: number[],
  slideIndex: number,
  componentIndex: number,
  out: FindMatchLocation[],
): void {
  elements.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const currentPath = [...path, index];
    if (elementHasMatch(raw, regex)) {
      out.push({ slideIndex, componentIndex, elementPath: currentPath });
    }
    if (Array.isArray(raw.children)) {
      findMatchesInElements(raw.children, regex, currentPath, slideIndex, componentIndex, out);
    }
    if (isRecord(raw.child)) {
      findMatchesInElements([raw.child], regex, currentPath, slideIndex, componentIndex, out);
    }
  });
}

// One entry per element that contains at least one match (not per raw
// occurrence) — the canvas can only highlight a whole element at a time,
// there's no sub-string text-range overlay.
export function findMatchLocationsInSlides(slides: SlideData[], regex: RegExp): FindMatchLocation[] {
  const out: FindMatchLocation[] = [];
  slides.forEach((slide, slideIndex) => {
    const ui = slide.ui;
    if (!isRecord(ui)) return;
    if (Array.isArray(ui.elements)) {
      findMatchesInElements(ui.elements, regex, [], slideIndex, ROOT_ELEMENTS_COMPONENT_INDEX, out);
    }
    if (Array.isArray(ui.components)) {
      ui.components.forEach((component, componentIndex) => {
        if (!isRecord(component) || !Array.isArray(component.elements)) return;
        findMatchesInElements(component.elements, regex, [], slideIndex, componentIndex, out);
      });
    }
  });
  return out;
}

function replaceAtPath(
  elements: unknown[],
  path: number[],
  transform: TextTransform,
  totals: { count: number },
): unknown[] {
  const [index, ...rest] = path;
  if (index == null || !isRecord(elements[index])) return elements;
  const current = elements[index] as AnyRecord;
  const next = [...elements];
  if (rest.length === 0) {
    next[index] = transformElement(current, transform, totals);
    return next;
  }
  if (Array.isArray(current.children)) {
    const nextChildren = replaceAtPath(current.children, rest, transform, totals);
    next[index] = nextChildren === current.children ? current : { ...current, children: nextChildren };
    return next;
  }
  if (isRecord(current.child)) {
    const nextChildWrap = replaceAtPath([current.child], rest, transform, totals);
    next[index] = nextChildWrap[0] === current.child ? current : { ...current, child: nextChildWrap[0] };
    return next;
  }
  return elements;
}

// Replaces matches within ONE element (the current Find & Replace match),
// not the whole deck — "Replace Selected" rather than "Replace All".
export function replaceMatchAtLocation(
  slides: SlideData[],
  location: FindMatchLocation,
  regex: RegExp,
  replacement: string,
): { slides: SlideData[]; count: number } {
  const totals = { count: 0 };
  const transform = replaceTransform(regex, replacement);

  const nextSlides = slides.map((slide, slideIndex) => {
    if (slideIndex !== location.slideIndex || !isRecord(slide.ui)) return slide;
    const ui = slide.ui;

    if (location.componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX) {
      if (!Array.isArray(ui.elements)) return slide;
      const nextElements = replaceAtPath(ui.elements, location.elementPath, transform, totals);
      return nextElements === ui.elements ? slide : { ...slide, ui: { ...ui, elements: nextElements } };
    }

    if (!Array.isArray(ui.components)) return slide;
    const nextComponents = ui.components.map((component, componentIndex) => {
      if (componentIndex !== location.componentIndex || !isRecord(component) || !Array.isArray(component.elements)) {
        return component;
      }
      const nextElements = replaceAtPath(component.elements, location.elementPath, transform, totals);
      return nextElements === component.elements ? component : { ...component, elements: nextElements };
    });
    return { ...slide, ui: { ...ui, components: nextComponents } };
  });

  return { slides: nextSlides, count: totals.count };
}
