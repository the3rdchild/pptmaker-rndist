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

import { selectRecipe } from "../html-themes/schema.js";
import { firstConfiguredProvider, chat } from "./llm-client.js";
import { buildOutline } from "./outline-source.js";
import { fillPhotos } from "./photo-fill.js";
import { assessSlideLayout } from "./layout-quality.js";
import { describeElements, renderAndExtract } from "./render-extract.js";
import { buildSafeFallbackFragment } from "./safe-fallback.js";
import { buildSlidePrompt } from "./slide-prompt.js";
import { buildSlideDocument, parseFragment } from "./slide-document.js";

/**
 * @param {object} options
 * @param {string} options.topic Free-text prompt, or the approved outline markdown.
 * @param {number} [options.slideCount] Only consulted when there is no approved outline.
 * @param {object} options.theme A validated persisted HTML theme.
 * @param {string} [options.provider] Falls back to the first configured one.
 * @param {string|null} [options.outDir] Keeps the HTML and PNGs; a temp dir otherwise.
 * @param {(event: Record<string, unknown>) => void} [options.onEvent]
 */
export async function generateDeck({
  topic,
  slideCount = 5,
  theme,
  provider,
  outDir = null,
  onEvent = () => {},
}) {
  if (!theme) throw new Error("A valid HTML theme is required.");
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
    const createFragment = async (slide, index, repairFeedback = "") => {
        const recipe = selectRecipe(theme, slide.role, index);
        const reply = await chat({
          provider: resolvedProvider,
          prompt: buildSlidePrompt({
            theme,
            recipe,
            deckTitle: outline.title,
            slide,
            index,
            total: outline.slides.length,
            repairFeedback,
          }),
          maxTokens: 4000,
          temperature: 0.7,
        });
        const fragment = parseFragment(reply.text);
        const { html } = await fillPhotos(fragment.sectionHtml);
        return { ...fragment, sectionHtml: html };
      };

    const fragments = await Promise.all(
      outline.slides.map((slide, index) => createFragment(slide, index)),
    );

    const htmlPaths = fragments.map((fragment, index) => {
      const path = join(workDir, `slide-${index + 1}.html`);
      writeFileSync(path, buildSlideDocument(theme, fragment), "utf8");
      return path;
    });

    onEvent({ type: "status", message: "Merender dan mencontek layout…" });
    let { slides, warnings } = await renderAndExtract({
      htmlPaths,
      outDir,
    });

    // The DOM extractor can measure a broken layout exactly. Never stream a
    // slide that it reports as clipped/out of bounds: repair that one slide
    // first, then only hand the editor a bounded canvas.
    for (let index = 0; index < slides.length; index += 1) {
      let assessment = assessSlideLayout({
        elements: slides[index].ui.elements,
        warnings: warnings.filter((warning) => warning.slide === index + 1).map((warning) => warning.message),
      });
      for (let attempt = 0; !assessment.ok && attempt < 2; attempt += 1) {
        const repaired = await createFragment(outline.slides[index], index, assessment.feedback);
        fragments[index] = repaired;
        writeFileSync(htmlPaths[index], buildSlideDocument(theme, repaired), "utf8");
        const retried = await renderAndExtract({ htmlPaths: [htmlPaths[index]], outDir });
        slides[index] = retried.slides[0];
        warnings = [
          ...warnings.filter((warning) => warning.slide !== index + 1),
          ...retried.warnings.map((warning) => ({ ...warning, slide: index + 1 })),
        ];
        assessment = assessSlideLayout({
          elements: slides[index].ui.elements,
          warnings: retried.warnings.map((warning) => warning.message),
        });
      }
      if (!assessment.ok) {
        const fallback = buildSafeFallbackFragment({
          slide: outline.slides[index],
          index,
          total: outline.slides.length,
        });
        fragments[index] = fallback;
        writeFileSync(htmlPaths[index], buildSlideDocument(theme, fallback), "utf8");
        const renderedFallback = await renderAndExtract({ htmlPaths: [htmlPaths[index]], outDir });
        slides[index] = renderedFallback.slides[0];
        warnings = [
          ...warnings.filter((warning) => warning.slide !== index + 1),
          ...renderedFallback.warnings.map((warning) => ({ ...warning, slide: index + 1 })),
        ];
        assessment = assessSlideLayout({
          elements: slides[index].ui.elements,
          warnings: renderedFallback.warnings.map((warning) => warning.message),
        });
        if (!assessment.ok) throw new Error(`Safe fallback for slide ${index + 1} failed layout validation: ${assessment.feedback}`);
        onEvent({ type: "warning", slide: index + 1, message: "AI layout was replaced with a safe bounded layout." });
      }
    }

    for (let index = 0; index < slides.length; index += 1) {
      const ui = slides[index].ui;
      onEvent({
        type: "slide",
        index,
        ui,
        heading: outline.slides[index]?.heading ?? "",
        elementCount: ui.elements.length,
        summary: describeElements(ui.elements),
      });
    }
    for (const warning of warnings) onEvent({ type: "warning", ...warning });

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
