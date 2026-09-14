const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,48}$/;
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const HTML_THEME_ROLES = [
  "cover",
  "content",
  "stat",
  "comparison",
  "quote",
  "section",
  "visual",
  "closing",
];

export const HTML_THEME_COMPOSITIONS = [
  "centered",
  "split-left",
  "split-right",
  "editorial-right",
  "two-column",
  "metric-rail",
  "visual-focus",
  "quote-statement",
  "full-bleed",
];

export const GOOGLE_FONT_FAMILIES = [
  "Inter", "Syne", "Unbounded", "Public Sans", "Albert Sans", "DM Sans",
  "DM Serif Display", "Overpass", "Barlow", "Nunito", "Nunito Sans", "Lora",
  "Instrument Sans", "Roboto", "Roboto Slab", "Open Sans", "Lato", "Source Sans 3",
  "Source Sans Pro", "Source Serif 4", "Montserrat", "Poppins", "Playfair Display",
  "Libre Baskerville", "Prompt", "Inconsolata", "Fraunces", "Gelasio", "Raleway",
  "Kanit", "Corben", "Noto Sans", "Noto Serif", "Work Sans", "Manrope", "Rubik",
  "Oswald", "Merriweather", "Bebas Neue", "Anton", "Archivo Black",
];

const COLOR_KEYS = ["background", "surface", "primary", "secondary", "accent", "text", "muted", "border"];
const EFFECTS = {
  surface: ["flat", "translucent", "gradient"],
  radius: ["none", "soft", "round"],
  shadow: ["none", "subtle", "elevated"],
  imageTreatment: ["natural", "monochrome", "duotone"],
  grid: ["none", "subtle", "technical"],
  slideNumber: ["none", "minimal", "rule"],
};
const REGION_KINDS = ["heading", "body", "bullets", "metric", "image", "quote", "label", "footer"];
const REGION_PLACEMENTS = ["left", "center", "right", "top", "bottom", "background"];
const REGION_EMPHASIS = ["primary", "secondary", "supporting"];
const DECORATIONS = ["accent-rule", "grid", "pill", "slide-number", "section-index", "icon-box"];

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label, max, { allowEmpty = false } = {}) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const next = value.trim();
  if (!allowEmpty && !next) throw new Error(`${label} is required`);
  if (next.length > max) throw new Error(`${label} must be at most ${max} characters`);
  return next;
}

function choice(value, label, values) {
  if (!values.includes(value)) throw new Error(`${label} must be one of ${values.join(", ")}`);
  return value;
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
  return values;
}

function textList(value, label, { maxItems = 10, maxItemLength = 180 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must contain at most ${maxItems} items`);
  return unique(value.map((item, index) => text(item, `${label}[${index}]`, maxItemLength)), label);
}

export function assertSafeHtmlThemeId(value) {
  const id = text(value, "id", 49);
  if (!ID_PATTERN.test(id)) throw new Error("id must be a lowercase safe slug");
  return id;
}

export function resolveHtmlThemeId(value) {
  if (value === "paper") return "paper-editorial";
  if (value === "midnight") return "midnight-signal";
  if (typeof value !== "string") return null;
  const id = value.trim();
  return ID_PATTERN.test(id) ? id : null;
}

function parseColors(value) {
  const colors = record(value, "colors");
  return Object.fromEntries(COLOR_KEYS.map((key) => {
    const color = text(colors[key], `colors.${key}`, 7);
    if (!HEX_PATTERN.test(color)) throw new Error(`colors.${key} must be a six-digit hex colour`);
    return [key, color.toUpperCase()];
  }));
}

function parseRecipe(value, index) {
  const recipe = record(value, `recipes[${index}]`);
  const roles = unique(
    (Array.isArray(recipe.roles) ? recipe.roles : []).map((role) => choice(role, `recipes[${index}].roles`, HTML_THEME_ROLES)),
    `recipes[${index}].roles`,
  );
  if (!roles.length) throw new Error(`recipes[${index}].roles is required`);
  const regions = Array.isArray(recipe.regions) ? recipe.regions : [];
  if (regions.length > 8) throw new Error(`recipes[${index}].regions must contain at most 8 items`);
  const decorations = Array.isArray(recipe.decorations) ? recipe.decorations : [];
  return {
    id: assertSafeHtmlThemeId(recipe.id),
    name: text(recipe.name, `recipes[${index}].name`, 80),
    roles,
    composition: choice(recipe.composition, `recipes[${index}].composition`, HTML_THEME_COMPOSITIONS),
    description: text(recipe.description ?? "", `recipes[${index}].description`, 300, { allowEmpty: true }),
    regions: regions.map((region, regionIndex) => {
      const entry = record(region, `recipes[${index}].regions[${regionIndex}]`);
      return {
        kind: choice(entry.kind, `recipes[${index}].regions[${regionIndex}].kind`, REGION_KINDS),
        placement: choice(entry.placement, `recipes[${index}].regions[${regionIndex}].placement`, REGION_PLACEMENTS),
        emphasis: choice(entry.emphasis, `recipes[${index}].regions[${regionIndex}].emphasis`, REGION_EMPHASIS),
      };
    }),
    decorations: unique(decorations.map((item) => choice(item, `recipes[${index}].decorations`, DECORATIONS)), `recipes[${index}].decorations`),
    instructions: text(recipe.instructions ?? "", `recipes[${index}].instructions`, 1400, { allowEmpty: true }),
  };
}

export function parseHtmlTheme(value) {
  const theme = record(value, "theme");
  if (theme.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  const recipes = Array.isArray(theme.recipes) ? theme.recipes.map(parseRecipe) : [];
  if (!recipes.length) throw new Error("recipes must contain at least one recipe");
  unique(recipes.map((recipe) => recipe.id), "recipes");
  const effects = record(theme.effects, "effects");
  const guidance = record(theme.guidance, "guidance");
  const typography = record(theme.typography, "typography");
  const headingFont = choice(typography.headingFont, "typography.headingFont", GOOGLE_FONT_FAMILIES);
  const bodyFont = choice(typography.bodyFont, "typography.bodyFont", GOOGLE_FONT_FAMILIES);
  return {
    schemaVersion: 1,
    id: assertSafeHtmlThemeId(theme.id),
    name: text(theme.name, "name", 100),
    description: text(theme.description ?? "", "description", 500, { allowEmpty: true }),
    previewUrl: theme.previewUrl == null ? null : text(theme.previewUrl, "previewUrl", 2048),
    backgroundImageUrl: theme.backgroundImageUrl == null ? null : text(theme.backgroundImageUrl, "backgroundImageUrl", 2048),
    colors: parseColors(theme.colors),
    typography: {
      headingFont,
      bodyFont,
      scale: choice(typography.scale, "typography.scale", ["compact", "balanced", "expressive"]),
    },
    effects: Object.fromEntries(Object.entries(EFFECTS).map(([key, values]) => [key, choice(effects[key], `effects.${key}`, values)])),
    guidance: {
      artDirection: text(guidance.artDirection ?? "", "guidance.artDirection", 1600, { allowEmpty: true }),
      dos: textList(guidance.dos ?? [], "guidance.dos"),
      donts: textList(guidance.donts ?? [], "guidance.donts"),
    },
    recipes,
    updatedAt: theme.updatedAt == null ? null : text(theme.updatedAt, "updatedAt", 64),
  };
}

export function htmlThemeSummary(theme, { isDefault = false } = {}) {
  const parsed = parseHtmlTheme(theme);
  return {
    id: parsed.id,
    name: parsed.name,
    description: parsed.description,
    previewUrl: parsed.previewUrl,
    backgroundImageUrl: parsed.backgroundImageUrl,
    colors: parsed.colors,
    typography: parsed.typography,
    effects: parsed.effects,
    firstRecipe: parsed.recipes[0]?.name ?? "",
    recipeCount: parsed.recipes.length,
    isDefault,
    updatedAt: parsed.updatedAt,
  };
}

export function selectRecipe(theme, role, slideIndex = 0) {
  const parsed = parseHtmlTheme(theme);
  const matching = parsed.recipes.filter((recipe) => recipe.roles.includes(role));
  const candidates = matching.length ? matching : parsed.recipes.filter((recipe) => recipe.roles.includes("content"));
  const selected = candidates.length ? candidates : parsed.recipes;
  return selected[Math.abs(Number(slideIndex) || 0) % selected.length];
}

export function deleteFromHtmlThemeIndex(index, themeId) {
  const value = record(index, "index");
  const id = assertSafeHtmlThemeId(themeId);
  const themes = unique((Array.isArray(value.themes) ? value.themes : []).map(assertSafeHtmlThemeId), "index.themes");
  if (!themes.includes(id)) throw new Error(`Theme "${id}" does not exist`);
  if (themes.length === 1) throw new Error("Cannot delete the last remaining HTML theme");
  const nextThemes = themes.filter((entry) => entry !== id);
  return {
    schemaVersion: 1,
    defaultThemeId: value.defaultThemeId === id ? nextThemes[0] : assertSafeHtmlThemeId(value.defaultThemeId),
    themes: nextThemes,
  };
}

export function createBlankHtmlTheme({ id, name = "Untitled HTML Theme" } = {}) {
  return {
    schemaVersion: 1,
    id: assertSafeHtmlThemeId(id),
    name,
    description: "",
    previewUrl: null,
    backgroundImageUrl: null,
    colors: {
      background: "#101828", surface: "#1D2939", primary: "#7F56D9", secondary: "#98A2B3",
      accent: "#FEC84B", text: "#F9FAFB", muted: "#D0D5DD", border: "#344054",
    },
    typography: { headingFont: "Manrope", bodyFont: "Inter", scale: "balanced" },
    effects: { surface: "translucent", radius: "soft", shadow: "subtle", imageTreatment: "natural", grid: "none", slideNumber: "minimal" },
    guidance: { artDirection: "", dos: [], donts: [] },
    recipes: [{
      id: "cover", name: "Cover", roles: ["cover"], composition: "split-left", description: "A clear title with one visual anchor.",
      regions: [{ kind: "heading", placement: "left", emphasis: "primary" }, { kind: "image", placement: "right", emphasis: "secondary" }],
      decorations: ["accent-rule", "slide-number"], instructions: "Keep the title concise and protect a generous safe margin.",
    }],
    updatedAt: null,
  };
}
