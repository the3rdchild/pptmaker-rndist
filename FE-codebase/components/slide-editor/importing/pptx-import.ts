// Imports an external .pptx file into the editor's internal `ui` format
// (the same {id, components:[{id, position, size, elements:[...]}]} shape
// AI generation and manual template inserts already produce).
//
// Scope (deliberately limited for v1 — matches what export-pptx.ts can even
// round-trip today, see that file's element-type switch): text, images,
// rectangles, ellipses, lines, and basic group flattening. Charts, tables,
// SmartArt, and theme-color resolution are NOT supported — such shapes are
// silently skipped (counted and reported back to the caller) rather than
// crashing the import or producing a garbled shape. A .pptx's real internal
// format is a zip of OOXML/DrawingML XML files; this only reads the small
// slice of that schema needed for the shape types above.
//
// EMU (English Metric Units, 914400/inch) is PowerPoint's native unit for
// every position/size in the XML. The editor's canvas is a fixed 1280x720px
// stage representing a 10in x 5.625in slide (matching export-pptx.ts's own
// SLIDE_W_IN/SLIDE_H_IN) — since custom canvas ratios aren't supported yet,
// an imported deck's own slide size (read from presentation.xml, which varies
// per source file: 4:3, 16:9, custom) is uniformly scaled to CONTAIN within
// 1280x720 and centered, rather than stretched — this keeps every shape's
// aspect ratio intact at the cost of letterboxing when the source ratio
// differs from 16:9.

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { EDITOR_STAGE_WIDTH, EDITOR_STAGE_HEIGHT } from "@/components/slide-editor/types";

type Rec = Record<string, unknown>;

const EMU_PER_INCH = 914400;
const CANVAS_PX_PER_INCH = EDITOR_STAGE_WIDTH / 10; // matches export-pptx.ts's 10in slide width
const PT_TO_PX = CANVAS_PX_PER_INCH / 72;

export interface PptxImportResult {
  title: string;
  slides: { ui: Rec }[];
  /** Shapes (charts/tables/SmartArt/unsupported geometry) that were dropped
   * rather than mis-rendered — surfaced so the caller can tell the user
   * fidelity was reduced instead of silently losing content. */
  skippedShapeCount: number;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) =>
    ["a:p", "a:r", "p:sp", "p:pic", "p:cxnSp", "p:grpSp", "p:sldIdLst", "sldId", "Relationship"].includes(
      name,
    ),
});

function parseXml(text: string): Rec {
  return xmlParser.parse(text) as Rec;
}

/** Reads one entry from the zip as text, or null if it doesn't exist —
 * several referenced parts (e.g. a slide's own .rels file) are optional. */
async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  return entry.async("text");
}

export async function importPptxFile(file: File): Promise<PptxImportResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const presentationXml = await readZipText(zip, "ppt/presentation.xml");
  if (!presentationXml) throw new Error("Not a valid .pptx file (missing presentation.xml).");
  const presentation = parseXml(presentationXml);
  const presRoot = asRecord(presentation["p:presentation"]);
  const sldSz = asRecord(presRoot?.["p:sldSz"]);
  const srcWidthEmu = readAttrNumber(sldSz, "@_cx") ?? 12192000;
  const srcHeightEmu = readAttrNumber(sldSz, "@_cy") ?? 6858000;

  // Uniform contain-fit into the fixed 1280x720 canvas, centered.
  const scale = Math.min(EDITOR_STAGE_WIDTH / srcWidthEmu, EDITOR_STAGE_HEIGHT / srcHeightEmu);
  const offsetPxX = (EDITOR_STAGE_WIDTH - srcWidthEmu * scale) / 2;
  const offsetPxY = (EDITOR_STAGE_HEIGHT - srcHeightEmu * scale) / 2;
  const geo: GeoContext = { scale, offsetPxX, offsetPxY };

  const presRelsXml = await readZipText(zip, "ppt/_rels/presentation.xml.rels");
  const presRels = presRelsXml ? relationshipMap(parseXml(presRelsXml)) : new Map<string, string>();

  const sldIdList = asArray(asRecord(presRoot?.["p:sldIdLst"])?.["p:sldId"]);
  const slidePaths: string[] = [];
  for (const sldId of sldIdList) {
    const rid = readAttrString(asRecord(sldId), "@_r:id");
    const target = rid ? presRels.get(rid) : null;
    if (target) slidePaths.push(resolvePath("ppt", target));
  }
  // Fallback: presentation.xml malformed/unreadable list — just take every
  // slideN.xml part in numeric order rather than failing the whole import.
  if (slidePaths.length === 0) {
    const found = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => slideNumberOf(a) - slideNumberOf(b));
    slidePaths.push(...found);
  }

  let skippedShapeCount = 0;
  const slides: { ui: Rec }[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const result = await importOneSlide(zip, slidePaths[i], geo, i);
    slides.push({ ui: result.ui });
    skippedShapeCount += result.skipped;
  }

  return {
    title: file.name.replace(/\.pptx$/i, "") || "Imported presentation",
    slides,
    skippedShapeCount,
  };
}

type GeoContext = { scale: number; offsetPxX: number; offsetPxY: number };

async function importOneSlide(
  zip: JSZip,
  slidePath: string,
  geo: GeoContext,
  index: number,
): Promise<{ ui: Rec; skipped: number }> {
  const slideXml = await readZipText(zip, slidePath);
  const components: Rec[] = [];
  let skipped = 0;
  if (!slideXml) return { ui: { id: `imported_slide_${index + 1}`, components }, skipped };

  const slideDir = slidePath.slice(0, slidePath.lastIndexOf("/"));
  const slideFile = slidePath.slice(slidePath.lastIndexOf("/") + 1);
  const relsXml = await readZipText(zip, `${slideDir}/_rels/${slideFile}.rels`);
  const rels = relsXml ? relationshipMap(parseXml(relsXml)) : new Map<string, string>();

  const slide = parseXml(slideXml);
  const cSld = asRecord(asRecord(slide["p:sld"])?.["p:cSld"]);
  const spTree = asRecord(cSld?.["p:spTree"]);

  // Slide background: solid fill only (gradient/image backgrounds are common
  // but non-trivial to map faithfully — default to white, matching what a
  // shape-only import already looks reasonable against).
  const bg = asRecord(asRecord(cSld?.["p:bg"])?.["p:bgPr"]);
  const bgColor = bg ? solidFillColor(asRecord(bg["a:solidFill"])) : null;
  components.push({
    id: `imported_bg_${index + 1}`,
    position: { x: 0, y: 0 },
    size: { width: EDITOR_STAGE_WIDTH, height: EDITOR_STAGE_HEIGHT },
    elements: [
      {
        type: "rectangle",
        name: "background",
        decorative: true,
        position: { x: 0, y: 0 },
        size: { width: EDITOR_STAGE_WIDTH, height: EDITOR_STAGE_HEIGHT },
        fill: { color: bgColor ?? "#FFFFFF", opacity: 1 },
      },
    ],
  });

  if (spTree) {
    const shapes = topLevelShapes(spTree);
    let counter = 0;
    for (const { key, node } of shapes) {
      const built = await buildShapesFromNode(key, node, geo, zip, slideDir, rels);
      for (const element of built.elements) {
        counter++;
        components.push({
          id: `imported_${index + 1}_${counter}`,
          position: { x: element.position.x, y: element.position.y },
          size: { width: element.size.width, height: element.size.height },
          elements: [
            {
              ...element.el,
              position: { x: 0, y: 0 },
              size: { width: element.size.width, height: element.size.height },
              __presenton_manual_position: true,
            },
          ],
        });
      }
      skipped += built.skipped;
    }
  }

  return { ui: { id: `imported_slide_${index + 1}`, components }, skipped };
}

type BuiltElement = { el: Rec; position: { x: number; y: number }; size: { width: number; height: number } };

/** A node's own transform composed with whatever group transform it's
 * nested inside (identity at the top level). Lets group children resolve to
 * final canvas coordinates without a separate recursive coordinate system. */
type NodeTransform = { offX: number; offY: number; scaleX: number; scaleY: number };

const IDENTITY_TRANSFORM: NodeTransform = { offX: 0, offY: 0, scaleX: 1, scaleY: 1 };

function topLevelShapes(spTree: Rec): { key: string; node: Rec }[] {
  const out: { key: string; node: Rec }[] = [];
  for (const key of ["p:sp", "p:pic", "p:cxnSp", "p:grpSp", "p:graphicFrame"]) {
    for (const node of asArray(spTree[key])) {
      const rec = asRecord(node);
      if (rec) out.push({ key, node: rec });
    }
  }
  return out;
}

async function buildShapesFromNode(
  key: string,
  node: Rec,
  geo: GeoContext,
  zip: JSZip,
  slideDir: string,
  rels: Map<string, string>,
  parentTransform: NodeTransform = IDENTITY_TRANSFORM,
): Promise<{ elements: BuiltElement[]; skipped: number }> {
  if (key === "p:grpSp") {
    return buildGroup(node, geo, zip, slideDir, rels, parentTransform);
  }
  if (key === "p:sp") {
    const shape = buildShape(node, geo, parentTransform);
    return shape ? { elements: [shape], skipped: 0 } : { elements: [], skipped: 1 };
  }
  if (key === "p:cxnSp") {
    const line = buildLine(node, geo, parentTransform);
    return line ? { elements: [line], skipped: 0 } : { elements: [], skipped: 1 };
  }
  if (key === "p:pic") {
    const image = await buildPicture(node, geo, zip, slideDir, rels, parentTransform);
    return image ? { elements: [image], skipped: 0 } : { elements: [], skipped: 1 };
  }
  // p:graphicFrame (charts/tables/SmartArt) — explicitly out of scope for v1.
  return { elements: [], skipped: 1 };
}

async function buildGroup(
  node: Rec,
  geo: GeoContext,
  zip: JSZip,
  slideDir: string,
  rels: Map<string, string>,
  parentTransform: NodeTransform,
): Promise<{ elements: BuiltElement[]; skipped: number }> {
  const grpPr = asRecord(node["p:grpSpPr"]);
  const xfrm = asRecord(grpPr?.["a:xfrm"]);
  const off = asRecord(xfrm?.["a:off"]);
  const ext = asRecord(xfrm?.["a:ext"]);
  const chOff = asRecord(xfrm?.["a:chOff"]);
  const chExt = asRecord(xfrm?.["a:chExt"]);
  const offX = readAttrNumber(off, "@_x") ?? 0;
  const offY = readAttrNumber(off, "@_y") ?? 0;
  const extCx = readAttrNumber(ext, "@_cx") ?? 1;
  const extCy = readAttrNumber(ext, "@_cy") ?? 1;
  const chOffX = readAttrNumber(chOff, "@_x") ?? 0;
  const chOffY = readAttrNumber(chOff, "@_y") ?? 0;
  const chExtCx = readAttrNumber(chExt, "@_cx") ?? (extCx || 1);
  const chExtCy = readAttrNumber(chExt, "@_cy") ?? (extCy || 1);

  // Group's own EMU-space transform composed with whatever transform it's
  // already nested inside (a group inside a group).
  const groupScaleX = extCx / (chExtCx || 1);
  const groupScaleY = extCy / (chExtCy || 1);
  const transform: NodeTransform = {
    scaleX: parentTransform.scaleX * groupScaleX,
    scaleY: parentTransform.scaleY * groupScaleY,
    offX: parentTransform.offX + offX * parentTransform.scaleX - chOffX * parentTransform.scaleX * groupScaleX,
    offY: parentTransform.offY + offY * parentTransform.scaleY - chOffY * parentTransform.scaleY * groupScaleY,
  };

  const elements: BuiltElement[] = [];
  let skipped = 0;
  for (const { key, node: child } of topLevelShapes(node)) {
    const built = await buildShapesFromNode(key, child, geo, zip, slideDir, rels, transform);
    elements.push(...built.elements);
    skipped += built.skipped;
  }
  return { elements, skipped };
}

function emuToPx(emu: number, geo: GeoContext, transform: NodeTransform, axis: "x" | "y"): number {
  const composed = axis === "x" ? emu * transform.scaleX + transform.offX : emu * transform.scaleY + transform.offY;
  return axis === "x" ? geo.offsetPxX + composed * geo.scale : geo.offsetPxY + composed * geo.scale;
}

function shapeBox(
  spPr: Rec | null,
  geo: GeoContext,
  transform: NodeTransform,
): { x: number; y: number; width: number; height: number } | null {
  const xfrm = asRecord(spPr?.["a:xfrm"]);
  const off = asRecord(xfrm?.["a:off"]);
  const ext = asRecord(xfrm?.["a:ext"]);
  const xEmu = readAttrNumber(off, "@_x");
  const yEmu = readAttrNumber(off, "@_y");
  const cxEmu = readAttrNumber(ext, "@_cx");
  const cyEmu = readAttrNumber(ext, "@_cy");
  if (xEmu == null || yEmu == null || cxEmu == null || cyEmu == null) return null;
  const x = emuToPx(xEmu, geo, transform, "x");
  const y = emuToPx(yEmu, geo, transform, "y");
  const width = Math.max(1, cxEmu * transform.scaleX * geo.scale);
  const height = Math.max(1, cyEmu * transform.scaleY * geo.scale);
  return { x, y, width, height };
}

function buildShape(node: Rec, geo: GeoContext, transform: NodeTransform): BuiltElement | null {
  const spPr = asRecord(node["p:spPr"]);
  const box = shapeBox(spPr, geo, transform);
  if (!box) return null;

  const txBody = asRecord(node["p:txBody"]);
  const runs = txBody ? textRunsFromBody(txBody) : [];
  if (runs.length) {
    const fill = solidFillColor(asRecord(spPr?.["a:solidFill"]));
    const el: Rec = {
      type: "text",
      runs,
      position: { x: 0, y: 0 },
      size: { width: box.width, height: box.height },
      ...(fill ? { fill: { color: fill, opacity: 1 } } : {}),
    };
    return { el, position: box, size: box };
  }

  // No text — a plain autoshape. Approximate every non-rect/ellipse preset
  // geometry (rounded rect, chevron, star, ...) as a rectangle rather than
  // dropping it; a slightly-wrong shape reads better than a missing one.
  const prstGeom = asRecord(spPr?.["a:prstGeom"]);
  const prst = readAttrString(prstGeom, "@_prst");
  const isEllipse = prst === "ellipse";
  const fill = solidFillColor(asRecord(spPr?.["a:solidFill"]));
  const stroke = solidLineColor(asRecord(spPr?.["a:ln"]));
  const el: Rec = {
    type: isEllipse ? "ellipse" : "rectangle",
    position: { x: 0, y: 0 },
    size: { width: box.width, height: box.height },
    fill: { color: fill ?? "#CBD2D9", opacity: fill ? 1 : 0.6 },
    ...(stroke ? { stroke } : {}),
  };
  return { el, position: box, size: box };
}

function buildLine(node: Rec, geo: GeoContext, transform: NodeTransform): BuiltElement | null {
  const spPr = asRecord(node["p:spPr"]);
  const box = shapeBox(spPr, geo, transform);
  if (!box) return null;
  const stroke = solidLineColor(asRecord(spPr?.["a:ln"])) ?? { color: "#111827", opacity: 1, width: 2 };
  const el: Rec = {
    type: "line",
    position: { x: 0, y: 0 },
    size: { width: box.width, height: box.height },
    stroke,
  };
  return { el, position: box, size: box };
}

async function buildPicture(
  node: Rec,
  geo: GeoContext,
  zip: JSZip,
  slideDir: string,
  rels: Map<string, string>,
  transform: NodeTransform,
): Promise<BuiltElement | null> {
  const spPr = asRecord(node["p:spPr"]);
  const box = shapeBox(spPr, geo, transform);
  if (!box) return null;

  const blipFill = asRecord(node["p:blipFill"]);
  const blip = asRecord(blipFill?.["a:blip"]);
  const rid = readAttrString(blip, "@_r:embed");
  const target = rid ? rels.get(rid) : null;
  if (!target) return null;
  const mediaPath = resolvePath(slideDir, target);
  const entry = zip.file(mediaPath);
  if (!entry) return null;

  const base64 = await entry.async("base64");
  const mime = mimeTypeFor(mediaPath);
  if (!mime) return null; // unsupported/vector media (e.g. .wmf/.emf) — skip rather than embed garbage
  const dataUrl = `data:${mime};base64,${base64}`;

  const el: Rec = {
    type: "image",
    data: dataUrl,
    fit: "fill",
    position: { x: 0, y: 0 },
    size: { width: box.width, height: box.height },
  };
  return { el, position: box, size: box };
}

function mimeTypeFor(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "svg": return "image/svg+xml";
    default: return null; // .wmf/.emf and other vector/legacy formats
  }
}

function textRunsFromBody(txBody: Rec): Rec[] {
  const paragraphs = asArray(txBody["a:p"]);
  const runs: Rec[] = [];
  paragraphs.forEach((p, pIndex) => {
    const para = asRecord(p);
    if (!para) return;
    if (pIndex > 0) runs.push({ text: "\n" });
    for (const r of asArray(para["a:r"])) {
      const run = asRecord(r);
      if (!run) continue;
      const text = readText(run["a:t"]);
      if (!text) continue;
      const rPr = asRecord(run["a:rPr"]);
      const font = fontFromRunProps(rPr);
      runs.push(font ? { text, font } : { text });
    }
  });
  return runs;
}

function fontFromRunProps(rPr: Rec | null): Rec | null {
  if (!rPr) return null;
  const szCentipoints = readAttrNumber(rPr, "@_sz");
  const bold = readAttrString(rPr, "@_b") === "1";
  const italic = readAttrString(rPr, "@_i") === "1";
  const underline = readAttrString(rPr, "@_u") != null && readAttrString(rPr, "@_u") !== "none";
  const color = solidFillColor(asRecord(rPr["a:solidFill"]));
  const font: Rec = {};
  if (szCentipoints != null) font.size = Math.round((szCentipoints / 100) * PT_TO_PX);
  if (bold) font.bold = true;
  if (italic) font.italic = true;
  if (underline) font.underline = true;
  if (color) font.color = color;
  return Object.keys(font).length ? font : null;
}

function solidFillColor(solidFill: Rec | null): string | null {
  if (!solidFill) return null;
  const srgb = asRecord(solidFill["a:srgbClr"]);
  const val = readAttrString(srgb, "@_val");
  return val ? `#${val.toUpperCase()}` : null; // theme colors (a:schemeClr) intentionally unresolved for v1
}

function solidLineColor(ln: Rec | null): Rec | null {
  if (!ln) return null;
  const color = solidFillColor(asRecord(ln["a:solidFill"]));
  if (!color) return null;
  const widthEmu = readAttrNumber(ln, "@_w");
  const widthPx = widthEmu ? Math.max(1, (widthEmu / EMU_PER_INCH) * CANVAS_PX_PER_INCH) : 1;
  return { color, opacity: 1, width: widthPx };
}

function relationshipMap(relsDoc: Rec): Map<string, string> {
  const map = new Map<string, string>();
  const rels = asRecord(relsDoc["Relationships"]);
  for (const rel of asArray(rels?.["Relationship"])) {
    const rec = asRecord(rel);
    const id = readAttrString(rec, "@_Id");
    const target = readAttrString(rec, "@_Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

/** Resolves a (possibly ../-relative) OOXML relationship target against the
 * directory of the part that referenced it, matching zip-path resolution. */
function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDir.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

function slideNumberOf(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  const rec = asRecord(value);
  const text = rec?.["#text"];
  return typeof text === "string" ? text : "";
}

function readAttrString(rec: Rec | null, attr: string): string | null {
  if (!rec) return null;
  const value = rec[attr];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}

function readAttrNumber(rec: Rec | null, attr: string): number | null {
  const value = readAttrString(rec, attr);
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asRecord(value: unknown): Rec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}
