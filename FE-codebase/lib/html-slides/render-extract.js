// Renders slide documents in headless Chrome and reads them back as editor
// elements, one slide at a time.
//
// This is the step that replaces "the model writes JSON": the browser resolves
// every box, colour and font, and the extractor copies those resolved values
// out. Nothing here guesses a number.
//
// Slides are handed to `onSlide` as they land rather than returned in a batch,
// so a caller streaming to the editor can show slide 1 while slide 4 is still
// rendering.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { ChromeSession } from "./chrome-session.js";
import { extractSlide } from "./dom-extract.js";

export async function renderAndExtract({ htmlPaths, outDir = null, onSlide = null }) {
  const chrome = await ChromeSession.launch();
  const slides = [];
  const warnings = [];

  try {
    for (let index = 0; index < htmlPaths.length; index += 1) {
      await chrome.loadFile(htmlPaths[index]);
      if (outDir) {
        writeFileSync(join(outDir, `slide-${index + 1}.png`), await chrome.screenshot());
      }

      const extracted = await chrome.evaluate(`(${extractSlide.toString()})()`);
      const ui = { elements: extracted.elements, components: [] };
      if (extracted.background) ui.background = extracted.background;
      if (extracted.backgroundStyle) ui.backgroundStyle = extracted.backgroundStyle;

      slides.push({ ui });
      for (const warning of extracted.warnings) warnings.push({ slide: index + 1, message: warning });
      if (onSlide) {
        await onSlide({ index, ui, warnings: extracted.warnings, elementCount: extracted.elements.length });
      }
    }
  } finally {
    await chrome.close();
  }

  return { slides, warnings };
}

/** Element counts by type, for a one-line log of what a slide came back as. */
export function describeElements(elements) {
  const counts = elements.reduce((acc, el) => {
    acc[el.type] = (acc[el.type] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
}
