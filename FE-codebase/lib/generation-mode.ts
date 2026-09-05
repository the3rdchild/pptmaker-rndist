// Which engine builds the deck, and how that choice travels.
//
// The homepage picks it, /outline forwards it, the editor acts on it — three
// files that must agree on the same two strings, so they live here rather than
// being retyped in each.

export const MODE_PARAM = "mode";
export const HTML_THEME_PARAM = "htmlTheme";

export type GenerationMode = "template" | "html";
export type HtmlThemeId = "paper" | "midnight";

export const HTML_THEMES: { id: HtmlThemeId; label: string }[] = [
  { id: "paper", label: "Terang" },
  { id: "midnight", label: "Gelap" },
];

const MODE_STORAGE_KEY = "ppt_generation_mode";
const HTML_THEME_STORAGE_KEY = "ppt_html_theme";

export function isGenerationMode(value: unknown): value is GenerationMode {
  return value === "template" || value === "html";
}

export function isHtmlThemeId(value: unknown): value is HtmlThemeId {
  return value === "paper" || value === "midnight";
}

/** Reads the mode out of a URL. Anything unrecognised means template — the
 *  existing pipeline stays the default for every link that predates this. */
export function modeFromParams(params: { get(name: string): string | null }): GenerationMode {
  const raw = params.get(MODE_PARAM);
  return isGenerationMode(raw) ? raw : "template";
}

export function htmlThemeFromParams(params: { get(name: string): string | null }): HtmlThemeId {
  const raw = params.get(HTML_THEME_PARAM);
  return isHtmlThemeId(raw) ? raw : "paper";
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
    return isHtmlThemeId(raw) ? raw : "paper";
  } catch {
    return "paper";
  }
}

export function storeHtmlTheme(theme: HtmlThemeId) {
  try {
    localStorage.setItem(HTML_THEME_STORAGE_KEY, theme);
  } catch {
    // as above
  }
}
