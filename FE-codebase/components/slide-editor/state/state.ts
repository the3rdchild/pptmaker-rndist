import type { SlideElement } from "@/components/slide-editor/types";

export type ExportMode = "native" | "keynote" | "raster";
export type TextSlideElement = Extract<SlideElement, { type: "text" }>;
export type BulletsSlideElement = Extract<SlideElement, { type: "text-list" }>;
export type ImageSlideElement = Extract<SlideElement, { type: "image" }>;
export type LineSlideElement = Extract<SlideElement, { type: "line" }>;
export type ShapeSlideElement = Extract<
  SlideElement,
  { type: "rectangle" | "ellipse" }
>;
export type TableSlideElement = Extract<SlideElement, { type: "table" }>;
export type ChartSlideElement = Extract<SlideElement, { type: "chart" }>;
export type SvgSlideElement = Extract<SlideElement, { type: "svg" }>;
export type FormulaSlideElement = Extract<SlideElement, { type: "formula" }>;
export type TableCellCoord = { rowIndex: number; colIndex: number };

export type TableCellSelection = {
  elementIndex: number;
  elementPath?: string | null;
  /** Primary/focus target — the most recently clicked cell/row/column. Drives
   * single-value UI (active color swatch, alignment icon, editing anchor). */
  rowIndex: number;
  colIndex: number;
  /** "row"/"column" select every cell in that row/column; "cell" (default) is just the one.
   * A selection is homogeneous — switching kind starts a brand-new selection
   * instead of trying to merge row-picks with cell-picks. */
  kind?: "cell" | "row" | "column";
  /** Full multi-select payload, always populated alongside rowIndex/colIndex/kind so
   * existing single-cell consumers keep working untouched:
   * - kind "cell": every individually selected leaf cell (Shift = rectangle range from
   *   the anchor, Ctrl/Cmd = toggle add/remove, non-contiguous allowed). Always has
   *   at least one entry ({rowIndex, colIndex}). `rows`/`columns` are derived unique
   *   sets of the rows/columns touched by `cells`, for convenience.
   * - kind "row"/"column": `rows`/`columns` holds every selected index (Shift = range,
   *   Ctrl = toggle). `cells` is left empty — consumers that need per-cell coordinates
   *   for a row/column selection expand it themselves using the table's column/row count. */
  cells: TableCellCoord[];
  rows: number[];
  columns: number[];
};

export { useTableCellSelection } from "@/components/slide-editor/tables/useTableCellSelection";
export { useTemplateV2InlineEditing } from "@/components/slide-editor/state/useTemplateV2InlineEditing";
