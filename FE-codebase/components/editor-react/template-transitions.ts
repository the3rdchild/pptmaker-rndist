// The outline's transition plan applied to a template-mode deck — pure.
//
// A template slide is filled from a hand-made layout and never written knowing
// its neighbour, so unlike HTML mode nothing was placed on purpose to carry
// across. The anchors every layout does have are the headline and, often, a
// hero photo; those are what a planned morph links (by `morph_id`, which the
// Present Mode morph pairs on first).

import { readArray, readNumber, type Box } from "@/components/slide-editor/model/core";
import { absoluteBoxForSelection } from "@/components/slide-editor/model/model";
import { parseSlotMeta } from "@/components/slide-editor/templates/slot-meta";
import { walkSlideElements, type MorphElementRef } from "@/components/editor-react/morph";
import type { OutlinePage } from "@/components/outline/outline-markdown";
import type { SlideTransition } from "@/store/presentationGeneration";

type Ui = Record<string, unknown>;

/** A hero photo has to be a real part of the composition, not an icon. */
const MIN_HERO_AREA = 1280 * 720 * 0.12;

function fontSizeOf(element: Record<string, unknown>): number {
  const own = readNumber((element.font as Record<string, unknown> | undefined)?.size) ?? 0;
  const runs = readArray(element.runs).map(
    (run) => readNumber(((run as Record<string, unknown>)?.font as Record<string, unknown> | undefined)?.size) ?? 0,
  );
  return Math.max(own, ...runs);
}

function area(box: Box | null) {
  return box ? box.width * box.height : 0;
}

/** The slot authored as the headline, else the text set in the largest type. */
function headline(refs: MorphElementRef[]): MorphElementRef | null {
  const texts = refs.filter((ref) => ref.element.type === "text");
  const authored = texts.find((ref) => parseSlotMeta(ref.element.slot)?.role === "headline");
  if (authored) return authored;
  return texts.reduce<MorphElementRef | null>(
    (best, ref) => (!best || fontSizeOf(ref.element) > fontSizeOf(best.element) ? ref : best),
    null,
  );
}

function heroPhoto(ui: Ui, refs: MorphElementRef[]): MorphElementRef | null {
  let best: MorphElementRef | null = null;
  let bestArea = MIN_HERO_AREA;
  for (const ref of refs) {
    if (ref.element.type !== "image") continue;
    const size = area(absoluteBoxForSelection(ui, ref.selection));
    if (size >= bestArea) {
      best = ref;
      bestArea = size;
    }
  }
  return best;
}

/**
 * Tags the headline (and hero photo, when both slides have one) of two
 * consecutive slides with the same `morph_id`. Returns fresh copies; an id
 * already used by the earlier link in a chain is simply reused, so a title
 * that morphs across three slides stays one object.
 */
export function linkMorphAnchors(uiA: Ui, uiB: Ui): { a: Ui; b: Ui } {
  const a = structuredClone(uiA);
  const b = structuredClone(uiB);
  const refsA = walkSlideElements(a);
  const refsB = walkSlideElements(b);
  const pairs: [MorphElementRef | null, MorphElementRef | null, string][] = [
    [headline(refsA), headline(refsB), "title"],
    [heroPhoto(a, refsA), heroPhoto(b, refsB), "hero"],
  ];
  for (const [refA, refB, id] of pairs) {
    if (!refA || !refB) continue;
    // walkSlideElements hands back the clones' own element objects.
    refA.element.morph_id = id;
    refB.element.morph_id = id;
  }
  return { a, b };
}

/** How each slide enters: the outline's plan, first slide none, and an
 *  unplanned slide a neutral fade. */
export function plannedTransitions(slideCount: number, pages: OutlinePage[]): SlideTransition[] {
  return Array.from({ length: slideCount }, (_, index) =>
    index === 0 ? "none" : pages[index]?.transition ?? "fade-black",
  );
}
