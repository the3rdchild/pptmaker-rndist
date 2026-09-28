// The whole HTML generation chain, from a topic to editor slides.
//
// Reports progress through `onEvent` rather than logging, so the CLI can print
// it and the API route can stream it to the editor without either owning the
// other's formatting.
//
// Events: {type:"status"|"outline"|"theme"|"slide"|"warning"}, and the return value
// carries the finished deck.

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planRecipes } from "../html-themes/schema.js";
import { withStarterStoryRecipes } from "../html-themes/seeds.js";
import { designFreestyleTheme } from "./freestyle-theme.js";
import { firstConfiguredProvider, chat, requireCompleteReply } from "./llm-client.js";
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
import { recordGenerationDiagnostic, redactGenerationText, withGenerationStage } from "./generation-trace.js";

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

  // The caller owns render files shared by these workers. Let active workers
  // finish before rejection triggers its cleanup.
  const workers = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  const failed = workers.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
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

/** Repair the source layout, not the potentially huge base64 photo payloads
 * injected for rendering. Keep photo intent and geometry as placeholders. */
export function buildVisualRepairFeedback(fragment, issues, elements) {
  const html = fragment.sectionHtml.replace(/<img\b((?:[^<>"']|"[^"]*"|'[^']*')*)>/gi, (_tag, attrs) => {
    const retained = [];
    for (const match of attrs.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      if (["class", "style", "data-brief", "data-morph", "data-theme-background", "data-theme-overlay"].includes(match[1].toLowerCase())) {
        retained.push(`${match[1]}="${(match[2] ?? match[3]).replaceAll('"', "&quot;")}"`);
      }
    }
    return `<div ${retained.join(" ")}></div>`;
  });
  const slots = elements.flatMap((element, index) => element.type === "text"
    ? [{ name: `text-${index + 1}`, text: element.runs?.map((run) => run.text ?? "").join("") ?? element.text ?? "" }]
    : element.type === "image" && !element.is_icon ? [{ name: `photo-${index + 1}`, hint: element.prompt ?? "" }] : []);
  return `VISUAL REVIEW: Fix these concrete issues in the current slide, preserving its other content and design.\n${JSON.stringify(issues)}\nCurrent slots: ${JSON.stringify(slots)}\nCurrent CSS: ${fragment.styleBlock ?? ""}\nCurrent HTML: ${html}`;
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
 * @param {(input: any) => Promise<any[]>} [options.reviewSlide] Optional screenshot review.
 * @param {(input: {prompt: string, signal?: AbortSignal}) => Promise<string>} [options.repairSlide] Optional selected provider for one visual repair.
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
  reviewSlide,
  repairSlide,
  signal,
  transitions = false,
}) {
  const resolvedProvider = firstConfiguredProvider(provider);
  const workDir = outDir ?? mkdtempSync(join(tmpdir(), "html-slides-"));
  const writeDocument = (htmlPath, fragment) => writeFileSync(htmlPath, redactGenerationText(buildSlideDocument(theme, fragment)), "utf8");

  try {
    onEvent({ type: "status", message: "Menyusun outline…" });
    const { outline, fromApprovedOutline } = await withGenerationStage({ stage: "outline", attempt: 1 }, () => buildOutline({
      topic,
      slideCount,
      provider: resolvedProvider,
      signal,
      transitions,
    }));
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
      theme = await withGenerationStage({ stage: "theme" }, () => resolveFreestyleTheme({ outline, provider: resolvedProvider, signal, loadFallbackTheme, onEvent }));
    }
    theme = withStarterStoryRecipes(theme);

    onEvent({
      type: "status",
      message: `Mendesain ${outline.slides.length} slide sebagai HTML…`,
    });
    const recipes = planRecipes(theme, plannedSlides);
    // One call per slide. Short replies are what let a cheap model hold the
    // layout rules in mind for a whole slide.
    const createFragment = async (slide, index, repairFeedback = "", morph = undefined, { maxTokens = 4000, visualRepair = false } = {}) => {
        const recipe = recipes[index];
        const prompt = buildSlidePrompt({
            theme,
            recipe,
            deckTitle: outline.title,
            slide,
            index,
            total: outline.slides.length,
            repairFeedback,
            morph,
          });
        const reply = visualRepair && repairSlide
          ? { text: await repairSlide({ prompt, signal }), finishReason: null }
          : await chat({
          provider: resolvedProvider,
          prompt,
          maxTokens,
          temperature: 0.7,
          signal,
        });
        signal?.throwIfAborted();
        requireCompleteReply(reply);
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
        outDir: outDir ?? (reviewSlide ? workDir : null),
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
      let fragment;
      const htmlPath = join(workDir, `slide-${index + 1}.html`);
      let rendered;
      let warnings = [];
      let assessment = { ok: false, feedback: "" };
      let maxTokens = 4000;
      // A review repair can keep an unchanged photo brief without paying for
      // or tracking the same asset twice. A changed brief gets a fresh image.
      const photoCache = new Map();
      const resolveSlidePhoto = resolvePhoto ? (brief, photoContext) => {
        signal?.throwIfAborted();
        if (!photoCache.has(brief)) photoCache.set(brief, Promise.resolve(resolvePhoto(brief, photoContext)));
        return photoCache.get(brief);
      } : undefined;
      const recoveryWarnings = [];
      const warn = (message) => recoveryWarnings.push({ slide: index + 1, message });
      const review = (stage, result, renderWarnings) => {
        const checked = assessSlideLayout({ elements: result.ui.elements, warnings: renderWarnings.map((warning) => warning.message) });
        recordGenerationDiagnostic({ type: "layout", stage, slide: index + 1, ok: checked.ok, feedback: checked.feedback, checks: { domLayout: true, visionReview: false } });
        return checked;
      };

      for (let attempt = 0; !assessment.ok && attempt < 3; attempt += 1) {
        try {
          await withGenerationStage({ stage: "slide-layout", slide: index + 1, attempt: attempt + 1 }, async () => {
            fragment = await createFragment(slide, index, assessment.feedback, morph, { maxTokens });
            writeDocument(htmlPath, fragment);
            ({ slide: rendered, warnings } = await renderSingleSlide(htmlPath, index));
            assessment = review("before-photos", rendered, warnings);
          });
        } catch (error) {
          signal?.throwIfAborted();
          if (error?.code === "OUTPUT_TRUNCATED") maxTokens = Math.min(maxTokens * 2, 12000);
          assessment = { ok: false, feedback: error instanceof Error ? error.message : String(error) };
          recordGenerationDiagnostic({ type: "repair", stage: "slide-layout", slide: index + 1, attempt: attempt + 1, phase: attempt < 2 ? "retry" : "exhausted", nextMaxTokens: attempt < 2 ? maxTokens : null, error: assessment.feedback });
        }
      }

      // A morph that pairs nothing plays as a plain crossfade. One more try,
      // kept only if it both pairs something and still passes layout review.
      const anchors = morph?.from?.anchors ?? [];
      if (assessment.ok && anchors.length && !sharedMorphIds(anchors, rendered.ui).length) {
        try {
          const retry = await withGenerationStage({ stage: "morph-repair", slide: index + 1, attempt: 1 }, () => createFragment(
            slide,
            index,
            `Slide ini seharusnya MORPH dari slide sebelumnya, tapi tidak ada elemen yang memakai ulang data-morph (${anchors.map((anchor) => anchor.id).join(", ")}). Pakai ulang minimal satu id itu pada elemen yang sama.`,
            morph,
            { maxTokens },
          ));
          writeDocument(htmlPath, retry);
          const retried = await renderSingleSlide(htmlPath, index);
          const retriedAssessment = review("morph-repair", retried.slide, retried.warnings);
          if (retriedAssessment.ok && sharedMorphIds(anchors, retried.slide.ui).length) {
            fragment = retry;
            ({ slide: rendered, warnings } = retried);
            assessment = retriedAssessment;
          }
        } catch (error) {
          signal?.throwIfAborted();
          warn(`Morph repair failed; keeping the accepted layout: ${error instanceof Error ? error.message : String(error)}`);
        }
        writeDocument(htmlPath, fragment);
      }

      if (!assessment.ok) {
        const reason = assessment.feedback;
        fragment = buildSafeFallbackFragment({ slide, index, total: outline.slides.length });
        writeDocument(htmlPath, fragment);
        ({ slide: rendered, warnings } = await renderSingleSlide(htmlPath, index));
        assessment = review("fallback", rendered, warnings);
        if (!assessment.ok) throw new Error(`Safe fallback for slide ${index + 1} failed layout validation: ${assessment.feedback}`);
        warn(`AI layout was replaced with a safe bounded layout. ${reason}`);
      }

      // The accepted geometry is now stable. Resolve its photos exactly once,
      // then extract the final editor elements with image metadata included.
      const acceptedFragment = fragment;
      try {
        fragment = await withGenerationStage({ stage: "photo-fill", slide: index + 1 }, () => resolveAcceptedFragmentPhotos(fragment, resolveSlidePhoto, {
          slideNumber: index + 1,
          heading: slide.heading,
          subject: slide.visual || slide.brief,
        }, morph?.from?.photos));
        writeDocument(htmlPath, fragment);
        ({ slide: rendered, warnings } = await renderSingleSlide(htmlPath, index));
        assessment = review("after-photos", rendered, warnings);
        if (!assessment.ok) {
          throw new Error(`Resolved images made slide ${index + 1} fail layout validation: ${assessment.feedback}`);
        }
      } catch (error) {
        signal?.throwIfAborted();
        // Photo replacement can change intrinsic sizes. Keep the layout that
        // already passed review instead of dropping this and all later slides.
        warn(`Photo fill was skipped to preserve the accepted layout: ${error instanceof Error ? error.message : String(error)}`);
        fragment = acceptedFragment;
        writeDocument(htmlPath, fragment);
        ({ slide: rendered, warnings } = await renderSingleSlide(htmlPath, index));
        const restored = review("photo-restore", rendered, warnings);
        if (!restored.ok) throw new Error(`Restored slide ${index + 1} failed layout validation: ${restored.feedback}`);
      }

      if (reviewSlide) {
        const accepted = { fragment, rendered, warnings };
        const reviewImage = async (result, attempt) => withGenerationStage({ stage: "visual-review", slide: index + 1, attempt }, async () => {
          signal?.throwIfAborted();
          const screenshot = `slide-${index + 1}-review-${attempt}.png`;
          copyFileSync(join(outDir ?? workDir, `slide-${index + 1}.png`), join(outDir ?? workDir, screenshot));
          const slots = [];
          const fills = [];
          const photos = [];
          for (const [elementIndex, element] of result.ui.elements.entries()) {
            if (element.type === "text") {
              const name = `text-${elementIndex + 1}`;
              slots.push({ name });
              fills.push({ name, text: element.runs?.map((run) => run.text ?? "").join("") ?? element.text ?? "" });
            } else if (element.type === "image" && !element.is_icon) {
              photos.push({ name: `photo-${elementIndex + 1}`, hint: slide.visual || slide.brief });
            }
          }
          const issues = await reviewSlide({ image: `data:image/png;base64,${readFileSync(join(outDir ?? workDir, screenshot)).toString("base64")}`, topic: `${outline.title}: ${slide.heading}. ${slide.brief ?? ""}`, language: "Indonesian", slots, fills, photos, signal });
          signal?.throwIfAborted();
          if (!Array.isArray(issues)) throw new Error("Visual review did not return an issues array.");
          recordGenerationDiagnostic({ type: "visual-review", ok: issues.length === 0, count: issues.length, issues, screenshot, checks: { domLayout: true, visionReview: true } });
          return issues;
        });
        try {
          onEvent({ type: "status", message: `Meninjau visual slide ${index + 1}/${outline.slides.length}...` });
          const issues = await reviewImage(rendered, 1);
          if (issues.length) {
            const feedback = buildVisualRepairFeedback(fragment, issues, rendered.ui.elements);
            let repairPhotos = { ...morph?.from?.photos, ...fragment.morphPhotos };
            for (const issue of issues.filter((issue) => issue.kind === "image")) {
              const photoIndex = Number(String(issue.slot).match(/^photo-(\d+)$/)?.[1]) - 1;
              const rejectedPhoto = rendered.ui.elements[photoIndex];
              if (rejectedPhoto?.type === "image") {
                if (rejectedPhoto.morph_id) delete repairPhotos[rejectedPhoto.morph_id];
                if (rejectedPhoto.prompt) photoCache.delete(rejectedPhoto.prompt);
              } else {
                // An unrecognized reviewer slot cannot pin the candidate to
                // an image the reviewer has already rejected.
                repairPhotos = {};
                photoCache.clear();
              }
            }
            await withGenerationStage({ stage: "visual-repair", slide: index + 1, attempt: 1 }, async () => {
              fragment = await createFragment(slide, index, feedback, morph, { maxTokens: 12000, visualRepair: true });
              writeDocument(htmlPath, fragment);
              ({ slide: rendered, warnings } = await renderSingleSlide(htmlPath, index));
              const before = review("repair-before-photos", rendered, warnings);
              if (!before.ok) throw new Error(`Visual repair failed layout validation: ${before.feedback}`);
              fragment = await resolveAcceptedFragmentPhotos(fragment, resolveSlidePhoto, { slideNumber: index + 1, heading: slide.heading, subject: slide.visual || slide.brief }, repairPhotos);
              writeDocument(htmlPath, fragment);
              ({ slide: rendered, warnings } = await renderSingleSlide(htmlPath, index));
              const after = review("repair-after-photos", rendered, warnings);
              if (!after.ok) throw new Error(`Visual repair photos failed layout validation: ${after.feedback}`);
            });
            const remaining = await reviewImage(rendered, 2);
            if (remaining.length) throw new Error(`Visual repair still has ${remaining.length} issue(s): ${remaining.map((issue) => issue.problem).join("; ")}`);
          }
        } catch (error) {
          signal?.throwIfAborted();
          ({ fragment, rendered, warnings } = accepted);
          // Accepted editor geometry is already in memory. Recovery must not
          // depend on Chrome launching again after a reviewer/provider failure.
          try {
            writeDocument(htmlPath, fragment);
            const savedScreenshot = join(outDir ?? workDir, `slide-${index + 1}-review-1.png`);
            if (existsSync(savedScreenshot)) copyFileSync(savedScreenshot, join(outDir ?? workDir, `slide-${index + 1}.png`));
          } catch (artifactError) {
            recordGenerationDiagnostic({ type: "artifact", phase: "error", slide: index + 1, error: artifactError instanceof Error ? artifactError.message : String(artifactError) });
          }
          warn(`Visual review/repair did not pass; kept the accepted layout: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      warnings.push(...recoveryWarnings);

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
