// Per-element animation planner — pure, no React, no DOM. Turns the
// `animations` arrays authored on a slide's elements into a playback plan:
// which elements need cutting out of the base bitmap, which start/end hidden,
// and how the steps group into the "clicks" of a build.
//
// Shared by Present Mode, the editor canvas preview and the Animation panel's
// sequence list, which is why it must stay free of anything browser-bound.

import { walkSlideElements } from "@/components/editor-react/morph";
import {
  animationEffectKind,
  parseElementAnimations,
  type AnimationEffect,
  type AnimationStep,
} from "@/components/slide-editor/animation/animation-meta";
import type { ElementSelection } from "@/components/slide-editor/model/core";

/** Each flight is one composited layer for the whole time the overlay is up
 *  (not just while moving), so an unbounded plan is a VRAM bomb on weak GPUs.
 *  Steps past this budget are dropped from the back of the build order and
 *  their elements simply render statically — same policy as morph's
 *  MAX_MORPH_FLIGHTS. */
export const MAX_ANIMATION_FLIGHTS = 40;

export interface PlannedStep {
  /** keyForSelection(selection) — also the lookup key in Konva nodeRefs. */
  key: string;
  selection: ElementSelection;
  step: AnimationStep;
  /** Start offset in ms, relative to the start of the step's GROUP (not the
   *  slide). The step's own `delay` is applied on top of this at playback so
   *  the panel can keep showing the two numbers separately. */
  startAt: number;
}

export interface AnimationGroup {
  /** All the steps that run within one "click". */
  steps: PlannedStep[];
  /** max(startAt + delay + duration) across the group's steps. */
  durationMs: number;
}

export interface AnimationPlan {
  groups: AnimationGroup[];
  /** Elements that must START hidden (their first step is an entrance). */
  hiddenAtStart: string[];
  /** Elements that must END hidden (their last step is an exit). */
  hiddenAtEnd: string[];
  /** Every element touched by any step — these are cut out of the base bitmap
   *  and re-rendered as their own rasters. */
  animatedKeys: string[];
}

const EMPTY_PLAN: AnimationPlan = {
  groups: [],
  hiddenAtStart: [],
  hiddenAtEnd: [],
  animatedKeys: [],
};

/** One step as the panel's build list shows it: the step plus enough context
 *  (which element, what to call it) to render and re-select it. */
export interface SlideAnimationEntry {
  key: string;
  selection: ElementSelection;
  elementName: string;
  step: AnimationStep;
}

/** All animation steps on a slide in build order (order asc, walk order as
 *  the stable tie-break — the same ordering buildAnimationPlan groups by). */
export function collectSlideAnimationSteps(
  ui: Record<string, unknown> | null | undefined,
): SlideAnimationEntry[] {
  const out: SlideAnimationEntry[] = [];
  for (const ref of walkSlideElements(ui)) {
    const steps = parseElementAnimations(ref.element.animations);
    if (!steps) continue;
    const name =
      typeof ref.element.name === "string" && ref.element.name.trim()
        ? ref.element.name
        : String(ref.element.type ?? "element");
    for (const step of steps) {
      out.push({ key: ref.key, selection: ref.selection, elementName: name, step });
    }
  }
  out.sort((a, b) => a.step.order - b.step.order);
  return out;
}

/** Rewrites every step's `order` to match the given sequence (position + 1)
 *  on a deep clone of the ui. Returns null when the slide has no animated
 *  elements, so callers can skip a pointless commit. Reordering spans several
 *  elements, which is why it writes a whole new ui instead of one patch. */
export function rewriteAnimationOrders(
  ui: Record<string, unknown> | null | undefined,
  sequence: { key: string; effect: AnimationEffect }[],
): Record<string, unknown> | null {
  if (!ui) return null;
  const assignment = new Map(
    sequence.map((entry, index) => [`${entry.key}|${entry.effect}`, index + 1]),
  );
  const next: Record<string, unknown> = JSON.parse(JSON.stringify(ui));
  let touched = false;
  for (const ref of walkSlideElements(next)) {
    const steps = parseElementAnimations(ref.element.animations);
    if (!steps) continue;
    ref.element.animations = steps.map((step) => ({
      ...step,
      order: assignment.get(`${ref.key}|${step.effect}`) ?? step.order,
    }));
    touched = true;
  }
  return touched ? next : null;
}

export function buildAnimationPlan(
  ui: Record<string, unknown> | null | undefined,
): AnimationPlan {
  if (!ui) return EMPTY_PLAN;

  // Walk order is the deterministic tie-break for equal `order` values — and
  // the order the panel's sequence list shows.
  type Entry = { key: string; selection: ElementSelection; step: AnimationStep };
  const entries: Entry[] = [];
  for (const ref of walkSlideElements(ui)) {
    const steps = parseElementAnimations(ref.element.animations);
    if (!steps) continue;
    for (const step of steps) {
      entries.push({ key: ref.key, selection: ref.selection, step });
    }
  }
  if (entries.length === 0) return EMPTY_PLAN;

  entries.sort((a, b) => a.step.order - b.step.order);

  // Enforce the flight budget by dropping steps from the BACK of the build
  // order. Popping may not free an element immediately (it can still have an
  // earlier step), so loop until the distinct key count fits.
  while (entries.length > 0) {
    const keys = new Set(entries.map((entry) => entry.key));
    if (keys.size <= MAX_ANIMATION_FLIGHTS) break;
    entries.pop();
  }
  if (entries.length === 0) return EMPTY_PLAN;

  // Group the sorted steps: `on-click` closes the current group and opens a
  // new one; the other triggers chain off the previous step inside the group.
  const groups: AnimationGroup[] = [];
  let current: PlannedStep[] = [];
  let previous: PlannedStep | null = null;
  const push = (steps: PlannedStep[]) => {
    if (steps.length === 0) return;
    groups.push({
      steps,
      durationMs: Math.max(
        ...steps.map(({ step, startAt }) => startAt + step.delay + step.duration),
      ),
    });
  };

  for (const entry of entries) {
    const { step } = entry;
    let startAt = 0;
    if (previous) {
      if (step.trigger === "on-click") {
        push(current);
        current = [];
        previous = null;
      } else if (step.trigger === "with-previous") {
        startAt = previous.startAt;
      } else {
        startAt =
          previous.startAt + previous.step.delay + previous.step.duration;
      }
    }
    const planned: PlannedStep = {
      key: entry.key,
      selection: entry.selection,
      step,
      startAt,
    };
    current.push(planned);
    previous = planned;
  }
  push(current);

  // First/last step per element decide the hidden sets — computed from the
  // budgeted step list, so an element dropped by the cap never ends up stuck
  // invisible.
  const firstByKindOrder = new Map<string, Entry>();
  const lastByKindOrder = new Map<string, Entry>();
  for (const entry of entries) {
    if (!firstByKindOrder.has(entry.key)) firstByKindOrder.set(entry.key, entry);
    lastByKindOrder.set(entry.key, entry);
  }
  const kindOf = (entry: Entry) => animationEffectKind(entry.step.effect);

  return {
    groups,
    hiddenAtStart: [...firstByKindOrder.values()]
      .filter((entry) => kindOf(entry) === "entrance")
      .map((entry) => entry.key),
    hiddenAtEnd: [...lastByKindOrder.values()]
      .filter((entry) => kindOf(entry) === "exit")
      .map((entry) => entry.key),
    animatedKeys: [...new Set(entries.map((entry) => entry.key))],
  };
}
