// A shape's frame: its box (position/size, converted from EMU to canvas px
// through the deck's geometry + the node's composed group transform),
// rotation and flip — as opposed to its outline geometry (pptx-geometry.ts)
// or paint (pptx-color.ts).

import { asRecord } from "@/components/slide-editor/model/core";
import { readAttrBoolean, readAttrNumber } from "@/components/slide-editor/importing/pptx-xml-read";
import {
  type Box,
  type GeoContext,
  type NodeTransform,
  type Rec,
} from "@/components/slide-editor/importing/pptx-context";

export function emuToPx(emu: number, geo: GeoContext, transform: NodeTransform, axis: "x" | "y"): number {
  const composed = axis === "x" ? emu * transform.scaleX + transform.offX : emu * transform.scaleY + transform.offY;
  return axis === "x" ? geo.offsetPxX + composed * geo.scale : geo.offsetPxY + composed * geo.scale;
}

export function shapeBox(spPr: Rec | null, geo: GeoContext, transform: NodeTransform): Box | null {
  const xfrm = asRecord(spPr?.["a:xfrm"]);
  const off = asRecord(xfrm?.["a:off"]);
  const ext = asRecord(xfrm?.["a:ext"]);
  const xEmu = readAttrNumber(off, "@_x");
  const yEmu = readAttrNumber(off, "@_y");
  const cxEmu = readAttrNumber(ext, "@_cx");
  const cyEmu = readAttrNumber(ext, "@_cy");
  if (xEmu == null || yEmu == null || cxEmu == null || cyEmu == null) return null;
  return {
    x: emuToPx(xEmu, geo, transform, "x"),
    y: emuToPx(yEmu, geo, transform, "y"),
    width: Math.max(1, cxEmu * transform.scaleX * geo.scale),
    height: Math.max(1, cyEmu * transform.scaleY * geo.scale),
  };
}

/** `rot` is stored in 60000ths of a degree. Both the editor and PowerPoint
 * rotate around the shape's centre, so no offset compensation is needed. */
export function shapeRotation(spPr: Rec | null): number | null {
  const rot = readAttrNumber(asRecord(spPr?.["a:xfrm"]), "@_rot");
  if (rot == null || rot === 0) return null;
  const degrees = ((rot / 60000) % 360 + 360) % 360;
  return degrees === 0 ? null : degrees;
}

export function shapeFlip(spPr: Rec | null): { flip_h?: boolean; flip_v?: boolean } {
  const xfrm = asRecord(spPr?.["a:xfrm"]);
  const out: { flip_h?: boolean; flip_v?: boolean } = {};
  if (readAttrBoolean(xfrm, "@_flipH")) out.flip_h = true;
  if (readAttrBoolean(xfrm, "@_flipV")) out.flip_v = true;
  return out;
}

export function withRotation(el: Rec, rotation: number | null): Rec {
  return rotation == null ? el : { ...el, rotation };
}
