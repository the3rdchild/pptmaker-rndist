"use client";

import pptxgen from "pptxgenjs";

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
    },
  };
}

function alignToPptx(align: unknown): "left" | "center" | "right" | undefined {
  if (typeof align !== "string") return undefined;
  if (align.includes("center")) return "center";
  if (align.includes("right") || align.includes("end")) return "right";
  return "left";
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

    // Background
    const bgColor = fillHex(ui.background);
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
      const elements = asArray(comp.elements);

      for (const el of elements) {
        const type = el.type;
        const ePos = el.position as Rec | undefined;
        const eSize = el.size as Rec | undefined;
        const ex = cx + num(ePos?.x);
        const ey = cy + num(ePos?.y);
        const ew = num(eSize?.width);
        const eh = num(eSize?.height);

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
          if (src) {
            s.addImage({
              data: src.startsWith("data:") ? src : undefined,
              path: src.startsWith("data:") ? undefined : src,
              x: ex * PX_TO_IN_X,
              y: ey * PX_TO_IN_Y,
              w: ew * PX_TO_IN_X,
              h: eh * PX_TO_IN_Y,
            });
          }
        } else if (type === "line") {
          const start = el.start as Rec | undefined;
          const end = el.end as Rec | undefined;
          const sx = cx + num(start?.x);
          const sy = cy + num(start?.y);
          const tx = cx + num(end?.x);
          const ty = cy + num(end?.y);
          s.addShape("line" as pptxgen.ShapeType, {
            x: Math.min(sx, tx) * PX_TO_IN_X,
            y: Math.min(sy, ty) * PX_TO_IN_Y,
            w: Math.abs(tx - sx) * PX_TO_IN_X,
            h: Math.abs(ty - sy) * PX_TO_IN_Y,
            line: { color: fillHex(el.stroke) ?? "333333", width: num((el.stroke as Rec)?.width) * PX_TO_IN_X || 0.02 },
          });
        }
      }
    }
  }

  return pptx.write({ outputType: "blob" }) as Promise<Blob>;
}
