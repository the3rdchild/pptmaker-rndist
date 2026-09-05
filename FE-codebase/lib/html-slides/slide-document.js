// Assembles design tokens + a model-written slide fragment into a standalone
// 1280x720 document for headless Chrome.
//
// CONTRACT_CSS is loaded AFTER the model's own <style>, and its rules are
// !important, so it wins. That is deliberate: the slide is exactly 1280x720
// with overflow hidden, so a model that writes too much gets silently cropped
// rather than producing a 1280x1400 page whose extracted geometry is nonsense.

import { googleFontLink, tokenCss } from "./design-system.js";

export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

const CONTRACT_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
html, body {
  width: ${STAGE_WIDTH}px !important;
  height: ${STAGE_HEIGHT}px !important;
  overflow: hidden !important;
  background: var(--color-bg);
}
.slide {
  position: relative !important;
  width: ${STAGE_WIDTH}px !important;
  height: ${STAGE_HEIGHT}px !important;
  overflow: hidden !important;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: var(--fs-body);
}
/* Effects the editor model cannot represent are neutralised here rather than
   trusted to the prompt — a model that reaches for one gets a flat box, not a
   silently wrong extraction. */
.slide *, .slide *::before, .slide *::after {
  backdrop-filter: none !important;
  filter: none !important;
  mix-blend-mode: normal !important;
  animation: none !important;
  transition: none !important;
}
.slide img { display: block }
.slide img.photo { object-fit: cover }
`;

export function buildSlideDocument(theme, fragmentHtml) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
${googleFontLink(theme)}
<style>
${tokenCss(theme)}
</style>
${fragmentHtml.styleBlock}
<style>
${CONTRACT_CSS}
</style>
</head>
<body>
${fragmentHtml.sectionHtml}
</body>
</html>`;
}

/** Splits the model's reply into its <style> block and its .slide section, and
 *  rejects anything that did not follow the output contract. */
export function parseFragment(raw) {
  const text = raw
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const styleMatch = text.match(/<style[\s\S]*?<\/style>/i);
  const sectionMatch = text.match(/<section[\s\S]*<\/section>/i);
  if (!sectionMatch) {
    throw new Error("Model output has no <section class=\"slide\"> element.");
  }
  let sectionHtml = sectionMatch[0];
  if (!/class\s*=\s*["'][^"']*\bslide\b/.test(sectionHtml)) {
    sectionHtml = sectionHtml.replace(/^<section/i, '<section class="slide"');
  }
  return {
    styleBlock: styleMatch ? styleMatch[0] : "<style></style>",
    sectionHtml,
  };
}
