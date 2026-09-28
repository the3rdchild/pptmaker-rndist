// Automatic entrance builds for generated decks, applied when the homepage
// "Transisi" toggle is on — pure, no React.
//
// It reuses the Animate-all preset's choice and reading order of elements,
// then retimes the build as one quick cascade: every step shares the slide's
// single group (Present Mode starts group 0 by itself once the transition
// ends) and is offset by a short stagger, so a slide assembles in a second or
// two with no clicks. Elements a morph carries in are left to Present Mode,
// whose morph-wins rule drops their entrance at play time.

import { applyAnimateAllPreset, clearAllAnimations } from "@/components/editor-react/animation-sequence";
import { walkSlideElements } from "@/components/editor-react/morph";
import { parseElementAnimations } from "@/components/slide-editor/animation/animation-meta";
import { absoluteBoxForSelection } from "@/components/slide-editor/model/model";
import type { Box, RawElement, RawUi } from "@/components/slide-editor/model/core";
import type { SlideTransition } from "@/store/presentationGeneration";

const STAGGER_MS = 90;
/** However many beats a slide has, the last one starts by this point. */
const MAX_CASCADE_MS = 1400;
const DURATION_MS = 450;
/** A non-text element covering this much of the 1280x720 stage is a backdrop
 *  (full-slide panel or photo): animating it would fade the slide itself in. */
const BACKDROP_AREA = 1280 * 720 * 0.85;

function isBackdrop(element: RawElement, box: Box | null) {
  return element.type !== "text" && box !== null && box.width * box.height >= BACKDROP_AREA;
}

/** The slide with an automatic entrance cascade, or null when it has nothing
 *  worth animating. Text rises; images and shapes fade. Elements the preset
 *  grouped into one beat keep starting together. */
export function applyAutoEntrance(ui: Record<string, unknown> | null | undefined) {
  const animated = applyAnimateAllPreset(
    ui,
    "rise",
    { trigger: "after-previous", duration: DURATION_MS, delay: 0, easing: "ease-out" },
    { skip: isBackdrop, allOrNothing: true },
  );
  if (!animated) return null;

  const steps = walkSlideElements(animated)
    .map((ref) => ({ element: ref.element, step: parseElementAnimations(ref.element.animations)?.[0] }))
    .filter((entry): entry is { element: RawElement; step: NonNullable<typeof entry.step> } => Boolean(entry.step))
    .sort((a, b) => a.step.order - b.step.order);

  let beat = -1;
  steps.forEach(({ element, step }, index) => {
    // The preset marks every member after a beat's first as with-previous.
    if (index === 0 || step.trigger !== "with-previous") beat += 1;
    element.animations = [
      {
        ...step,
        effect: element.type === "text" ? "rise" : "fade-in",
        trigger: index === 0 ? "after-previous" : "with-previous",
        delay: Math.min(beat * STAGGER_MS, MAX_CASCADE_MS),
      },
    ];
  });
  return animated;
}

/** The homepage animation toggle never leaves a dense generated slide with a
 *  partial entrance. Dense slides use one fade for all unmatched content;
 *  a real morph keeps its linked-element transition. */
export function prepareGeneratedEntrance(
  ui: Record<string, unknown> | null | undefined,
  transition: SlideTransition,
) {
  const animated = applyAutoEntrance(ui);
  return {
    ui: animated ?? ui,
    transition: !animated && transition !== "morph" ? "fade-black" as const : transition,
  };
}

/** Older generated decks were cut off at 40 element flights. Recognize only
 *  that exact automatic cadence, then rebuild it for playback with the current
 *  budget. If the slide is still too dense, remove the partial cascade so its
 *  normal slide transition reveals every element together. Stored deck data
 *  and manually authored animations remain untouched. */
export function recoverPartialAutoEntrance(
  ui: Record<string, unknown> | null | undefined,
): { ui: Record<string, unknown>; overflow: boolean } | null {
  if (!ui) return null;
  const refs = walkSlideElements(ui);
  const animated = refs.flatMap((ref) => {
    const steps = parseElementAnimations(ref.element.animations);
    return steps ? [{ element: ref.element, steps }] : [];
  });
  if (animated.length !== 40) return null;
  const ordered = animated.sort((a, b) => a.steps[0].order - b.steps[0].order);
  const generatedCadence = ordered.every(({ element, steps }, index) => {
    if (steps.length !== 1) return false;
    const step = steps[0];
    return step.order === index + 1 &&
      step.effect === (element.type === "text" ? "rise" : "fade-in") &&
      step.trigger === (index === 0 ? "after-previous" : "with-previous") &&
      step.duration === DURATION_MS && step.easing === "ease-out" &&
      step.delay >= 0 && step.delay <= MAX_CASCADE_MS &&
      (step.delay % STAGGER_MS === 0 || step.delay === MAX_CASCADE_MS);
  });
  if (!generatedCadence) return null;
  const omitted = refs.some((ref) =>
    !parseElementAnimations(ref.element.animations) &&
    ref.element.decorative !== true &&
    !isBackdrop(ref.element, absoluteBoxForSelection(ui as RawUi, ref.selection)),
  );
  if (!omitted) return null;
  const complete = applyAutoEntrance(ui);
  return complete
    ? { ui: complete, overflow: false }
    : { ui: clearAllAnimations(ui) ?? ui, overflow: true };
}
