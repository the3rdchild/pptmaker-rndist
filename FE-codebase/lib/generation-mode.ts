// Which engine builds the deck, and how that choice travels.
//
// The homepage picks it, /outline forwards it, the editor acts on it — three
// files that must agree on the same two strings, so they live here rather than
// being retyped in each.

export const MODE_PARAM = "mode";
export const HTML_THEME_PARAM = "htmlTheme";

export type GenerationMode = "template" | "html";
/** An opaque stored HTML-theme id. It is validated against the registry by the
 *  outline picker and the server; this module only keeps old URLs safe. */
export type HtmlThemeId = string;

export const DEFAULT_HTML_THEME_ID = "corporate-tech-glass";

const MODE_STORAGE_KEY = "ppt_generation_mode";
const HTML_THEME_STORAGE_KEY = "ppt_html_theme";

export function isGenerationMode(value: unknown): value is GenerationMode {
  return value === "template" || value === "html";
}

export function isHtmlThemeId(value: unknown): value is HtmlThemeId {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,48}$/.test(value);
}

/** Old bookmarks used these two source-code palette IDs. They now identify the
 *  equivalent persisted starter themes, so they stay useful after the registry
 *  replaces the old hard-coded switch. */
export function normalizeHtmlThemeId(value: unknown): HtmlThemeId | null {
  if (value === "paper") return "paper-editorial";
  if (value === "midnight") return "midnight-signal";
  return isHtmlThemeId(value) ? value : null;
}

/** Reads the mode out of a URL. Anything unrecognised means template — the
 *  existing pipeline stays the default for every link that predates this. */
export function modeFromParams(params: { get(name: string): string | null }): GenerationMode {
  const raw = params.get(MODE_PARAM);
  return isGenerationMode(raw) ? raw : "template";
}

export function htmlThemeFromParams(params: { get(name: string): string | null }): HtmlThemeId {
  return normalizeHtmlThemeId(params.get(HTML_THEME_PARAM)) ?? DEFAULT_HTML_THEME_ID;
}

/** The homepage remembers the last choice; localStorage can throw in a
 *  locked-down browser, so every access is guarded. */
export function loadStoredMode(): GenerationMode {
  try {
    const raw = localStorage.getItem(MODE_STORAGE_KEY);
    return isGenerationMode(raw) ? raw : "template";
  } catch {
    return "template";
  }
}

export function storeMode(mode: GenerationMode) {
  try {
    if (mode === "template") localStorage.removeItem(MODE_STORAGE_KEY);
    else localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // a browser that blocks storage still gets a working toggle for this visit
  }
}

export function loadStoredHtmlTheme(): HtmlThemeId {
  try {
    const raw = localStorage.getItem(HTML_THEME_STORAGE_KEY);
    return normalizeHtmlThemeId(raw) ?? DEFAULT_HTML_THEME_ID;
  } catch {
    return DEFAULT_HTML_THEME_ID;
  }
}

export function storeHtmlTheme(theme: HtmlThemeId) {
  try {
    localStorage.setItem(HTML_THEME_STORAGE_KEY, theme);
  } catch {
    // as above
  }
}
