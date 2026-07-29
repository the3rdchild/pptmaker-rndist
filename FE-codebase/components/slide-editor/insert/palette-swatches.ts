// Builds a palette swatch stack as real slide elements.
//
// A generated palette was previously a thing you could only sample one colour
// at a time from. Putting the whole set on the canvas is how you actually
// judge it — and, while authoring a template, it doubles as the colour key
// that stays with the design.

import {
  EDITOR_STAGE_HEIGHT,
  EDITOR_STAGE_WIDTH,
  type SlideElement,
} from "@/components/slide-editor/types";
import { parseHex, relativeLuminance } from "@/lib/templates/palette-engine";

const BAR_WIDTH = 560;
const BAR_HEIGHT = 40;
const BAR_GAP = 6;
const PADDING_X = 14;

/** Black or white, whichever the eye can actually read on this swatch. */
export function readableInkOn(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return "#111827";
  return relativeLuminance(rgb) > 0.45 ? "#111827" : "#FFFFFF";
}

function textElement(
  text: string,
  color: string,
  x: number,
  width: number,
  align: "left" | "right",
): SlideElement {
  return {
    type: "text",
    position: { x, y: Math.round((BAR_HEIGHT - 16) / 2) },
    size: { width, height: 16 },
    font: { family: "Poppins", size: 12, color, line_height: 1.2 },
    alignment: { horizontal: align, vertical: "middle" },
    runs: [{ text, font: { family: "Poppins", size: 12, color } }],
    decorative: true,
  } as SlideElement;
}

/**
 * One component per swatch: a coloured bar carrying its hex and a readable
 * name. Components rather than a single group so each row can be moved,
 * recoloured or deleted on its own.
 */
export function createPaletteSwatchComponents(
  colors: string[],
  nameOf: (hex: string) => string,
): Record<string, unknown>[] {
  const rows = colors.filter(Boolean);
  if (rows.length === 0) return [];

  const stackHeight = rows.length * BAR_HEIGHT + (rows.length - 1) * BAR_GAP;
  const originX = Math.round((EDITOR_STAGE_WIDTH - BAR_WIDTH) / 2);
  const originY = Math.round((EDITOR_STAGE_HEIGHT - stackHeight) / 2);
  const labelWidth = Math.round(BAR_WIDTH / 2) - PADDING_X;

  return rows.map((color, index) => {
    const ink = readableInkOn(color);
    return {
      id: `palette_swatch_${index + 1}`,
      description: `Palette swatch ${color}`,
      position: { x: originX, y: originY + index * (BAR_HEIGHT + BAR_GAP) },
      size: { width: BAR_WIDTH, height: BAR_HEIGHT },
      elements: [
        {
          type: "rectangle",
          position: { x: 0, y: 0 },
          size: { width: BAR_WIDTH, height: BAR_HEIGHT },
          fill: { color, opacity: 1 },
          border_radius: { tl: 6, tr: 6, bl: 6, br: 6 },
          decorative: true,
        } as SlideElement,
        textElement(color.toUpperCase(), ink, PADDING_X, labelWidth, "left"),
        textElement(
          nameOf(color),
          ink,
          BAR_WIDTH - PADDING_X - labelWidth,
          labelWidth,
          "right",
        ),
      ],
    };
  });
}
