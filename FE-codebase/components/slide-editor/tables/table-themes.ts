// Table style presets (PRD #17 "tema tabel"). Applying one repaints every
// cell's fill/border in one click instead of manually coloring each cell.

export type TableTheme = {
  id: string;
  label: string;
  headerFill: string;
  headerText: string;
  rowFill: string;
  altRowFill: string;
  border: string;
};

export const TABLE_THEMES: TableTheme[] = [
  {
    id: "violet",
    label: "Violet",
    headerFill: "#7C51F8",
    headerText: "#FFFFFF",
    rowFill: "#FFFFFF",
    altRowFill: "#F3F0FF",
    border: "#E4DEFB",
  },
  {
    id: "slate",
    label: "Slate",
    headerFill: "#1E293B",
    headerText: "#FFFFFF",
    rowFill: "#FFFFFF",
    altRowFill: "#F1F5F9",
    border: "#E2E8F0",
  },
  {
    id: "emerald",
    label: "Emerald",
    headerFill: "#059669",
    headerText: "#FFFFFF",
    rowFill: "#FFFFFF",
    altRowFill: "#ECFDF5",
    border: "#D1FAE5",
  },
  {
    id: "amber",
    label: "Amber",
    headerFill: "#D97706",
    headerText: "#FFFFFF",
    rowFill: "#FFFFFF",
    altRowFill: "#FFFBEB",
    border: "#FDE9C8",
  },
  {
    id: "rose",
    label: "Rose",
    headerFill: "#E11D48",
    headerText: "#FFFFFF",
    rowFill: "#FFFFFF",
    altRowFill: "#FFF1F2",
    border: "#FECDD3",
  },
  {
    id: "mono",
    label: "Minimal",
    headerFill: "#F4F4F5",
    headerText: "#18181B",
    rowFill: "#FFFFFF",
    altRowFill: "#FAFAFA",
    border: "#E4E4E7",
  },
];

type ThemeableCell = {
  color?: { color?: string | null } | null;
  stroke?: { color?: string | null; width?: number | null } | null;
  font?: { color?: string | null } | null;
};

function paintCell<T extends ThemeableCell>(cell: T, fill: string, border: string, textColor?: string): T {
  return {
    ...cell,
    color: { ...(cell.color ?? {}), color: fill },
    stroke: { ...(cell.stroke ?? {}), color: border, width: cell.stroke?.width ?? 1 },
    ...(textColor ? { font: { ...(cell.font ?? {}), color: textColor } } : {}),
  };
}

// Applies a theme to every cell of a table element (raw, permissive shape —
// callers pass the typed TableSlideElement which structurally matches).
export function applyTableTheme<
  T extends { columns: ThemeableCell[]; rows: ThemeableCell[][] },
>(element: T, theme: TableTheme): T {
  return {
    ...element,
    columns: element.columns.map((cell) => paintCell(cell, theme.headerFill, theme.border, theme.headerText)),
    rows: element.rows.map((row, rowIndex) =>
      row.map((cell) =>
        paintCell(cell, rowIndex % 2 === 0 ? theme.rowFill : theme.altRowFill, theme.border),
      ),
    ),
  };
}
