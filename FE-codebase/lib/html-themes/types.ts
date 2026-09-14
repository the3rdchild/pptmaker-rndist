export type HtmlSlideRole =
  | "cover" | "content" | "stat" | "comparison" | "quote" | "section" | "visual" | "closing";

export type HtmlThemeRecipe = {
  id: string;
  name: string;
  roles: HtmlSlideRole[];
  composition: string;
  description: string;
  regions: Array<{ kind: string; placement: string; emphasis: string }>;
  decorations: string[];
  instructions: string;
};

export type HtmlTheme = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  previewUrl: string | null;
  colors: Record<"background" | "surface" | "primary" | "secondary" | "accent" | "text" | "muted" | "border", string>;
  typography: { headingFont: string; bodyFont: string; scale: "compact" | "balanced" | "expressive" };
  effects: { surface: "flat" | "translucent" | "gradient"; radius: "none" | "soft" | "round"; shadow: "none" | "subtle" | "elevated"; imageTreatment: "natural" | "monochrome" | "duotone"; grid: "none" | "subtle" | "technical"; slideNumber: "none" | "minimal" | "rule" };
  guidance: { artDirection: string; dos: string[]; donts: string[] };
  recipes: HtmlThemeRecipe[];
  updatedAt: string | null;
};

export type HtmlThemeSummary = Pick<HtmlTheme, "id" | "name" | "description" | "previewUrl" | "updatedAt"> & {
  recipeCount: number;
  isDefault: boolean;
  colors: HtmlTheme["colors"];
  typography: HtmlTheme["typography"];
  effects: HtmlTheme["effects"];
  firstRecipe: string;
};

export type HtmlThemeRegistry = { themes: HtmlThemeSummary[]; defaultThemeId: string | null };
