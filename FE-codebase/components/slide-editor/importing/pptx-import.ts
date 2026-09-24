// Imports an external .pptx file into the editor's internal `ui` format
// (the same {id, components:[{id, position, size, elements:[...]}]} shape
// AI generation and manual template inserts already produce).
//
// Scope: text, images, rectangles, ellipses, lines and group flattening.
// Charts, tables and SmartArt (p:graphicFrame) are NOT supported — those are
// silently skipped (counted and reported back to the caller) rather than
// crashing the import or producing a garbled shape. A .pptx's real internal
// format is a zip of OOXML/DrawingML XML files; this only reads the slice of
// that schema needed for the element types above.
//
// EMU (English Metric Units, 914400/inch) is PowerPoint's native unit for
// every position/size in the XML. The editor's canvas is a fixed 1280x720px
// stage; the source deck's own slide size (read from presentation.xml, which
// varies per file: 4:3, 16:9, or an oversized 2x canvas as exported by Canva)
// is uniformly scaled to CONTAIN within 1280x720 and centered, rather than
// stretched — this keeps every shape's aspect ratio intact at the cost of
// letterboxing when the source ratio differs from 16:9.
//
// That same slide scale MUST also be applied to font sizes and line widths:
// a 96pt heading on a 20in-wide Canva slide occupies the same fraction of the
// canvas as a 48pt heading on a 10in slide. Converting points to pixels with a
// fixed px-per-inch (as this importer originally did) renders every deck whose
// slide isn't exactly 10in wide at the wrong text size — 2x too large for a
// Canva export, which is what made imported decks look like they exploded.
//
// The actual XML-to-shape conversion is split by concern across sibling
// modules — this file keeps the orchestration (walking the slide/layout/
// master tree and assembling components) and re-exports everything importers
// use, so nothing outside this module needs to know it moved:
//   - pptx-context.ts: the shared Rec/Box/GeoContext/PartContext/... types
//   - pptx-xml-read.ts: low-level XML attribute/text/number readers
//   - pptx-geometry.ts: DrawingML geometry -> SVG path data + shape geometry
//   - pptx-shape-frame.ts: a shape's box (position/size), rotation and flip
//   - pptx-color.ts: DrawingML colour/fill/stroke resolution
//   - pptx-text-runs.ts: paragraph/run/bullet -> text or text-list element
//   - pptx-table.ts: a:tbl -> the editor's table element
//   - pptx-image-fill.ts: blip fills, crop/stretch, media data URLs
//   - pptx-font-resolution.ts: unresolvable-font detection + substitution

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { EDITOR_STAGE_WIDTH, EDITOR_STAGE_HEIGHT } from "@/components/slide-editor/types";
import { asRecord } from "@/components/slide-editor/model/core";
import {
  asArray,
  readAttrBoolean,
  readAttrNumber,
  readAttrString,
} from "@/components/slide-editor/importing/pptx-xml-read";
import { shapeElementOf, shapeGeometry } from "@/components/slide-editor/importing/pptx-geometry";
import {
  emuToPx,
  shapeBox,
  shapeFlip,
  shapeRotation,
  withRotation,
} from "@/components/slide-editor/importing/pptx-shape-frame";
import {
  colorOf,
  fillOf,
  strokeOf,
  styleRefFill,
  styleRefStroke,
} from "@/components/slide-editor/importing/pptx-color";
import { textElement } from "@/components/slide-editor/importing/pptx-text-runs";
import { buildTable } from "@/components/slide-editor/importing/pptx-table";
import { imageFromBlipFill } from "@/components/slide-editor/importing/pptx-image-fill";
import {
  findUnresolvableFonts,
  resolveUnresolvedFonts,
  type FontSubstitution,
  type PptxImportResult,
} from "@/components/slide-editor/importing/pptx-font-resolution";
import {
  EMPTY_RELS,
  IDENTITY_TRANSFORM,
  type Box,
  type BuiltElement,
  type DeckContext,
  type GeoContext,
  type NodeTransform,
  type PartContext,
  type Rec,
  type Rels,
  type ThemeContext,
} from "@/components/slide-editor/importing/pptx-context";

export {
  findUnresolvableFonts,
  resolveUnresolvedFonts,
  type FontSubstitution,
  type PptxImportResult,
} from "@/components/slide-editor/importing/pptx-font-resolution";

/** Fallback slide size (16:9, 13.33in) for decks with no readable p:sldSz. */
const DEFAULT_SLIDE_W_EMU = 12192000;
const DEFAULT_SLIDE_H_EMU = 6858000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Slide text is text, never a number. Left at its default (true) the parser
  // "helpfully" coerces any numeric-looking <a:t>, so a step marker authored
  // as "01" arrives as the number 1 and imports a step list numbered 1,2,3
  // against a source that reads 01,02,03. Same for "1.50", "+62", "0x1F".
  parseTagValue: false,
  // Freeform geometry is an ORDERED command list, and this parser groups
  // siblings by tag name — moveTo → lnTo → cubicBezTo → lnTo would come back
  // with the interleaving lost. Kept as raw XML for pptx-geometry to scan.
  stopNodes: ["*.a:pathLst"],
  isArray: (name) =>
    [
      "a:p",
      "a:r",
      "a:gs",
      "p:sp",
      "p:pic",
      "p:cxnSp",
      "p:grpSp",
      "p:graphicFrame",
      "p:sldIdLst",
      "sldId",
      "Relationship",
    ].includes(name),
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
  const srcWidthEmu = readAttrNumber(sldSz, "@_cx") ?? DEFAULT_SLIDE_W_EMU;
  const srcHeightEmu = readAttrNumber(sldSz, "@_cy") ?? DEFAULT_SLIDE_H_EMU;

  // Uniform contain-fit into the fixed 1280x720 canvas, centered.
  const scale = Math.min(EDITOR_STAGE_WIDTH / srcWidthEmu, EDITOR_STAGE_HEIGHT / srcHeightEmu);
  const geo: GeoContext = {
    scale,
    offsetPxX: (EDITOR_STAGE_WIDTH - srcWidthEmu * scale) / 2,
    offsetPxY: (EDITOR_STAGE_HEIGHT - srcHeightEmu * scale) / 2,
  };

  const deck: DeckContext = {
    zip,
    geo,
    themeCache: new Map(),
    mediaCache: new Map(),
    partCache: new Map(),
  };

  const presRels = await readRels(zip, "ppt/presentation.xml");
  const sldIdList = asArray(asRecord(presRoot?.["p:sldIdLst"])?.["p:sldId"]);
  const slidePaths: string[] = [];
  for (const sldId of sldIdList) {
    const rid = readAttrString(asRecord(sldId), "@_r:id");
    const target = rid ? presRels.byId.get(rid) : null;
    if (target) slidePaths.push(target);
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
    const result = await importOneSlide(deck, slidePaths[i], i);
    slides.push({ ui: result.ui });
    skippedShapeCount += result.skipped;
  }

  return {
    title: file.name.replace(/\.pptx$/i, "") || "Imported presentation",
    slides,
    skippedShapeCount,
    fontSubstitutions: [],
  };
}

async function importOneSlide(
  deck: DeckContext,
  slidePath: string,
  index: number,
): Promise<{ ui: Rec; skipped: number }> {
  const slideXml = await readZipText(deck.zip, slidePath);
  const components: Rec[] = [];
  let skipped = 0;
  if (!slideXml) return { ui: { id: `imported_slide_${index + 1}`, components }, skipped };

  const rels = await readRels(deck.zip, slidePath);
  const layoutPath = rels.byType.get("slideLayout")?.[0] ?? null;
  const theme = await loadTheme(deck, layoutPath);
  const ctx: PartContext = { deck, rels, theme, order: shapeOrderIndex(slideXml) };

  const slide = parseXml(slideXml);
  const cSld = asRecord(asRecord(slide["p:sld"])?.["p:cSld"]);

  const background = await slideBackground(ctx, cSld, layoutPath, index);
  components.push(background);

  const counter = { value: 0 };

  // Everything the slide inherits from its layout and master paints first,
  // underneath the slide's own shapes — which is both PowerPoint's z-order and
  // the reason it has to happen at all: a deck that keeps its artwork on the
  // layout (Slidesgo's do) used to import as a near-empty slide.
  const inherited = await inheritedShapes(deck, layoutPath, theme, index, counter);
  components.push(...inherited.components);
  skipped += inherited.skipped;

  const spTree = asRecord(cSld?.["p:spTree"]);
  if (spTree) {
    const own = await shapeComponents(spTree, ctx, index, counter);
    components.push(...own.components);
    skipped += own.skipped;
  }

  return { ui: { id: `imported_slide_${index + 1}`, components }, skipped };
}

/** One component per built element, numbered from a shared counter so shapes
 * inherited from a layout and the slide's own shapes never collide on id. */
async function shapeComponents(
  spTree: Rec,
  ctx: PartContext,
  index: number,
  counter: { value: number },
  skipPlaceholders = false,
): Promise<{ components: Rec[]; skipped: number }> {
  const components: Rec[] = [];
  let skipped = 0;
  for (const { key, node } of childShapes(spTree, ctx.order)) {
    if (skipPlaceholders && isPlaceholder(node)) continue;
    const built = await buildShapesFromNode(key, node, ctx, IDENTITY_TRANSFORM, true);
    for (const element of built.elements) {
      counter.value += 1;
      // Rotation belongs on the component (the outer Group the selection
      // transformer tracks) rather than the element — leaving it on the
      // element still renders the shape rotated, but around a Konva node
      // the transformer never sees, so the selection outline stays square
      // while the content underneath visibly rotates.
      const { rotation, ...elRest } = element.el as Rec & { rotation?: number };
      components.push({
        id: `imported_${index + 1}_${counter.value}`,
        position: { x: element.box.x, y: element.box.y },
        size: { width: element.box.width, height: element.box.height },
        ...(typeof rotation === "number" ? { rotation } : {}),
        elements: [
          {
            ...elRest,
            position: { x: 0, y: 0 },
            size: { width: element.box.width, height: element.box.height },
            __presenton_manual_position: true,
          },
        ],
      });
    }
    skipped += built.skipped;
  }
  return { components, skipped };
}

/** A shape that fills a layout/master placeholder rather than standing on its
 * own. Whatever it holds either comes from the slide (which supplies its own
 * copy) or is prompt text like "Click to edit Master title style", so it must
 * not be drawn from the inherited part. */
function isPlaceholder(node: Rec): boolean {
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("p:nv")) continue;
    if (asRecord(asRecord(value)?.["p:nvPr"])?.["p:ph"] !== undefined) return true;
  }
  return false;
}

/** The master's decoration, then the layout's. Only non-placeholder shapes:
 * see isPlaceholder. A layout can opt out of the master's shapes entirely with
 * showMasterSp="0", which is how a deck gives one section its own backdrop. */
async function inheritedShapes(
  deck: DeckContext,
  layoutPath: string | null,
  theme: ThemeContext | null,
  index: number,
  counter: { value: number },
): Promise<{ components: Rec[]; skipped: number }> {
  if (!layoutPath) return { components: [], skipped: 0 };

  const layout = await readPart(deck, layoutPath);
  if (!layout) return { components: [], skipped: 0 };
  const layoutRoot = asRecord(layout.doc["p:sldLayout"]);
  const showMaster = readAttrBoolean(layoutRoot, "@_showMasterSp") ?? true;

  const components: Rec[] = [];
  let skipped = 0;

  if (showMaster) {
    const masterPath = layout.rels.byType.get("slideMaster")?.[0] ?? null;
    const master = masterPath ? await readPart(deck, masterPath) : null;
    const masterTree = asRecord(asRecord(asRecord(master?.doc["p:sldMaster"])?.["p:cSld"])?.["p:spTree"]);
    if (master && masterTree) {
      const built = await shapeComponents(
        masterTree,
        { deck, rels: master.rels, theme, order: master.order },
        index,
        counter,
        true,
      );
      components.push(...built.components);
      skipped += built.skipped;
    }
  }

  const layoutTree = asRecord(asRecord(layoutRoot?.["p:cSld"])?.["p:spTree"]);
  if (layoutTree) {
    const built = await shapeComponents(
      layoutTree,
      { deck, rels: layout.rels, theme, order: layout.order },
      index,
      counter,
      true,
    );
    components.push(...built.components);
    skipped += built.skipped;
  }

  return { components, skipped };
}

/** Parsed part + its rels + its shape order, cached: a layout is shared by
 * every slide using it, and re-reading it per slide is the whole cost of
 * inheritance on a long deck. */
async function readPart(
  deck: DeckContext,
  path: string,
): Promise<{ doc: Rec; rels: Rels; order: Map<string, number> } | null> {
  const cached = deck.partCache.get(path);
  if (cached !== undefined) return cached;

  const xml = await readZipText(deck.zip, path);
  const part = xml
    ? { doc: parseXml(xml), rels: await readRels(deck.zip, path), order: shapeOrderIndex(xml) }
    : null;
  deck.partCache.set(path, part);
  return part;
}

// ---------------------------------------------------------------- background

/** Slide background, falling back to the layout's and then the master's when
 * the slide itself declares none — which is how most PowerPoint decks store
 * it. Solid fills and picture fills are both honoured; anything else lands on
 * white, which shape content still reads acceptably against. */
async function slideBackground(
  ctx: PartContext,
  cSld: Rec | null,
  layoutPath: string | null,
  index: number,
): Promise<Rec> {
  const full = { x: 0, y: 0, width: EDITOR_STAGE_WIDTH, height: EDITOR_STAGE_HEIGHT };
  const chain: { bg: Rec | null; ctx: PartContext }[] = [{ bg: asRecord(cSld?.["p:bg"]), ctx }];

  if (!chain[0].bg && layoutPath) {
    const layoutCtx: PartContext = { ...ctx, rels: await readRels(ctx.deck.zip, layoutPath) };
    const layout = parseXml((await readZipText(ctx.deck.zip, layoutPath)) ?? "");
    const layoutCSld = asRecord(asRecord(layout["p:sldLayout"])?.["p:cSld"]);
    chain.push({ bg: asRecord(layoutCSld?.["p:bg"]), ctx: layoutCtx });

    const masterPath = layoutCtx.rels.byType.get("slideMaster")?.[0] ?? null;
    if (masterPath) {
      const masterCtx: PartContext = { ...ctx, rels: await readRels(ctx.deck.zip, masterPath) };
      const master = parseXml((await readZipText(ctx.deck.zip, masterPath)) ?? "");
      const masterCSld = asRecord(asRecord(master["p:sldMaster"])?.["p:cSld"]);
      chain.push({ bg: asRecord(masterCSld?.["p:bg"]), ctx: masterCtx });
    }
  }

  for (const step of chain) {
    if (!step.bg) continue;
    const bgPr = asRecord(step.bg["p:bgPr"]);
    if (bgPr) {
      const picture = await imageFromBlipFill(asRecord(bgPr["a:blipFill"]), step.ctx, full);
      if (picture) {
        return backgroundComponent(
          index,
          { ...picture.el, name: "background", decorative: true },
          picture.box,
        );
      }
      const fill = fillOf(bgPr, step.ctx.theme);
      if (fill) return backgroundComponent(index, backgroundRect(fill));
    }
    // <p:bgRef idx=".."><a:schemeClr val="lt1"/></p:bgRef> — the indexed theme
    // fill style is approximated by its colour, which is what it resolves to
    // for the overwhelmingly common "solid fill" entries.
    const bgRef = asRecord(step.bg["p:bgRef"]);
    const refColor = bgRef ? colorOf(bgRef, step.ctx.theme) : null;
    if (refColor) return backgroundComponent(index, backgroundRect(refColor));
  }

  return backgroundComponent(index, backgroundRect({ color: "#FFFFFF", opacity: 1 }));
}

function backgroundRect(fill: { color: string; opacity: number }): Rec {
  return {
    type: "rectangle",
    name: "background",
    decorative: true,
    fill,
  };
}

/** `box` covers the whole stage unless a background picture fill's own
 * fillRect asked for less than that. */
function backgroundComponent(index: number, element: Rec, box?: Box): Rec {
  const area = box ?? { x: 0, y: 0, width: EDITOR_STAGE_WIDTH, height: EDITOR_STAGE_HEIGHT };
  return {
    id: `imported_bg_${index + 1}`,
    position: { x: area.x, y: area.y },
    size: { width: area.width, height: area.height },
    elements: [
      {
        ...element,
        position: { x: 0, y: 0 },
        size: { width: area.width, height: area.height },
      },
    ],
  };
}

// -------------------------------------------------------------------- shapes

/** Ranks every shape by where its `p:cNvPr` appears in the raw slide XML.
 * The XML parser groups siblings by tag name, which loses the document order
 * that IS the z-order — without this, every grouped shape would paint on top
 * of every ungrouped one and cover the text underneath. Shape ids are unique
 * within a slide, so the first `cNvPr` of each shape ranks it. */
function shapeOrderIndex(xml: string): Map<string, number> {
  const order = new Map<string, number>();
  let rank = 0;
  for (const match of xml.matchAll(/<p:cNvPr\b[^>]*\bid="([^"]+)"/g)) {
    if (!order.has(match[1])) order.set(match[1], rank);
    rank++;
  }
  return order;
}

function shapeId(node: Rec): string | null {
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("p:nv")) continue;
    const id = readAttrString(asRecord(asRecord(value)?.["p:cNvPr"]), "@_id");
    if (id) return id;
  }
  return null;
}

function childShapes(tree: Rec, order: Map<string, number>): { key: string; node: Rec }[] {
  const out: { key: string; node: Rec; rank: number }[] = [];
  for (const key of ["p:sp", "p:pic", "p:cxnSp", "p:grpSp", "p:graphicFrame"]) {
    for (const node of asArray(tree[key])) {
      const rec = asRecord(node);
      if (!rec) continue;
      const id = shapeId(rec);
      out.push({ key, node: rec, rank: (id ? order.get(id) : null) ?? Number.MAX_SAFE_INTEGER });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map(({ key, node }) => ({ key, node }));
}

async function buildShapesFromNode(
  key: string,
  node: Rec,
  ctx: PartContext,
  transform: NodeTransform,
  topLevel = false,
): Promise<{ elements: BuiltElement[]; skipped: number }> {
  if (key === "p:grpSp") return buildGroup(node, ctx, transform, topLevel);
  if (key === "p:sp") return buildShape(node, ctx, transform);
  if (key === "p:cxnSp") {
    const line = buildLine(node, ctx, transform);
    return { elements: line ? [line] : [], skipped: 0 };
  }
  if (key === "p:pic") {
    const image = await buildPicture(node, ctx, transform);
    return { elements: image ? [image] : [], skipped: image ? 0 : 1 };
  }
  if (key === "p:graphicFrame") {
    const table = buildTable(node, ctx, transform);
    if (table) return { elements: [table], skipped: 0 };
  }
  // Charts and SmartArt — out of scope, reported instead of mis-rendered.
  return { elements: [], skipped: 1 };
}

async function buildGroup(
  node: Rec,
  ctx: PartContext,
  parentTransform: NodeTransform,
  topLevel = false,
): Promise<{ elements: BuiltElement[]; skipped: number }> {
  const xfrm = asRecord(asRecord(node["p:grpSpPr"])?.["a:xfrm"]);
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
  for (const { key, node: child } of childShapes(node, ctx.order)) {
    const built = await buildShapesFromNode(key, child, ctx, transform);
    if (topLevel && key !== "p:grpSp") {
      for (const element of built.elements) element.directChild = true;
    }
    elements.push(...built.elements);
    skipped += built.skipped;
  }

  // A group's own rotation applies to everything inside it — Canva exports
  // tilted photos as a rotated group around an unrotated frame + picture, so
  // dropping this made every such image import straight. Rotate each child's
  // centre around the group's centre and compose the angle with the child's
  // own rotation. (Group flips are similarly unhandled, but rare enough to
  // leave until one shows up in the wild.)
  const groupRot = readAttrNumber(xfrm, "@_rot");
  if (groupRot) {
    const degrees = (((groupRot / 60000) % 360) + 360) % 360;
    if (degrees !== 0) {
      const centreX = emuToPx(offX + extCx / 2, ctx.deck.geo, parentTransform, "x");
      const centreY = emuToPx(offY + extCy / 2, ctx.deck.geo, parentTransform, "y");
      for (const element of elements) {
        rotateBuiltElement(element, centreX, centreY, degrees);
      }
    }
  }

  if (topLevel) normalizeGroupImageRotation(elements);

  return { elements, skipped };
}

/** Canva exports a tilted polaroid as an outer rotated group holding an
 * unrotated frame overlay plus a further-nested group (its own, slightly
 * different rotation) holding the photo. Composing group rotations above
 * reproduces that structure exactly — which is faithful to the source XML,
 * and is genuinely what PowerPoint renders (a sliver of the frame's window
 * peeking out from under the photo) — but it reads as unintended skew rather
 * than a deliberate choice. When every image in a top-level group ends up
 * within a few degrees of each other, snap them all to the frame's angle so
 * the photo sits parallel to its frame. Groups that intentionally mix
 * near-perpendicular rotations (e.g. a portrait photo stacked in a landscape
 * frame) fail the spread gate below and are left exactly as composed. */
function normalizeGroupImageRotation(elements: BuiltElement[]): void {
  const images = elements.filter((element) => element.el.type === "image");
  if (images.length < 2) return;

  const rotations = images.map((image) => (typeof image.el.rotation === "number" ? image.el.rotation : 0));
  if (circularSpreadDegrees(rotations) > 20) return;

  const anchor = images.find((image) => image.directChild) ?? images[0];
  const target = typeof anchor.el.rotation === "number" ? anchor.el.rotation : 0;
  for (const image of images) {
    if (image === anchor) continue;
    if (target === 0) delete image.el.rotation;
    else image.el.rotation = target;
  }
}

/** Smallest arc (in degrees) that contains every angle, so two rotations on
 * opposite sides of the 0/360 wrap (e.g. 357° and 3°) read as 6° apart
 * rather than 354° — a plain max-min would misfire the safety gate above. */
function circularSpreadDegrees(anglesDeg: number[]): number {
  if (anglesDeg.length <= 1) return 0;
  const sorted = [...anglesDeg].sort((a, b) => a - b);
  let maxGap = sorted[0] + 360 - sorted[sorted.length - 1];
  for (let i = 1; i < sorted.length; i++) {
    maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
  }
  return 360 - maxGap;
}

/** Rotates one built element around (cx, cy) in canvas px, composing the
 *  angle with any rotation the element already carries. pptx `rot` and Konva
 *  share the same convention — clockwise-positive degrees around the centre —
 *  so the composition is plain addition. */
function rotateBuiltElement(
  built: BuiltElement,
  cx: number,
  cy: number,
  degrees: number,
): void {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = built.box.x + built.box.width / 2 - cx;
  const dy = built.box.y + built.box.height / 2 - cy;
  built.box = {
    ...built.box,
    x: cx + dx * cos - dy * sin - built.box.width / 2,
    y: cy + dx * sin + dy * cos - built.box.height / 2,
  };
  const own = typeof built.el.rotation === "number" ? built.el.rotation : 0;
  const next = (((own + degrees) % 360) + 360) % 360;
  if (next === 0) delete built.el.rotation;
  else built.el.rotation = next;
}

async function buildShape(
  node: Rec,
  ctx: PartContext,
  transform: NodeTransform,
): Promise<{ elements: BuiltElement[]; skipped: number }> {
  const spPr = asRecord(node["p:spPr"]);
  const box = shapeBox(spPr, ctx.deck.geo, transform);
  if (!box) return { elements: [], skipped: 0 };

  const rotation = shapeRotation(spPr);
  const elements: BuiltElement[] = [];
  const geometry = shapeGeometry(spPr, box);

  // A shape can carry a picture fill instead of a colour — Canva exports every
  // photo that way (as a custGeom with a:blipFill) and uses p:pic almost never,
  // so treating these as plain rectangles loses all the imagery in the deck.
  const picture = await imageFromBlipFill(asRecord(spPr?.["a:blipFill"]), ctx, box);
  if (picture) {
    // The picture fills the shape's outline, not its bounding box. Clipping to
    // the geometry is what stops a photo dropped into a circle or a speech
    // bubble from importing as a rectangle covering its neighbours. Only when
    // the fill still covers the whole box, though: a fillRect that shrank the
    // element moved it out from under the path's coordinates.
    const clip =
      geometry.path && picture.box.width === box.width && picture.box.height === box.height
        ? { clippath: `path("${geometry.path.d}")` }
        : {};
    elements.push(placePicture(picture, { ...shapeFlip(spPr), ...clip }, box, rotation));
  }

  const fill = fillOf(spPr, ctx.theme) ?? styleRefFill(node, ctx.theme);
  const stroke = strokeOf(asRecord(spPr?.["a:ln"]), ctx.theme, ctx.deck.geo);

  // A shape both painted and lettered (a labelled chevron, a numbered badge)
  // is two things: the outline, then the text on top of it. Folding the fill
  // onto the text element instead — as this did — flattens every such shape
  // into a rectangle behind its label.
  if (!picture && (fill || stroke)) {
    elements.push({
      el: withRotation(
        {
          ...shapeElementOf(geometry, fill, stroke),
          ...(geometry.kind === "path" ? shapeFlip(spPr) : {}),
        },
        rotation,
      ),
      box,
    });
  }

  const text = textElement(node, ctx, box, elements.length > 0);
  if (text) elements.push({ el: withRotation(text, rotation), box });

  // Nothing visible at all (no fill, no outline, no text, no picture): drawing
  // a placeholder box would add clutter the source deck never showed, so drop
  // it — and don't count it as skipped, since nothing was lost.
  return { elements, skipped: 0 };
}

function buildLine(node: Rec, ctx: PartContext, transform: NodeTransform): BuiltElement | null {
  const spPr = asRecord(node["p:spPr"]);
  const box = shapeBox(spPr, ctx.deck.geo, transform);
  if (!box) return null;
  const stroke =
    strokeOf(asRecord(spPr?.["a:ln"]), ctx.theme, ctx.deck.geo) ??
    styleRefStroke(node, ctx.theme) ?? { color: "#111827", opacity: 1, width: 2 };

  // A connector is only a straight line in the simplest case: bent and curved
  // connectors route around their endpoints, and the `line` element can draw
  // neither those nor the flips that decide which way a connector points.
  const geometry = shapeGeometry(spPr, box);
  const el =
    geometry.kind === "path"
      ? { ...shapeElementOf(geometry, null, stroke), ...shapeFlip(spPr) }
      : { type: "line", stroke };
  return { el: withRotation(el, shapeRotation(spPr)), box };
}

async function buildPicture(
  node: Rec,
  ctx: PartContext,
  transform: NodeTransform,
): Promise<BuiltElement | null> {
  const spPr = asRecord(node["p:spPr"]);
  const box = shapeBox(spPr, ctx.deck.geo, transform);
  if (!box) return null;
  const picture = await imageFromBlipFill(asRecord(node["p:blipFill"]), ctx, box);
  if (!picture) return null;
  return placePicture(picture, { ...shapeFlip(spPr) }, box, shapeRotation(spPr));
}

/** Places a resolved picture fill inside the shape it belongs to. A fill whose
 * `fillRect` insets are positive paints only part of the shape, so the element
 * shrinks onto that part — and PowerPoint rotates around the SHAPE's centre,
 * not the painted sub-rectangle's, so the shrunken box is swung around the
 * shape centre rather than just handed the angle. Identical boxes (every fill
 * that covers or overflows its shape) fall out as a plain rotation. */
function placePicture(
  picture: { el: Rec; box: Box },
  extra: Rec,
  shape: Box,
  rotation: number | null,
): BuiltElement {
  const built: BuiltElement = { el: { ...picture.el, ...extra }, box: picture.box };
  if (rotation != null) {
    rotateBuiltElement(built, shape.x + shape.width / 2, shape.y + shape.height / 2, rotation);
  }
  return built;
}

// -------------------------------------------------------- parts & references

async function readRels(zip: JSZip, partPath: string): Promise<Rels> {
  const dir = partPath.slice(0, partPath.lastIndexOf("/"));
  const file = partPath.slice(partPath.lastIndexOf("/") + 1);
  const xml = await readZipText(zip, `${dir}/_rels/${file}.rels`);
  if (!xml) return EMPTY_RELS;

  const byId = new Map<string, string>();
  const byType = new Map<string, string[]>();
  const relationships = asRecord(parseXml(xml)["Relationships"]);
  for (const rel of asArray(relationships?.["Relationship"])) {
    const rec = asRecord(rel);
    const id = readAttrString(rec, "@_Id");
    const target = readAttrString(rec, "@_Target");
    if (!target || readAttrString(rec, "@_TargetMode") === "External") continue;
    const resolved = resolvePath(dir, target);
    if (id) byId.set(id, resolved);
    const type = readAttrString(rec, "@_Type")?.split("/").pop();
    if (type) byType.set(type, [...(byType.get(type) ?? []), resolved]);
  }
  return { byId, byType };
}

async function loadTheme(deck: DeckContext, layoutPath: string | null): Promise<ThemeContext | null> {
  if (!layoutPath) return null;
  const cached = deck.themeCache.get(layoutPath);
  if (cached !== undefined) return cached;

  const layoutRels = await readRels(deck.zip, layoutPath);
  const masterPath = layoutRels.byType.get("slideMaster")?.[0] ?? null;
  let clrMap: Record<string, string> = {};
  let themePath: string | null = null;

  if (masterPath) {
    const masterXml = await readZipText(deck.zip, masterPath);
    if (masterXml) {
      const master = asRecord(parseXml(masterXml)["p:sldMaster"]);
      const map = asRecord(master?.["p:clrMap"]);
      if (map) {
        for (const [key, value] of Object.entries(map)) {
          if (key.startsWith("@_") && typeof value === "string") clrMap[key.slice(2)] = value;
        }
      }
    }
    themePath = (await readRels(deck.zip, masterPath)).byType.get("theme")?.[0] ?? null;
  }

  const colors = new Map<string, string>();
  let majorFont: string | null = null;
  let minorFont: string | null = null;
  const themeXml = themePath ? await readZipText(deck.zip, themePath) : null;
  if (themeXml) {
    const elements = asRecord(asRecord(parseXml(themeXml)["a:theme"])?.["a:themeElements"]);
    const scheme = asRecord(elements?.["a:clrScheme"]);
    if (scheme) {
      for (const slot of ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]) {
        const color = colorOf(asRecord(scheme[`a:${slot}`]), null);
        if (color) colors.set(slot, color.color);
      }
    }
    const fonts = asRecord(elements?.["a:fontScheme"]);
    majorFont = readAttrString(asRecord(asRecord(fonts?.["a:majorFont"])?.["a:latin"]), "@_typeface");
    minorFont = readAttrString(asRecord(asRecord(fonts?.["a:minorFont"])?.["a:latin"]), "@_typeface");
  }

  // `bg1`/`tx1` are the names shapes actually reference; without a master they
  // still map to the conventional light/dark slots.
  clrMap = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2", ...clrMap };

  const theme: ThemeContext = { colors, clrMap, majorFont, minorFont };
  deck.themeCache.set(layoutPath, theme);
  return theme;
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
