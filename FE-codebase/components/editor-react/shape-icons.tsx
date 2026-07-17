/**
 * Small local shape library (triangle/polygon/star/arrow/diamond) — no
 * external icon API. Path data lives in one place; `ShapePreview` renders it
 * for panel grids (monochrome, inherits button color), `shapeDataUri` bakes
 * the same path into a standalone SVG data URI used as the inserted
 * element's image `data` (self-contained, no network round-trip).
 */

export type ShapeKind =
  | "triangle"
  | "pentagon"
  | "hexagon"
  | "star"
  | "diamond"
  | "arrow-right"
  | "arrow-left"
  | "arrow-up"
  | "arrow-down";

export const SHAPE_PATHS: Record<ShapeKind, string> = {
  triangle: "M50 8 L92 88 L8 88 Z",
  pentagon: "M50 5 L95 38 L78 92 L22 92 L5 38 Z",
  hexagon: "M25 5 L75 5 L97 50 L75 95 L25 95 L3 50 Z",
  star: "M50 4 L61 37 L96 37 L68 58 L79 92 L50 72 L21 92 L32 58 L4 37 L39 37 Z",
  diamond: "M50 5 L95 50 L50 95 L5 50 Z",
  "arrow-right": "M8 38 H60 V22 L94 50 L60 78 V62 H8 Z",
  "arrow-left": "M92 38 H40 V22 L6 50 L40 78 V62 H92 Z",
  "arrow-up": "M38 92 V40 H22 L50 6 L78 40 H62 V92 Z",
  "arrow-down": "M38 8 V60 H22 L50 94 L78 60 H62 V8 Z",
};

export function ShapePreview({
  kind,
  size = 22,
  className,
}: {
  kind: ShapeKind;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      fill="currentColor"
    >
      <path d={SHAPE_PATHS[kind]} />
    </svg>
  );
}

export function shapeDataUri(kind: ShapeKind, fillHex = "#7A5AF8"): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${SHAPE_PATHS[kind]}" fill="${fillHex}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
