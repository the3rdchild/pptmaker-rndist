// Vector contour morphs for simple authored shapes. Both endpoints are sampled
// around their visible outline, then the same points travel together. This
// changes the actual stroke silhouette instead of scaling a frozen bitmap.
import { colorWithOpacity, fillColor, fillOpacity, strokeColor, strokeOpacity, strokeWidth } from "@/components/slide-editor/model/render-style";
import type { RawElement } from "@/components/slide-editor/model/core";

export type ContourPoint = { x: number; y: number };
export type ShapePaint = { fill: string; stroke: string; strokeWidth: number };
export type ShapeMorphPlan = {
  from: ContourPoint[];
  to: ContourPoint[];
  fromPaint: ShapePaint;
  toPaint: ShapePaint;
};

const SAMPLES = 96;
const SVG_NS = "http://www.w3.org/2000/svg";

function radii(element: RawElement, width: number, height: number): [number, number, number, number] {
  const raw = element.border_radius ?? element.borderRadius;
  let values: number[];
  if (typeof raw === "number") values = [raw, raw, raw, raw];
  else if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    const all = typeof value.radius === "number" ? value.radius : 0;
    values = [value.tl, value.tr, value.br, value.bl].map((corner) => typeof corner === "number" ? corner : all);
  } else values = [0, 0, 0, 0];
  const max = Math.min(width, height) / 2;
  return values.map((value) => Math.min(max, Math.max(0, value))) as [number, number, number, number];
}

export function shapePathSpec(element: RawElement): { d: string; width: number; height: number } | null {
  const width = element.size?.width ?? 0;
  const height = element.size?.height ?? 0;
  if (!(width > 0 && height > 0)) return null;
  if (element.type === "rectangle") {
    const [tl, tr, br, bl] = radii(element, width, height);
    return {
      d: `M ${tl} 0 H ${width - tr} Q ${width} 0 ${width} ${tr} V ${height - br} Q ${width} ${height} ${width - br} ${height} H ${bl} Q 0 ${height} 0 ${height - bl} V ${tl} Q 0 0 ${tl} 0 Z`,
      width, height,
    };
  }
  if (element.type === "ellipse") {
    const rx = width / 2;
    const ry = height / 2;
    return { d: `M ${rx} 0 A ${rx} ${ry} 0 1 1 ${rx} ${height} A ${rx} ${ry} 0 1 1 ${rx} 0 Z`, width, height };
  }
  if (element.type === "path" && typeof element.d === "string" && element.d.trim()) {
    // Multiple disjoint rings need topology matching; keep their normal slide
    // crossfade rather than joining separate contours with a spurious stroke.
    if ((element.d.match(/[Mm]/g) ?? []).length > 1) return null;
    const view = element.view_box as { width?: number; height?: number } | undefined;
    return { d: element.d, width: view?.width || width, height: view?.height || height };
  }
  if (element.type === "line") return { d: `M 0 0 L ${width} ${height} L 0 0 Z`, width, height };
  return null;
}

function contour(spec: { d: string; width: number; height: number }): ContourPoint[] | null {
  if (typeof document === "undefined") return null;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", spec.d);
  let length: number;
  try { length = path.getTotalLength(); } catch { return null; }
  if (!(length > 0)) return null;
  return Array.from({ length: SAMPLES }, (_, index) => {
    const point = path.getPointAtLength(index * length / SAMPLES);
    return { x: point.x / spec.width, y: point.y / spec.height };
  });
}

function alignContour(from: ContourPoint[], to: ContourPoint[]): ContourPoint[] {
  let bestCost = Infinity;
  let bestShift = 0;
  let bestDirection = 1;
  for (const direction of [1, -1]) {
    for (let shift = 0; shift < to.length; shift += 1) {
      let cost = 0;
      for (let index = 0; index < from.length; index += 1) {
        const target = to[(shift + direction * index + to.length * 2) % to.length];
        cost += (from[index].x - target.x) ** 2 + (from[index].y - target.y) ** 2;
      }
      if (cost < bestCost) { bestCost = cost; bestShift = shift; bestDirection = direction; }
    }
  }
  return from.map((_, index) => to[(bestShift + bestDirection * index + to.length * 2) % to.length]);
}

function paint(element: RawElement): ShapePaint | null {
  const fill = element.fill as { type?: string } | undefined;
  if (fill?.type && fill.type !== "solid") return null;
  return {
    fill: colorWithOpacity(fillColor(element.fill), fillOpacity(element.fill)) ?? "none",
    stroke: colorWithOpacity(strokeColor(element.stroke), strokeOpacity(element.stroke)) ?? "none",
    strokeWidth: strokeWidth(element.stroke),
  };
}

export function shapeMorphPlan(source: RawElement | null | undefined, target: RawElement | null | undefined): ShapeMorphPlan | null {
  if (!source || !target) return null;
  const fromSpec = shapePathSpec(source);
  const toSpec = shapePathSpec(target);
  const fromPaint = paint(source);
  const toPaint = paint(target);
  if (!fromSpec || !toSpec || !fromPaint || !toPaint) return null;
  const from = contour(fromSpec);
  const to = contour(toSpec);
  if (!from || !to) return null;
  return { from, to: alignContour(from, to), fromPaint, toPaint };
}

// Photos have a rectangular (possibly rounded) viewport. Treat that viewport
// as a contour endpoint when the other side is a shape, so the photo reveal
// follows the moving silhouette instead of fading in as a full rectangle.
export function shapeImageMorphPlan(source: RawElement | null | undefined, target: RawElement | null | undefined): ShapeMorphPlan | null {
  if (!source || !target || (source.type === "image") === (target.type === "image")) return null;
  const viewport = (element: RawElement): RawElement => element.type !== "image" ? element : {
    type: "rectangle",
    position: element.position,
    size: element.size,
    border_radius: element.border_radius ?? element.borderRadius ?? 0,
    fill: null,
    stroke: null,
  };
  return shapeMorphPlan(viewport(source), viewport(target));
}

export function contourPolygonAt(from: ContourPoint[], to: ContourPoint[], progress: number): string {
  const t = Math.max(0, Math.min(1, progress));
  return `polygon(${from.map((point, index) => {
    const target = to[index];
    return `${((point.x + (target.x - point.x) * t) * 100).toFixed(3)}% ${((point.y + (target.y - point.y) * t) * 100).toFixed(3)}%`;
  }).join(", ")})`;
}

export function contourPathAt(from: ContourPoint[], to: ContourPoint[], progress: number): string {
  const t = Math.max(0, Math.min(1, progress));
  const rounded = (value: number) => Number((value * 1000).toFixed(3));
  return from.map((point, index) => {
    const target = to[index];
    const x = rounded(point.x + (target.x - point.x) * t);
    const y = rounded(point.y + (target.y - point.y) * t);
    return `${index === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ") + " Z";
}
