// CLI for the HTML generation mode — the same pipeline the editor's HTML
// toggle runs, driven from a terminal so it can be watched and iterated on.
//
//   node FE-codebase/lib/html-slides/generate.js --topic "..." --slides 5 --theme paper
//   node FE-codebase/lib/html-slides/generate.js --reuse
//
// --reuse re-renders the HTML already in out/ instead of generating it again,
// so a change to the extractor can be checked against the same slides for free.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateDeck } from "./deck-pipeline.js";
import { describeElements, renderAndExtract } from "./render-extract.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "out");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const log = console.log;

function writeDeck(deck) {
  const deckPath = join(OUT_DIR, "deck.json");
  writeFileSync(deckPath, JSON.stringify(deck, null, 2), "utf8");
  const kb = (Buffer.byteLength(JSON.stringify(deck)) / 1024).toFixed(1);
  log(`\n${deckPath} — ${deck.slides.length} slides, ${kb} KB`);
}

async function reuse() {
  const htmlPaths = [];
  for (let i = 1; existsSync(join(OUT_DIR, `slide-${i}.html`)); i += 1) {
    htmlPaths.push(join(OUT_DIR, `slide-${i}.html`));
  }
  if (htmlPaths.length === 0) throw new Error(`No slide-N.html files in ${OUT_DIR}`);
  log(`reusing ${htmlPaths.length} slide documents in ${OUT_DIR}\n`);

  const { slides, warnings } = await renderAndExtract({
    htmlPaths,
    outDir: OUT_DIR,
    onSlide: ({ index, ui, elementCount }) =>
      log(`  slide ${index + 1}: ${elementCount} elements (${describeElements(ui.elements)})`),
  });
  for (const warning of warnings) log(`  ! slide ${warning.slide}: ${warning.message}`);
  writeDeck({ title: arg("title", "Reused deck"), slides });
}

async function fresh() {
  const topic = arg("topic", "Kopi specialty Indonesia: dari kebun ke cangkir");
  const themeId = arg("theme", "paper");
  const provider = arg("provider", undefined);
  const slideCount = Number(arg("slides", "5"));

  log(`topic : ${topic}`);
  log(`theme : ${themeId}\n`);

  const deck = await generateDeck({
    topic,
    slideCount,
    themeId,
    provider,
    outDir: OUT_DIR,
    onEvent: (event) => {
      if (event.type === "status") log(event.message);
      if (event.type === "outline") {
        log(`  "${event.title}" via ${event.provider}`);
        event.slides.forEach((heading, i) => log(`  ${i + 1}. ${heading}`));
      }
      if (event.type === "slide") {
        log(`  slide ${event.index + 1}: ${event.elementCount} elements (${event.summary})`);
      }
      if (event.type === "warning") log(`  ! slide ${event.slide}: ${event.message}`);
    },
  });

  writeDeck({ title: deck.title, slides: deck.slides });
  log(`screenshots + html in ${OUT_DIR}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (process.argv.includes("--reuse")) await reuse();
  else await fresh();
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
