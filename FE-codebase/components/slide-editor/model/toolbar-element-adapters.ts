import type { SlideElement } from "@/components/slide-editor/types";
import {
  editorFontRecordToRaw,
  rawFontRecordForEditor,
  rawTableCellText,
  rawTextListItemText,
  rawTextRunsForEditor,
} from "@/components/slide-editor/text/template-v2-text";
import { rawChartToEditorChart } from "@/components/slide-editor/model/chart-model";
import {
  asRecord,
  readArray,
  readNumber,
  readPoint,
  readString,
  type Box,
  type RawElement,
  type UnknownRecord,
} from "@/components/slide-editor/model/core";
import { elementSize } from "@/components/slide-editor/model/geometry";

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
