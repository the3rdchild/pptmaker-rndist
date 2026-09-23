// The whole HTML generation chain, from a topic to editor slides.
//
// Reports progress through `onEvent` rather than logging, so the CLI can print
// it and the API route can stream it to the editor without either owning the
// other's formatting.
//
// Events: {type:"status"|"outline"|"theme"|"slide"|"warning"}, and the return value
// carries the finished deck.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { selectRecipe } from "../html-themes/schema.js";
import { designFreestyleTheme } from "./freestyle-theme.js";
import { firstConfiguredProvider, chat } from "./llm-client.js";
import { buildOutline } from "./outline-source.js";
import { ensureThemeBackgroundPlaceholder, fillPhotos } from "./photo-fill.js";
import { assessSlideLayout } from "./layout-quality.js";
import {
  ensureMorphAnchor,
  groupMorphChains,
  morphAnchorsFrom,
  pairHeadingsIfUnmatched,
  sharedMorphIds,
} from "./morph-chain.js";
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
export async function resolveAcceptedFragmentPhotos(fragment, resolvePhoto, photoContext, reusePhotos = {}) {
  const { html, unresolved, morphPhotos } = await fillPhotos(
    fragment.sectionHtml,
    resolvePhoto ? { resolvePhoto, photoContext, reusePhotos } : { reusePhotos },
  );
  return { ...fragment, sectionHtml: html, unresolvedPhotos: unresolved, morphPhotos };
}

/** The transition each slide enters with. Off: none recorded at all. On: the
 *  outline's plan, with the first slide forced to none (nothing precedes it)
 *  and an unplanned slide given a neutral fade. */
function withPlannedTransitions(slides, transitions) {
  return slides.map((slide, index) => ({
    ...slide,
    transition: !transitions ? undefined : index === 0 ? "none" : slide.transition ?? "fade-black",
  }));
}

/** The AI designs the deck's theme; a saved theme stands in when that fails,
 *  so a flaky theme reply costs the look, never the deck. */
async function resolveFreestyleTheme({ outline, provider, signal, loadFallbackTheme, onEvent }) {
  onEvent({ type: "status", message: "AI merancang tema visual dari topik…" });
  try {
    const theme = await designFreestyleTheme({ outline, provider, signal });
    onEvent({ type: "theme", name: theme.name, description: theme.description, source: "ai" });
    return theme;
  } catch (error) {
    signal?.throwIfAborted();
    const fallback = loadFallbackTheme ? await loadFallbackTheme() : null;
    if (!fallback) throw error;
    onEvent({
      type: "theme",
      name: fallback.name,
      description: fallback.description,
      source: "fallback",
      reason: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

/**
 * @param {object} options
 * @param {string} options.topic Free-text prompt, or the approved outline markdown.
 * @param {number} [options.slideCount] Only consulted when there is no approved outline.
 * @param {object|null} [options.theme] A validated persisted HTML theme, or
 *   null to have the model design one for this outline.
 * @param {() => Promise<object|null>} [options.loadFallbackTheme] A saved theme
 *   to use when the AI-designed one cannot be validated.
 * @param {string} [options.provider] Falls back to the first configured one.
 * @param {string|null} [options.outDir] Keeps the HTML and PNGs; a temp dir otherwise.
 * @param {(brief: string, context?: {slideNumber?: number, heading?: string, subject?: string}) => Promise<string|ResolvedPhoto|null>} [options.resolvePhoto]
 * @param {(event: Record<string, unknown>) => void} [options.onEvent]
 * @param {AbortSignal} [options.signal] Aborts outstanding LLM calls and stops
 *   scheduling new slides, e.g. when the client disconnects.
 * @param {boolean} [options.transitions] Apply the outline's transition plan;
 *   slides joined by morph are then generated in order, each written against
 *   what the slide before it actually rendered.
 */
export async function generateDeck({
  topic,
  slideCount = 5,
  theme = null,
  loadFallbackTheme,
  provider,
  resolvePhoto,
  outDir = null,
  onEvent = () => {},
  signal,
  transitions = false,
}) {
  const resolvedProvider = firstConfiguredProvider(provider);
  const workDir = outDir ?? mkdtempSync(join(tmpdir(), "html-slides-"));

  try {
    onEvent({ type: "status", message: "Menyusun outline…" });
    const { outline, fromApprovedOutline } = await buildOutline({
      topic,
      slideCount,
      provider: resolvedProvider,
      signal,
      transitions,
    });
    if (!outline.slides?.length) throw new Error("Outline came back empty.");
    const plannedSlides = withPlannedTransitions(outline.slides, transitions);
    onEvent({
      type: "outline",
      title: outline.title,
      slides: outline.slides.map((slide) => slide.heading),
      fromApprovedOutline,
      provider: resolvedProvider,
    });

    if (!theme) {
      theme = await resolveFreestyleTheme({ outline, provider: resolvedProvider, signal, loadFallbackTheme, onEvent });
    }

    onEvent({
      type: "status",
      message: `Mendesain ${outline.slides.length} slide sebagai HTML…`,
    });
    // One call per slide. Short replies are what let a cheap model hold the
    // layout rules in mind for a whole slide.
    const createFragment = async (slide, index, repairFeedback = "", morph = undefined) => {
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
            morph,
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

    const generateSlide = async (slide, index, morph) => {
      signal?.throwIfAborted();
      onEvent({ type: "status", message: `Membuat slide ${index + 1}/${outline.slides.length}...` });
      let fragment = await createFragment(slide, index, "", morph);
      const htmlPath = join(workDir, `slide-${index + 1}.html`);
      writeFileSync(htmlPath, buildSlideDocument(theme, fragment), "utf8");
      let { slide: rendered, warnings } = await renderSingleSlide(htmlPath, index);
      let assessment = assessSlideLayout({
        elements: rendered.ui.elements,
        warnings: warnings.map((warning) => warning.message),
      });

      for (let attempt = 0; !assessment.ok && attempt < 2; attempt += 1) {
        fragment = await createFragment(slide, index, assessment.feedback, morph);
        writeFileSync(htmlPath, buildSlideDocument(theme, fragment), "utf8");
        ({ slide: rendered, warnings } = await renderSingleSlide(htmlPath, index));
        assessment = assessSlideLayout({
          elements: rendered.ui.elements,
          warnings: warnings.map((warning) => warning.message),
        });
      }

      // A morph that pairs nothing plays as a plain crossfade. One more try,
      // kept only if it both pairs something and still passes layout review.
      const anchors = morph?.from?.anchors ?? [];
      if (assessment.ok && anchors.length && !sharedMorphIds(anchors, rendered.ui).length) {
        const retry = await createFragment(
          slide,
          index,
          `Slide ini seharusnya MORPH dari slide sebelumnya, tapi tidak ada elemen yang memakai ulang data-morph (${anchors.map((anchor) => anchor.id).join(", ")}). Pakai ulang minimal satu id itu pada elemen yang sama.`,
          morph,
        );
        writeFileSync(htmlPath, buildSlideDocument(theme, retry), "utf8");
        const retried = await renderSingleSlide(htmlPath, index);
        const retriedAssessment = assessSlideLayout({
          elements: retried.slide.ui.elements,
          warnings: retried.warnings.map((warning) => warning.message),
        });
        if (retriedAssessment.ok && sharedMorphIds(anchors, retried.slide.ui).length) {
          fragment = retry;
          ({ slide: rendered, warnings } = retried);
          assessment = retriedAssessment;
        } else {
          // Keep the first render; the headings get paired below instead.
          writeFileSync(htmlPath, buildSlideDocument(theme, fragment), "utf8");
        }
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
      }, morph?.from?.photos);
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

      // The model's own tags win; the heading only stands in when a planned
      // morph would otherwise pair nothing.
      let ui = rendered.ui;
      if (morph?.from) ui = pairHeadingsIfUnmatched(anchors, ui);
      if (morph?.toNext) ui = ensureMorphAnchor(ui);
      onEvent({
        type: "slide",
        index,
        ui,
        ...(slide.transition ? { transition: slide.transition } : {}),
        heading: slide.heading ?? "",
        elementCount: ui.elements.length,
        summary: describeElements(ui.elements),
      });
      for (const warning of warnings) onEvent({ type: "warning", ...warning });
      return {
        slide: { ...rendered, ui },
        warnings,
        anchors: morphAnchorsFrom(ui),
        morphPhotos: fragment.morphPhotos ?? {},
      };
    };

    // Two chains at a time; inside a chain each slide waits for the one it
    // morphs from, and tags its own anchors when the next slide morphs from it.
    onEvent({ type: "status", message: "Merender dan mencontek layout…" });
    const completed = new Array(plannedSlides.length);
    await mapWithConcurrency(groupMorphChains(plannedSlides), 2, async (chain) => {
      let previous = null;
      for (const index of chain) {
        const slide = plannedSlides[index];
        const next = plannedSlides[index + 1];
        const morph = {
          ...(previous && slide.transition === "morph"
            ? { from: { note: slide.transitionNote ?? "", anchors: previous.anchors, photos: previous.morphPhotos } }
            : {}),
          ...(next?.transition === "morph" ? { toNext: { note: next.transitionNote ?? "" } } : {}),
        };
        completed[index] = await generateSlide(slide, index, morph);
        previous = completed[index];
      }
    });
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
