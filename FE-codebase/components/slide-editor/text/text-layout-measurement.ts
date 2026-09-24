// The text layout/measurement engine: wraps and positions RenderTextRun[]
// into lines/tokens for rendering (canvas measureText, falling back to an
// average-char-width estimate off the DOM), plus the scaleRawTextMetrics
// family used to rescale a text element's font/spacing on component resize.

import { asRecord, readNumber } from "@/components/slide-editor/model/core";
import type { TemplateV2TextEditStyle } from "@/components/slide-editor/text/template-v2-text-editing";

type UnknownRecord = Record<string, any>;
type TemplateV2RawTextElement = UnknownRecord;

export type RenderTextFont = Omit<
  TemplateV2TextEditStyle,
  "horizontal" | "vertical"
>;

export type RenderTextRun = {
  text: string;
  font: RenderTextFont;
};

export type LaidToken = {
  text: string;
  font: RenderTextFont;
  x: number;
  y: number;
  width: number;
  height: number;
};

const TEXT_AVERAGE_CHAR_EM = 0.5;

export const DEFAULT_FONT: RenderTextFont = {
  family: "Arial",
  size: 18,
  color: "#111827",
  bold: false,
  italic: false,
  underline: false,
  lineHeight: 1.15,
  letterSpacing: 0,
  opacity: 1,
};

const MIN_TRANSFORM_FONT_SIZE = 1;
const MAX_TRANSFORM_FONT_SIZE = 512;
const TRANSFORM_FONT_SCALE_EPSILON = 0.001;

const richMeasureCtx: { ctx: CanvasRenderingContext2D | null } = { ctx: null };
let renderTextMeasureCanvas: HTMLCanvasElement | null = null;

export function displayText(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1");
}

export function textRunsHaveMixedStyle(runs: RenderTextRun[]) {
  const first = runs[0]?.font;
  return runs.some((run) => JSON.stringify(run.font) !== JSON.stringify(first));
}

export function layoutRichText(
  runs: RenderTextRun[],
  maxWidth: number,
  baseFont: RenderTextFont,
  align: string,
  verticalAlign: string,
  boxHeight: number,
  wrap: string | null | undefined,
): { tokens: LaidToken[]; contentHeight: number } {
  type Tok = {
    text: string;
    font: RenderTextFont;
    newline: boolean;
    space: boolean;
    width: number;
  };
  const tokens: Tok[] = [];
  for (const run of runs) {
    const display = displayText(run.text);
    if (!display) continue;
    for (const part of display.split(/(\n|[ \t]+)/)) {
      if (part === "") continue;
      if (part === "\n") {
        tokens.push({
          text: "",
          font: run.font,
          newline: true,
          space: false,
          width: 0,
        });
      } else {
        const space = /^[ \t]+$/.test(part);
        const measuredParts =
          wrap !== "none" && !space
            ? splitOversizedTextSegment(part, run.font, maxWidth, measureRunText)
            : [{ text: part, width: measureRunText(part, run.font) }];

        for (const measuredPart of measuredParts) {
          tokens.push({
            text: measuredPart.text,
            font: run.font,
            newline: false,
            space,
            width: measuredPart.width,
          });
        }
      }
    }
  }

  type Line = { toks: Tok[]; height: number; width: number };
  const lines: Line[] = [];
  let cur: Tok[] = [];
  let curWidth = 0;
  const flush = () => {
    const height = cur.length
      ? Math.max(...cur.map((t) => t.font.size * t.font.lineHeight))
      : baseFont.size * baseFont.lineHeight;
    lines.push({ toks: cur, height, width: curWidth });
    cur = [];
    curWidth = 0;
  };
  for (const tok of tokens) {
    if (tok.newline) {
      flush();
      continue;
    }
    if (tok.space && cur.length === 0) continue;
    if (
      wrap !== "none" &&
      !tok.space &&
      curWidth + tok.width > maxWidth &&
      cur.length > 0
    ) {
      flush();
    }
    cur.push(tok);
    curWidth += tok.width;
  }
  flush();

  const contentHeight = lines.reduce((sum, line) => sum + line.height, 0);
  let y =
    verticalAlign === "middle"
      ? (boxHeight - contentHeight) / 2
      : verticalAlign === "bottom"
        ? boxHeight - contentHeight
        : 0;
  if (y < 0) y = 0;

  const laid: LaidToken[] = [];
  for (const line of lines) {
    let lineWidth = line.width;
    for (let i = line.toks.length - 1; i >= 0 && line.toks[i].space; i--) {
      lineWidth -= line.toks[i].width;
    }
    let x = lineStartX(align, maxWidth, lineWidth, wrap === "none");
    for (const tok of line.toks) {
      if (tok.text) {
        const tokenBoxHeight = tok.font.size * tok.font.lineHeight;
        laid.push({
          text: tok.text,
          font: tok.font,
          x,
          y: y + (line.height - tokenBoxHeight),
          width: tok.width,
          height: tokenBoxHeight,
        });
      }
      x += tok.width;
    }
    y += line.height;
  }
  return { tokens: laid, contentHeight };
}

export function layoutRenderTextRuns(
  runs: RenderTextRun[],
  width: number,
  wrap: string | null | undefined,
) {
  const lines: Array<Array<RenderTextRun & { width: number }>> = [[]];
  let lineWidth = 0;

  const pushLine = () => {
    if (lines[lines.length - 1]?.length === 0) return;
    lines.push([]);
    lineWidth = 0;
  };

  for (const run of runs) {
    const parts = run.text.match(/\n|[^\S\n]+|[^\s]+/g) ?? [run.text];
    for (const part of parts) {
      if (part === "\n") {
        pushLine();
        continue;
      }
      const isWhitespace = part.trim().length === 0;
      const segments =
        wrap !== "none" && !isWhitespace
          ? splitOversizedTextSegment(part, run.font, width, measureRenderText)
          : [{ text: part, width: measureRenderText(part, run.font) }];

      for (const segment of segments) {
        if (
          wrap !== "none" &&
          !isWhitespace &&
          lineWidth > 0 &&
          lineWidth + segment.width > width
        ) {
          pushLine();
        }
        if (lines.length === 0) lines.push([]);
        lines[lines.length - 1].push({
          ...run,
          text: segment.text,
          width: segment.width,
        });
        lineWidth += segment.width;
      }
    }
  }

  return lines.filter((line) => line.length > 0);
}

export function lineRenderHeight(
  line: Array<RenderTextRun & { width: number }>,
  fallbackLineHeight: number,
) {
  return Math.max(
    1,
    ...line.map(
      (segment) =>
        segment.font.size * (segment.font.lineHeight ?? fallbackLineHeight),
    ),
  );
}

function splitOversizedTextSegment(
  text: string,
  font: RenderTextFont,
  maxWidth: number,
  measure: (text: string, font: RenderTextFont) => number,
): Array<{ text: string; width: number }> {
  const fullWidth = measure(text, font);
  if (!text || maxWidth <= 0 || fullWidth <= maxWidth) {
    return [{ text, width: fullWidth }];
  }

  const characters = Array.from(text);
  const segments: Array<{ text: string; width: number }> = [];
  let start = 0;

  while (start < characters.length) {
    let low = start + 1;
    let high = characters.length;
    let bestEnd = low;
    let bestWidth = measure(characters.slice(start, low).join(""), font);

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = characters.slice(start, mid).join("");
      const candidateWidth = measure(candidate, font);

      if (candidateWidth <= maxWidth || mid === start + 1) {
        bestEnd = mid;
        bestWidth = candidateWidth;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    segments.push({
      text: characters.slice(start, bestEnd).join(""),
      width: bestWidth,
    });
    start = bestEnd;
  }

  return segments;
}

export function measureNoWrapTextWidth(text: string, font: RenderTextFont) {
  const lines = text.split(/\r?\n/);
  return Math.max(1, ...lines.map((line) => measureRenderText(line, font)));
}

export function measureNoWrapTextHeight(
  text: string,
  font: RenderTextFont,
  lineHeight: number,
) {
  const lineCount = Math.max(1, text.split(/\r?\n/).length);
  return lineCount * font.size * lineHeight;
}

export function lineStartX(
  align: string,
  boxWidth: number,
  lineWidth: number,
  allowOverflow: boolean,
) {
  const x =
    align === "center"
      ? (boxWidth - lineWidth) / 2
      : align === "right"
        ? boxWidth - lineWidth
        : 0;
  return allowOverflow ? x : Math.max(0, x);
}

export function verticalTextStartY(
  align: string,
  boxHeight: number,
  textHeight: number,
  allowOverflow: boolean,
) {
  const y = verticalStartY(align, boxHeight, textHeight);
  return allowOverflow ? y : Math.max(0, y);
}

export function verticalStartY(align: string, boxHeight: number, textHeight: number) {
  const y =
    align === "middle"
      ? (boxHeight - textHeight) / 2
      : align === "bottom"
        ? boxHeight - textHeight
        : 0;
  return y;
}

export function scaleRawTextMetrics(
  element: TemplateV2RawTextElement,
  scale: number,
): TemplateV2RawTextElement {
  if (
    !Number.isFinite(scale) ||
    Math.abs(scale - 1) < TRANSFORM_FONT_SCALE_EPSILON
  ) {
    return element;
  }

  return stripUndefined({
    ...element,
    font: scaleRawFontMetrics(element.font, scale),
    runs: scaleRawTextRunsMetrics(element.runs, scale),
    items: scaleRawTextListItemsMetrics(element.items, scale),
    columns: scaleRawTableCellsMetrics(element.columns, scale),
    rows: scaleRawTableRowsMetrics(element.rows, scale),
  });
}

function scaleRawTextRunsMetrics(value: unknown, scale: number) {
  if (!Array.isArray(value)) return value;
  return value.map((run) => {
    const record = asRecord(run);
    if (!record) return run;
    return stripUndefined({
      ...record,
      font: scaleRawFontMetrics(record.font, scale),
    });
  });
}

function scaleRawTextListItemsMetrics(value: unknown, scale: number) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (Array.isArray(item)) return scaleRawTextRunsMetrics(item, scale);
    const record = asRecord(item);
    if (!record) return item;
    return stripUndefined({
      ...record,
      font: scaleRawFontMetrics(record.font, scale),
      runs: scaleRawTextRunsMetrics(record.runs, scale),
    });
  });
}

function scaleRawTableRowsMetrics(value: unknown, scale: number) {
  if (!Array.isArray(value)) return value;
  return value.map((row) =>
    Array.isArray(row) ? scaleRawTableCellsMetrics(row, scale) : row,
  );
}

function scaleRawTableCellsMetrics(value: unknown, scale: number) {
  if (!Array.isArray(value)) return value;
  return value.map((cell) => {
    const record = asRecord(cell);
    if (!record) return cell;
    const textRecord = asRecord(record.text);
    return stripUndefined({
      ...record,
      font: scaleRawFontMetrics(record.font, scale),
      runs: scaleRawTextRunsMetrics(record.runs, scale),
      text: textRecord
        ? stripUndefined({
          ...textRecord,
          font: scaleRawFontMetrics(textRecord.font, scale),
          runs: scaleRawTextRunsMetrics(textRecord.runs, scale),
        })
        : record.text,
    });
  });
}

function scaleRawFontMetrics(value: unknown, scale: number) {
  const font = asRecord(value);
  if (!font) return value;

  const next = { ...font };
  const size = readNumber(font.size);
  if (size != null) {
    next.size = scaleFontSize(size, scale);
  }

  const letterSpacing = readNumber(font.letter_spacing);
  if (letterSpacing != null) {
    next.letter_spacing = scaleTextMetric(letterSpacing, scale);
  }

  const camelLetterSpacing = readNumber(font.letterSpacing);
  if (camelLetterSpacing != null) {
    next.letterSpacing = scaleTextMetric(camelLetterSpacing, scale);
  }

  return stripUndefined(next);
}

function scaleFontSize(size: number, scale: number) {
  return Math.min(
    MAX_TRANSFORM_FONT_SIZE,
    Math.max(MIN_TRANSFORM_FONT_SIZE, scaleTextMetric(size, scale)),
  );
}

function scaleTextMetric(value: number, scale: number) {
  return Math.round(value * scale * 100) / 100;
}

function measureContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!richMeasureCtx.ctx) {
    richMeasureCtx.ctx = document.createElement("canvas").getContext("2d");
  }
  return richMeasureCtx.ctx;
}

function richFontCss(font: RenderTextFont): string {
  const italic = font.italic ? "italic " : "";
  const weight = font.bold ? "700 " : "400 ";
  return `${italic}${weight}${font.size}px ${quotedFontFamily(font.family)}, Helvetica, sans-serif`;
}

function quotedFontFamily(family: string): string {
  const name = (family || DEFAULT_FONT.family).trim() || DEFAULT_FONT.family;
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function measureRunText(text: string, font: RenderTextFont): number {
  if (!text) return 0;
  const ctx = measureContext();
  if (!ctx) return text.length * font.size * TEXT_AVERAGE_CHAR_EM;
  ctx.font = richFontCss(font);
  const width = ctx.measureText(text).width;
  const spacing = font.letterSpacing
    ? font.letterSpacing * Math.max(0, text.length - 1)
    : 0;
  return width + spacing;
}

function measureRenderText(text: string, font: RenderTextFont) {
  const fallbackWidth =
    text.length * font.size * (font.bold ? 0.58 : TEXT_AVERAGE_CHAR_EM);
  if (typeof document === "undefined") return fallbackWidth;
  renderTextMeasureCanvas ??= document.createElement("canvas");
  const context = renderTextMeasureCanvas.getContext("2d");
  if (!context) return fallbackWidth;
  context.font = richFontCss(font);
  return (
    context.measureText(text).width +
    (font.letterSpacing ?? 0) * Math.max(0, text.length - 1)
  );
}

export function stripUndefined<T extends UnknownRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
