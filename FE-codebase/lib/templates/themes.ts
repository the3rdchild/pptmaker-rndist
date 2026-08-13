// Central registry for template themes ("packs").
//
// A theme is one prefix in the storage bucket, templates/<id>/, holding:
//   template.json — the built layout bundle the renderer consumes
//   theme.json    — hand-authored theme metadata (AI guidance + palette)
//   layouts/*.json — per-layout sources written by the template engine
//   static/…      — the theme's own images
//
// Manifests are read through /api/templates/… (server-side, so no bucket CORS
// policy is required); the images they reference are absolute CDN URLs the
// browser loads directly.
//
// Everything that needs template layouts goes through here so that (a) the
// four separate `fetch(".../general/template.json")` call sites stop
// disagreeing about which theme is active, and (b) every layout is tagged
// with the theme it came from before it reaches the editor — asset paths and
// the template engine's save target both depend on knowing that.

import { normalizeBackendAssetUrls } from "@/utils/api";

/** Fallback theme ids. Nothing ships in the repo any more, so this only
 *  covers the window where index.json has not been written yet. */
const BUILTIN_THEME_IDS = ["general", "modern", "standard", "swift"] as const;

/** Where a theme's default thumbnail lives when its bundle names none. Points
 *  at the same-origin asset route rather than the CDN, so it needs no public
 *  bucket URL on the client and no CORS. Every other asset URL arrives inside
 *  the layout JSON already resolved by the server. */
const THUMBNAIL_BASE = "/api/templates/asset/templates";

/** Theme used when no other choice has been made (blank deck, new slide). */
export const DEFAULT_THEME_ID = "general";

/** Key stamped onto every layout so downstream code can recover its theme.
 *  Underscore-prefixed to stay clear of Template V2's own field names. */
export const LAYOUT_THEME_KEY = "__theme";

export type ThemeAiGuidance = {
  when_to_use?: string | null;
  avoid_when?: string | null;
  tone?: string[] | null;
  keywords?: string[] | null;
};

export type ThemePalette = {
  background?: string | null;
  surface?: string | null;
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
  text?: string | null;
  muted?: string | null;
  border?: string | null;
};

export type TemplateLayout = Record<string, unknown> & {
  id?: string;
  /** Human-readable page name (auto-label authors it; the id stays the slug). */
  name?: string;
  description?: string;
};

export type TemplateTheme = {
  /** Prefix name under templates/ — the stable identity used everywhere. */
  id: string;
  name: string;
  description: string;
  thumbnail: string | null;
  fonts: Record<string, string> | null;
  ai: ThemeAiGuidance | null;
  palette: ThemePalette | null;
  layouts: TemplateLayout[];
  mergedComponents: unknown[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

let themeIdsPromise: Promise<string[]> | null = null;

export async function listThemeIds(): Promise<string[]> {
  if (!themeIdsPromise) {
    themeIdsPromise = (async () => {
      const index = asRecord(await fetchJson("/api/templates/index.json"));
      const ids = Array.isArray(index?.themes)
        ? index.themes.filter((id): id is string => typeof id === "string")
        : [];
      return ids.length > 0 ? ids : [...BUILTIN_THEME_IDS];
    })();
  }
  return themeIdsPromise;
}

const themePromises = new Map<string, Promise<TemplateTheme | null>>();

export async function loadTheme(id: string): Promise<TemplateTheme | null> {
  const cached = themePromises.get(id);
  if (cached) return cached;

  const promise = (async (): Promise<TemplateTheme | null> => {
    const [bundleRaw, metaRaw] = await Promise.all([
      fetchJson(`/api/templates/${id}/template.json`),
      fetchJson(`/api/templates/${id}/theme.json`),
    ]);
    const bundle = asRecord(bundleRaw);
    if (!bundle) return null;
    const meta = asRecord(metaRaw);

    const rawLayouts = Array.isArray(bundle.layouts) ? bundle.layouts : [];
    const layouts = rawLayouts
      .filter((layout): layout is Record<string, unknown> => Boolean(asRecord(layout)))
      // Resolve asset paths against THIS theme's folder, not a global default,
      // then stamp the theme so the layout stays self-describing once it has
      // been copied into a deck.
      .map((layout) => ({
        ...normalizeBackendAssetUrls(layout, id),
        [LAYOUT_THEME_KEY]: id,
      })) as TemplateLayout[];

    return {
      id,
      name: readString(meta?.name) ?? readString(bundle.name) ?? id,
      description:
        readString(meta?.description) ?? readString(bundle.description) ?? "",
      thumbnail:
        readString(bundle.thumbnail) ??
        `${THUMBNAIL_BASE}/${id}/static/thumbnail.png`,
      fonts: (asRecord(bundle.fonts) as Record<string, string> | null) ?? null,
      ai: (asRecord(meta?.ai) as ThemeAiGuidance | null) ?? null,
      palette: (asRecord(meta?.palette) as ThemePalette | null) ?? null,
      layouts,
      mergedComponents: Array.isArray(bundle.merged_components)
        ? bundle.merged_components
        : [],
    };
  })();

  themePromises.set(id, promise);
  return promise;
}

export async function loadAllThemes(): Promise<TemplateTheme[]> {
  const ids = await listThemeIds();
  const themes = await Promise.all(ids.map((id) => loadTheme(id)));
  return themes.filter((theme): theme is TemplateTheme => Boolean(theme));
}

/** A guaranteed-usable theme for callers that need actual layout content and
 *  have no preference of their own (a blank deck, the AI assistant's
 *  "add slide" tool) — DEFAULT_THEME_ID when it actually has layouts,
 *  otherwise the first theme in the registry that does.
 *
 *  DEFAULT_THEME_ID is a stable id, not a guarantee: an id can be listed in
 *  index.json (so it's visible for management in the template engine) while
 *  holding zero layouts — never populated, or mid-rebuild. loadTheme(id)
 *  alone doesn't protect against that; this does, so a caller that hands the
 *  result straight to something like walkUi() never gets an empty/undefined
 *  layout back. Returns null only if literally no theme anywhere has any
 *  layouts, which should never happen outside a fully empty bucket. */
export async function loadDefaultTheme(): Promise<TemplateTheme | null> {
  const preferred = await loadTheme(DEFAULT_THEME_ID);
  if (preferred && preferred.layouts.length > 0) return preferred;
  const all = await loadAllThemes();
  return all.find((theme) => theme.layouts.length > 0) ?? null;
}

/** Recovers the theme a layout came from. Layouts loaded through this module
 *  carry the tag; anything older falls back to the first shipped theme. */
export function themeIdOfLayout(layout: unknown): string {
  const record = asRecord(layout);
  return readString(record?.[LAYOUT_THEME_KEY]) ?? BUILTIN_THEME_IDS[0];
}

/** Drops the registry tag before a layout is written back to disk. */
export function stripLayoutThemeTag<T extends Record<string, unknown>>(
  layout: T
): Omit<T, typeof LAYOUT_THEME_KEY> {
  const { [LAYOUT_THEME_KEY]: _theme, ...rest } = layout;
  return rest;
}

/** Test seam — the browser caches themes for the page's lifetime, but the
 *  template engine has to see a layout it just saved. */
export function invalidateThemeCache(id?: string): void {
  if (id) themePromises.delete(id);
  else themePromises.clear();
  themeIdsPromise = null;
}
