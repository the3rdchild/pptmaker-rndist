// Applies a GeneratedPalette (see color-theory.ts) to an AI-generated
// slide's `ui`, explicitly, by role — not the old "recolor every rectangle
// proportionally to its own lightness" heuristic. Classification happens
// per TOP-LEVEL element within each component (a plain title sitting on the
// page background is one unit; a 4-card feature grid is a separate unit),
// matching how ai-layout-fill.ts's own walkElement() already reasons about
// "item slots" — so a title next to a colored card grid in the same
// component doesn't get miscolored just because its sibling has a shape.

import { hexLightness } from "@/components/slide-editor/utils/extract-image-colors";
import { contrastColor, type GeneratedPalette } from "@/components/slide-editor/utils/color-theory";

type Rec = Record<string, unknown>;

const NEAR_BLACK_LIGHTNESS = 0.15;
const NEAR_WHITE_LIGHTNESS = 0.92;

export interface IconCounter {
  current: number;
}

/** Rotates the deck's scheme colors across sibling cards. Shared/mutated
 * across the WHOLE deck (like IconCounter) so consecutive slides don't all
 * start their card grids on the same color. */
export interface ShapeCounter {
  current: number;
}

function isCardGrid(el: Rec): boolean {
  return (
    (el.type === "grid" || el.type === "flex") &&
    Array.isArray(el.children) &&
    (el.children as Rec[]).length > 1
  );
}

function isTextLike(type: unknown): boolean {
  return type === "text" || type === "text-list";
}

function isIconElement(el: Rec): boolean {
  return el.type === "image" && el.is_icon === true;
}

function classifyRect(el: Rec): "background" | "shape" | null {
  if (el.type !== "rectangle") return null;
  const fill = (el.fill as { color?: string } | undefined) ?? {};
  if (!fill.color) return null;
  const lightness = hexLightness(fill.color);
  if (lightness >= NEAR_WHITE_LIGHTNESS) return "background";
  if (lightness > NEAR_BLACK_LIGHTNESS) return "shape";
  return null;
}

function walkForClassification(el: Rec): { hasBackground: boolean; hasShape: boolean } {
  const own = classifyRect(el);
  let hasBackground = own === "background";
  let hasShape = own === "shape";

  const children = Array.isArray(el.children) ? (el.children as Rec[]) : [];
  for (const child of children) {
    const r = walkForClassification(child);
    hasBackground = hasBackground || r.hasBackground;
    hasShape = hasShape || r.hasShape;
  }
  if (el.child && typeof el.child === "object") {
    const r = walkForClassification(el.child as Rec);
    hasBackground = hasBackground || r.hasBackground;
    hasShape = hasShape || r.hasShape;
  }
  return { hasBackground, hasShape };
}

function recolorTextRuns(runs: unknown, color: string): unknown {
  if (!Array.isArray(runs)) return runs;
  return runs.map((run) => {
    if (typeof run !== "object" || run === null) return run;
    const r = run as Rec;
    return { ...r, font: { ...((r.font as Rec | undefined) ?? {}), color } };
  });
}

function recolorTextElement(el: Rec, color: string): Rec {
  let next = el;
  if (Array.isArray(next.runs)) {
    next = { ...next, runs: recolorTextRuns(next.runs, color) };
  }
  if (Array.isArray(next.items)) {
    next = {
      ...next,
      items: (next.items as unknown[]).map((line) => recolorTextRuns(line, color)),
    };
  }
  if (next.font && typeof next.font === "object") {
    next = { ...next, font: { ...(next.font as Rec), color } };
  }
  return next;
}

function recolorTree(
  el: Rec,
  palette: GeneratedPalette,
  shapeColor: string,
  textColor: string,
  iconCounter: IconCounter,
  shapeCounter: ShapeCounter,
): Rec {
  let next = el;

  const rectRole = classifyRect(next);
  if (rectRole === "background") {
    // Made transparent, not recolored — the actual background comes from
    // ui.backgroundStyle (a gradient) set once in applyPaletteToUi below,
    // which renders in its own Konva layer beneath every component. A flat
    // recolor here would just paint over that gradient.
    const fill = (next.fill as Rec | undefined) ?? {};
    next = { ...next, fill: { ...fill, opacity: 0 } };
  } else if (rectRole === "shape") {
    const fill = (next.fill as Rec | undefined) ?? {};
    next = { ...next, fill: { ...fill, color: shapeColor } };
  } else if (isTextLike(next.type)) {
    next = recolorTextElement(next, textColor);
  } else if (isIconElement(next)) {
    const hue = palette.iconHues[iconCounter.current % palette.iconHues.length];
    iconCounter.current += 1;
    next = { ...next, color: hue };
  }

  // A card grid: give each sibling card its own scheme color (and matching
  // contrast text) so a feature row reads as a designed set rather than a wall
  // of one accent tone. Non-grid subtrees keep the inherited shapeColor.
  if (isCardGrid(next)) {
    next = {
      ...next,
      children: (next.children as Rec[]).map((card) => {
        const cardShape = palette.shapes[shapeCounter.current % palette.shapes.length];
        shapeCounter.current += 1;
        const cls = walkForClassification(card);
        const cardText = cls.hasShape ? contrastColor(cardShape) : palette.textOnBackground;
        return recolorTree(card, palette, cardShape, cardText, iconCounter, shapeCounter);
      }),
    };
    return next;
  }

  if (Array.isArray(next.children)) {
    next = {
      ...next,
      children: (next.children as Rec[]).map((child) =>
        recolorTree(child, palette, shapeColor, textColor, iconCounter, shapeCounter),
      ),
    };
  }
  if (next.child && typeof next.child === "object") {
    next = {
      ...next,
      child: recolorTree(next.child as Rec, palette, shapeColor, textColor, iconCounter, shapeCounter),
    };
  }

  return next;
}

export function applyPaletteToUi(
  ui: Rec | null | undefined,
  palette: GeneratedPalette,
  iconCounter: IconCounter = { current: 0 },
  shapeCounter: ShapeCounter = { current: 0 },
): Rec | null | undefined {
  const components = Array.isArray(ui?.components) ? (ui!.components as Rec[]) : null;
  if (!components) return ui;

  let foundBackgroundRect = false;
  const nextComponents = components.map((component) => {
    const elements = Array.isArray(component.elements) ? (component.elements as Rec[]) : [];
    const nextElements = elements.map((el) => {
      const classification = walkForClassification(el);
      if (classification.hasBackground) foundBackgroundRect = true;
      const textColor = classification.hasShape ? palette.textOnShape : palette.textOnBackground;
      return recolorTree(el, palette, palette.shape, textColor, iconCounter, shapeCounter);
    });
    return { ...component, elements: nextElements };
  });

  const next: Rec = { ...ui, components: nextComponents };
  if (foundBackgroundRect) {
    next.backgroundStyle = {
      type: "linear",
      from: palette.shape,
      to: palette.background,
      angle: 135,
      pattern: "dots",
    };
  }
  return next;
}
