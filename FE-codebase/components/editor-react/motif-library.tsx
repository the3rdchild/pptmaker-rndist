/**
 * Motif library — art-directed infographic "recipes" composed from existing
 * primitives (rectangle/ellipse/line/text/image), following the same
 * component shape as createImageInsertContent's "image-text"/"image-grid"
 * entries: one positioned box (TemplateV2InsertComponent) whose children sit
 * at relative coordinates. Inserted as ONE atomic, movable unit, but every
 * child (label text, description text) stays independently selectable and
 * editable once placed on the canvas — unlike a flattened raster/vector
 * blob, nothing here is baked together.
 *
 * `colors` lets callers (deck-generation pipeline, per-slide regen) bake in
 * the deck's generated palette instead of the static defaults used when a
 * user inserts a motif manually from the panel.
 */
import type { TemplateV2InsertComponent } from "@/components/slide-editor/events/events";
import { shapeDataUri } from "@/components/editor-react/shape-icons";
import type { Font, SlideElement } from "@/components/slide-editor/types";

export interface MotifColors {
  accent: string;
  accentSecondary?: string;
  text: string;
  textMuted: string;
}

const DEFAULT_COLORS: MotifColors = {
  accent: "#7A5AF8",
  accentSecondary: "#F59E0B",
  text: "#101323",
  textMuted: "#667085",
};

function withColors(colors?: Partial<MotifColors>): MotifColors {
  return { ...DEFAULT_COLORS, ...colors };
}

function polarPoint(cx: number, cy: number, r: number, angleDeg: number) {
  // 0deg = 12 o'clock, clockwise — matches a clock/gauge face.
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function textEl(opts: {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  horizontal?: "left" | "center" | "right";
  lineHeight?: number;
}): SlideElement {
  const font: Font = {
    family: "Inter",
    size: opts.size,
    color: opts.color,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    line_height: opts.lineHeight ?? 1.25,
  };
  return {
    type: "text",
    position: { x: opts.x, y: opts.y },
    size: { width: opts.width, height: opts.height },
    alignment: { horizontal: opts.horizontal ?? "left", vertical: "top" },
    runs: [{ text: opts.text, font }],
    font,
  };
}

function lineEl(x1: number, y1: number, x2: number, y2: number, color: string, width = 1.5, dash?: number[]): SlideElement {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  return {
    type: "line",
    position: { x: left, y: top },
    size: { width: Math.max(1, Math.abs(x2 - x1)), height: Math.max(1, Math.abs(y2 - y1)) },
    stroke: { color, width, ...(dash ? { dash } : {}) },
  };
}

function tickEl(cx: number, cy: number, r: number, angleDeg: number, length: number, color: string): SlideElement {
  const outer = polarPoint(cx, cy, r, angleDeg);
  const inner = polarPoint(cx, cy, r - length, angleDeg);
  return lineEl(inner.x, inner.y, outer.x, outer.y, color, 2);
}

/* ------------------------------ Radial gauge ----------------------------- */

export function buildRadialGaugeMotif(colors?: Partial<MotifColors>): TemplateV2InsertComponent {
  const c = withColors(colors);
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const ringRadius = 150;

  const elements: SlideElement[] = [
    // Outer ring
    {
      type: "ellipse",
      position: { x: cx - ringRadius, y: cy - ringRadius },
      size: { width: ringRadius * 2, height: ringRadius * 2 },
      fill: { color: "transparent", opacity: 0 },
      stroke: { color: c.accent, width: 3 },
    },
    // Ticks every 30deg (clock-style, 12 marks)
    ...Array.from({ length: 12 }, (_, i) => tickEl(cx, cy, ringRadius, i * 30, 14, c.accent)),
    // Center icon placeholder (recolorable via the image toolbar)
    {
      type: "image",
      position: { x: cx - 36, y: cy - 36 },
      size: { width: 72, height: 72 },
      data: shapeDataUri("hexagon", c.accent),
      fit: "contain",
      name: "gauge-icon",
    },
    // Callout 1 — upper-left
    lineEl(cx - ringRadius * 0.55, cy - ringRadius * 0.55, 4, 74, c.accent, 1.5),
    textEl({ x: 0, y: 40, width: 190, height: 30, text: "9–14 Kg", size: 20, color: c.text, bold: true }),
    textEl({ x: 0, y: 68, width: 190, height: 60, text: "Short description of this data point.", size: 13, color: c.textMuted, lineHeight: 1.3 }),
    // Callout 2 — right
    lineEl(cx + ringRadius * 0.85, cy, size - 4, cy, c.accent, 1.5),
    textEl({ x: size - 190, y: cy - 30, width: 190, height: 30, text: "14 Jam Sehari", size: 20, color: c.text, bold: true }),
    textEl({ x: size - 190, y: cy - 2, width: 190, height: 60, text: "Short description of this data point.", size: 13, color: c.textMuted, lineHeight: 1.3 }),
    // Callout 3 — lower-left
    lineEl(cx - ringRadius * 0.55, cy + ringRadius * 0.55, 4, size - 74, c.accent, 1.5),
    textEl({ x: 0, y: size - 100, width: 190, height: 30, text: "Siklus Pembuangan", size: 20, color: c.text, bold: true }),
    textEl({ x: 0, y: size - 72, width: 190, height: 60, text: "Short description of this data point.", size: 13, color: c.textMuted, lineHeight: 1.3 }),
  ];

  return {
    id: "motif_radial_gauge",
    description: "Radial gauge with labeled callouts",
    position: { x: 300, y: 100 },
    size: { width: size, height: size },
    elements,
  };
}

/* --------------------------- Leader-line callout -------------------------- */

export function buildLeaderCalloutMotif(colors?: Partial<MotifColors>): TemplateV2InsertComponent {
  const c = withColors(colors);
  const width = 900;
  const height = 460;
  const frameX = 480;
  const frameW = width - frameX;

  const labels = [
    { title: "Bukan Jari Sejati", y: 20 },
    { title: "Tulang Sesamoid Radial", y: 190 },
    { title: "Bantalan Berdaging", y: 360 },
  ];

  const elements: SlideElement[] = [
    // Image placeholder frame — where the generated hero image drops in later.
    {
      type: "rectangle",
      position: { x: frameX, y: 0 },
      size: { width: frameW, height },
      fill: { color: c.textMuted, opacity: 0.08 },
      stroke: { color: c.accent, width: 1.5 },
      border_radius: { tl: 12, tr: 12, bl: 12, br: 12 },
    },
  ];

  labels.forEach((label, i) => {
    const anchorY = 40 + i * 170;
    elements.push(
      textEl({ x: 0, y: label.y, width: frameX - 40, height: 30, text: label.title, size: 20, color: c.text, bold: true }),
      textEl({
        x: 0,
        y: label.y + 32,
        width: frameX - 40,
        height: 70,
        text: "Explain this labeled point — what it is and why it matters.",
        size: 13,
        color: c.textMuted,
        lineHeight: 1.35,
      }),
      lineEl(frameX - 30, anchorY, frameX, anchorY, c.accent, 1.5, [4, 4]),
    );
  });

  return {
    id: "motif_leader_callout",
    description: "Leader-line labeled callout with image frame",
    position: { x: 190, y: 130 },
    size: { width, height },
    elements,
  };
}

/* ---------------------------- Corner-bracket frame ------------------------ */

export function buildBracketFrameMotif(colors?: Partial<MotifColors>): TemplateV2InsertComponent {
  const c = withColors(colors);
  const width = 520;
  const height = 320;
  const armLength = 32;
  const strokeWidth = 3;

  const corners: Array<[number, number, number, number]> = [
    [0, 0, 1, 1], // top-left: arms go right + down
    [width, 0, -1, 1], // top-right
    [0, height, 1, -1], // bottom-left
    [width, height, -1, -1], // bottom-right
  ];

  const elements: SlideElement[] = corners.flatMap(([x, y, dx, dy]) => [
    lineEl(x, y, x + dx * armLength, y, c.accent, strokeWidth),
    lineEl(x, y, x, y + dy * armLength, c.accent, strokeWidth),
  ]);

  return {
    id: "motif_bracket_frame",
    description: "Corner-bracket frame (blueprint-style)",
    position: { x: 380, y: 200 },
    size: { width, height },
    elements,
  };
}

/* ------------------------------ Big-stat block ----------------------------- */

export function buildBigStatMotif(colors?: Partial<MotifColors>): TemplateV2InsertComponent {
  const c = withColors(colors);
  const width = 280;
  const height = 170;

  const elements: SlideElement[] = [
    textEl({ x: 0, y: 0, width, height: 84, text: "84%", size: 64, color: c.accent, bold: true }),
    {
      type: "rectangle",
      position: { x: 2, y: 92 },
      size: { width: 44, height: 4 },
      fill: { color: c.accentSecondary ?? c.accent, opacity: 1 },
      border_radius: { tl: 2, tr: 2, bl: 2, br: 2 },
    },
    textEl({ x: 0, y: 108, width, height: 56, text: "Metric label goes here", size: 16, color: c.textMuted, lineHeight: 1.3 }),
  ];

  return {
    id: "motif_big_stat",
    description: "Big stat number with label",
    position: { x: 500, y: 280 },
    size: { width, height },
    elements,
  };
}

export type MotifKey = "radial-gauge" | "leader-callout" | "bracket-frame" | "big-stat";

export const MOTIF_BUILDERS: Record<MotifKey, (colors?: Partial<MotifColors>) => TemplateV2InsertComponent> = {
  "radial-gauge": buildRadialGaugeMotif,
  "leader-callout": buildLeaderCalloutMotif,
  "bracket-frame": buildBracketFrameMotif,
  "big-stat": buildBigStatMotif,
};
