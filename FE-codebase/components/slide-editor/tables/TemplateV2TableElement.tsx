import { useRef } from "react";
import { Group, Rect, Text } from "react-konva";
import type Konva from "konva";
import { renderMarkdownTextRuns } from "@/components/slide-editor/text/markdown-text";
import type { TextRun } from "@/components/slide-editor/types";
import { layoutRichText } from "@/components/slide-editor/text/template-v2-text";
import { effectiveLineHeight } from "@/components/slide-editor/text/text-line-height";
import { readableTableTextColor } from "@/components/slide-editor/tables/table-colors";
import { colorWithOpacity } from "@/components/slide-editor/model/render-style";

type UnknownRecord = Record<string, any>;
type RawElement = UnknownRecord;
type RenderTextFont = {
  family: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  lineHeight: number;
  letterSpacing: number;
  opacity: number;
};

const MIN_CELL_SIZE = 24;
const HANDLE_HIT_SIZE = 8;

// Cumulative pixel offsets/sizes for each column (or row), derived from
// fractional weights so resizing the table as a whole scales every column
// together. Falls back to equal division when weights are missing/stale
// (wrong length) — every existing table with no column_widths keeps
// rendering exactly as before.
function trackSizes(weights: unknown, count: number, total: number): number[] {
  const raw = Array.isArray(weights)
    ? weights.filter((v): v is number => typeof v === "number" && v > 0)
    : [];
  const base = raw.length === count ? raw : Array.from({ length: count }, () => 1 / count);
  const sum = base.reduce((a, b) => a + b, 0) || 1;
  return base.map((v) => (v / sum) * total);
}

function offsetsFromSizes(sizes: number[]): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const size of sizes) {
    offsets.push(cursor);
    cursor += size;
  }
  return offsets;
}

export function TemplateV2TableElement({
  element,
  width,
  height,
  interactive,
  selectedCell,
  onCellSelect,
  onCellEdit,
  onResize,
}: {
  element: RawElement;
  width: number;
  height: number;
  interactive: boolean;
  selectedCell?: { rowIndex: number; colIndex: number; kind?: "cell" | "row" | "column" } | null;
  onCellSelect?: (rowIndex: number, colIndex: number) => void;
  onCellEdit?: (rowIndex: number, colIndex: number) => void;
  onResize?: (columnWidths: number[] | null, rowHeights: number[] | null) => void;
}) {
  const rows = rawTableRows(element);
  const rowCount = Math.max(1, rows.length);
  const colCount = Math.max(1, ...rows.map((row) => row.length));
  const colWidths = trackSizes(element.column_widths, colCount, width);
  const rowHeightsPx = trackSizes(element.row_heights, rowCount, height);
  const colOffsets = offsetsFromSizes(colWidths);
  const rowOffsets = offsetsFromSizes(rowHeightsPx);
  const font = rawFont(element);

  return (
    <Group listening={interactive}>
      {rows.map((row, rowIndex) =>
        Array.from({ length: colCount }, (_, colIndex) => {
          const cell = asRecord(row[colIndex]) ?? {};
          const firstRun = asRecord(readArray(cell.runs)[0]) ?? {};
          const cellFont = fontFromRecord(
            asRecord(cell.font) ?? asRecord(firstRun.font),
            font,
          );
          const fill = fillColor(cell.fill ?? cell.color);
          const runs = readableTableCellRuns(
            rawTableCellRuns(cell, cellFont),
            fill,
            rowIndex === 0,
          );
          const renderRuns =
            rowIndex === 0
              ? runs.map((run) => ({
                ...run,
                font: { ...run.font, bold: true },
              }))
              : runs;
          const text = tableCellTextContent(runs);
          const fontSize = cellFont.size;
          const cellW = colWidths[colIndex] ?? width / colCount;
          const cellH = rowHeightsPx[rowIndex] ?? height / rowCount;
          const textWidth = Math.max(1, cellW - 12);
          const cellLineHeight = effectiveLineHeight({
            text,
            width: textWidth,
            fontSize,
            lineHeight: cellFont.lineHeight,
            fallback: 1.15,
            wrap: "word",
          });
          return (
            <Group
              key={`${rowIndex}-${colIndex}`}
              x={colOffsets[colIndex] ?? 0}
              y={rowOffsets[rowIndex] ?? 0}
              onClick={(event) => {
                if (!interactive) return;
                event.cancelBubble = true;
                onCellSelect?.(rowIndex, colIndex);
              }}
              onTap={(event) => {
                if (!interactive) return;
                event.cancelBubble = true;
                onCellSelect?.(rowIndex, colIndex);
              }}
              onDblClick={(event) => {
                if (!interactive) return;
                event.cancelBubble = true;
                onCellSelect?.(rowIndex, colIndex);
                onCellEdit?.(rowIndex, colIndex);
              }}
              onDblTap={(event) => {
                if (!interactive) return;
                event.cancelBubble = true;
                onCellSelect?.(rowIndex, colIndex);
                onCellEdit?.(rowIndex, colIndex);
              }}
            >
              <Rect
                width={cellW}
                height={cellH}
                fill={fill ?? "rgba(0,0,0,0)"}
                stroke={strokeColor(cell.stroke) ?? "#D0D5DD"}
                strokeWidth={strokeWidth(cell.stroke) || 1}
              />
              <TableCellText
                x={6}
                y={4}
                width={textWidth}
                height={Math.max(1, cellH - 8)}
                runs={renderRuns}
                font={rowIndex === 0 ? { ...cellFont, bold: true } : cellFont}
                align={readString(cell.alignment) ?? "left"}
                verticalAlign="middle"
                lineHeight={cellLineHeight}
              />
            </Group>
          );
        }),
      )}
      <SelectedTableCellOutline
        colWidths={colWidths}
        rowHeights={rowHeightsPx}
        colOffsets={colOffsets}
        rowOffsets={rowOffsets}
        colCount={colCount}
        rowCount={rowCount}
        selectedCell={selectedCell}
        tableWidth={width}
        tableHeight={height}
      />
      {interactive && onCellSelect ? (
        <RowColumnHandles
          colCount={colCount}
          rowCount={rowCount}
          colOffsets={colOffsets}
          rowOffsets={rowOffsets}
          tableWidth={width}
          tableHeight={height}
          onCellSelect={onCellSelect}
        />
      ) : null}
      {interactive && onResize ? (
        <ResizeHandles
          colWidths={colWidths}
          rowHeights={rowHeightsPx}
          colOffsets={colOffsets}
          rowOffsets={rowOffsets}
          tableWidth={width}
          tableHeight={height}
          onResize={onResize}
        />
      ) : null}
    </Group>
  );
}

// Thin strips just inside the top/left edges — clicking one selects the
// whole row or column (sentinel: colIndex -1 = "row", rowIndex -1 =
// "column", read by TemplateV2KonvaSlide.selectTableCell).
function RowColumnHandles({
  colCount,
  rowCount,
  colOffsets,
  rowOffsets,
  tableWidth,
  tableHeight,
  onCellSelect,
}: {
  colCount: number;
  rowCount: number;
  colOffsets: number[];
  rowOffsets: number[];
  tableWidth: number;
  tableHeight: number;
  onCellSelect: (rowIndex: number, colIndex: number) => void;
}) {
  const HANDLE_THICKNESS = 6;
  return (
    <Group listening>
      {Array.from({ length: colCount }, (_, colIndex) => {
        const x = colOffsets[colIndex] ?? 0;
        const w =
          (colOffsets[colIndex + 1] ?? tableWidth) - x;
        return (
          <Rect
            key={`col-handle-${colIndex}`}
            x={x}
            y={-HANDLE_THICKNESS - 2}
            width={w}
            height={HANDLE_THICKNESS}
            fill="rgba(124, 81, 248, 0.001)"
            onClick={(event) => {
              event.cancelBubble = true;
              onCellSelect(-1, colIndex);
            }}
            onTap={(event) => {
              event.cancelBubble = true;
              onCellSelect(-1, colIndex);
            }}
            onMouseEnter={(event) => setCursor(event, "s-resize")}
            onMouseLeave={(event) => setCursor(event, "default")}
          />
        );
      })}
      {Array.from({ length: rowCount }, (_, rowIndex) => {
        const y = rowOffsets[rowIndex] ?? 0;
        const h = (rowOffsets[rowIndex + 1] ?? tableHeight) - y;
        return (
          <Rect
            key={`row-handle-${rowIndex}`}
            x={-HANDLE_THICKNESS - 2}
            y={y}
            width={HANDLE_THICKNESS}
            height={h}
            fill="rgba(124, 81, 248, 0.001)"
            onClick={(event) => {
              event.cancelBubble = true;
              onCellSelect(rowIndex, -1);
            }}
            onTap={(event) => {
              event.cancelBubble = true;
              onCellSelect(rowIndex, -1);
            }}
            onMouseEnter={(event) => setCursor(event, "e-resize")}
            onMouseLeave={(event) => setCursor(event, "default")}
          />
        );
      })}
    </Group>
  );
}

function setCursor(event: Konva.KonvaEventObject<Event>, cursor: string) {
  const stage = event.target.getStage();
  const container = stage?.container();
  if (container) container.style.cursor = cursor;
}

// Drag handles on column/row boundaries. Reads the pointer's position in
// the table's own LOCAL coordinate space (getRelativePointerPosition),
// which Konva keeps correct under rotation without any manual math — the
// handle is snapped back to its true boundary position on drag end
// regardless of where the pointer ended up, only the resolved delta along
// the relevant axis is kept.
function ResizeHandles({
  colWidths,
  rowHeights,
  colOffsets,
  rowOffsets,
  tableWidth,
  tableHeight,
  onResize,
}: {
  colWidths: number[];
  rowHeights: number[];
  colOffsets: number[];
  rowOffsets: number[];
  tableWidth: number;
  tableHeight: number;
  onResize: (columnWidths: number[] | null, rowHeights: number[] | null) => void;
}) {
  return (
    <Group listening>
      {colWidths.slice(0, -1).map((_, index) => (
        <ColumnResizeHandle
          key={`col-resize-${index}`}
          index={index}
          boundaryX={colOffsets[index + 1] ?? 0}
          height={tableHeight}
          colWidths={colWidths}
          tableWidth={tableWidth}
          onResize={onResize}
        />
      ))}
      {rowHeights.slice(0, -1).map((_, index) => (
        <RowResizeHandle
          key={`row-resize-${index}`}
          index={index}
          boundaryY={rowOffsets[index + 1] ?? 0}
          width={tableWidth}
          rowHeights={rowHeights}
          tableHeight={tableHeight}
          onResize={onResize}
        />
      ))}
    </Group>
  );
}

function ColumnResizeHandle({
  index,
  boundaryX,
  height,
  colWidths,
  tableWidth,
  onResize,
}: {
  index: number;
  boundaryX: number;
  height: number;
  colWidths: number[];
  tableWidth: number;
  onResize: (columnWidths: number[] | null, rowHeights: number[] | null) => void;
}) {
  const rectRef = useRef<Konva.Rect | null>(null);
  return (
    <Rect
      ref={rectRef}
      x={boundaryX - HANDLE_HIT_SIZE / 2}
      y={0}
      width={HANDLE_HIT_SIZE}
      height={height}
      fill="transparent"
      draggable
      onMouseEnter={(event) => setCursor(event, "col-resize")}
      onMouseLeave={(event) => setCursor(event, "default")}
      onDragEnd={(event) => {
        const node = event.target;
        const draggedX = node.x() + HANDLE_HIT_SIZE / 2;
        const delta = draggedX - boundaryX;
        node.position({ x: boundaryX - HANDLE_HIT_SIZE / 2, y: 0 });
        const next = [...colWidths];
        next[index] = Math.max(MIN_CELL_SIZE, colWidths[index] + delta);
        const appliedDelta = next[index] - colWidths[index];
        next[index + 1] = Math.max(MIN_CELL_SIZE, colWidths[index + 1] - appliedDelta);
        onResize(
          next.map((w) => w / tableWidth),
          null,
        );
      }}
    />
  );
}

function RowResizeHandle({
  index,
  boundaryY,
  width,
  rowHeights,
  tableHeight,
  onResize,
}: {
  index: number;
  boundaryY: number;
  width: number;
  rowHeights: number[];
  tableHeight: number;
  onResize: (columnWidths: number[] | null, rowHeights: number[] | null) => void;
}) {
  const rectRef = useRef<Konva.Rect | null>(null);
  return (
    <Rect
      ref={rectRef}
      x={0}
      y={boundaryY - HANDLE_HIT_SIZE / 2}
      width={width}
      height={HANDLE_HIT_SIZE}
      fill="transparent"
      draggable
      onMouseEnter={(event) => setCursor(event, "row-resize")}
      onMouseLeave={(event) => setCursor(event, "default")}
      onDragEnd={(event) => {
        const node = event.target;
        const draggedY = node.y() + HANDLE_HIT_SIZE / 2;
        const delta = draggedY - boundaryY;
        node.position({ x: 0, y: boundaryY - HANDLE_HIT_SIZE / 2 });
        const next = [...rowHeights];
        next[index] = Math.max(MIN_CELL_SIZE, rowHeights[index] + delta);
        const appliedDelta = next[index] - rowHeights[index];
        next[index + 1] = Math.max(MIN_CELL_SIZE, rowHeights[index + 1] - appliedDelta);
        onResize(
          null,
          next.map((h) => h / tableHeight),
        );
      }}
    />
  );
}

function TableCellText({
  x,
  y,
  width,
  height,
  runs,
  font,
  align,
  verticalAlign,
  lineHeight,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  runs: Array<{ text: string; font: RenderTextFont }>;
  font: RenderTextFont;
  align: string;
  verticalAlign: string;
  lineHeight: number;
}) {
  const baseFont = { ...font, lineHeight };
  const renderRuns = runs.map((run) => ({
    ...run,
    font: {
      ...run.font,
      lineHeight: run.font.lineHeight || lineHeight,
    },
  }));

  const { tokens } = layoutRichText(
    renderRuns,
    width,
    baseFont,
    align,
    verticalAlign,
    height,
    "word",
  );

  return (
    <Group x={x} y={y} listening={false}>
      {tokens.map((token, index) => (
        <Text
          key={index}
          x={token.x}
          y={token.y}
          width={token.width}
          height={token.height}
          text={token.text}
          fill={colorWithOpacity(withHash(token.font.color), token.font.opacity)}
          fontFamily={`${token.font.family}, Inter`}
          fontSize={token.font.size}
          fontStyle={`${token.font.bold ? "bold" : "normal"} ${token.font.italic ? "italic" : ""
            }`}
          textDecoration={token.font.underline ? "underline" : ""}
          lineHeight={token.font.lineHeight}
          letterSpacing={token.font.letterSpacing}
          wrap="none"
          listening={false}
        />
      ))}
    </Group>
  );
}

function SelectedTableCellOutline({
  colWidths,
  rowHeights,
  colOffsets,
  rowOffsets,
  colCount,
  rowCount,
  selectedCell,
  tableWidth,
  tableHeight,
}: {
  colWidths: number[];
  rowHeights: number[];
  colOffsets: number[];
  rowOffsets: number[];
  colCount: number;
  rowCount: number;
  selectedCell?: { rowIndex: number; colIndex: number; kind?: "cell" | "row" | "column" } | null;
  tableWidth: number;
  tableHeight: number;
}) {
  if (!selectedCell) return null;
  const kind = selectedCell.kind ?? "cell";

  if (kind === "row") {
    if (selectedCell.rowIndex < 0 || selectedCell.rowIndex >= rowCount) return null;
    return (
      <Rect
        x={0}
        y={rowOffsets[selectedCell.rowIndex] ?? 0}
        width={tableWidth}
        height={rowHeights[selectedCell.rowIndex] ?? 0}
        fill="rgba(0,0,0,0)"
        stroke="#7C51F8"
        strokeWidth={2}
        listening={false}
      />
    );
  }
  if (kind === "column") {
    if (selectedCell.colIndex < 0 || selectedCell.colIndex >= colCount) return null;
    return (
      <Rect
        x={colOffsets[selectedCell.colIndex] ?? 0}
        y={0}
        width={colWidths[selectedCell.colIndex] ?? 0}
        height={tableHeight}
        fill="rgba(0,0,0,0)"
        stroke="#7C51F8"
        strokeWidth={2}
        listening={false}
      />
    );
  }

  if (selectedCell.colIndex < 0 || selectedCell.colIndex >= colCount) return null;
  if (selectedCell.rowIndex < 0 || selectedCell.rowIndex >= rowCount) return null;

  return (
    <Rect
      x={colOffsets[selectedCell.colIndex] ?? 0}
      y={rowOffsets[selectedCell.rowIndex] ?? 0}
      width={colWidths[selectedCell.colIndex] ?? 0}
      height={rowHeights[selectedCell.rowIndex] ?? 0}
      fill="rgba(0,0,0,0)"
      stroke="#7C51F8"
      strokeWidth={2}
      listening={false}
    />
  );
}

function rawTableRows(element: RawElement) {
  const columns = readArray(element.columns);
  const rows = readArray(element.rows);
  return [columns, ...rows].filter((row) => Array.isArray(row)) as unknown[][];
}

function rawTableCellRuns(cell: unknown, fallbackFont: RenderTextFont) {
  const sourceRuns = rawTableCellSourceRuns(cell, fallbackFont);
  return renderMarkdownTextRuns(sourceRuns).map((run) => ({
    text: run.text,
    font: fontFromRecord(asRecord(run.font), fallbackFont),
  }));
}

function rawTableCellSourceRuns(
  cell: unknown,
  fallbackFont: RenderTextFont,
): TextRun[] {
  if (typeof cell === "string" || typeof cell === "number") {
    return [{ text: String(cell), font: fontToTextRunFont(fallbackFont) }];
  }
  const record = asRecord(cell);
  if (!record) return [{ text: "", font: fontToTextRunFont(fallbackFont) }];
  const cellFont = fontFromRecord(asRecord(record.font), fallbackFont);
  const runs = readArray(record.runs);
  if (runs.length > 0) {
    return runs
      .map((run) => {
        const runRecord = asRecord(run) ?? {};
        return {
          text: readString(runRecord.text) ?? "",
          font: fontToTextRunFont(
            fontFromRecord(asRecord(runRecord.font), cellFont),
          ),
        };
      })
      .filter((run) => run.text.length > 0);
  }
  const textRecord = asRecord(record.text);
  return [
    {
      text: readString(textRecord?.text) ?? readString(record.text) ?? "",
      font: fontToTextRunFont(cellFont),
    },
  ];
}

function fontToTextRunFont(font: RenderTextFont): TextRun["font"] {
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

function tableCellTextContent(runs: Array<{ text: string }>) {
  return runs.map((run) => run.text).join("");
}

function readableTableCellRuns(
  runs: Array<{ text: string; font: RenderTextFont }>,
  fill: string | undefined,
  isHeader: boolean,
) {
  if (isHeader) return runs;
  return runs.map((run) => ({
    ...run,
    font: {
      ...run.font,
      color: readableTableTextColor(run.font.color, fill),
    },
  }));
}

function rawFont(element: RawElement) {
  const font = asRecord(element.font) ?? {};
  return fontFromRecord(font, {
    family: "Arial",
    size: 18,
    color: "#111827",
    bold: false,
    italic: false,
    underline: false,
    lineHeight: 1.15,
    letterSpacing: 0,
    opacity: 1,
  });
}

function fontFromRecord(
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

function fillColor(fill: unknown) {
  const value = asRecord(fill);
  return withHash(readString(value?.color));
}

function strokeColor(stroke: unknown) {
  const value = asRecord(stroke);
  return withHash(readString(value?.color));
}

function strokeWidth(stroke: unknown) {
  const value = asRecord(stroke);
  return readNumber(value?.width) ?? 0;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function withHash(value: string | null | undefined) {
  if (!value) return undefined;
  return value.startsWith("#") || value.startsWith("rgb") ? value : `#${value}`;
}
