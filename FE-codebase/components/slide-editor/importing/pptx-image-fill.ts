import type JSZip from "jszip";
import { asRecord } from "@/components/slide-editor/model/core";
import {
  asArray,
  clamp01,
  readAttrNumber,
  readAttrString,
  round4,
} from "@/components/slide-editor/importing/pptx-xml-read";
import {
  type Box,
  type DeckContext,
  type PartContext,
  type Rec,
} from "@/components/slide-editor/importing/pptx-context";

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

/** The vector original behind a picture, when the file carries one.
 *
 * `a:blip/@r:embed` is only the RASTER FALLBACK. A deck exported from Canva
 * (or PowerPoint 2016+ itself) writes every piece of vector artwork twice: a
 * flattened PNG for old readers, and the real SVG hung off the blip in an
 * extension list. PowerPoint draws the SVG, which is why the same icon looks
 * crisp there and soft here — the fallback PNGs are tiny. In the deck this was
 * traced on, the road is a 500x208 PNG stretched across 770px and the step
 * icons are 24x24 PNGs, against 79 SVGs sitting unused in the same file. */
function svgBlipId(blip: Rec | null): string | null {
  for (const ext of asArray(asRecord(blip?.["a:extLst"])?.["a:ext"])) {
    const id = readAttrString(asRecord(asRecord(ext)?.["asvg:svgBlip"]), "@_r:embed");
    if (id) return id;
  }
  return null;
}

/** Media for a blip, preferring its vector original and falling back to the
 * raster copy — including when the SVG is referenced but missing from the zip. */
async function blipDataUrl(blip: Rec | null, ctx: PartContext): Promise<string | null> {
  const svgId = svgBlipId(blip);
  const svgTarget = svgId ? ctx.rels.byId.get(svgId) : null;
  if (svgTarget) {
    const vector = await mediaDataUrl(ctx.deck, svgTarget);
    if (vector) return vector;
  }
  const rid = readAttrString(blip, "@_r:embed");
  const target = rid ? ctx.rels.byId.get(rid) : null;
  return target ? mediaDataUrl(ctx.deck, target) : null;
}

export async function imageFromBlipFill(
  blipFill: Rec | null,
  ctx: PartContext,
  box: Box,
): Promise<{ el: Rec; box: Box } | null> {
  const blip = asRecord(blipFill?.["a:blip"]);
  if (!blip || !blipFill) return null;

  const dataUrl = await blipDataUrl(blip, ctx);
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
      // Imported artwork is content, not an empty photo slot. Without this an
      // icon clipped to its hexagon reads as an image container to the frame
      // detector (a clip used to mean exactly that), and the generator would
      // paint a stock photo over every icon on the page. The operator marks
      // the real photo slots in the template panel.
      is_frame: false,
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
  if (entry && mime) {
    // Shrink from the raw bytes, never from a data URL: base64-encoding a
    // 6MB photo only to decode it straight back was most of the import's
    // time. The base64 is produced only for what actually ships.
    const shrunk = await shrinkOversizedImage(entry, mime);
    dataUrl = shrunk ?? `data:${mime};base64,${await entry.async("base64")}`;
  }
  deck.mediaCache.set(path, dataUrl);
  return dataUrl;
}

/** Longest edge worth keeping. The editor stage is 1280x720 and the PDF export
 * rasterises it at 2x, so nothing is ever sampled above ~2560px — a source
 * wider than that is carrying detail no output can show. */
const MAX_IMAGE_DIMENSION = 2560;
/** Below this, re-encoding costs more than it saves. */
const IMAGE_SHRINK_THRESHOLD_BYTES = 256 * 1024;

/** Re-encodes a print-resolution photo down to what the canvas can actually
 * display. Decks routinely embed originals far beyond that — one sample deck
 * carries a single 19.5MB image, another reaches 148MB of inline base64 across
 * ten slides — and every byte is then paid again on each autosave, undo
 * snapshot and clone, because the importer inlines media as data URLs.
 *
 * WebP, not JPEG: imported artwork is full of cut-out shapes and icons whose
 * transparency JPEG would flatten onto a black box. A browser without WebP
 * encoding falls back to PNG per the canvas spec, which still gets the
 * downscale. SVG is skipped — it is vector, already small, and rasterising it
 * would throw away the very thing that makes it sharp.
 *
 * No-ops outside the browser (no canvas), so the import stays usable headlessly
 * and in any server-side path. */
async function shrinkOversizedImage(
  entry: JSZip.JSZipObject,
  mime: string,
): Promise<string | null> {
  if (mime === "image/svg+xml" || mime === "image/gif") return null;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return null;

  try {
    const blob: Blob = await entry.async("blob");
    if (blob.size < IMAGE_SHRINK_THRESHOLD_BYTES) return null;

    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const encoded = canvas.toDataURL("image/webp", 0.9);
    // Re-encoding can lose to the original (an already-optimised PNG, or a
    // browser that fell back to PNG at a size it can't beat). base64 costs
    // about 4/3 of the raw bytes, which is what the original would ship as —
    // keep whichever is actually smaller so this never makes a deck heavier.
    return encoded.length < blob.size * (4 / 3) ? encoded : null;
  } catch {
    // A decode failure must not lose the image — fall back to the raw bytes.
    return null;
  }
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
