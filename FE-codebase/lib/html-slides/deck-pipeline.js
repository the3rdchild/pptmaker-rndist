// The whole HTML generation chain, from a topic to editor slides.
//
// Reports progress through `onEvent` rather than logging, so the CLI can print
// it and the API route can stream it to the editor without either owning the
// other's formatting.
//
// Events: {type:"status"|"outline"|"slide"|"warning"}, and the return value
// carries the finished deck.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { themeById } from "./design-system.js";
import { firstConfiguredProvider, chat } from "./llm-client.js";
import { buildOutline } from "./outline-source.js";
import { fillPhotos } from "./photo-fill.js";
import { describeElements, renderAndExtract } from "./render-extract.js";
import { buildSlidePrompt } from "./slide-prompt.js";
import { buildSlideDocument, parseFragment } from "./slide-document.js";

/**
 * @param {object} options
 * @param {string} options.topic Free-text prompt, or the approved outline markdown.
 * @param {number} [options.slideCount] Only consulted when there is no approved outline.
 * @param {string} [options.themeId] A key of THEMES.
 * @param {string} [options.provider] Falls back to the first configured one.
 * @param {string|null} [options.outDir] Keeps the HTML and PNGs; a temp dir otherwise.
 * @param {(event: Record<string, unknown>) => void} [options.onEvent]
 */
export async function generateDeck({
  topic,
  slideCount = 5,
  themeId = "paper",
  provider,
  outDir = null,
  onEvent = () => {},
}) {
  const theme = themeById(themeId);
  const resolvedProvider = firstConfiguredProvider(provider);
  const workDir = outDir ?? mkdtempSync(join(tmpdir(), "html-slides-"));

  try {
    onEvent({ type: "status", message: "Menyusun outline…" });
    const { outline, fromApprovedOutline } = await buildOutline({
      topic,
      slideCount,
      provider: resolvedProvider,
    });
    if (!outline.slides?.length) throw new Error("Outline came back empty.");
    onEvent({
      type: "outline",
      title: outline.title,
      slides: outline.slides.map((slide) => slide.heading),
      fromApprovedOutline,
      provider: resolvedProvider,
    });

    onEvent({
      type: "status",
      message: `Mendesain ${outline.slides.length} slide sebagai HTML…`,
    });
    // One call per slide, in parallel. Short replies are what let a cheap model
    // hold the layout rules in mind for a whole slide.
    const fragments = await Promise.all(
      outline.slides.map(async (slide, index) => {
        const reply = await chat({
          provider: resolvedProvider,
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
        const { html } = await fillPhotos(fragment.sectionHtml);
        return { ...fragment, sectionHtml: html };
      }),
    );

    const htmlPaths = fragments.map((fragment, index) => {
      const path = join(workDir, `slide-${index + 1}.html`);
      writeFileSync(path, buildSlideDocument(theme, fragment), "utf8");
      return path;
    });

    onEvent({ type: "status", message: "Merender dan mencontek layout…" });
    const { slides, warnings } = await renderAndExtract({
      htmlPaths,
      outDir,
      onSlide: async ({ index, ui, warnings: slideWarnings, elementCount }) => {
        onEvent({
          type: "slide",
          index,
          ui,
          heading: outline.slides[index]?.heading ?? "",
          elementCount,
          summary: describeElements(ui.elements),
        });
        for (const message of slideWarnings) {
          onEvent({ type: "warning", slide: index + 1, message });
        }
      },
    });

    return { title: outline.title, slides, warnings, theme: theme.name, provider: resolvedProvider };
  } finally {
    if (!outDir) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // the OS temp dir will get it
      }
    }
  }
}
