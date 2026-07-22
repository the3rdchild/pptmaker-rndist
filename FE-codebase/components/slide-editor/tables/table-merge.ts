// Merge Cells (PRD #17 remainder). Framework-agnostic on purpose — used both by
// the Konva renderer (TemplateV2TableElement) and the toolbar (TableToolbar),
// neither of which should have to import the other's concerns.
//
// Grid shape never changes: merging never removes array entries, it only marks
// the top-left cell of the selected rectangle with colSpan/rowSpan > 1. Every
// other position the merge covers stays in the array untouched (so colCount/
// rowCount derived elsewhere from row lengths keep working) — renderers just
// skip drawing those covered positions and redirect their clicks to the anchor.

export type MergeCoord = { rowIndex: number; colIndex: number };
export type MergeableCell = { colSpan?: number | null; rowSpan?: number | null };

/** Map of "row:col" -> anchor coord, for every grid position covered by some
 * OTHER cell's merge (the anchor itself is not included as covering itself). */
export function computeMergedCoverage<T extends MergeableCell>(
  rows: (T | undefined)[][],
): Map<string, MergeCoord> {
  const covered = new Map<string, MergeCoord>();
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const rowSpan = Math.max(1, cell?.rowSpan ?? 1);
      const colSpan = Math.max(1, cell?.colSpan ?? 1);
      if (rowSpan <= 1 && colSpan <= 1) return;
      for (let r = rowIndex; r < rowIndex + rowSpan; r++) {
        for (let c = colIndex; c < colIndex + colSpan; c++) {
          if (r === rowIndex && c === colIndex) continue;
          covered.set(`${r}:${c}`, { rowIndex, colIndex });
        }
      }
    });
  });
  return covered;
}

/** True only when `cells` is an exact solid rectangle (no gaps) and every cell
 * in it is a "virgin" 1x1 position — not itself a merge anchor, and not covered
 * by some other merge that reaches in from outside the selection. Merging
 * already-merged cells together isn't supported; unmerge first. */
export function canMergeCells<T extends MergeableCell>(
  rows: (T | undefined)[][],
  cells: MergeCoord[],
): boolean {
  if (cells.length < 2) return false;
  const rowIndexes = cells.map((c) => c.rowIndex);
  const colIndexes = cells.map((c) => c.colIndex);
  const rowLo = Math.min(...rowIndexes);
  const rowHi = Math.max(...rowIndexes);
  const colLo = Math.min(...colIndexes);
  const colHi = Math.max(...colIndexes);
  const expectedCount = (rowHi - rowLo + 1) * (colHi - colLo + 1);
  if (expectedCount !== cells.length) return false;

  const covered = computeMergedCoverage(rows);
  for (const { rowIndex, colIndex } of cells) {
    const cell = rows[rowIndex]?.[colIndex];
    const rowSpan = Math.max(1, cell?.rowSpan ?? 1);
    const colSpan = Math.max(1, cell?.colSpan ?? 1);
    if (rowSpan > 1 || colSpan > 1) return false;
    if (covered.has(`${rowIndex}:${colIndex}`)) return false;
  }
  return true;
}

export function mergeCellsRectangle<T extends MergeableCell>(
  rows: T[][],
  cells: MergeCoord[],
  makeAnchor: (cell: T, rowSpan: number, colSpan: number) => T,
): T[][] {
  const rowIndexes = cells.map((c) => c.rowIndex);
  const colIndexes = cells.map((c) => c.colIndex);
  const rowLo = Math.min(...rowIndexes);
  const rowHi = Math.max(...rowIndexes);
  const colLo = Math.min(...colIndexes);
  const colHi = Math.max(...colIndexes);
  const rowSpan = rowHi - rowLo + 1;
  const colSpan = colHi - colLo + 1;
  return rows.map((row, rowIndex) =>
    row.map((cell, colIndex) =>
      rowIndex === rowLo && colIndex === colLo
        ? makeAnchor(cell, rowSpan, colSpan)
        : cell,
    ),
  );
}

export function unmergeCellAt<T extends MergeableCell>(
  rows: T[][],
  anchor: MergeCoord,
  makeUnmerged: (cell: T) => T,
): T[][] {
  return rows.map((row, rowIndex) =>
    row.map((cell, colIndex) =>
      rowIndex === anchor.rowIndex && colIndex === anchor.colIndex
        ? makeUnmerged(cell)
        : cell,
    ),
  );
}

/** Effective (colSpan, rowSpan) for a cell, clamped so a stale/oversized span
 * (e.g. after a column was deleted) never reads past the grid edges. */
export function effectiveSpan<T extends MergeableCell>(
  cell: T | undefined,
  rowIndex: number,
  colIndex: number,
  rowCount: number,
  colCount: number,
): { rowSpan: number; colSpan: number } {
  const rowSpan = Math.max(1, Math.min(cell?.rowSpan ?? 1, rowCount - rowIndex));
  const colSpan = Math.max(1, Math.min(cell?.colSpan ?? 1, colCount - colIndex));
  return { rowSpan, colSpan };
}
