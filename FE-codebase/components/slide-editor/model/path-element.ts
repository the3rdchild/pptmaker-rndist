// Shared reading of `path` elements: the geometry lives in its own coordinate
// space (`view_box`) and is scaled onto the element box, so every consumer —
// the Konva renderer, the .pptx exporter — needs the same two answers about
// which space it is in and how it maps onto the box.

import {
  asRecord,
  readNumber,
  readString,
  type RawElement,
} from "@/components/slide-editor/model/core";
import {
  fillColor,
  fillOpacity,
  strokeColor,
  strokeDash,
  strokeOpacity,
  strokeWidth,
  colorWithOpacity,
} from "@/components/slide-editor/model/render-style";

export type PathViewBox = { width: number; height: number };

export function readPathData(element: RawElement): string | null {
  const data = readString(element.d)?.trim();
  return data ? data : null;
}

/** The coordinate space `d` is authored in. Falls back to the element box,
 *  which makes an element whose path is already in element px render 1:1. */
export function readPathViewBox(element: RawElement, width: number, height: number): PathViewBox {
  const box = asRecord(element.view_box);
  const boxWidth = readNumber(box?.width);
  const boxHeight = readNumber(box?.height);
  return {
    width: boxWidth && boxWidth > 0 ? boxWidth : width || 1,
    height: boxHeight && boxHeight > 0 ? boxHeight : height || 1,
  };
}

export function readPathFillRule(element: RawElement): "nonzero" | "evenodd" {
  return readString(element.fill_rule) === "evenodd" ? "evenodd" : "nonzero";
}

/** The path rendered standalone, in the element's own px box. Used by the
 *  .pptx exporter: pptxgenjs cannot write custom geometry, so a path ships as
 *  an SVG picture — which PowerPoint 2016+, Keynote and Slides all render as
 *  the vector it is, rather than the shape being dropped from the export. */
export function pathElementToSvg(element: RawElement, width: number, height: number): string {
  const data = readPathData(element);
  if (!data) return "";
  const view = readPathViewBox(element, width, height);
  const fill = colorWithOpacity(fillColor(element.fill), fillOpacity(element.fill)) ?? "none";
  const stroke = colorWithOpacity(strokeColor(element.stroke), strokeOpacity(element.stroke));
  const lineWidth = strokeWidth(element.stroke);
  const dash = strokeDash(element.stroke);
  const strokeAttrs =
    stroke && lineWidth > 0
      ? ` stroke="${stroke}" stroke-width="${lineWidth}"${dash ? ` stroke-dasharray="${dash.join(" ")}"` : ""}` +
        // The viewBox scales non-uniformly onto the box; without this a stroke
        // on a wide, short path renders thick horizontally and thin vertically.
        ` vector-effect="non-scaling-stroke"`
      : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="0 0 ${view.width} ${view.height}" preserveAspectRatio="none">` +
    `<path d="${escapeXmlAttribute(data)}" fill="${fill}" fill-rule="${readPathFillRule(element)}"${strokeAttrs}/>` +
    `</svg>`
  );
}

export function pathElementToSvgDataUrl(
  element: RawElement,
  width: number,
  height: number,
): string | null {
  const svg = pathElementToSvg(element, width, height);
  if (!svg) return null;
  // MUST be base64, not percent-encoded: pptxgenjs rejects any `data:` image
  // whose string doesn't contain "base64," — it logs and returns null, which
  // silently drops the shape from the exported deck. Given a base64 SVG it
  // handles the rest itself (svg extension, the PNG fallback rel, and the
  // asvg:svgBlip that makes PowerPoint render the vector).
  return `data:image/svg+xml;base64,${encodeBase64(svg)}`;
}

/** btoa over UTF-8. btoa alone throws on any non-Latin-1 character, which a
 *  path element can carry through a colour name or an author's text. */
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
