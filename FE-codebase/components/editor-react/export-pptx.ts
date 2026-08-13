"use client";

import pptxgen from "pptxgenjs";
import {
  layoutChildren,
  childArrayInfo,
  elementBox,
} from "@/components/slide-editor/model/model";
import type { RawElement, Box } from "@/components/slide-editor/model/core";
import { pathElementToSvgDataUrl } from "@/components/slide-editor/model/path-element";

// Presenton canvas is 1280x720 px. PptxGenJS 16:9 slide = 10x5.625 inches.
const SLIDE_W_PX = 1280;
const SLIDE_H_PX = 720;
const SLIDE_W_IN = 10;
const SLIDE_H_IN = 5.625;
const PX_TO_IN_X = SLIDE_W_IN / SLIDE_W_PX;
const PX_TO_IN_Y = SLIDE_H_IN / SLIDE_H_PX;

type Rec = Record<string, unknown>;

function asArray(v: unknown): Rec[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Rec[]) : [];
}

function num(v: unknown): number {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

function fillHex(fill: unknown): string | undefined {
  if (!fill || typeof fill !== "object") return undefined;
  const f = fill as Rec;
  const color = typeof f.color === "string" ? f.color.replace("#", "") : undefined;
  return color;
}

function fillAlpha(fill: unknown): number {
  if (!fill || typeof fill !== "object") return 1;
  const f = fill as Rec;
  return typeof f.opacity === "number" ? f.opacity : 1;
}

// pptxgenjs has no gradient fill support in this version (checked its type
// defs directly — ShapeFillProps is solid-color only) — a linear/radial
// backgroundStyle is approximated as the midpoint blend of its two colors
// rather than dropping the background entirely.
function blendHex(a: string, b: string): string {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  if (pa.length !== 6 || pb.length !== 6) return pa || pb;
  const mix = (i: number) => {
    const av = parseInt(pa.slice(i, i + 2), 16);
    const bv = parseInt(pb.slice(i, i + 2), 16);
    return Math.round((av + bv) / 2).toString(16).padStart(2, "0");
  };
  return `${mix(0)}${mix(2)}${mix(4)}`;
}

function resolveBackgroundHex(ui: Rec): string | undefined {
  const style = ui.backgroundStyle as Rec | undefined;
  if (style && typeof style === "object") {
    const from = typeof style.from === "string" ? style.from.replace("#", "") : undefined;
    const to = typeof style.to === "string" ? style.to.replace("#", "") : undefined;
    if (from && to && (style.type === "linear" || style.type === "radial")) {
      return blendHex(from, to);
    }
    if (from) return from;
  }
  return fillHex(ui.background);
}

function runsToText(runs: unknown): { text: string; opts: pptxgen.TextPropsOptions } {
  const arr = asArray(runs);
  if (arr.length === 0) {
    return { text: "", opts: {} };
  }
  let text = "";
  let fontSize = 18;
  let color = "333333";
  let bold = false;
  let italic = false;
  let underline = false;
  let fontFamily = "Arial";
  let letterSpacing: number | null = null;

  for (const run of arr) {
    text += typeof run.text === "string" ? run.text : "";
    const font = run.font as Rec | undefined;
    if (font) {
      if (typeof font.size === "number") fontSize = font.size;
      if (typeof font.color === "string") color = font.color.replace("#", "");
      if (font.bold) bold = true;
      if (font.italic) italic = true;
      if (font.underline) underline = true;
      if (typeof font.family === "string") fontFamily = font.family;
      if (typeof font.letter_spacing === "number") letterSpacing = font.letter_spacing;
    }
  }

  return {
    text,
    opts: {
      fontSize: Math.round((fontSize * PX_TO_IN_Y) * 72) / 72 || fontSize,
      color,
      bold,
      italic,
      underline: underline ? { style: "sng" as const } : undefined,
      fontFace: fontFamily,
      // charSpacing is in points — same px→pt factor as fontSize.
      charSpacing:
        letterSpacing != null && letterSpacing !== 0
          ? Math.round(letterSpacing * PX_TO_IN_Y * 72 * 100) / 100
          : undefined,
    },
  };
}

function alignToPptx(align: unknown): "left" | "center" | "right" | undefined {
  if (typeof align !== "string") return undefined;
  if (align.includes("center")) return "center";
  if (align.includes("right") || align.includes("end")) return "right";
  return "left";
}

// PowerPoint OOXML doesn't reliably support arbitrary SVG image embeds via
// pptxgenjs (its addImage expects a raster image or a data: URI it can
// re-encode) — a raw .svg path (icons searched from the local icon index,
// or template decorative assets) produced a corrupt file PowerPoint could
// only open by "repairing" and dropping the offending media. Real photos
// (data: URIs from image generation) are unaffected; only non-data-uri .svg
// paths are skipped here.
function isSafeImageSrc(src: string): boolean {
  if (src.startsWith("data:")) return true;
  return !src.toLowerCase().endsWith(".svg");
}

type PositionedElement = { el: Rec; x: number; y: number; w: number; h: number };

/** Walks one element and, if it's a container (children/child), every
 * descendant too — using the SAME layoutChildren/childArrayInfo engine the
 * real Konva renderer uses, so grid/flex "card" layouts (the majority of an
 * AI-generated deck's actual content) get their real computed positions
 * instead of being silently skipped. `offsetX`/`offsetY` is the parent's
 * already-accumulated absolute position; `box` is this element's own
 * position/size relative to that parent. */
function collectPositionedElements(
  element: Rec,
  box: Box,
  offsetX: number,
  offsetY: number,
  out: PositionedElement[],
): void {
  const x = offsetX + box.x;
  const y = offsetY + box.y;
  out.push({ el: element, x, y, w: box.width, h: box.height });

  const childInfo = childArrayInfo(element as RawElement);
  if (!childInfo) return;

  const laidOut = layoutChildren(element as RawElement, childInfo.items, box);
  for (const childLayout of laidOut) {
    const childBox = childLayout.box ?? elementBox(childLayout.child);
    collectPositionedElements(childLayout.child as Rec, childBox, x, y, out);
  }
}

export function exportToPptx(
  title: string,
  slides: { ui?: Record<string, unknown> | null | undefined }[]
) {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: "PPT16x9", width: SLIDE_W_IN, height: SLIDE_H_IN });
  pptx.layout = "PPT16x9";
  pptx.title = title;

  for (const slide of slides) {
    const ui = slide.ui as Rec | null | undefined;
    const s = pptx.addSlide();
    if (!ui) continue;

    const bgColor = resolveBackgroundHex(ui);
    if (bgColor) s.background = { color: bgColor };

    const components = asArray(ui.components);
    if (components.length === 0) continue;

    for (const comp of components) {
      const cPos = comp.position as Rec | undefined;
      const cSize = comp.size as Rec | undefined;
      const cx = num(cPos?.x);
      const cy = num(cPos?.y);
      const cw = num(cSize?.width);
      const ch = num(cSize?.height);

      const positioned: PositionedElement[] = [];
      for (const el of asArray(comp.elements)) {
        collectPositionedElements(el, elementBox(el as RawElement), cx, cy, positioned);
      }

      for (const { el, x: ex, y: ey, w: ew, h: eh } of positioned) {
        const type = el.type;

        if (type === "rectangle" || type === "rect") {
          s.addShape("rect" as pptxgen.ShapeType, {
            x: ex * PX_TO_IN_X,
            y: ey * PX_TO_IN_Y,
            w: ew * PX_TO_IN_X,
            h: eh * PX_TO_IN_Y,
            fill: fillHex(el.fill) ? { color: fillHex(el.fill)!, transparency: Math.round((1 - fillAlpha(el.fill)) * 100) } : undefined,
            line: el.stroke ? { color: fillHex(el.stroke) ?? "000000", width: num((el.stroke as Rec)?.width) * PX_TO_IN_X } : undefined,
            rotate: num(el.rotation) * (180 / Math.PI),
          });
        } else if (type === "ellipse") {
          s.addShape("ellipse" as pptxgen.ShapeType, {
            x: ex * PX_TO_IN_X,
            y: ey * PX_TO_IN_Y,
            w: ew * PX_TO_IN_X,
            h: eh * PX_TO_IN_Y,
            fill: fillHex(el.fill) ? { color: fillHex(el.fill)!, transparency: Math.round((1 - fillAlpha(el.fill)) * 100) } : undefined,
            line: el.stroke ? { color: fillHex(el.stroke) ?? "000000", width: num((el.stroke as Rec)?.width) * PX_TO_IN_X } : undefined,
          });
        } else if (type === "text") {
          const { text: txt, opts } = runsToText(el.runs);
          if (txt.trim()) {
            s.addText(txt, {
              x: ex * PX_TO_IN_X,
              y: ey * PX_TO_IN_Y,
              w: ew * PX_TO_IN_X,
              h: eh * PX_TO_IN_Y,
              align: alignToPptx(el.align),
              valign: "top" as const,
              ...opts,
            });
          }
        } else if (type === "text-list") {
          const items = asArray(el.items);
          const bulletText = items
            .map((it) => {
              const { text: t } = runsToText(it.runs);
              return t;
            })
            .filter(Boolean)
            .join("\n");
          if (bulletText) {
            s.addText(bulletText, {
              x: ex * PX_TO_IN_X,
              y: ey * PX_TO_IN_Y,
              w: ew * PX_TO_IN_X,
              h: eh * PX_TO_IN_Y,
              bullet: true,
              valign: "top" as const,
              fontSize: 14,
              color: "333333",
            });
          }
        } else if (type === "image") {
          const src = typeof el.data === "string" ? el.data : "";
          if (src && isSafeImageSrc(src)) {
            s.addImage({
              data: src.startsWith("data:") ? src : undefined,
              path: src.startsWith("data:") ? undefined : src,
              x: ex * PX_TO_IN_X,
              y: ey * PX_TO_IN_Y,
              w: ew * PX_TO_IN_X,
              h: eh * PX_TO_IN_Y,
            });
          }
        } else if (type === "path") {
          // pptxgenjs cannot write custom geometry, so a freeform ships as an
          // SVG picture rather than being dropped from the export or flattened
          // to its bounding rectangle. PowerPoint 2016+, Keynote and Slides
          // all render it as the vector it is.
          const svg = pathElementToSvgDataUrl(el as RawElement, ew, eh);
          if (svg) {
            s.addImage({
              data: svg,
              x: ex * PX_TO_IN_X,
              y: ey * PX_TO_IN_Y,
              w: ew * PX_TO_IN_X,
              h: eh * PX_TO_IN_Y,
            });
          }
        } else if (type === "line") {
          const start = el.start as Rec | undefined;
          const end = el.end as Rec | undefined;
          const sx = ex + num(start?.x);
          const sy = ey + num(start?.y);
          const tx = ex + num(end?.x);
          const ty = ey + num(end?.y);
          s.addShape("line" as pptxgen.ShapeType, {
            x: Math.min(sx, tx) * PX_TO_IN_X,
            y: Math.min(sy, ty) * PX_TO_IN_Y,
            w: Math.abs(tx - sx) * PX_TO_IN_X,
            h: Math.abs(ty - sy) * PX_TO_IN_Y,
            line: { color: fillHex(el.stroke) ?? "333333", width: num((el.stroke as Rec)?.width) * PX_TO_IN_X || 0.02 },
          });
        }
      }

      void cw;
      void ch;
    }
  }

  return pptx.write({ outputType: "blob" }) as Promise<Blob>;
}
