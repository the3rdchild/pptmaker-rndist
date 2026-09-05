// CLI for the HTML generation mode.
//
//   node html-slides/generate.js --topic "..." --slides 5 --theme midnight
//   node html-slides/generate.js --reuse          # re-extract out/*.html only
//
// outline -> per-slide HTML -> photo fill -> headless Chrome -> DOM readback
// -> a deck payload in the editor's own shape, plus a PNG per slide.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { themeById } from "./design-system.js";
import { chat } from "./llm-client.js";
import { fillPhotos } from "./photo-fill.js";
import { renderAndExtract } from "./render-extract.js";
import { buildOutlinePrompt, buildSlidePrompt } from "./slide-prompt.js";
import { buildSlideDocument, parseFragment } from "./slide-document.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "out");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const log = console.log;

function parseOutline(text) {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(`Outline reply was not JSON:\n${cleaned.slice(0, 400)}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

function existingHtmlPaths() {
  const paths = [];
  for (let i = 1; existsSync(join(OUT_DIR, `slide-${i}.html`)); i += 1) {
    paths.push(join(OUT_DIR, `slide-${i}.html`));
  }
  return paths;
}

async function main() {
  const reuse = process.argv.includes("--reuse");
  mkdirSync(OUT_DIR, { recursive: true });

  if (reuse) {
    const meta = JSON.parse(readFileSync(join(OUT_DIR, "outline.json"), "utf8"));
    log(`reusing  : ${OUT_DIR}`);
    log("\n[1/2] render + extract…");
    await renderAndExtract({ htmlPaths: existingHtmlPaths(), title: meta.title, outDir: OUT_DIR, log });
    log("\n[2/2] deck payload written.");
    return;
  }

  const topic = arg("topic", "Kopi specialty Indonesia: dari kebun ke cangkir");
  const slideCount = Number(arg("slides", "5"));
  const theme = themeById(arg("theme", "midnight"));
  const provider = arg("provider", "deepinfra");

  log(`topic    : ${topic}`);
  log(`theme    : ${theme.name}`);
  log(`provider : ${provider}`);

  log("\n[1/4] outline…");
  const outlineReply = await chat({
    provider,
    prompt: buildOutlinePrompt(topic, slideCount),
    maxTokens: 1800,
    temperature: 0.8,
  });
  const outline = parseOutline(outlineReply.text);
  writeFileSync(join(OUT_DIR, "outline.json"), JSON.stringify(outline, null, 2), "utf8");
  log(`      "${outline.title}" — ${outline.slides.length} slides (${outlineReply.ms}ms, ${outlineReply.model})`);
  outline.slides.forEach((slide, i) => log(`      ${i + 1}. [${slide.role}] ${slide.heading}`));

  log("\n[2/4] slide HTML (parallel)…");
  const fragments = await Promise.all(
    outline.slides.map(async (slide, index) => {
      const reply = await chat({
        provider,
        prompt: buildSlidePrompt({
          theme,
          deckTitle: outline.title,
          slide,
          index,
          total: outline.slides.length,
        }),
        maxTokens: 4000,
        temperature: 0.7,
      });
      const fragment = parseFragment(reply.text);
      const { html, count } = await fillPhotos(fragment.sectionHtml);
      log(`      slide ${index + 1}: ${reply.text.length} chars, ${count} photo(s), ${reply.ms}ms`);
      return { ...fragment, sectionHtml: html };
    }),
  );

  const htmlPaths = fragments.map((fragment, index) => {
    const path = join(OUT_DIR, `slide-${index + 1}.html`);
    writeFileSync(path, buildSlideDocument(theme, fragment), "utf8");
    return path;
  });

  log("\n[3/4] render + extract…");
  await renderAndExtract({ htmlPaths, title: outline.title, outDir: OUT_DIR, log });

  log(`\n[4/4] done. screenshots + html in ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
