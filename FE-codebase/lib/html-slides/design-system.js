// Design tokens for one deck, emitted as CSS custom properties.
//
// This is the whole consistency mechanism: the slide prompt tells the model it
// may use ONLY these variables, so five independently generated slides come out
// of five separate LLM calls still looking like one deck. It is also what makes
// extraction tractable — a finite palette and type scale is a finite set of
// computed values to map back into the editor model.

// The registry owns actual theme values; this module only translates that
// validated shape to CSS/prompt tokens used by the HTML renderer.
const BASE_TYPE_SCALE = {
  display: 96,
  h1: 64,
  h2: 44,
  h3: 30,
  lead: 24,
  body: 18,
  small: 15,
  caption: 12,
};

export function typeScaleForTheme(theme) {
  const scale = theme.typography?.scale ?? "balanced";
  const multiplier = scale === "compact" ? 0.9 : scale === "expressive" ? 1.1 : 1;
  return Object.fromEntries(Object.entries(BASE_TYPE_SCALE).map(([key, value]) => [key, Math.round(value * multiplier)]));
}

function tokenName(key) {
  return key === "background" ? "bg" : key;
}

export function tokenCss(theme) {
  const color = Object.entries(theme.colors)
    .map(([key, value]) => `  --color-${tokenName(key)}: ${value};`)
    .join("\n");
  const size = Object.entries(typeScaleForTheme(theme))
    .map(([key, value]) => `  --fs-${key}: ${value}px;`)
    .join("\n");
  return `:root {\n${color}\n${size}\n  --font-heading: "${theme.typography.headingFont}", serif;\n  --font-body: "${theme.typography.bodyFont}", sans-serif;\n}`;
}

// The same token list in the shape the prompt shows the model.
export function tokensForPrompt(theme) {
  const color = Object.entries(theme.colors)
    .map(([key, value]) => `  var(--color-${tokenName(key)})  = ${value}`)
    .join("\n");
  const size = Object.entries(typeScaleForTheme(theme))
    .map(([key, value]) => `  var(--fs-${key})  = ${value}px`)
    .join("\n");
  return `COLORS:\n${color}\n\nTYPE SCALE:\n${size}\n\nFONTS:\n  var(--font-heading) = ${theme.typography.headingFont}\n  var(--font-body)    = ${theme.typography.bodyFont}`;
}

export function googleFontLink(theme) {
  const families = [theme.typography.headingFont, theme.typography.bodyFont]
    .map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800;900`)
    .join("&");
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">`;
}
