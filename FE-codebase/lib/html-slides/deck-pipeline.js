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
import { ensureThemeBackgroundPlaceholder, fillPhotos } from "./photo-fill.js";
import { assessSlideLayout } from "./layout-quality.js";
import { describeElements, renderAndExtract } from "./render-extract.js";
import { buildSafeFallbackFragment } from "./safe-fallback.js";
import { buildSlidePrompt } from "./slide-prompt.js";
import { buildSlideDocument, parseFragment } from "./slide-document.js";

/** @typedef {{url: string, extra?: {credit?: string, credit_url?: string|null, source_url?: string}}} ResolvedPhoto */

export async function mapWithConcurrency(items, limit, mapper) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  const results = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Resolves image placeholders only after a fragment has passed layout review.
 * This prevents AI-image charges and stock tracking pings from repeating on
 * discarded repair attempts. */
export async function resolveAcceptedFragmentPhotos(fragment, resolvePhoto, photoContext) {
  const { html, unresolved } = await fillPhotos(
    fragment.sectionHtml,
    resolvePhoto ? { resolvePhoto, photoContext } : undefined,
  );
  return { ...fragment, sectionHtml: html, unresolvedPhotos: unresolved };
}

/**
 * @param {object} options
 * @param {string} options.topic Free-text prompt, or the approved outline markdown.
 * @param {number} [options.slideCount] Only consulted when there is no approved outline.
 * @param {object} options.theme A validated persisted HTML theme.
 * @param {string} [options.provider] Falls back to the first configured one.
 * @param {string|null} [options.outDir] Keeps the HTML and PNGs; a temp dir otherwise.
 * @param {(brief: string, context?: {slideNumber?: number, heading?: string, subject?: string}) => Promise<string|ResolvedPhoto|null>} [options.resolvePhoto]
 * @param {(event: Record<string, unknown>) => void} [options.onEvent]
 * @param {AbortSignal} [options.signal] Aborts outstanding LLM calls and stops
 *   scheduling new slides, e.g. when the client disconnects.
 */
export async function generateDeck({
  topic,
  slideCount = 5,
  theme,
  provider,
  resolvePhoto,
  outDir = null,
  onEvent = () => {},
  signal,
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
      signal,
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
          signal,
        });
        const fragment = parseFragment(reply.text);
        const sectionHtml = theme.backgroundImageMode === "generated"
          ? ensureThemeBackgroundPlaceholder(
              fragment.sectionHtml,
              `cinematic documentary photograph for ${slide.heading}: ${slide.visual || slide.brief}`,
            )
          : fragment.sectionHtml;
        return { ...fragment, sectionHtml };
      };

    const renderSingleSlide = async (htmlPath, index) => {
      signal?.throwIfAborted();
      const rendered = await renderAndExtract({
        htmlPaths: [htmlPath],
        outDir,
        screenshotStartIndex: index,
      });
      return {
        slide: rendered.slides[0],
        warnings: rendered.warnings.map((warning) => ({ ...warning, slide: index + 1 })),
      };
    };

    const generateSlide = async (slide, index) => {
      signal?.throwIfAborted();
      onEvent({ type: "status", message: `Membuat slide ${index + 1}/${outline.slides.length}...` });
      let fragment = await createFragment(slide, index);
      const htmlPath = join(workDir, `slide-${index + 1}.html`);
      writeFileSync(htmlPath, buildSlideDocument(theme, fragment), "utf8");
      let { slide: rendered, warnings } = await renderSingleSlide(htmlPath, index);
      let assessment = assessSlideLayout({
        elements: rendered.ui.elements,
        warnings: warnings.map((warning) => warning.message),
      });

      for (let attempt = 0; !assessment.ok && attempt < 2; attempt += 1) {
        fragment = await createFragment(slide, index, assessment.feedback);
        writeFileSync(htmlPath, buildSlideDocument(theme, fragment), "utf8");
        ({ slide: rendered, warnings } = await renderSingleSlide(htmlPath, index));
        assessment = assessSlideLayout({
          elements: rendered.ui.elements,
          warnings: warnings.map((warning) => warning.message),
        });
      }

      if (!assessment.ok) {
        fragment = buildSafeFallbackFragment({ slide, index, total: outline.slides.length });
        writeFileSync(htmlPath, buildSlideDocument(theme, fragment), "utf8");
        ({ slide: rendered, warnings } = await renderSingleSlide(htmlPath, index));
        assessment = assessSlideLayout({
          elements: rendered.ui.elements,
          warnings: warnings.map((warning) => warning.message),
        });
        if (!assessment.ok) throw new Error(`Safe fallback for slide ${index + 1} failed layout validation: ${assessment.feedback}`);
        onEvent({ type: "warning", slide: index + 1, message: "AI layout was replaced with a safe bounded layout." });
      }

      // The accepted geometry is now stable. Resolve its photos exactly once,
      // then extract the final editor elements with image metadata included.
      fragment = await resolveAcceptedFragmentPhotos(fragment, resolvePhoto, {
        slideNumber: index + 1,
        heading: slide.heading,
        subject: slide.visual || slide.brief,
      });
      writeFileSync(htmlPath, buildSlideDocument(theme, fragment), "utf8");
      ({ slide: rendered, warnings } = await renderSingleSlide(htmlPath, index));
      assessment = assessSlideLayout({
        elements: rendered.ui.elements,
        warnings: warnings.map((warning) => warning.message),
      });
      if (!assessment.ok) {
        throw new Error(`Resolved images made slide ${index + 1} fail layout validation: ${assessment.feedback}`);
      }

      if (fragment.unresolvedPhotos?.length) {
        warnings.push({
          slide: index + 1,
          message: `No relevant image was found for: ${fragment.unresolvedPhotos.join("; ")}`,
        });
      }

      const ui = rendered.ui;
      onEvent({
        type: "slide",
        index,
        ui,
        heading: slide.heading ?? "",
        elementCount: ui.elements.length,
        summary: describeElements(ui.elements),
      });
      for (const warning of warnings) onEvent({ type: "warning", ...warning });
      return { slide: rendered, warnings };
    };

    onEvent({ type: "status", message: "Merender dan mencontek layout…" });
    const completed = await mapWithConcurrency(outline.slides, 2, generateSlide);
    const slides = completed.map((entry) => entry.slide);
    const warnings = completed.flatMap((entry) => entry.warnings);

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
