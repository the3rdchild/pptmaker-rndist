// Deck-wide Find & Replace (#18). Walks every text-bearing element across
// every slide — text/text-list runs, text-list items, and table cells —
// both root elements (ui.elements) and component elements (ui.components[].
// elements), recursing through container.child / flex-grid.children the
// same way agent-dispatch.ts's walkUi does.

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
