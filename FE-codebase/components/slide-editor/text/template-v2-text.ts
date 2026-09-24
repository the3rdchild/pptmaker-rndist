import { renderMarkdownTextRuns } from "@/components/slide-editor/text/markdown-text";
import type { Font, TextRun } from "@/components/slide-editor/types";
import { effectiveLineHeight } from "@/components/slide-editor/text/text-line-height";
import { textRunsContent } from "@/components/slide-editor/text/text-runs";
import type { TemplateV2TextEditStyle } from "@/components/slide-editor/text/template-v2-text-editing";
import {
  readArray,
  asRecord,
  readString,
  readNumber,
  readBoolean,
} from "@/components/slide-editor/model/core";
import { withHash } from "@/lib/color-conversion";
import {
  DEFAULT_FONT,
  displayText,
  layoutRenderTextRuns,
  layoutRichText,
  lineRenderHeight,
  lineStartX,
  stripUndefined,
  textRunsHaveMixedStyle,
  verticalStartY,
  type RenderTextFont,
  type RenderTextRun,
} from "@/components/slide-editor/text/text-layout-measurement";
import {
  cloneTextRun,
  containsMarkdownSyntax,
  normalizeStyledSourceRunBoundaries,
  reconcileTextRunsWithStoredText,
  sameTextRuns,
  splitTextRunsOnNewlines,
} from "@/components/slide-editor/text/text-run-reconciliation";

export {
  displayText,
  layoutRichText,
  layoutRenderTextRuns,
  lineRenderHeight,
  lineStartX,
  measureNoWrapTextWidth,
  measureNoWrapTextHeight,
  scaleRawTextMetrics,
  textRunsHaveMixedStyle,
  verticalTextStartY,
  type LaidToken,
  type RenderTextFont,
  type RenderTextRun,
} from "@/components/slide-editor/text/text-layout-measurement";

type UnknownRecord = Record<string, any>;

export type TemplateV2RawTextElement = UnknownRecord;

export type TemplateV2TextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const TEXT_RENDER_WRAP = "word";

function withoutFontWrap(font: UnknownRecord): UnknownRecord {
  return Object.fromEntries(
    Object.entries(font).filter(([key]) => key !== "wrap"),
  );
}

export function rawFont(element: TemplateV2RawTextElement) {
  const font = asRecord(element.font) ?? {};
  return fontFromRecord(font, DEFAULT_FONT);
}

export function fontFromRecord(
  font: UnknownRecord | null,
  fallback: RenderTextFont,
): RenderTextFont {
  return {
    family: readString(font?.family) ?? fallback.family,
    size: readNumber(font?.size) ?? fallback.size,
    color: readString(font?.color) ?? fallback.color,
    bold: readBoolean(font?.bold) ?? fallback.bold,
    italic: readBoolean(font?.italic) ?? fallback.italic,
    underline:
      readBoolean(font?.underline) ??
      (readString(font?.text_decoration) === "underline" ||
        readString(font?.textDecoration) === "underline"
        ? true
        : fallback.underline),
    lineHeight:
      readNumber(font?.line_height) ??
      readNumber(font?.lineHeight) ??
      fallback.lineHeight,
    letterSpacing:
      readNumber(font?.letter_spacing) ??
      readNumber(font?.letterSpacing) ??
      fallback.letterSpacing,
    opacity: readNumber(font?.opacity) ?? fallback.opacity,
  };
}

export function fontToSource(font: RenderTextFont): Font {
  return {
    family: font.family,
    size: font.size,
    color: font.color,
    bold: font.bold,
    italic: font.italic,
    underline: font.underline,
    line_height: font.lineHeight,
    letter_spacing: font.letterSpacing,
    opacity: font.opacity,
  };
}

export function rawTextStyle(
  element: TemplateV2RawTextElement,
): TemplateV2TextEditStyle {
  const font = rawFont(element);
  return {
    ...font,
    color: withHash(font.color) ?? "#111827",
    horizontal: readHorizontalAlignment(
      asRecord(element.alignment)?.horizontal,
    ),
    vertical: readVerticalAlignment(asRecord(element.alignment)?.vertical),
  };
}

export function applyTextStyle(
  element: TemplateV2RawTextElement,
  style: TemplateV2TextEditStyle,
): TemplateV2RawTextElement {
  const sourceFont = asRecord(element.font) ?? {};
  const nextFont = {
    ...withoutFontWrap(sourceFont),
    family: style.family,
    size: style.size,
    color: withHash(style.color) ?? "#111827",
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    line_height: style.lineHeight,
    letter_spacing: style.letterSpacing,
    opacity: style.opacity,
  };
  const runs = readArray(element.runs);
  return {
    ...element,
    font: nextFont,
    alignment: {
      ...(asRecord(element.alignment) ?? {}),
      horizontal: style.horizontal,
      vertical: style.vertical,
    },
    ...(runs.length > 0
      ? {
        runs: runs.map((run) => {
          const record = asRecord(run) ?? {};
          return {
            ...record,
            font: {
              ...(asRecord(record.font) ?? {}),
              ...nextFont,
            },
          };
        }),
      }
      : {}),
  };
}

export function normalizeRawTextMarkdownElement(
  element: TemplateV2RawTextElement,
): {
  element: TemplateV2RawTextElement;
  runs: TextRun[];
  changed: boolean;
} {
  const originalSourceRuns = rawSourceTextRuns(element);
  const rawText = rawStoredTextContent(element);
  const hasSourceRuns = rawTextHasRuns(element);
  const reconciledSourceRuns = reconcileTextRunsWithStoredText(
    originalSourceRuns,
    rawText,
  );
  const sourceRuns = normalizeStyledSourceRunBoundaries(reconciledSourceRuns);
  const renderedRuns = renderMarkdownTextRuns(sourceRuns);
  const renderedText = textRunsContent(renderedRuns);
  const sourceHasMarkdown = sourceRuns.some((run) =>
    containsMarkdownSyntax(run.text),
  );
  const runsChanged = !sameTextRuns(originalSourceRuns, sourceRuns);
  const renderedRunsChanged = !sameTextRuns(sourceRuns, renderedRuns);
  const changed =
    runsChanged ||
    renderedRunsChanged ||
    sourceHasMarkdown ||
    ((!hasSourceRuns || containsMarkdownSyntax(rawText)) &&
      rawText !== renderedText);

  return {
    element: changed ? setRawTextRunsContent(element, renderedRuns) : element,
    runs: renderedRuns,
    changed,
  };
}

export function rawTextContent(element: TemplateV2RawTextElement) {
  const runs = readArray(element.runs);
  if (runs.length > 0) {
    const content = runs
      .map((run) => readString(asRecord(run)?.text) ?? "")
      .join("");
    if (content) return content;
  }
  return rawStoredTextContent(element);
}

export function rawStoredTextContent(element: TemplateV2RawTextElement) {
  const text = readString(element.text);
  if (text != null) return text;
  return "";
}

export function rawSourceTextRuns(
  element: TemplateV2RawTextElement,
): TextRun[] {
  const fallbackFont = fontToSource(rawFont(element));
  const runs = readArray(element.runs)
    .map((run) => {
      const record = asRecord(run);
      if (!record) return null;
      const text = readString(record.text) ?? "";
      if (!text) return null;
      return {
        text,
        font: fontToSource(
          fontFromRecord(asRecord(record.font), rawFont(element)),
        ),
      } satisfies TextRun;
    })
    .filter(Boolean) as TextRun[];

  return runs.length > 0
    ? runs
    : [{ text: rawTextContent(element) || " ", font: fallbackFont }];
}

export function rawTextRunsForEditor(
  element: TemplateV2RawTextElement,
): TextRun[] {
  return normalizeRawTextMarkdownElement(element).runs;
}

export function rawTextHasRuns(element: TemplateV2RawTextElement) {
  return readArray(element.runs).some((run) => {
    const record = asRecord(run);
    return Boolean(readString(record?.text));
  });
}

export function setRawTextContent(
  element: TemplateV2RawTextElement,
  text: string,
  style?: TemplateV2TextEditStyle,
): TemplateV2RawTextElement {
  const styled = style ? applyTextStyle(element, style) : element;
  const sourceRuns = readArray(styled.runs);
  const firstRun = asRecord(sourceRuns[0]) ?? {};
  const runs = stripPlainTextListMarkersFromRuns(
    renderMarkdownTextRuns([{ text, font: fontToSource(rawFont(styled)) }]),
  ).map((run) => ({
    ...firstRun,
    text: run.text,
    font: {
      ...(asRecord(firstRun.font) ?? {}),
      ...(asRecord(run.font) ?? {}),
    },
  }));
  return {
    ...styled,
    text: textRunsContent(runs),
    runs,
  };
}

export function setRawTextRunsContent(
  element: TemplateV2RawTextElement,
  runs: TextRun[],
): TemplateV2RawTextElement {
  const storageRuns = stripPlainTextListMarkersFromRuns(runs);
  const sourceRuns = readArray(element.runs);
  const nextRuns = (
    storageRuns.length > 0 ? storageRuns : [{ text: " " }]
  ).map(
    (run, index) => {
      const sourceRun = asRecord(sourceRuns[index]) ?? {};
      return {
        ...sourceRun,
        text: run.text,
        font: rawInlineTextFontRecord(run.font, sourceRun.font),
      };
    },
  );
  return {
    ...element,
    text: textRunsContent(nextRuns),
    runs: nextRuns,
  };
}

export function rawInlineTextFontRecord(value: unknown, fallback: unknown) {
  const font = asRecord(value);
  if (!font) return fallback;
  const fallbackFont = asRecord(fallback) ?? {};
  return {
    ...withoutFontWrap(fallbackFont),
    ...withoutFontWrap(font),
    line_height: font.line_height ?? font.lineHeight,
    letter_spacing: font.letter_spacing ?? font.letterSpacing,
    opacity: font.opacity,
  };
}

export function rawTextListContent(element: TemplateV2RawTextElement) {
  const items = readArray(element.items);
  if (items.length === 0) return "";
  return items.map(rawTextListItemText).join("\n");
}

export function rawTextListRunsForEditor(
  element: TemplateV2RawTextElement,
): TextRun[] {
  const baseFont = rawFont(element);
  const fallbackFont = fontToSource(baseFont);
  const items = readArray(element.items);
  const runs: TextRun[] = [];

  items.forEach((item, index) => {
    const itemRuns = renderMarkdownTextRuns(
      normalizeStyledSourceRunBoundaries(
        rawTextListItemSourceRuns(item, baseFont),
      ),
    );
    const itemFont = itemRuns[0]?.font ?? fallbackFont;
    const prefix = textListMarkerPrefix(element.marker, index);

    if (index > 0) appendTextRun(runs, "\n", itemFont);
    if (prefix) appendTextRun(runs, prefix, itemFont);
    itemRuns.forEach((run) =>
      appendTextRun(runs, run.text, run.font ?? itemFont),
    );
  });

  return runs.length > 0 ? runs : [{ text: " ", font: fallbackFont }];
}

export function rawTextListRenderTextRuns(
  element: TemplateV2RawTextElement,
): RenderTextRun[] {
  const baseFont = rawFont(element);
  return rawTextListRunsForEditor(element)
    .filter((run) => run.text)
    .map((run) => ({
      text: run.text,
      font: fontFromRecord(asRecord(run.font), baseFont),
    }));
}

export function rawTextListItemText(item: unknown) {
  if (typeof item === "string") return item;
  if (Array.isArray(item)) {
    return item
      .map((run) => readString(asRecord(run)?.text) ?? "")
      .join("");
  }
  const record = asRecord(item);
  if (!record) return "";
  const directText = readString(record.text);
  if (directText != null) return directText;
  return readArray(record.runs)
    .map((run) => readString(asRecord(run)?.text) ?? "")
    .join("");
}

export function rawTextListItemWithText(
  source: unknown,
  text: string,
): unknown {
  if (Array.isArray(source)) {
    const firstRun = asRecord(source[0]) ?? {};
    return [{ ...firstRun, text }];
  }
  if (typeof source === "string") return text;
  const record = asRecord(source);
  if (!record) return { type: "text", text };
  const runs = readArray(record.runs);
  if (runs.length > 0 || Object.hasOwn(record, "runs")) {
    const firstRun = asRecord(runs[0]) ?? {};
    return { ...record, runs: text ? [{ ...firstRun, text }] : [] };
  }
  return { ...record, type: record.type ?? "text", text };
}

export function setRawTextListContent(
  element: TemplateV2RawTextElement,
  draft: string,
): TemplateV2RawTextElement {
  const sourceItems = readArray(element.items);
  const texts = draft
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*(?:[•*-]|\d+\.)\s?/, "").trimEnd())
    .filter((item) => item.trim().length > 0);
  const items = (texts.length > 0 ? texts : [" "]).map((text, index) =>
    rawTextListItemWithText(
      sourceItems[index] ?? sourceItems[sourceItems.length - 1],
      text,
    ),
  );
  return { ...element, items };
}

export function setRawTextListRunsContent(
  element: TemplateV2RawTextElement,
  runs: TextRun[],
): TemplateV2RawTextElement {
  const sourceItems = readArray(element.items);
  const stripMarker = readString(element.marker) !== "none";
  const lines = splitTextRunsOnNewlines(runs)
    .map((line) => (stripMarker ? stripTextListMarkerFromRuns(line) : line))
    .map((line) => line.filter((run) => run.text))
    .filter((line) => textRunsContent(line).trim().length > 0);

  const fallbackItem = sourceItems[sourceItems.length - 1];
  const items = (lines.length > 0 ? lines : [[{ text: " " }]]).map(
    (line, index) =>
      rawTextListItemWithRuns(
        sourceItems[index] ?? fallbackItem,
        line as TextRun[],
      ),
  );

  return { ...element, items };
}

export function rawTableCellText(cell: unknown) {
  if (typeof cell === "string" || typeof cell === "number") {
    return displayText(String(cell));
  }
  const record = asRecord(cell);
  if (!record) return "";
  const runs = readArray(record.runs);
  if (runs.length > 0) {
    return textRunsContent(
      renderMarkdownTextRuns(
        runs.map((run) => ({
          text: readString(asRecord(run)?.text) ?? "",
          font: asRecord(run)?.font as TextRun["font"],
        })),
      ),
    );
  }
  const textRecord = asRecord(record.text);
  return displayText(readString(textRecord?.text) ?? readString(record.text) ?? "");
}

export function rawSvgContent(element: TemplateV2RawTextElement) {
  return readString(element.svg) ?? readString(element.data) ?? "";
}


export function setRawSvgContent(
  element: TemplateV2RawTextElement,
  draft: string,
): TemplateV2RawTextElement {
  return { ...element, svg: draft };
}

export function rawRenderTextRuns(
  element: TemplateV2RawTextElement,
): RenderTextRun[] {
  const baseFont = rawFont(element);
  const runs = normalizeRawTextMarkdownElement(element).runs;

  return runs
    .filter((run) => run.text)
    .map((run) => ({
      text: run.text,
      font: fontFromRecord(asRecord(run.font), baseFont),
    }));
}

export function textVisualLocalBox(
  element: TemplateV2RawTextElement,
  box: TemplateV2TextBox,
  options: {
    content?: string;
    runs?: RenderTextRun[];
  } = {},
): TemplateV2TextBox {
  const font = rawFont(element);
  const renderRuns = options.runs ?? rawRenderTextRuns(element);
  const content =
    options.content ??
    (options.runs ? textRunsContent(options.runs) : rawTextContent(element));
  const displayContent = displayText(content);
  const renderRunsDifferFromElement =
    renderRuns.length > 0 &&
    textRunsHaveMixedStyle([{ text: "", font }, ...renderRuns]);
  const align = readString(asRecord(element.alignment)?.horizontal) ?? "left";
  const verticalAlign =
    readString(asRecord(element.alignment)?.vertical) ?? "top";
  const textLineHeight = effectiveLineHeight({
    text: displayContent,
    width: box.width,
    fontSize: font.size,
    lineHeight: font.lineHeight,
    fallback: 1.15,
    wrap: TEXT_RENDER_WRAP,
  });

  if (renderRunsDifferFromElement) {
    const lines = layoutRenderTextRuns(renderRuns, box.width, TEXT_RENDER_WRAP);
    const lineMetrics = lines.map((line) => ({
      height: lineRenderHeight(line, textLineHeight),
      width: line.reduce((sum, segment) => sum + segment.width, 0),
    }));
    const totalHeight = lineMetrics.reduce(
      (sum, metric) => sum + metric.height,
      0,
    );
    const startY = verticalStartY(verticalAlign, box.height, totalHeight);
    const left = Math.min(
      0,
      ...lineMetrics.map((metric) =>
        lineStartX(align, box.width, metric.width, false),
      ),
    );
    const right = Math.max(
      box.width,
      ...lineMetrics.map((metric) => {
        const startX = lineStartX(
          align,
          box.width,
          metric.width,
          false,
        );
        return startX + metric.width;
      }),
    );
    return {
      x: box.x + left,
      y: box.y + Math.min(0, startY),
      width: Math.max(1, right - left),
      height: Math.max(box.height, totalHeight),
    };
  }

  if (renderRuns.length > 1) {
    const { tokens, contentHeight } = layoutRichText(
      renderRuns,
      box.width,
      font,
      align,
      verticalAlign,
      box.height,
      TEXT_RENDER_WRAP,
    );
    if (tokens.length === 0) return box;
    const left = Math.min(0, ...tokens.map((token) => token.x));
    const top = Math.min(0, ...tokens.map((token) => token.y));
    const right = Math.max(
      box.width,
      ...tokens.map((token) => token.x + token.width),
    );
    const bottom = Math.max(
      box.height,
      contentHeight,
      ...tokens.map((token) => token.y + token.height),
    );
    return {
      x: box.x + left,
      y: box.y + top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }

  const textNodeRuns =
    renderRuns.length > 0 ? renderRuns : [{ text: displayContent, font }];
  return {
    ...box,
    height: Math.max(
      box.height,
      measureRenderTextRunsHeight(
        textNodeRuns,
        box.width,
        TEXT_RENDER_WRAP,
        textLineHeight,
      ),
    ),
  };
}

function measureRenderTextRunsHeight(
  runs: RenderTextRun[],
  width: number,
  wrap: string | null | undefined,
  fallbackLineHeight: number,
) {
  const lines = layoutRenderTextRuns(runs, width, wrap);
  if (lines.length === 0) return fallbackLineHeight;
  return lines.reduce(
    (sum, line) => sum + lineRenderHeight(line, fallbackLineHeight),
    0,
  );
}

export function rawFontRecordForEditor(value: unknown) {
  const font = asRecord(value);
  if (!font) return value;
  return {
    ...withoutFontWrap(font),
    line_height: font.line_height ?? font.lineHeight,
    letter_spacing: font.letter_spacing ?? font.letterSpacing,
  };
}

export function editorFontRecordToRaw(value: unknown, fallback: unknown) {
  const font = asRecord(value);
  if (!font) return fallback;
  const fallbackFont = asRecord(fallback) ?? {};
  return {
    ...withoutFontWrap(fallbackFont),
    ...withoutFontWrap(font),
    line_height: font.line_height ?? font.lineHeight,
    letter_spacing: font.letter_spacing ?? font.letterSpacing,
  };
}

export function rawFontToSource(value: unknown) {
  const font = asRecord(value) ?? {};
  return stripUndefined({
    ...withoutFontWrap(font),
    line_height: font.line_height ?? font.lineHeight,
    letter_spacing: font.letter_spacing ?? font.letterSpacing,
    opacity: font.opacity,
  });
}

export function fontScaleFromResize(scaleX: number, scaleY: number) {
  const safeX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
  const safeY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
  return Math.sqrt(safeX * safeY);
}

function rawTextListItemSourceRuns(
  item: unknown,
  fallback: RenderTextFont,
): TextRun[] {
  const fallbackFont = fontToSource(fallback);
  if (typeof item === "string") return [{ text: item, font: fallbackFont }];
  if (typeof item === "number") {
    return [{ text: String(item), font: fallbackFont }];
  }

  if (Array.isArray(item)) {
    const runs = item
      .map((run) => rawRunRecordToTextRun(run, fallback))
      .filter((run): run is TextRun => Boolean(run));
    return runs.length > 0 ? runs : [{ text: " ", font: fallbackFont }];
  }

  const record = asRecord(item);
  if (!record) return [];
  const itemFont = fontFromRecord(asRecord(record.font), fallback);
  const runs = readArray(record.runs)
    .map((run) => rawRunRecordToTextRun(run, itemFont))
    .filter((run): run is TextRun => Boolean(run));
  if (runs.length > 0) return runs;

  const text = readString(record.text);
  if (text != null) return [{ text, font: fontToSource(itemFont) }];
  return [];
}

function rawRunRecordToTextRun(
  value: unknown,
  fallback: RenderTextFont,
): TextRun | null {
  const record = asRecord(value);
  if (!record) return null;
  const text = readString(record.text) ?? "";
  if (!text) return null;
  return {
    text,
    font: fontToSource(fontFromRecord(asRecord(record.font), fallback)),
  };
}

function textListMarkerPrefix(value: unknown, index: number) {
  const marker = readString(value);
  if (marker === "none") return "";
  if (marker === "number") return `${index + 1}. `;
  return "• ";
}

function rawTextListItemWithRuns(source: unknown, runs: TextRun[]): unknown {
  const sourceRuns = Array.isArray(source)
    ? source
    : readArray(asRecord(source)?.runs);
  return runs.map((run, index) => {
    const sourceRun = asRecord(sourceRuns[index]) ?? {};
    return {
      ...sourceRun,
      text: run.text,
      font: rawInlineTextFontRecord(run.font, sourceRun.font),
    };
  });
}

function stripPlainTextListMarkersFromRuns(runs: TextRun[]): TextRun[] {
  const lines = splitTextRunsOnNewlines(runs);
  const stripped: TextRun[] = [];

  lines.forEach((line, index) => {
    const normalizedLine = stripTextListMarkerFromRuns(line);
    const lineFont =
      normalizedLine[0]?.font ?? line[0]?.font ?? stripped.at(-1)?.font;

    if (index > 0) appendTextRun(stripped, "\n", lineFont);
    normalizedLine.forEach((run) =>
      appendTextRun(stripped, run.text, run.font),
    );
  });

  return stripped.length > 0 ? stripped : [{ text: " " }];
}

function stripTextListMarkerFromRuns(runs: TextRun[]): TextRun[] {
  const marker = textRunsContent(runs).match(
    /^\s*(?:[-*•]\s+|\d+[.)]\s+)/u,
  )?.[0];
  if (!marker) return runs;
  return removeTextRunPrefix(runs, marker.length);
}

function removeTextRunPrefix(runs: TextRun[], length: number): TextRun[] {
  let remaining = length;
  const stripped: TextRun[] = [];

  for (const run of runs) {
    if (remaining <= 0) {
      stripped.push(cloneTextRun(run));
      continue;
    }

    const text = run.text ?? "";
    if (text.length <= remaining) {
      remaining -= text.length;
      continue;
    }

    const consumed = remaining;
    remaining = 0;
    stripped.push({
      ...run,
      text: text.slice(consumed),
      font: run.font ? { ...run.font } : undefined,
    });
  }

  return stripped;
}

function appendTextRun(
  runs: TextRun[],
  text: string,
  font: TextRun["font"],
) {
  if (!text) return;
  const previous = runs[runs.length - 1];
  if (
    previous &&
    JSON.stringify(previous.font ?? null) === JSON.stringify(font ?? null)
  ) {
    previous.text += text;
    return;
  }
  runs.push(font ? { text, font: { ...font } } : { text });
}

function readHorizontalAlignment(
  value: unknown,
): TemplateV2TextEditStyle["horizontal"] {
  const normalized = readString(value);
  if (normalized === "center" || normalized === "right") return normalized;
  return "left";
}

function readVerticalAlignment(
  value: unknown,
): TemplateV2TextEditStyle["vertical"] {
  const normalized = readString(value);
  if (normalized === "middle" || normalized === "bottom") return normalized;
  return "top";
}

