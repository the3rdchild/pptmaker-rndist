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

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { custGeomToPath, type PathGeometry } from "@/components/slide-editor/importing/pptx-geometry";
import { EDITOR_STAGE_WIDTH, EDITOR_STAGE_HEIGHT } from "@/components/slide-editor/types";
import { childArrayInfo, readString } from "@/components/slide-editor/model/model";
import {
  isGoogleFontFamily,
  loadGoogleFontOptions,
} from "@/components/slide-editor/text/google-fonts";
import { getGlobalFonts } from "@/lib/fonts/global-fonts";

type Rec = Record<string, unknown>;

const EMU_PER_INCH = 914400;
const EMU_PER_POINT = EMU_PER_INCH / 72;
/** Fallback slide size (16:9, 13.33in) for decks with no readable p:sldSz. */
const DEFAULT_SLIDE_W_EMU = 12192000;
const DEFAULT_SLIDE_H_EMU = 6858000;

export interface FontSubstitution {
  /** The original font name carried in from the .pptx (e.g. "Pagkaki Full"). */
  original: string;
  /** The Google Font the import rewrote it to so the canvas can render it. */
  substitute: string;
}

export interface PptxImportResult {
  title: string;
  slides: { ui: Rec }[];
  /** Shapes (charts/tables/SmartArt) that were dropped rather than
   * mis-rendered — surfaced so the caller can tell the user fidelity was
   * reduced instead of silently losing content. */
  skippedShapeCount: number;
  /** Fonts the import could not resolve against the Google Fonts catalogue and
   * rewrote to a visually similar substitute. Empty for the common case where
   * every source font is already available. The original name is preserved on
   * each affected element as `font.original_family` for traceability. */
  fontSubstitutions: FontSubstitution[];
}

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

type GeoContext = { scale: number; offsetPxX: number; offsetPxY: number };

/** A resolved relationship: both maps are keyed for the two lookups the
 * importer needs — by r:id (images, layouts) and by relationship type
 * (walking slide -> layout -> master -> theme). Targets are already resolved
 * to absolute zip paths. */
type Rels = { byId: Map<string, string>; byType: Map<string, string[]> };

const EMPTY_RELS: Rels = { byId: new Map(), byType: new Map() };

/** Theme + master colour mapping, needed to resolve `a:schemeClr` references.
 * Decks authored in PowerPoint express nearly every colour that way, so
 * without this every such shape falls back to a placeholder grey. */
type ThemeContext = {
  colors: Map<string, string>;
  clrMap: Record<string, string>;
  majorFont: string | null;
  minorFont: string | null;
};

/** Everything a slide needs that is shared across the whole deck. */
type DeckContext = {
  zip: JSZip;
  geo: GeoContext;
  themeCache: Map<string, ThemeContext>;
  mediaCache: Map<string, string | null>;
};

/** Per-part context: the rels of the XML part a shape came from (a slide, or
 * a layout/master when inheriting a background) plus the resolved theme. */
type PartContext = {
  deck: DeckContext;
  rels: Rels;
  theme: ThemeContext | null;
  /** Shape id -> position in the slide XML, see `shapeOrderIndex`. */
  order: Map<string, number>;
};

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

  const deck: DeckContext = { zip, geo, themeCache: new Map(), mediaCache: new Map() };

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

/** Record of a font name encountered while walking an import tree, kept
 *  case-sensitive so the substitute mapping round-trips exactly. */
function collectFontFamily(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectFontFamily(item, into));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  // `font` may live directly on the element, on a run, on a list item, on a
  // table cell, or on a cell's nested `text` block. Recursing covers them all
  // without listing every key, but we also short-circuit on the family itself.
  const fontRecord = asRecord(record.font);
  if (fontRecord) {
    const family = typeof fontRecord.family === "string" ? fontRecord.family.trim() : "";
    if (family) into.add(family);
  }
  for (const key of Object.keys(record)) {
    if (key === "font") continue;
    collectFontFamily(record[key], into);
  }
}

/** Walks every element in a ui tree (root elements + components + nested
 *  children + table cells) and collects the set of font family names in use.
 *  Mirrors the descriptor walk in surface/fontLoading.ts but only needs names. */
function collectUiFontFamilies(ui: Rec, into: Set<string>) {
  const visit = (value: unknown) => {
    const element = asRecord(value);
    if (!element) return;
    collectFontFamily(element, into);
    const children = childArrayInfo(element as never);
    if (children) children.items.forEach(visit);
  };
  const rootElements = asArray(asRecord(ui)?.elements);
  rootElements.forEach(visit);
  const components = asArray(asRecord(ui)?.components);
  components.forEach((component) => {
    const elements = asArray(asRecord(component)?.elements);
    elements.forEach(visit);
  });
}

/** Rewrites every `font.family` in the tree according to `mapping`, also
 *  stamping `font.original_family` with the pre-rewrite name (only when the
 *  family is being changed) so the original is recoverable later. Mutates
 *  records in place — the import result is freshly parsed, so this is safe. */
function rewriteFontFamilies(value: unknown, mapping: Map<string, string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => rewriteFontFamilies(item, mapping));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const fontRecord = asRecord(record.font);
  if (fontRecord && typeof fontRecord.family === "string") {
    const original = fontRecord.family;
    const substitute = mapping.get(original.trim());
    if (substitute && substitute !== original) {
      fontRecord.family = substitute;
      // Preserve the source name only if not already set, so a re-import of an
      // already-substituted deck doesn't overwrite the true original.
      if (typeof fontRecord.original_family !== "string") {
        fontRecord.original_family = original;
      }
    }
  }
  for (const key of Object.keys(record)) {
    if (key === "font") continue;
    rewriteFontFamilies(record[key], mapping);
  }
}

const DEFAULT_SUBSTITUTE_FALLBACK = "Inter";

/** Font families from an imported file that the renderer cannot resolve:
 *  not in the Google Fonts catalogue, not in the global font library
 *  (/api/fonts), and not in `extraFamilies` (e.g. a theme's bundle fonts).
 *  The catalogue and registry are lazy-loaded here so callers get a complete
 *  answer without their own setup. */
export async function findUnresolvableFonts(
  result: PptxImportResult,
  extraFamilies?: Iterable<string>,
): Promise<string[]> {
  // The Google Fonts catalogue is lazy-loaded into the isGoogleFontFamily
  // lookup; make sure it is populated before filtering, otherwise everything
  // outside the 42 hardcoded GOOGLE_FONT_OPTIONS would be treated as
  // unresolved and substituted unnecessarily.
  try {
    await loadGoogleFontOptions();
  } catch {
    // If the catalogue fails to load, treat that as "nothing resolves" — the
    // substitution route then handles every family, which is conservative but
    // keeps the import correct.
  }

  const available = new Set<string>();
  if (extraFamilies) {
    for (const family of extraFamilies) {
      available.add(family.trim().toLowerCase());
    }
  }
  try {
    const globalFonts = await getGlobalFonts();
    for (const family of Object.keys(globalFonts)) {
      available.add(family.trim().toLowerCase());
    }
  } catch {
    // Registry unreachable — its families simply count as unresolved.
  }

  const families = new Set<string>();
  result.slides.forEach((slide) => collectUiFontFamilies(slide.ui, families));

  const unresolved: string[] = [];
  families.forEach((family) => {
    if (available.has(family.trim().toLowerCase())) return;
    if (!isGoogleFontFamily(family)) unresolved.push(family);
  });
  return unresolved;
}

/** After importPptxFile has produced its result, find font names the renderer
 *  cannot resolve (see findUnresolvableFonts), ask the substitution route
 *  for a visually similar Google Font, and rewrite every affected
 *  `font.family` in place while preserving the original name as
 *  `font.original_family`. Returns the same result with `fontSubstitutions`
 *  filled in. No-op (and no network call) when every font already resolves. */
export async function resolveUnresolvedFonts(
  result: PptxImportResult,
  extraFamilies?: Iterable<string>,
): Promise<PptxImportResult> {
  const unresolved = await findUnresolvableFonts(result, extraFamilies);

  if (unresolved.length === 0) {
    return { ...result, fontSubstitutions: [] };
  }

  let chosen: Record<string, string> = {};
  try {
    const res = await fetch("/api/fonts/substitute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fonts: unresolved }),
    });
    const data = (await res.json()) as {
      substitutions?: Record<string, string>;
    };
    chosen = data.substitutions ?? {};
  } catch {
    // Network/parse failure: leave chosen empty; the fallback below covers it.
  }

  const mapping = new Map<string, string>();
  const substitutions: FontSubstitution[] = [];
  for (const original of unresolved) {
    const substitute = chosen[original] || DEFAULT_SUBSTITUTE_FALLBACK;
    mapping.set(original, substitute);
    substitutions.push({ original, substitute });
  }

  result.slides.forEach((slide) => {
    rewriteFontFamilies(slide.ui, mapping);
  });

  return { ...result, fontSubstitutions: substitutions };
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

  const spTree = asRecord(cSld?.["p:spTree"]);
  if (spTree) {
    let counter = 0;
    for (const { key, node } of childShapes(spTree, ctx.order)) {
      const built = await buildShapesFromNode(key, node, ctx, IDENTITY_TRANSFORM, true);
      for (const element of built.elements) {
        counter++;
        // Rotation belongs on the component (the outer Group the selection
        // transformer tracks) rather than the element — leaving it on the
        // element still renders the shape rotated, but around a Konva node
        // the transformer never sees, so the selection outline stays square
        // while the content underneath visibly rotates.
        const { rotation, ...elRest } = element.el as Rec & { rotation?: number };
        components.push({
          id: `imported_${index + 1}_${counter}`,
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
  }

  return { ui: { id: `imported_slide_${index + 1}`, components }, skipped };
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

type Box = { x: number; y: number; width: number; height: number };
/** `directChild` marks an element produced by a shape that hangs straight off
 * a top-level `p:grpSp` (as opposed to one nested inside a further group) —
 * used only to pick the anchor angle in `normalizeGroupImageRotation`. */
type BuiltElement = { el: Rec; box: Box; directChild?: boolean };

/** A node's own transform composed with whatever group transform it's
 * nested inside (identity at the top level). Lets group children resolve to
 * final canvas coordinates without a separate recursive coordinate system. */
type NodeTransform = { offX: number; offY: number; scaleX: number; scaleY: number };

const IDENTITY_TRANSFORM: NodeTransform = { offX: 0, offY: 0, scaleX: 1, scaleY: 1 };

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
  // p:graphicFrame (charts/tables/SmartArt) — out of scope, reported instead.
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

function emuToPx(emu: number, geo: GeoContext, transform: NodeTransform, axis: "x" | "y"): number {
  const composed = axis === "x" ? emu * transform.scaleX + transform.offX : emu * transform.scaleY + transform.offY;
  return axis === "x" ? geo.offsetPxX + composed * geo.scale : geo.offsetPxY + composed * geo.scale;
}

function shapeBox(spPr: Rec | null, geo: GeoContext, transform: NodeTransform): Box | null {
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
function shapeRotation(spPr: Rec | null): number | null {
  const rot = readAttrNumber(asRecord(spPr?.["a:xfrm"]), "@_rot");
  if (rot == null || rot === 0) return null;
  const degrees = ((rot / 60000) % 360 + 360) % 360;
  return degrees === 0 ? null : degrees;
}

function shapeFlip(spPr: Rec | null): { flip_h?: boolean; flip_v?: boolean } {
  const xfrm = asRecord(spPr?.["a:xfrm"]);
  const out: { flip_h?: boolean; flip_v?: boolean } = {};
  if (readAttrBoolean(xfrm, "@_flipH")) out.flip_h = true;
  if (readAttrBoolean(xfrm, "@_flipV")) out.flip_v = true;
  return out;
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

/** How a shape's outline should be drawn: a real path when the geometry is a
 * freeform or a preset with actual shape to it, otherwise the native rectangle
 * and ellipse elements — which stay directly editable and export as first-class
 * pptx shapes, so there is no reason to path them. */
type ShapeGeometry = { kind: "rectangle" | "ellipse" | "path"; path: PathGeometry | null; radius: number | null };

function shapeGeometry(spPr: Rec | null, box: Box): ShapeGeometry {
  const custom = asRecord(spPr?.["a:custGeom"]);
  if (custom) {
    const raw = custom["a:pathLst"];
    const ext = asRecord(asRecord(spPr?.["a:xfrm"])?.["a:ext"]);
    const path =
      typeof raw === "string"
        ? custGeomToPath(
            raw,
            { cx: readAttrNumber(ext, "@_cx") ?? 0, cy: readAttrNumber(ext, "@_cy") ?? 0 },
            box.width,
            box.height,
          )
        : null;
    return path ? { kind: "path", path, radius: null } : { kind: "rectangle", path: null, radius: null };
  }

  const prstGeom = asRecord(spPr?.["a:prstGeom"]);
  const prst = readAttrString(prstGeom, "@_prst");
  if (!prst || prst === "rect") return { kind: "rectangle", path: null, radius: null };
  if (prst === "ellipse" || prst === "circle") return { kind: "ellipse", path: null, radius: null };
  return presetGeometry(prst, prstGeom, box);
}

function shapeElementOf(
  geometry: ShapeGeometry,
  fill: { color: string; opacity: number } | null,
  stroke: { color: string; opacity: number; width: number; dash?: number[] } | null,
): Rec {
  const paint = { ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) };
  if (geometry.kind === "path" && geometry.path) {
    return {
      type: "path",
      d: geometry.path.d,
      view_box: { width: geometry.path.width, height: geometry.path.height },
      // DrawingML shapes punch holes by overlapping subpaths (a donut is one
      // path of two circles), which only reads right under the even-odd rule.
      fill_rule: "evenodd",
      ...paint,
    };
  }
  return {
    type: geometry.kind,
    ...(geometry.radius != null ? { border_radius: uniformRadius(geometry.radius) } : {}),
    ...paint,
  };
}

function uniformRadius(value: number): Rec {
  return { tl: value, tr: value, bl: value, br: value };
}

/** Named preset geometry (chevron, star, arrow, …). Anything without a mapping
 * falls back to a rectangle, which is what every preset used to get. */
function presetGeometry(prst: string, prstGeom: Rec | null, box: Box): ShapeGeometry {
  void prst;
  void prstGeom;
  void box;
  return { kind: "rectangle", path: null, radius: null };
}

function buildLine(node: Rec, ctx: PartContext, transform: NodeTransform): BuiltElement | null {
  const spPr = asRecord(node["p:spPr"]);
  const box = shapeBox(spPr, ctx.deck.geo, transform);
  if (!box) return null;
  const stroke =
    strokeOf(asRecord(spPr?.["a:ln"]), ctx.theme, ctx.deck.geo) ??
    styleRefStroke(node, ctx.theme) ?? { color: "#111827", opacity: 1, width: 2 };
  return { el: withRotation({ type: "line", stroke }, shapeRotation(spPr)), box };
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

function withRotation(el: Rec, rotation: number | null): Rec {
  return rotation == null ? el : { ...el, rotation };
}

/** DrawingML inset rectangle (`a:srcRect`, `a:fillRect`): four edge insets in
 * 1000ths of a percent, each defaulting to 0. Insets may be NEGATIVE, which is
 * how "the picture is bigger than the shape and the shape is a window onto it"
 * is expressed. */
type Insets = { l: number; t: number; r: number; b: number };

function insetsOf(rect: Rec | null): Insets | null {
  if (!rect) return null;
  const read = (attr: string) => (readAttrNumber(rect, attr) ?? 0) / 100000;
  return { l: read("@_l"), t: read("@_t"), r: read("@_r"), b: read("@_b") };
}

function isZeroInsets(insets: Insets | null): boolean {
  return !insets || (insets.l === 0 && insets.t === 0 && insets.r === 0 && insets.b === 0);
}

/** A sub-rectangle of the source image, as fractions of its natural size. */
type CropRect = { x: number; y: number; width: number; height: number };

/** Resolves a picture fill's two nested rectangles into what the shape
 * actually shows.
 *
 * `a:srcRect` crops the source image first; the surviving window is then
 * stretched into `a:stretch/a:fillRect`, a rect expressed relative to the
 * SHAPE, which may reach outside it. Canva leans on that hard: it exports one
 * sprite sheet and gives each shape a fillRect like `l=0 r=-343885`, meaning
 * "draw this image 4.4x the width of my box, anchored left" — so the box shows
 * only the leftmost 22% of the sprite. Dropping fillRect (as this importer
 * did) squeezes the whole sprite into the box instead, which is why one road
 * segment imported as six tiny roads and a pentagon label imported as a
 * square, a circle and a triangle side by side.
 *
 * Returns the visible part as a crop into the source plus the sub-rectangle of
 * the shape box it lands in, or null when the fill covers the box untouched
 * (the common case, no crop needed). */
function resolvePictureFill(
  blipFill: Rec,
  box: Box,
): { crop: CropRect | null; box: Box } | null {
  const src = insetsOf(asRecord(blipFill["a:srcRect"]));
  const stretch = asRecord(blipFill["a:stretch"]);
  const fill = insetsOf(asRecord(stretch?.["a:fillRect"]));
  if (isZeroInsets(src) && isZeroInsets(fill)) return { crop: null, box };

  // Source window left by srcRect, in natural-image fractions.
  const win = {
    x: src?.l ?? 0,
    y: src?.t ?? 0,
    width: 1 - (src?.l ?? 0) - (src?.r ?? 0),
    height: 1 - (src?.t ?? 0) - (src?.b ?? 0),
  };
  if (win.width <= 0 || win.height <= 0) return null;

  // Where that window is drawn, in fractions of the shape box.
  const dest = { x0: fill?.l ?? 0, y0: fill?.t ?? 0, x1: 1 - (fill?.r ?? 0), y1: 1 - (fill?.b ?? 0) };
  const destWidth = dest.x1 - dest.x0;
  const destHeight = dest.y1 - dest.y0;
  if (destWidth <= 0 || destHeight <= 0) return null;

  // The shape clips whatever falls outside it.
  const visible = {
    x0: Math.max(0, dest.x0),
    y0: Math.max(0, dest.y0),
    x1: Math.min(1, dest.x1),
    y1: Math.min(1, dest.y1),
  };
  if (visible.x1 <= visible.x0 || visible.y1 <= visible.y0) return null;

  const fx0 = (visible.x0 - dest.x0) / destWidth;
  const fx1 = (visible.x1 - dest.x0) / destWidth;
  const fy0 = (visible.y0 - dest.y0) / destHeight;
  const fy1 = (visible.y1 - dest.y0) / destHeight;

  return {
    crop: {
      x: round4(win.x + fx0 * win.width),
      y: round4(win.y + fy0 * win.height),
      width: round4((fx1 - fx0) * win.width),
      height: round4((fy1 - fy0) * win.height),
    },
    // Only the visible slice of the box is painted; the rest of the shape held
    // nothing, so the element shrinks onto it rather than scaling to fit.
    box: {
      x: box.x + visible.x0 * box.width,
      y: box.y + visible.y0 * box.height,
      width: Math.max(1, (visible.x1 - visible.x0) * box.width),
      height: Math.max(1, (visible.y1 - visible.y0) * box.height),
    },
  };
}

async function imageFromBlipFill(
  blipFill: Rec | null,
  ctx: PartContext,
  box: Box,
): Promise<{ el: Rec; box: Box } | null> {
  const blip = asRecord(blipFill?.["a:blip"]);
  const rid = readAttrString(blip, "@_r:embed");
  const target = rid ? ctx.rels.byId.get(rid) : null;
  if (!target || !blipFill) return null;

  const dataUrl = await mediaDataUrl(ctx.deck, target);
  if (!dataUrl) return null; // unsupported/vector media (.wmf/.emf) — skip rather than embed garbage

  const resolved = resolvePictureFill(blipFill, box);
  if (!resolved) return null; // the fill maps to nothing visible

  // `alphaModFix` is how a translucent picture fill is stored (Canva uses it
  // for the faint tiled patterns behind a slide); ignoring it renders those at
  // full strength and buries the actual content underneath.
  const alpha = readAttrNumber(asRecord(blip?.["a:alphaModFix"]), "@_amt");
  const opacity = alpha == null ? null : clamp01(alpha / 100000);

  return {
    el: {
      type: "image",
      data: dataUrl,
      // `a:stretch` means exactly that: map the source onto the destination
      // rect, warping if the aspect ratios differ. Falling back to "cover"
      // (as this importer did unconditionally) re-crops on top of a mapping
      // the file already stated, which moves the picture's content.
      fit: blipFill["a:stretch"] !== undefined ? "fill" : "cover",
      ...(resolved.crop ? { crop: resolved.crop } : {}),
      size: { width: resolved.box.width, height: resolved.box.height },
      ...(opacity != null && opacity < 1 ? { opacity } : {}),
    },
    box: resolved.box,
  };
}

async function mediaDataUrl(deck: DeckContext, path: string): Promise<string | null> {
  const cached = deck.mediaCache.get(path);
  if (cached !== undefined) return cached;

  const entry = deck.zip.file(path);
  const mime = mimeTypeFor(path);
  let dataUrl: string | null = null;
  if (entry && mime) dataUrl = `data:${mime};base64,${await entry.async("base64")}`;
  deck.mediaCache.set(path, dataUrl);
  return dataUrl;
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

// ---------------------------------------------------------------------- text

/** `hasBackdrop` is set when the shape's own outline was already emitted as a
 * separate element underneath — the fill belongs to that, not to the text. */
function textElement(node: Rec, ctx: PartContext, box: Box, hasBackdrop = false): Rec | null {
  const txBody = asRecord(node["p:txBody"]);
  if (!txBody) return null;

  const bodyPr = asRecord(txBody["a:bodyPr"]);
  // Body-level defaults a run inherits when it doesn't set its own properties.
  const bodyDefaults = asRecord(
    asRecord(asRecord(txBody["a:lstStyle"])?.["a:lvl1pPr"])?.["a:defRPr"],
  );
  const styleColor = styleRefFontColor(node, ctx.theme);

  let firstFont: Rec | null = null;
  let firstFontPt: number | null = null;
  let lineSpacing: { pct?: number; pts?: number } | null = null;
  let align: string | null = null;

  // Paragraphs are collected separately so trailing empty ones (very common —
  // they only exist to hold cursor state) don't leave stray blank lines.
  const paragraphRuns: Rec[][] = [];
  for (const p of asArray(txBody["a:p"])) {
    const para = asRecord(p);
    if (!para) continue;
    const pPr = asRecord(para["a:pPr"]);
    const paraDefaults = asRecord(pPr?.["a:defRPr"]) ?? bodyDefaults;
    if (align == null) align = readAttrString(pPr, "@_algn");
    if (lineSpacing == null) lineSpacing = lineSpacingOf(pPr);

    const current: Rec[] = [];
    for (const r of asArray(para["a:r"])) {
      const run = asRecord(r);
      if (!run) continue;
      const text = readText(run["a:t"]);
      if (!text) continue;
      const rPr = asRecord(run["a:rPr"]);
      const sizePt = readAttrNumber(rPr, "@_sz") ?? readAttrNumber(paraDefaults, "@_sz");
      const font = runFont(rPr, paraDefaults, ctx, styleColor);
      if (!firstFont && font) {
        firstFont = font;
        firstFontPt = sizePt == null ? null : sizePt / 100;
      }
      current.push(font ? { text, font } : { text });
    }
    paragraphRuns.push(current);
  }
  while (paragraphRuns.length > 0 && paragraphRuns[paragraphRuns.length - 1].length === 0) {
    paragraphRuns.pop();
  }

  const runs: Rec[] = [];
  paragraphRuns.forEach((paragraph, pIndex) => {
    if (pIndex > 0) runs.push({ text: "\n" });
    runs.push(...paragraph);
  });

  if (runs.length === 0) return null;

  const lineHeight = lineHeightOf(lineSpacing, firstFontPt);
  const elementFont: Rec = { ...(firstFont ?? {}) };
  if (lineHeight != null) elementFont.line_height = lineHeight;

  const alignment: Rec = {};
  const horizontal = horizontalAlignment(align);
  const vertical = verticalAlignment(readAttrString(bodyPr, "@_anchor"));
  if (horizontal) alignment.horizontal = horizontal;
  if (vertical) alignment.vertical = vertical;

  const fill = hasBackdrop ? null : fillOf(asRecord(node["p:spPr"]), ctx.theme);

  return {
    type: "text",
    runs,
    ...(Object.keys(elementFont).length ? { font: elementFont } : {}),
    ...(Object.keys(alignment).length ? { alignment } : {}),
    ...(fill ? { fill } : {}),
    size: { width: box.width, height: box.height },
  };
}

function runFont(
  rPr: Rec | null,
  defaults: Rec | null,
  ctx: PartContext,
  styleColor: { color: string; opacity: number } | null,
): Rec | null {
  const font: Rec = {};
  const sizePt = readAttrNumber(rPr, "@_sz") ?? readAttrNumber(defaults, "@_sz");
  if (sizePt != null) font.size = fontPx(sizePt, ctx.deck.geo);

  const bold = readAttrBoolean(rPr, "@_b") ?? readAttrBoolean(defaults, "@_b");
  if (bold) font.bold = true;
  const italic = readAttrBoolean(rPr, "@_i") ?? readAttrBoolean(defaults, "@_i");
  if (italic) font.italic = true;
  const underline = readAttrString(rPr, "@_u") ?? readAttrString(defaults, "@_u");
  if (underline && underline !== "none") font.underline = true;

  const color =
    (rPr ? colorOf(asRecord(rPr["a:solidFill"]), ctx.theme) : null) ??
    (defaults ? colorOf(asRecord(defaults["a:solidFill"]), ctx.theme) : null) ??
    styleColor;
  if (color) {
    font.color = color.color;
    if (color.opacity < 1) font.opacity = color.opacity;
  }

  const family = fontFamilyOf(rPr, ctx.theme) ?? fontFamilyOf(defaults, ctx.theme);
  if (family) font.family = family;

  // Character spacing (`spc`, 1/100 pt) — without it text reflows wider than
  // PowerPoint's own rendering (tight tracking makes headlines fit one line
  // there, wrap here).
  const spacing = readAttrNumber(rPr, "@_spc") ?? readAttrNumber(defaults, "@_spc");
  if (spacing != null) font.letter_spacing = letterSpacingPx(spacing, ctx.deck.geo);

  return Object.keys(font).length ? font : null;
}

/** Point sizes are relative to the source slide, so they scale by exactly the
 * same factor as every position and length on it. */
function fontPx(sizeHundredthsPt: number, geo: GeoContext): number {
  return Math.max(1, Math.round((sizeHundredthsPt / 100) * EMU_PER_POINT * geo.scale));
}

/** Character spacing scales like any other length — but unlike fontPx it may
 * be zero or negative (tighter-than-default tracking), so no clamp-to-1. */
function letterSpacingPx(spcHundredthsPt: number, geo: GeoContext): number {
  return round2((spcHundredthsPt / 100) * EMU_PER_POINT * geo.scale);
}

function fontFamilyOf(rPr: Rec | null, theme: ThemeContext | null): string | null {
  const typeface = readAttrString(asRecord(rPr?.["a:latin"]), "@_typeface");
  if (!typeface) return null;
  if (typeface === "+mj-lt") return theme?.majorFont ?? null;
  if (typeface === "+mn-lt") return theme?.minorFont ?? null;
  return typeface;
}

function lineSpacingOf(pPr: Rec | null): { pct?: number; pts?: number } | null {
  const lnSpc = asRecord(pPr?.["a:lnSpc"]);
  if (!lnSpc) return null;
  const pct = readAttrNumber(asRecord(lnSpc["a:spcPct"]), "@_val");
  if (pct != null) return { pct: pct / 100000 };
  const pts = readAttrNumber(asRecord(lnSpc["a:spcPts"]), "@_val");
  if (pts != null) return { pts: pts / 100 };
  return null;
}

/** Exact (`spcPts`) line spacing is an absolute point height, so it only maps
 * onto the editor's multiplier once divided by the font size it applies to. */
function lineHeightOf(
  spacing: { pct?: number; pts?: number } | null,
  fontPt: number | null,
): number | null {
  if (!spacing) return null;
  if (spacing.pct != null) return round2(spacing.pct);
  if (spacing.pts != null && fontPt && fontPt > 0) return round2(spacing.pts / fontPt);
  return null;
}

function horizontalAlignment(algn: string | null): string | null {
  switch (algn) {
    case "ctr": return "center";
    case "r": return "right";
    case "l": case "just": case "justLow": case "dist": return "left";
    default: return null;
  }
}

function verticalAlignment(anchor: string | null): string | null {
  switch (anchor) {
    case "ctr": return "middle";
    case "b": return "bottom";
    case "t": return "top";
    default: return null;
  }
}

// -------------------------------------------------------------------- colors

/** Reads whichever colour choice a fill/reference element carries, applying
 * the DrawingML colour transforms (alpha/lum/shade/tint) layered on top. */
function colorOf(container: Rec | null, theme: ThemeContext | null): { color: string; opacity: number } | null {
  if (!container) return null;

  const srgb = asRecord(container["a:srgbClr"]);
  const scheme = asRecord(container["a:schemeClr"]);
  const sys = asRecord(container["a:sysClr"]);
  const scrgb = asRecord(container["a:scrgbClr"]);
  const node = srgb ?? scheme ?? sys ?? scrgb;
  if (!node) return null;

  let base: string | null = null;
  if (srgb) {
    const val = readAttrString(srgb, "@_val");
    base = val ? `#${val.toUpperCase()}` : null;
  } else if (scheme) {
    base = schemeColor(readAttrString(scheme, "@_val"), theme);
  } else if (sys) {
    const val = readAttrString(sys, "@_lastClr");
    base = val ? `#${val.toUpperCase()}` : null;
  } else if (scrgb) {
    const r = readAttrNumber(scrgb, "@_r");
    const g = readAttrNumber(scrgb, "@_g");
    const b = readAttrNumber(scrgb, "@_b");
    if (r != null && g != null && b != null) {
      base = rgbToHex([
        Math.round((r / 100000) * 255),
        Math.round((g / 100000) * 255),
        Math.round((b / 100000) * 255),
      ]);
    }
  }
  if (!base) return null;

  let rgb = hexToRgb(base);
  const lumMod = readAttrNumber(asRecord(node["a:lumMod"]), "@_val");
  const lumOff = readAttrNumber(asRecord(node["a:lumOff"]), "@_val");
  const shade = readAttrNumber(asRecord(node["a:shade"]), "@_val");
  const tint = readAttrNumber(asRecord(node["a:tint"]), "@_val");
  if (lumMod != null || lumOff != null) rgb = applyLuminance(rgb, lumMod, lumOff);
  if (shade != null) rgb = rgb.map((c) => clampByte(c * (shade / 100000))) as [number, number, number];
  if (tint != null) {
    const k = tint / 100000;
    rgb = rgb.map((c) => clampByte(c * k + 255 * (1 - k))) as [number, number, number];
  }

  const alpha = readAttrNumber(asRecord(node["a:alpha"]), "@_val");
  return { color: rgbToHex(rgb), opacity: alpha == null ? 1 : clamp01(alpha / 100000) };
}

function schemeColor(val: string | null, theme: ThemeContext | null): string | null {
  if (!val || !theme) return null;
  // bg1/tx1/bg2/tx2 are indirections the master's colour map resolves.
  const mapped = theme.clrMap[val] ?? val;
  return theme.colors.get(mapped) ?? theme.colors.get(val) ?? null;
}

/** Solid fill, or a gradient approximated by its first stop — a flat colour in
 * roughly the right hue beats the grey placeholder a dropped fill produced. */
function fillOf(spPr: Rec | null, theme: ThemeContext | null): { color: string; opacity: number } | null {
  if (!spPr) return null;
  if (spPr["a:noFill"] !== undefined) return null;
  const solid = colorOf(asRecord(spPr["a:solidFill"]), theme);
  if (solid) return solid;
  const stops = asArray(asRecord(asRecord(spPr["a:gradFill"])?.["a:gsLst"])?.["a:gs"]);
  for (const stop of stops) {
    const color = colorOf(asRecord(stop), theme);
    if (color) return color;
  }
  return null;
}

function strokeOf(
  ln: Rec | null,
  theme: ThemeContext | null,
  geo: GeoContext,
): { color: string; opacity: number; width: number; dash?: number[] } | null {
  if (!ln) return null;
  if (ln["a:noFill"] !== undefined) return null;
  const color = colorOf(asRecord(ln["a:solidFill"]), theme);
  if (!color) return null;
  const widthEmu = readAttrNumber(ln, "@_w");
  const width = widthEmu ? Math.max(1, Math.round(widthEmu * geo.scale)) : 1;
  const dash = dashOf(ln, width);
  return { ...color, width, ...(dash ? { dash } : {}) };
}

/** ECMA-376 preset dash patterns, as multiples of the line width — which is
 * how PowerPoint defines them, so a thick dashed line gets proportionally
 * longer dashes rather than the same dashes as a hairline. */
const PRESET_DASH: Record<string, number[]> = {
  dot: [1, 3],
  dash: [4, 3],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

/** Dash pattern in canvas px, or null for a solid line. Both the preset
 * (`a:prstDash`) and custom (`a:custDash`) forms are expressed relative to the
 * line width, so the px pattern is only known once the width is scaled. */
function dashOf(ln: Rec, width: number): number[] | null {
  const preset = readAttrString(asRecord(ln["a:prstDash"]), "@_val");
  if (preset && preset !== "solid") {
    const pattern = PRESET_DASH[preset];
    if (pattern) return pattern.map((n) => round2(n * width));
  }

  // <a:custDash><a:ds d="400000" sp="300000"/>… — d/sp are 1000ths of a
  // percent of the line width, alternating dash then gap.
  const stops = asArray(asRecord(ln["a:custDash"])?.["a:ds"]);
  const custom: number[] = [];
  for (const stop of stops) {
    const rec = asRecord(stop);
    const d = readAttrNumber(rec, "@_d");
    const sp = readAttrNumber(rec, "@_sp");
    if (d == null || sp == null) continue;
    custom.push(round2((d / 100000) * width), round2((sp / 100000) * width));
  }
  return custom.length ? custom : null;
}

/** PowerPoint shapes very often carry no explicit fill and get their colour
 * from the theme's style matrix instead (`p:style`). The indexed matrix entry
 * isn't resolved here, but its colour reference is — which is the part that
 * actually determines what the shape looks like. */
function styleRefFill(node: Rec, theme: ThemeContext | null): { color: string; opacity: number } | null {
  return colorOf(asRecord(asRecord(node["p:style"])?.["a:fillRef"]), theme);
}

function styleRefStroke(
  node: Rec,
  theme: ThemeContext | null,
): { color: string; opacity: number; width: number } | null {
  const color = colorOf(asRecord(asRecord(node["p:style"])?.["a:lnRef"]), theme);
  return color ? { ...color, width: 1 } : null;
}

function styleRefFontColor(node: Rec, theme: ThemeContext | null): { color: string; opacity: number } | null {
  return colorOf(asRecord(asRecord(node["p:style"])?.["a:fontRef"]), theme);
}

function applyLuminance(
  rgb: [number, number, number],
  lumMod: number | null,
  lumOff: number | null,
): [number, number, number] {
  const [h, s, l] = rgbToHsl(rgb);
  let lum = l;
  if (lumMod != null) lum *= lumMod / 100000;
  if (lumOff != null) lum += lumOff / 100000;
  return hslToRgb(h, s, clamp01(lum));
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.padEnd(6, "0");
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function rgbToHex(rgb: [number, number, number] | number[]): string {
  return `#${rgb.map((c) => clampByte(c).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = clampByte(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    clampByte(channel(h + 1 / 3) * 255),
    clampByte(channel(h) * 255),
    clampByte(channel(h - 1 / 3) * 255),
  ];
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

// --------------------------------------------------------------- xml helpers

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  const rec = asRecord(value);
  const text = rec?.["#text"];
  return typeof text === "string" ? text : typeof text === "number" ? String(text) : "";
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

/** OOXML booleans appear as both `1`/`0` and `true`/`false` depending on the
 * exporter — Canva writes `b="true"`, PowerPoint writes `b="1"`. */
function readAttrBoolean(rec: Rec | null, attr: string): boolean | null {
  const value = readAttrString(rec, attr);
  if (value == null) return null;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

function asRecord(value: unknown): Rec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Crop fractions need more precision than layout px: at 4 decimals one unit
 * is ~0.5px on a 4000px-wide sprite, below anything visible. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
