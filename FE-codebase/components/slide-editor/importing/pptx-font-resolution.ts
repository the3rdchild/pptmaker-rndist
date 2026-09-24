import { asRecord } from "@/components/slide-editor/model/core";
import { childArrayInfo } from "@/components/slide-editor/model/model";
import { asArray } from "@/components/slide-editor/importing/pptx-xml-read";
import {
  isGoogleFontFamily,
  loadGoogleFontOptions,
} from "@/components/slide-editor/text/google-fonts";
import { getGlobalFonts } from "@/lib/fonts/global-fonts";
import { type Rec } from "@/components/slide-editor/importing/pptx-context";

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
