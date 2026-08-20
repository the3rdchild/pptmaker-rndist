// Per-element animation planner — pure, no React, no DOM. Turns the
// `animations` arrays authored on a slide's elements into a playback plan:
// which elements need cutting out of the base bitmap, which start/end hidden,
// and how the steps group into the "clicks" of a build.
//
// Shared by Present Mode, the editor canvas preview and the Animation panel's
// sequence list, which is why it must stay free of anything browser-bound.

import { walkSlideElements } from "@/components/editor-react/morph";
import {
  MAX_ANIMATION_FLIGHTS,
  animationEffectKind,
  parseElementAnimations,
  type AnimationEasing,
  type AnimationEffect,
  type AnimationStep,
  type AnimationTrigger,
} from "@/components/slide-editor/animation/animation-meta";
import {
  absoluteBoxForSelection,
  isBackgroundComponent,
} from "@/components/slide-editor/model/model";
import {
  ROOT_ELEMENTS_COMPONENT_INDEX,
  type ElementSelection,
  type RawUi,
} from "@/components/slide-editor/model/core";

/** Re-exported for the consumers already reaching for it here; the budget
 *  itself is defined next to the step schema. Steps past it are dropped from
 *  the back of the build order and their elements render statically. */
export { MAX_ANIMATION_FLIGHTS };

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
  /** Some emphasis step repeats until the slide is left. The overlay then has
   *  to stay up after the last group instead of handing the slide back to the
   *  live stage, which is where the looping element would stop dead. */
  hasLoop: boolean;
}

const EMPTY_PLAN: AnimationPlan = {
  groups: [],
  hiddenAtStart: [],
  hiddenAtEnd: [],
  animatedKeys: [],
  hasLoop: false,
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

/** Height of the "same row" band the Animate-all ordering uses — elements
 *  whose tops are within this many pixels read as one line and order
 *  left-to-right instead of by microscopic y jitter. */
const ORDER_BAND_PX = 40;

/** The timing every step of an "Animate all" pass gets, so the preset is a
 *  choice of effect plus a choice of pacing rather than four hardcoded
 *  numbers. `trigger` applies to the element that opens each beat. */
export interface AnimateAllTiming {
  trigger: AnimationTrigger;
  duration: number;
  delay: number;
  easing: AnimationEasing;
}

/** "Animate all" preset: one entrance step for every meaningful element,
 *  ordered the way a reader scans (top-to-bottom in bands, then
 *  left-to-right).
 *
 *  Skip rules: decorative elements (their children stay candidates), whole
 *  background components, and the CHILDREN of an accepted element —
 *  animating a container together with its contents double-transforms the
 *  contents, so each subtree contributes its topmost animatable level only.
 *  Existing steps on covered elements are replaced: a preset is a statement
 *  about the whole slide, not a merge. */
export function applyAnimateAllPreset(
  ui: Record<string, unknown> | null | undefined,
  effect: AnimationEffect,
  timing: AnimateAllTiming,
): Record<string, unknown> | null {
  if (!ui) return null;

  const backgroundComponents = new Set<number>();
  if (Array.isArray(ui.components)) {
    ui.components.forEach((component, index) => {
      if (
        component &&
        typeof component === "object" &&
        isBackgroundComponent(component as never)
      ) {
        backgroundComponents.add(index);
      }
    });
  }

  // walkSlideElements is pre-order (parent before children), so an accepted
  // element's descendants can be recognised by path prefix and skipped.
  const acceptedPrefixes: { componentIndex: number; path: number[] }[] = [];
  const underAccepted = (componentIndex: number, path: number[]) =>
    acceptedPrefixes.some(
      (prefix) =>
        prefix.componentIndex === componentIndex &&
        path.length > prefix.path.length &&
        prefix.path.every((value, index) => path[index] === value),
    );

  const ranked: { key: string; beat: string; band: number; x: number }[] = [];
  for (const ref of walkSlideElements(ui)) {
    if (backgroundComponents.has(ref.selection.componentIndex)) continue;
    if (underAccepted(ref.selection.componentIndex, ref.selection.elementPath)) {
      continue;
    }
    // Decorative marks the element itself untouchable, not its subtree —
    // content inside a decorative frame is still content.
    if (ref.element.decorative === true) continue;
    const box = absoluteBoxForSelection(ui as RawUi, ref.selection);
    ranked.push({
      key: ref.key,
      beat: beatKey(ref.selection.componentIndex, ref.selection.elementPath),
      band: box ? Math.floor(box.y / ORDER_BAND_PX) : Number.MAX_SAFE_INTEGER,
      x: box?.x ?? 0,
    });
    acceptedPrefixes.push({
      componentIndex: ref.selection.componentIndex,
      path: ref.selection.elementPath,
    });
  }

  // Elements that share a component were grouped on the canvas (grouping
  // merges the components into one), so they read as a single thing and have
  // to move as one — animating a grouped card's icon, title and body one by
  // one is what the beat exists to prevent. A beat is sorted by its
  // topmost-leftmost member, and beats run in reading order between them.
  const beats = new Map<string, typeof ranked>();
  for (const entry of ranked) {
    const members = beats.get(entry.beat) ?? [];
    members.push(entry);
    beats.set(entry.beat, members);
  }
  const readingOrder = (a: { band: number; x: number }, b: typeof a) =>
    a.band - b.band || a.x - b.x;
  const ordered = [...beats.values()]
    .map((members) => [...members].sort(readingOrder))
    .sort((a, b) => readingOrder(a[0], b[0]));

  // The budget counts elements, so slice across the flattened beats rather
  // than dropping whole ones — a half-animated beat still plays correctly,
  // its remaining members just render statically.
  const assignment = new Map<string, { order: number; first: boolean }>();
  for (const members of ordered) {
    members.forEach((member, indexInBeat) => {
      if (assignment.size >= MAX_ANIMATION_FLIGHTS) return;
      assignment.set(member.key, {
        order: assignment.size + 1,
        first: indexInBeat === 0,
      });
    });
  }
  if (assignment.size === 0) return null;

  const next: Record<string, unknown> = JSON.parse(JSON.stringify(ui));
  for (const ref of walkSlideElements(next)) {
    const slot = assignment.get(ref.key);
    if (!slot) continue;
    const step: AnimationStep = {
      effect,
      // Only the element opening a beat carries the chosen trigger; the rest
      // ride along with it. with-previous is what makes them share a start
      // time — the order values stay distinct so the build list can still
      // show and reorder them individually.
      trigger: slot.first ? timing.trigger : "with-previous",
      order: slot.order,
      duration: timing.duration,
      delay: timing.delay,
      easing: timing.easing,
    };
    ref.element.animations = [step];
  }
  return next;
}

/** What counts as "one beat" for the preset. Elements inside the same
 *  component were grouped together (groupComponentsInUi merges the selected
 *  components into one, so a canvas group IS a component); root-level
 *  elements have no such relationship, so each stands alone. */
function beatKey(componentIndex: number, elementPath: number[]): string {
  return componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX
    ? `root:${elementPath[0]}`
    : `component:${componentIndex}`;
}

/** Retimes every step already on the slide without touching which effects
 *  they are — the "apply to all" half of the timing controls, for a slide
 *  whose animations are already the ones the author wants. Returns null when
 *  there is nothing animated to retime. */
export function applyTimingToAll(
  ui: Record<string, unknown> | null | undefined,
  timing: AnimateAllTiming,
): Record<string, unknown> | null {
  if (!ui) return null;
  const next: Record<string, unknown> = JSON.parse(JSON.stringify(ui));
  let touched = false;
  for (const ref of walkSlideElements(next)) {
    const steps = parseElementAnimations(ref.element.animations);
    if (!steps) continue;
    ref.element.animations = steps.map((step) => ({
      ...step,
      // `with-previous` is what binds a group's elements into one beat, so
      // retiming must not flatten it back into a one-by-one chain.
      trigger: step.trigger === "with-previous" ? step.trigger : timing.trigger,
      duration: timing.duration,
      delay: timing.delay,
      easing: timing.easing,
    }));
    touched = true;
  }
  return touched ? next : null;
}

/** Strips every element's `animations` on a deep clone; null when there was
 *  nothing to strip, so the caller can skip a pointless (selection-resetting)
 *  commit. */
export function clearAllAnimations(
  ui: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!ui) return null;
  const next: Record<string, unknown> = JSON.parse(JSON.stringify(ui));
  let touched = false;
  for (const ref of walkSlideElements(next)) {
    if (ref.element.animations === undefined) continue;
    delete ref.element.animations;
    touched = true;
  }
  return touched ? next : null;
}

/** Steps of elements whose key is excluded are dropped entirely — the
 *  element renders statically instead. Present Mode uses this for the
 *  morph-wins rule: an element matched by a morph flight must not ALSO run
 *  an entrance, and one element cannot both fly in from the previous slide
 *  and fade in from nothing. */
export function buildAnimationPlan(
  ui: Record<string, unknown> | null | undefined,
  excludeKeys?: Set<string>,
): AnimationPlan {
  if (!ui) return EMPTY_PLAN;

  // Walk order is the deterministic tie-break for equal `order` values — and
  // the order the panel's sequence list shows.
  type Entry = { key: string; selection: ElementSelection; step: AnimationStep };
  const entries: Entry[] = [];
  for (const ref of walkSlideElements(ui)) {
    if (excludeKeys?.has(ref.key)) continue;
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
      // A looping step counts for ONE iteration here on purpose: the group has
      // to be able to finish, or an after-previous step behind a loop would
      // never start and the build would stall forever.
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
    hasLoop: entries.some((entry) => entry.step.loop === true),
  };
}
