import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  TableCellCoord,
  TableCellSelection,
} from "@/components/slide-editor/state/state";

type ElementSelectionLike = {
  elementPath: number[];
};

export type TableSelectModifiers = { shift?: boolean; ctrl?: boolean };

type RangeAnchor = {
  kind: NonNullable<TableCellSelection["kind"]>;
  rowIndex: number;
  colIndex: number;
};

function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function cellKey(coord: TableCellCoord): string {
  return `${coord.rowIndex}:${coord.colIndex}`;
}

export function useTableCellSelection<
  TSelection extends object | null,
  TElementSelection extends ElementSelectionLike,
>({
  keyForSelection,
  selection,
}: {
  keyForSelection: (
    selection: NonNullable<TSelection> | TElementSelection,
  ) => string;
  selection: TSelection;
}) {
  const [selectedTableCell, setSelectedTableCell] =
    useState<TableCellSelection | null>(null);
  const [editingTableCell, setEditingTableCell] =
    useState<TableCellSelection | null>(null);
  // Fixed point Shift-range is computed from. Reset to the clicked target on
  // every plain/Ctrl click; left untouched across repeated Shift-clicks so
  // the range always spans from the same origin (standard spreadsheet feel).
  const [rangeAnchor, setRangeAnchor] = useState<RangeAnchor | null>(null);

  useEffect(() => {
    if (!selectedTableCell) return;
    if (
      !selection ||
      selectedTableCell.elementPath !==
        keyForSelection(selection as NonNullable<TSelection>)
    ) {
      setSelectedTableCell(null);
      setRangeAnchor(null);
    }
  }, [keyForSelection, selectedTableCell, selection]);

  useEffect(() => {
    if (!editingTableCell) return;
    if (
      !selection ||
      editingTableCell.elementPath !==
        keyForSelection(selection as NonNullable<TSelection>)
    ) {
      setEditingTableCell(null);
    }
  }, [editingTableCell, keyForSelection, selection]);

  const buildCellSelection = useCallback(
    (
      elementSelection: TElementSelection,
      rowIndex: number,
      colIndex: number,
      kind: NonNullable<TableCellSelection["kind"]>,
      modifiers: TableSelectModifiers = {},
    ): TableCellSelection => {
      const elementPath = keyForSelection(elementSelection);
      const elementIndex = elementSelection.elementPath[0] ?? 0;
      const sameElement = selectedTableCell?.elementPath === elementPath;
      const sameKindSelection =
        sameElement && selectedTableCell?.kind === kind
          ? selectedTableCell
          : null;
      const anchor =
        sameElement && rangeAnchor?.kind === kind ? rangeAnchor : null;

      if (kind === "row" || kind === "column") {
        const targetIndex = kind === "row" ? rowIndex : colIndex;
        let indexes: number[];
        if (modifiers.shift && anchor) {
          const anchorIndex = kind === "row" ? anchor.rowIndex : anchor.colIndex;
          const lo = Math.min(anchorIndex, targetIndex);
          const hi = Math.max(anchorIndex, targetIndex);
          indexes = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
        } else if (modifiers.ctrl && sameKindSelection) {
          const existing = new Set(
            kind === "row" ? sameKindSelection.rows : sameKindSelection.columns,
          );
          if (existing.has(targetIndex)) existing.delete(targetIndex);
          else existing.add(targetIndex);
          indexes =
            existing.size > 0 ? uniqueSorted(Array.from(existing)) : [targetIndex];
          setRangeAnchor({ kind, rowIndex, colIndex });
        } else {
          indexes = [targetIndex];
          setRangeAnchor({ kind, rowIndex, colIndex });
        }
        return {
          elementIndex,
          elementPath,
          rowIndex,
          colIndex,
          kind,
          cells: [],
          rows: kind === "row" ? indexes : [],
          columns: kind === "column" ? indexes : [],
        };
      }

      // kind === "cell"
      let cells: TableCellCoord[];
      if (modifiers.shift && anchor) {
        const rowLo = Math.min(anchor.rowIndex, rowIndex);
        const rowHi = Math.max(anchor.rowIndex, rowIndex);
        const colLo = Math.min(anchor.colIndex, colIndex);
        const colHi = Math.max(anchor.colIndex, colIndex);
        cells = [];
        for (let r = rowLo; r <= rowHi; r++) {
          for (let c = colLo; c <= colHi; c++) cells.push({ rowIndex: r, colIndex: c });
        }
      } else if (modifiers.ctrl && sameKindSelection) {
        const map = new Map(
          sameKindSelection.cells.map((c) => [cellKey(c), c]),
        );
        const targetKey = cellKey({ rowIndex, colIndex });
        if (map.has(targetKey)) map.delete(targetKey);
        else map.set(targetKey, { rowIndex, colIndex });
        cells =
          map.size > 0 ? Array.from(map.values()) : [{ rowIndex, colIndex }];
        setRangeAnchor({ kind, rowIndex, colIndex });
      } else {
        cells = [{ rowIndex, colIndex }];
        setRangeAnchor({ kind, rowIndex, colIndex });
      }

      return {
        elementIndex,
        elementPath,
        rowIndex,
        colIndex,
        kind,
        cells,
        rows: uniqueSorted(cells.map((c) => c.rowIndex)),
        columns: uniqueSorted(cells.map((c) => c.colIndex)),
      };
    },
    [keyForSelection, rangeAnchor, selectedTableCell],
  );

  const clearTableCellSelection = useCallback(() => {
    setSelectedTableCell(null);
    setEditingTableCell(null);
    setRangeAnchor(null);
  }, []);

  const clearTableCellEditing = useCallback(() => {
    setEditingTableCell(null);
  }, []);

  const selectTableCellSelection = useCallback(
    (
      elementSelection: TElementSelection,
      rowIndex: number,
      colIndex: number,
      modifiers?: TableSelectModifiers,
    ) => {
      setEditingTableCell(null);
      setSelectedTableCell(
        buildCellSelection(elementSelection, rowIndex, colIndex, "cell", modifiers),
      );
    },
    [buildCellSelection],
  );

  const selectTableRow = useCallback(
    (
      elementSelection: TElementSelection,
      rowIndex: number,
      modifiers?: TableSelectModifiers,
    ) => {
      setEditingTableCell(null);
      setSelectedTableCell(
        buildCellSelection(elementSelection, rowIndex, 0, "row", modifiers),
      );
    },
    [buildCellSelection],
  );

  const selectTableColumn = useCallback(
    (
      elementSelection: TElementSelection,
      colIndex: number,
      modifiers?: TableSelectModifiers,
    ) => {
      setEditingTableCell(null);
      setSelectedTableCell(
        buildCellSelection(elementSelection, 0, colIndex, "column", modifiers),
      );
    },
    [buildCellSelection],
  );

  const editTableCellSelection = useCallback(
    (
      elementSelection: TElementSelection,
      rowIndex: number,
      colIndex: number,
    ) => {
      const nextSelection = buildCellSelection(
        elementSelection,
        rowIndex,
        colIndex,
        "cell",
      );
      setSelectedTableCell(nextSelection);
      setEditingTableCell(nextSelection);
      setRangeAnchor({ kind: "cell", rowIndex, colIndex });
    },
    [buildCellSelection],
  );

  const visibleSelectedTableCell = useMemo(
    () => (editingTableCell ? null : selectedTableCell),
    [editingTableCell, selectedTableCell],
  );

  return {
    clearTableCellEditing,
    clearTableCellSelection,
    editingTableCell,
    editTableCellSelection,
    selectTableRow,
    selectTableColumn,
    selectedTableCell,
    selectTableCellSelection,
    visibleSelectedTableCell,
  };
}
