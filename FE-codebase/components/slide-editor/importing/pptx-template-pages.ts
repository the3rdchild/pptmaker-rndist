// Brings a .pptx into the template engine as authorable pages.
//
// The deck importer (pptx-import.ts) is shared with the dashboard's "Import
// .pptx", but a deck and a template want different things from the media it
// carries. A deck keeps images inlined as `data:` URLs, matching how pasted
// images are stored. A template is a JSON file committed to the repo, so an
// inlined image is megabytes of base64 in the diff — the exporter warns about
// exactly that. Here every image is written into the theme's static/ folder
// first and referenced by URL, which also collapses the many references a
// deck makes to the same file (a Canva export tiles one pattern image across
// every slide) onto a single asset.

import {
  importPptxFile,
  resolveUnresolvedFonts,
  type FontSubstitution,
} from "@/components/slide-editor/importing/pptx-import";

type Rec = Record<string, unknown>;

export type TemplatePagesImport = {
  /** One `ui` record per source slide, ready to drop onto the canvas. */
  pages: Rec[];
  /** Distinct images written into the theme, and how many were already there. */
  assetCount: number;
  reusedAssetCount: number;
  skippedShapeCount: number;
  /** Images that could not be stored; those elements keep their inline data so
   *  the page still renders, and the author is told which ones. */
  failedAssetCount: number;
  /** Font names from the source that the renderer cannot resolve and were
   *  rewritten to a similar Google Font. Empty in the common case. */
  fontSubstitutions: FontSubstitution[];
};

export type TemplateImportProgress = {
  stage: "parsing" | "assets" | "done";
  done: number;
  total: number;
};

function isRecord(value: unknown): value is Rec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Every distinct `data:` URL held by an image/media element in the tree. */
function collectDataUrls(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectDataUrls(item, into));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, raw] of Object.entries(value)) {
    if (
      (key === "data" || key === "src" || key === "poster") &&
      typeof raw === "string" &&
      raw.startsWith("data:")
    ) {
      into.add(raw);
      continue;
    }
    collectDataUrls(raw, into);
  }
}

function replaceDataUrls(value: unknown, urls: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceDataUrls(item, urls));
  }
  if (!isRecord(value)) return value;
  const out: Rec = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      (key === "data" || key === "src" || key === "poster") &&
      typeof raw === "string"
    ) {
      out[key] = urls.get(raw) ?? raw;
      continue;
    }
    out[key] = replaceDataUrls(raw, urls);
  }
  return out;
}

async function storeAsset(themeId: string, dataUrl: string): Promise<{ url: string; reused: boolean }> {
  const res = await fetch("/api/template-engine/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ themeId, data: dataUrl }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "Could not store the image");
  return { url: String(body.url), reused: Boolean(body.reused) };
}

export async function importPptxAsTemplatePages(
  file: File,
  themeId: string,
  onProgress?: (progress: TemplateImportProgress) => void,
): Promise<TemplatePagesImport> {
  onProgress?.({ stage: "parsing", done: 0, total: 0 });
  const parsed = await importPptxFile(file);
  // Resolve unresolved fonts BEFORE extracting image data URLs so the rewrite
  // applies to the same tree the pages are built from.
  const deck = await resolveUnresolvedFonts(parsed);

  const dataUrls = new Set<string>();
  deck.slides.forEach((slide) => collectDataUrls(slide.ui, dataUrls));

  const stored = new Map<string, string>();
  let reusedAssetCount = 0;
  let failedAssetCount = 0;
  const total = dataUrls.size;
  let done = 0;
  onProgress?.({ stage: "assets", done, total });

  // Sequential on purpose: each request carries a whole image, and the point of
  // this loop is a repo write, not throughput.
  for (const dataUrl of dataUrls) {
    try {
      const result = await storeAsset(themeId, dataUrl);
      stored.set(dataUrl, result.url);
      if (result.reused) reusedAssetCount += 1;
    } catch {
      // Leave the inline data in place: a page that renders with a fat image
      // beats a page with a hole in it. The exporter warns again on save.
      failedAssetCount += 1;
    }
    done += 1;
    onProgress?.({ stage: "assets", done, total });
  }

  const baseName = file.name.replace(/\.pptx$/i, "").trim() || "Imported";
  const pages = deck.slides.map((slide, index) => {
    const ui = replaceDataUrls(slide.ui, stored) as Rec;
    return {
      ...ui,
      // Blank, like a new layout: the author names the page and the panel
      // derives the layout id from that name on save.
      id: "",
      description: "",
      name: `${baseName} ${index + 1}`,
    };
  });

  onProgress?.({ stage: "done", done, total });

  return {
    pages,
    assetCount: stored.size,
    reusedAssetCount,
    skippedShapeCount: deck.skippedShapeCount,
    failedAssetCount,
    fontSubstitutions: deck.fontSubstitutions,
  };
}
