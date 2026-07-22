import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronLeft,
  ChevronRight,
  Columns3,
  MoreVertical,
  Paintbrush,
  Plus,
  Rows3,
  Settings,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  TableCellSelection,
  TableSlideElement,
} from "@/components/slide-editor/state/state";
import { withHash } from "@/components/slide-editor/utils/color";
import {
  elementBox,
  setTableRowsFromStrings,
  tableRowsAsStrings,
} from "@/components/slide-editor/model/element-model";
import type { TableCell } from "@/components/slide-editor/types";
import { DeferredColorInput } from "@/components/slide-editor/toolbar/DeferredColorInput";
import {
  FloatingToolbar,
  FloatingToolbarPanel,
  type FloatingToolbarBox,
} from "@/components/slide-editor/toolbar/FloatingToolbar";
import { applyTableTheme, TABLE_THEMES } from "@/components/slide-editor/tables/table-themes";
import {
  canMergeCells,
  mergeCellsRectangle,
  unmergeCellAt,
} from "@/components/slide-editor/tables/table-merge";

type TableCellAlignment = NonNullable<TableCell["alignment"]>;

const TABLE_CELL_ALIGNMENTS = ["left", "center", "right"] as const satisfies
  readonly TableCellAlignment[];

export function TableToolbarControls({
  element,
  index,
  selectedCell,
  onChange,
}: {
  element: TableSlideElement;
  index: number;
  selectedCell: TableCellSelection | null;
  onChange: (index: number, element: TableSlideElement) => void;
}) {
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const rows = tableRowsAsStrings(element);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const activeRow = Math.min(
    rows.length - 1,
    Math.max(0, selectedCell?.rowIndex ?? 0),
  );
  const activeColumn = Math.min(
    columnCount - 1,
    Math.max(0, selectedCell?.colIndex ?? 0),
  );
  const activeCell =
    activeRow === 0
      ? element.columns[activeColumn]
      : element.rows[activeRow - 1]?.[activeColumn];
  const activeCellFillColor =
    activeCell?.color?.color ??
    (activeCell as TableCell & { fill?: { color?: string | null } | null })
      ?.fill?.color;
  const colorPickerValue = activeCellFillColor ?? "FFFFFF";
  const activeCellAlignment: TableCellAlignment =
    activeCell?.alignment ?? "left";
  const ActiveCellAlignmentIcon =
    activeCellAlignment === "center"
      ? AlignCenter
      : activeCellAlignment === "right"
        ? AlignRight
        : AlignLeft;

  // Multi-select (Shift range / Ctrl toggle, see useTableCellSelection) — these
  // fall back to just the focus cell/row/column so single-target behavior is
  // unchanged when there's no multi-selection in play.
  const selectionKind = selectedCell?.kind ?? "cell";
  const targetRowIndexes =
    selectionKind === "row" && selectedCell?.rows?.length
      ? selectedCell.rows
      : [activeRow];
  const targetColumnIndexes =
    selectionKind === "column" && selectedCell?.columns?.length
      ? selectedCell.columns
      : [activeColumn];
  const targetCellCoords =
    selectionKind === "cell" && selectedCell?.cells?.length
      ? selectedCell.cells
      : [{ rowIndex: activeRow, colIndex: activeColumn }];

  const canAddRow = rows.length < 8;
  const canAddColumn = columnCount < 6;
  const canDeleteRow = rows.length - targetRowIndexes.length >= 2;
  const canDeleteColumn = columnCount - targetColumnIndexes.length >= 1;
  const canMoveColumnLeft = activeColumn > 0;
  const canMoveColumnRight = activeColumn < columnCount - 1;

  useEffect(() => {
    if (!tableMenuOpen && !themeMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-inline-edit-ignore='true']")) return;
      if (toolbarRef.current?.contains(event.target as Node)) return;
      setTableMenuOpen(false);
      setThemeMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [tableMenuOpen, themeMenuOpen]);

  const applyTheme = (themeId: string) => {
    const theme = TABLE_THEMES.find((t) => t.id === themeId);
    if (!theme) return;
    onChange(index, applyTableTheme(element, theme));
    setThemeMenuOpen(false);
  };

  const normalizeRows = (nextRows: string[][]) =>
    nextRows.map((row) =>
      Array.from({ length: columnCount }, (_, colIndex) => row[colIndex] ?? ""),
    );

  const commitRows = (nextRows: string[][]) => {
    onChange(index, setTableRowsFromStrings(element, nextRows));
  };

  // Cell-identity-preserving grid (header + body as one array), used by the
  // delete/merge ops below instead of the string round-trip `commitRows` goes
  // through — that round-trip re-derives styling from whatever cell now SITS
  // at a position after the text changes, which would silently reassign
  // fill/font/colSpan/rowSpan to the wrong cell once rows/columns shift.
  const normalizeCellRow = (row: TableCell[]): TableCell[] =>
    Array.from({ length: columnCount }, (_, colIndex) => row[colIndex] ?? { runs: [] });
  const cellGrid = [element.columns, ...element.rows].map(normalizeCellRow);
  const commitCellGrid = (grid: TableCell[][]) => {
    const [nextColumns, ...nextRows] = grid;
    onChange(index, { ...element, columns: nextColumns ?? [], rows: nextRows });
  };

  const addRow = () => {
    if (!canAddRow) return;
    const nextRows = normalizeRows(rows);
    const insertIndex = Math.min(nextRows.length, activeRow + 1);
    nextRows.splice(
      insertIndex,
      0,
      Array.from({ length: columnCount }, () => ""),
    );
    commitRows(nextRows);
  };

  const deleteRow = () => {
    if (!canDeleteRow) return;
    const targetRows = new Set(targetRowIndexes);
    commitCellGrid(cellGrid.filter((_, rowIndex) => !targetRows.has(rowIndex)));
  };

  const addColumn = () => {
    if (!canAddColumn) return;
    const insertIndex = Math.min(columnCount, activeColumn + 1);
    commitRows(
      rows.map((row) => {
        const next = Array.from(
          { length: columnCount },
          (_, colIndex) => row[colIndex] ?? "",
        );
        next.splice(insertIndex, 0, "");
        return next;
      }),
    );
  };

  const deleteColumn = () => {
    if (!canDeleteColumn) return;
    const targetCols = new Set(targetColumnIndexes);
    commitCellGrid(
      cellGrid.map((row) => row.filter((_, colIndex) => !targetCols.has(colIndex))),
    );
  };

  const moveColumn = (direction: "left" | "right") => {
    const targetColumn =
      direction === "left" ? activeColumn - 1 : activeColumn + 1;
    if (targetColumn < 0 || targetColumn >= columnCount) return;
    commitRows(
      rows.map((row) => {
        const next = Array.from(
          { length: columnCount },
          (_, colIndex) => row[colIndex] ?? "",
        );
        [next[activeColumn], next[targetColumn]] = [
          next[targetColumn],
          next[activeColumn],
        ];
        return next;
      }),
    );
  };

  const canMergeSelection =
    selectionKind === "cell" &&
    targetCellCoords.length > 1 &&
    canMergeCells(cellGrid, targetCellCoords);

  const mergeSelection = () => {
    if (!canMergeSelection) return;
    commitCellGrid(
      mergeCellsRectangle(cellGrid, targetCellCoords, (cell, rowSpan, colSpan) => ({
        ...cell,
        rowSpan,
        colSpan,
      })),
    );
  };

  const canUnmergeActiveCell = Boolean(
    activeCell && ((activeCell.rowSpan ?? 1) > 1 || (activeCell.colSpan ?? 1) > 1),
  );

  const unmergeActiveCell = () => {
    if (!canUnmergeActiveCell) return;
    commitCellGrid(
      unmergeCellAt(cellGrid, { rowIndex: activeRow, colIndex: activeColumn }, (cell) => ({
        ...cell,
        rowSpan: 1,
        colSpan: 1,
      })),
    );
  };

  // Applies to the whole multi-selection (Shift range / Ctrl toggle), not just
  // the focus cell — e.g. selecting 3 rows and picking a fill color paints all 3.
  const updateActiveCell = (patchCell: (cell: TableCell) => TableCell) => {
    if (selectionKind === "column") {
      const cols = new Set(targetColumnIndexes);
      commitCellGrid(
        cellGrid.map((row) =>
          row.map((cell, colIndex) => (cols.has(colIndex) ? patchCell(cell) : cell)),
        ),
      );
      return;
    }

    if (selectionKind === "row") {
      const targetRows = new Set(targetRowIndexes);
      commitCellGrid(
        cellGrid.map((row, rowIndex) =>
          targetRows.has(rowIndex) ? row.map((cell) => patchCell(cell)) : row,
        ),
      );
      return;
    }

    const cellKeys = new Set(
      targetCellCoords.map((c) => `${c.rowIndex}:${c.colIndex}`),
    );
    commitCellGrid(
      cellGrid.map((row, rowIndex) =>
        row.map((cell, colIndex) =>
          cellKeys.has(`${rowIndex}:${colIndex}`) ? patchCell(cell) : cell,
        ),
      ),
    );
  };

  const updateActiveCellFillColor = (color: string) => {
    updateActiveCell((cell) => ({
      ...(cell ?? { runs: [] }),
      color: {
        ...(cell?.color ?? {}),
        color,
      },
    }));
  };
  const cycleActiveCellAlignment = () => {
    const activeIndex = TABLE_CELL_ALIGNMENTS.indexOf(activeCellAlignment);
    const nextAlignment =
      TABLE_CELL_ALIGNMENTS[
      (activeIndex + 1) % TABLE_CELL_ALIGNMENTS.length
      ] ?? "left";
    updateActiveCell((cell) => ({
      ...(cell ?? { runs: [] }),
      alignment: nextAlignment,
    }));
  };
  const runTableMenuAction = (action: () => void) => {
    action();
    setTableMenuOpen(false);
  };

  return (
    <div ref={toolbarRef} style={tableControlsStyle}>
      <button
        type="button"
        aria-label="Cell background color"
        title="Cell background"
        style={iconButtonStyle}
        onClick={() => colorInputRef.current?.click()}
      >
        <span
          style={{
            ...colorDotStyle,
            background: activeCellFillColor
              ? withHash(activeCellFillColor)
              : "transparent",
          }}
        />
        <DeferredColorInput
          ref={colorInputRef}
          aria-hidden="true"
          tabIndex={-1}
          value={colorPickerValue}
          onCommit={updateActiveCellFillColor}
          style={hiddenColorInputStyle}
        />
      </button>
      <Divider />
      <button
        type="button"
        aria-label="Table alignment"
        title={`Align ${nextAlignmentLabel(activeCellAlignment)}`}
        style={iconButtonStyle}
        onClick={cycleActiveCellAlignment}
      >
        <ActiveCellAlignmentIcon size={16} strokeWidth={1.33} />
      </button>
      <Divider />
      <button
        type="button"
        aria-label="Table theme"
        aria-expanded={themeMenuOpen}
        title="Table theme"
        style={{
          ...iconButtonStyle,
          ...(themeMenuOpen ? activeButtonStyle : null),
        }}
        onClick={() => setThemeMenuOpen((open) => !open)}
      >
        <Paintbrush size={16} strokeWidth={1.33} />
      </button>
      {themeMenuOpen ? (
        <FloatingToolbarPanel style={themeMenuStyle}>
          {TABLE_THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              title={theme.label}
              onClick={() => applyTheme(theme.id)}
              style={themeSwatchButtonStyle}
            >
              <span style={{ ...themeSwatchStripStyle, background: theme.headerFill }} />
              <span style={{ ...themeSwatchStripStyle, background: theme.rowFill }} />
              <span style={{ ...themeSwatchStripStyle, background: theme.altRowFill }} />
              <span style={themeSwatchLabelStyle}>{theme.label}</span>
            </button>
          ))}
        </FloatingToolbarPanel>
      ) : null}
      <Divider />
      <button
        type="button"
        aria-label="Delete row"
        title="Delete row"
        disabled={!canDeleteRow}
        style={{
          ...iconButtonStyle,
          opacity: canDeleteRow ? 1 : 0.36,
          cursor: canDeleteRow ? "pointer" : "not-allowed",
        }}
        onClick={deleteRow}
      >
        <Trash2 size={16} strokeWidth={1.33} />
      </button>
      <Divider />
      <button
        type="button"
        aria-label="Table cell actions"
        aria-expanded={tableMenuOpen}
        title="Table cell actions"
        style={{
          ...iconButtonStyle,
          ...(tableMenuOpen ? activeButtonStyle : null),
        }}
        onClick={() => setTableMenuOpen((open) => !open)}
      >
        <Settings size={16} strokeWidth={1.33} />
      </button>
      <TableToolbarMenu
        canAddColumn={canAddColumn}
        canAddRow={canAddRow}
        canDeleteColumn={canDeleteColumn}
        canDeleteRow={canDeleteRow}
        canMoveColumnLeft={canMoveColumnLeft}
        canMoveColumnRight={canMoveColumnRight}
        canMergeSelection={canMergeSelection}
        canUnmergeActiveCell={canUnmergeActiveCell}
        menuOpen={tableMenuOpen}
        onAddColumn={() => runTableMenuAction(addColumn)}
        onAddRow={() => runTableMenuAction(addRow)}
        onDeleteColumn={() => runTableMenuAction(deleteColumn)}
        onDeleteRow={() => runTableMenuAction(deleteRow)}
        onMoveColumnLeft={() => runTableMenuAction(() => moveColumn("left"))}
        onMoveColumnRight={() => runTableMenuAction(() => moveColumn("right"))}
        onMergeSelection={() => runTableMenuAction(mergeSelection)}
        onUnmergeActiveCell={() => runTableMenuAction(unmergeActiveCell)}
      />
    </div>
  );
}

export function TableToolbar({
  anchorBox,
  element,
  index,
  scale,
  selectedCell,
  onChange,
}: {
  anchorBox?: FloatingToolbarBox | null;
  element: TableSlideElement;
  index: number;
  scale: number;
  selectedCell: TableCellSelection | null;
  onChange: (index: number, element: TableSlideElement) => void;
}) {
  const box = elementBox(element);

  return (
    <FloatingToolbar
      anchorBox={
        anchorBox ?? {
          x: box.x * scale,
          y: box.y * scale,
          width: box.w * scale,
          height: box.h * scale,
        }
      }
      fallbackWidth={290}
      inlineEditIgnore
    >
      <div style={standaloneToolbarStyle}>
        <TableToolbarControls
          element={element}
          index={index}
          selectedCell={selectedCell}
          onChange={onChange}
        />
      </div>
    </FloatingToolbar>
  );
}

function TableToolbarMenu({
  canAddColumn,
  canAddRow,
  canDeleteColumn,
  canDeleteRow,
  canMoveColumnLeft,
  canMoveColumnRight,
  canMergeSelection,
  canUnmergeActiveCell,
  menuOpen,
  onAddColumn,
  onAddRow,
  onDeleteColumn,
  onDeleteRow,
  onMoveColumnLeft,
  onMoveColumnRight,
  onMergeSelection,
  onUnmergeActiveCell,
}: {
  canAddColumn: boolean;
  canAddRow: boolean;
  canDeleteColumn: boolean;
  canDeleteRow: boolean;
  canMoveColumnLeft: boolean;
  canMoveColumnRight: boolean;
  canMergeSelection: boolean;
  canUnmergeActiveCell: boolean;
  menuOpen: boolean;
  onAddColumn: () => void;
  onAddRow: () => void;
  onDeleteColumn: () => void;
  onDeleteRow: () => void;
  onMoveColumnLeft: () => void;
  onMoveColumnRight: () => void;
  onMergeSelection: () => void;
  onUnmergeActiveCell: () => void;
}) {
  if (!menuOpen) return null;

  return (
    <FloatingToolbarPanel style={menuStyle}>
      <MenuItem
        disabled={!canDeleteRow}
        icon={<Rows3 size={20} strokeWidth={2.2} />}
        label="Delete Row"
        onClick={onDeleteRow}
      />
      <MenuItem
        disabled={!canDeleteColumn}
        icon={<Columns3 size={20} strokeWidth={2.2} />}
        label="Delete Column"
        onClick={onDeleteColumn}
      />
      <MenuItem
        disabled={!canAddRow}
        icon={<Plus size={20} strokeWidth={2.4} />}
        label="Add Row"
        onClick={onAddRow}
      />
      <MenuItem
        disabled={!canAddColumn}
        icon={<Plus size={20} strokeWidth={2.4} />}
        label="Add Column"
        onClick={onAddColumn}
      />
      <div style={menuDividerStyle} />
      <MenuItem
        disabled={!canMergeSelection}
        icon={<TableCellsMerge size={20} strokeWidth={2.2} />}
        label="Merge Cells"
        onClick={onMergeSelection}
      />
      <MenuItem
        disabled={!canUnmergeActiveCell}
        icon={<TableCellsSplit size={20} strokeWidth={2.2} />}
        label="Unmerge Cells"
        onClick={onUnmergeActiveCell}
      />
      <div style={menuDividerStyle} />
      <MenuItem
        disabled={!canMoveColumnRight}
        icon={<ChevronRight size={20} strokeWidth={2.4} />}
        label="Move Column Right"
        onClick={onMoveColumnRight}
      />
      <MenuItem
        disabled={!canMoveColumnLeft}
        icon={<ChevronLeft size={20} strokeWidth={2.4} />}
        label="Move Column Left"
        onClick={onMoveColumnLeft}
      />
    </FloatingToolbarPanel>
  );
}

function MenuItem({
  disabled = false,
  icon,
  label,
  shortcut,
  strong = false,
  onClick,
}: {
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  shortcut?: string;
  strong?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        ...menuItemStyle,
        ...(strong ? strongMenuItemStyle : null),
        opacity: disabled ? 0.38 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
    >
      {icon ? <span style={menuIconStyle}>{icon}</span> : null}
      <span>{label}</span>
      {shortcut ? <span style={menuShortcutStyle}>{shortcut}</span> : null}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" style={dividerStyle} />;
}

function nextAlignmentLabel(alignment: TableCellAlignment) {
  const activeIndex = TABLE_CELL_ALIGNMENTS.indexOf(alignment);
  return (
    TABLE_CELL_ALIGNMENTS[
    (activeIndex + 1) % TABLE_CELL_ALIGNMENTS.length
    ] ?? "left"
  );
}

const standaloneToolbarStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 14,
  border: "1px solid #E7E8EC",
  background: "#FFFFFF",
  boxShadow: "0 12px 32px rgba(15, 23, 42, 0.18)",
};

const tableControlsStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  height: 28,
  color: "#191919",
  fontFamily:
    "syne, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const iconButtonStyle: CSSProperties = {
  position: "relative",
  width: 28,
  height: 28,
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "#0F172A",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

const activeButtonStyle: CSSProperties = {
  background: "#F6F3FF",
};

const dividerStyle: CSSProperties = {
  width: 1,
  height: 28,
  margin: "0 8px",
  background: "#E7E8EC",
};

const colorDotStyle: CSSProperties = {
  width: 16,
  height: 16,
  boxSizing: "border-box",
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.26)",
  boxShadow:
    "inset 0 0 0 1px rgba(255, 255, 255, 0.68), 0 1px 3px rgba(15, 23, 42, 0.22)",
  display: "block",
};

const hiddenColorInputStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0,
  pointerEvents: "none",
};

const menuStyle: CSSProperties = {
  width: 260,
  padding: "14px 0",
  borderRadius: 14,
  border: "1px solid #E7E8EC",
  background: "#FFFFFF",
  boxShadow: "0 20px 52px rgba(15, 23, 42, 0.22)",
};

const themeMenuStyle: CSSProperties = {
  width: 168,
  padding: 8,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  borderRadius: 14,
  border: "1px solid #E7E8EC",
  background: "#FFFFFF",
  boxShadow: "0 20px 52px rgba(15, 23, 42, 0.22)",
};

const themeSwatchButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 32,
  padding: "0 8px",
  border: 0,
  borderRadius: 8,
  background: "transparent",
  cursor: "pointer",
  fontFamily: "syne, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const themeSwatchStripStyle: CSSProperties = {
  width: 12,
  height: 20,
  borderRadius: 3,
  border: "1px solid rgba(15, 23, 42, 0.12)",
};

const themeSwatchLabelStyle: CSSProperties = {
  marginLeft: 4,
  fontSize: 13,
  fontWeight: 500,
  color: "#191919",
};

const menuItemStyle: CSSProperties = {
  width: "100%",
  height: 44,
  border: 0,
  background: "transparent",
  color: "#191919",
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "0 24px",
  fontSize: 15,
  fontWeight: 500,
  letterSpacing: 0,
  textAlign: "left",
};

const strongMenuItemStyle: CSSProperties = {
  color: "#000000",
};

const menuIconStyle: CSSProperties = {
  width: 22,
  height: 22,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#111827",
};

const menuShortcutStyle: CSSProperties = {
  marginLeft: "auto",
  padding: "4px 6px",
  borderRadius: 6,
  background: "#F6F6F9",
  color: "#808080",
  fontSize: 12,
  lineHeight: 1,
  whiteSpace: "nowrap",
};

const menuDividerStyle: CSSProperties = {
  height: 1,
  margin: "10px 0",
  background: "#ECEDEF",
};
