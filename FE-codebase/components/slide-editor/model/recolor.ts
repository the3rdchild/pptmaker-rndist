import {
  asRecord,
  readArray,
  readString,
  type RawElement,
  type UnknownRecord,
} from "@/components/slide-editor/model/core";
import { childArrayInfo, withUpdatedChildItems } from "@/components/slide-editor/model/geometry";
import { isRawIconElement } from "@/components/slide-editor/model/element-predicates";

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
