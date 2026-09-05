// Renders slide documents in headless Chrome and reads them back as a deck
// payload in the editor's own shape.
//
// This is the step that replaces "the model writes JSON": the browser resolves
// every box, colour and font, and the extractor copies those resolved values
// out. Nothing here guesses a number.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { ChromeSession } from "./chrome-session.js";
import { extractSlide } from "./dom-extract.js";

export async function renderAndExtract({ htmlPaths, title, outDir, log = console.log }) {
  const chrome = await ChromeSession.launch();
  const slides = [];
  const warnings = [];

  try {
    for (let index = 0; index < htmlPaths.length; index += 1) {
      await chrome.loadFile(htmlPaths[index]);
      writeFileSync(join(outDir, `slide-${index + 1}.png`), await chrome.screenshot());

      const extracted = await chrome.evaluate(`(${extractSlide.toString()})()`);
      const counts = extracted.elements.reduce((acc, el) => {
        acc[el.type] = (acc[el.type] ?? 0) + 1;
        return acc;
      }, {});
      const summary = Object.entries(counts)
        .map(([type, count]) => `${count} ${type}`)
        .join(", ");
      log(
        `      slide ${index + 1}: ${extracted.elements.length} elements (${summary})` +
          (extracted.warnings.length ? ` — ${extracted.warnings.length} warning(s)` : ""),
      );
      for (const warning of extracted.warnings) {
        log(`         ! ${warning}`);
        warnings.push(`slide ${index + 1}: ${warning}`);
      }

      const ui = { elements: extracted.elements, components: [] };
      if (extracted.background) ui.background = extracted.background;
      if (extracted.backgroundStyle) ui.backgroundStyle = extracted.backgroundStyle;
      slides.push({ ui });
    }
  } finally {
    await chrome.close();
  }

  const deck = { title, slides };
  const deckPath = join(outDir, "deck.json");
  writeFileSync(deckPath, JSON.stringify(deck, null, 2), "utf8");
  const bytes = Buffer.byteLength(JSON.stringify(deck));
  log(`      ${deckPath} — ${slides.length} slides, ${(bytes / 1024).toFixed(1)} KB`);
  log(`      ${warnings.length} warning(s) total`);

  return { deck, warnings };
}
