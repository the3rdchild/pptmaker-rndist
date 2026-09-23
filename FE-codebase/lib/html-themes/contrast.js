// WCAG contrast between two theme colours. Plain JS so the HTML pipeline can
// use it from the Node CLI as well as from the Next route.

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#RRGGBB` colour. */
export function relativeLuminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio, 1 (none) to 21 (black on white). */
export function contrastRatio(hexA, hexB) {
  const [hi, lo] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pairs a theme's slides actually put text on, and the minimum each needs.
 *  Body text sits on the background and on surface panels; muted text is
 *  captions and labels, so it is held to the large-text bar. */
const TEXT_PAIRS = [
  ["text", "background", 4.5],
  ["text", "surface", 4.5],
  ["muted", "background", 3],
  ["muted", "surface", 3],
];

/** Human-readable problems with a validated theme's text contrast, or []. */
export function themeContrastProblems(colors) {
  const problems = [];
  for (const [fg, bg, min] of TEXT_PAIRS) {
    const ratio = contrastRatio(colors[fg], colors[bg]);
    if (ratio < min) {
      problems.push(`colors.${fg} ${colors[fg]} on colors.${bg} ${colors[bg]} has contrast ${ratio.toFixed(2)}:1, needs at least ${min}:1`);
    }
  }
  return problems;
}
