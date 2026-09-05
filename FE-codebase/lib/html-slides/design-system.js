// Design tokens for one deck, emitted as CSS custom properties.
//
// This is the whole consistency mechanism: the slide prompt tells the model it
// may use ONLY these variables, so five independently generated slides come out
// of five separate LLM calls still looking like one deck. It is also what makes
// extraction tractable — a finite palette and type scale is a finite set of
// computed values to map back into the editor model.

export const THEMES = {
  midnight: {
    name: "Midnight",
    fontHeading: "Manrope",
    fontBody: "Inter",
    colors: {
      bg: "#0B0F1A",
      surface: "#151B2B",
      primary: "#6C8CFF",
      accent: "#F5C563",
      text: "#F2F5FF",
      muted: "#8B94AD",
    },
  },
  paper: {
    name: "Paper",
    fontHeading: "Fraunces",
    fontBody: "Inter",
    colors: {
      bg: "#FBF8F3",
      surface: "#FFFFFF",
      primary: "#1F4B3F",
      accent: "#C4622D",
      text: "#1A1A18",
      muted: "#6E6A62",
    },
  },
};

// One px scale for the whole deck. The model picks a step, never a number.
export const TYPE_SCALE = {
  display: 96,
  h1: 64,
  h2: 44,
  h3: 30,
  lead: 24,
  body: 18,
  small: 15,
  caption: 12,
};

export function themeById(id) {
  const theme = THEMES[id];
  if (!theme) throw new Error(`Unknown theme "${id}". Known: ${Object.keys(THEMES).join(", ")}`);
  return theme;
}

export function tokenCss(theme) {
  const color = Object.entries(theme.colors)
    .map(([key, value]) => `  --color-${key}: ${value};`)
    .join("\n");
  const size = Object.entries(TYPE_SCALE)
    .map(([key, value]) => `  --fs-${key}: ${value}px;`)
    .join("\n");
  return `:root {\n${color}\n${size}\n  --font-heading: "${theme.fontHeading}", serif;\n  --font-body: "${theme.fontBody}", sans-serif;\n}`;
}

// The same token list in the shape the prompt shows the model.
export function tokensForPrompt(theme) {
  const color = Object.entries(theme.colors)
    .map(([key, value]) => `  var(--color-${key})  = ${value}`)
    .join("\n");
  const size = Object.entries(TYPE_SCALE)
    .map(([key, value]) => `  var(--fs-${key})  = ${value}px`)
    .join("\n");
  return `COLORS:\n${color}\n\nTYPE SCALE:\n${size}\n\nFONTS:\n  var(--font-heading) = ${theme.fontHeading}\n  var(--font-body)    = ${theme.fontBody}`;
}

export function googleFontLink(theme) {
  const families = [theme.fontHeading, theme.fontBody]
    .map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800;900`)
    .join("&");
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">`;
}
