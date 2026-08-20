// Per-element animation authoring metadata (Animation rail tab, Present Mode
// playback). Same contract as templates/slot-meta.ts: a constant catalog plus
// defensive parse* helpers that return null when nothing meaningful was
// authored, so an element nobody touched stays byte-identical through a
// template round trip.
//
// The `animations` array lives on the element itself, never on the slide: the
// generator's fill pass can DELETE elements (`prune_if_unfilled`), which would
// silently re-point any slide-level list that addresses elements by path.

/** What phase of an element's life an effect belongs to. Entrance steps make
 *  the element start hidden; exit steps make it end hidden. Emphasis is a
 *  temporary beat that returns the element to rest. */
export type AnimationKind = "entrance" | "emphasis" | "exit";

/** How many distinct ELEMENTS one slide may animate. Each one becomes a
 *  composited layer for the whole time the overlay is up (not just while it
 *  moves), so an unbounded plan is a VRAM bomb on weak GPUs — same policy as
 *  morph's flight cap. Lives here rather than next to the planner so the
 *  template exporter can warn against it without importing the editor. */
export const MAX_ANIMATION_FLIGHTS = 40;

export type AnimationEffect =
  // entrance
  | "fade-in" | "rise" | "slide-in-left" | "slide-in-right"
  | "slide-in-up" | "slide-in-down" | "zoom-in" | "pop" | "wipe-in"
  // emphasis
  | "pulse" | "shake" | "spin" | "grow" | "bounce"
  // exit
  | "fade-out" | "sink" | "slide-out-left" | "slide-out-right"
  | "slide-out-up" | "slide-out-down" | "zoom-out" | "wipe-out";

export const ANIMATION_EFFECTS: {
  id: AnimationEffect;
  kind: AnimationKind;
  label: string;
  hint: string;
}[] = [
  { id: "fade-in", kind: "entrance", label: "Fade In", hint: "Plain opacity ramp from 0" },
  { id: "rise", kind: "entrance", label: "Rise", hint: "Fades in while settling up into place" },
  { id: "slide-in-left", kind: "entrance", label: "Slide In Left", hint: "Enters from off the left edge" },
  { id: "slide-in-right", kind: "entrance", label: "Slide In Right", hint: "Enters from off the right edge" },
  { id: "slide-in-up", kind: "entrance", label: "Slide In Up", hint: "Enters from below the bottom edge" },
  { id: "slide-in-down", kind: "entrance", label: "Slide In Down", hint: "Enters from above the top edge" },
  { id: "zoom-in", kind: "entrance", label: "Zoom In", hint: "Scales up from the center" },
  { id: "pop", kind: "entrance", label: "Pop", hint: "Overshoots past full size, then settles" },
  { id: "wipe-in", kind: "entrance", label: "Wipe In", hint: "Reveals edge to edge" },
  { id: "pulse", kind: "emphasis", label: "Pulse", hint: "One soft scale beat" },
  { id: "shake", kind: "emphasis", label: "Shake", hint: "Horizontal jitter in place" },
  { id: "spin", kind: "emphasis", label: "Spin", hint: "One full rotation" },
  { id: "grow", kind: "emphasis", label: "Grow", hint: "Grows noticeably, then returns" },
  { id: "bounce", kind: "emphasis", label: "Bounce", hint: "Hops up and lands" },
  { id: "fade-out", kind: "exit", label: "Fade Out", hint: "Fades to nothing" },
  { id: "sink", kind: "exit", label: "Sink", hint: "Fades out while dropping" },
  { id: "slide-out-left", kind: "exit", label: "Slide Out Left", hint: "Leaves past the left edge" },
  { id: "slide-out-right", kind: "exit", label: "Slide Out Right", hint: "Leaves past the right edge" },
  { id: "slide-out-up", kind: "exit", label: "Slide Out Up", hint: "Leaves past the top edge" },
  { id: "slide-out-down", kind: "exit", label: "Slide Out Down", hint: "Leaves past the bottom edge" },
  { id: "zoom-out", kind: "exit", label: "Zoom Out", hint: "Shrinks towards the center" },
  { id: "wipe-out", kind: "exit", label: "Wipe Out", hint: "Wipes away edge to edge" },
];

/** When this step starts, relative to the previous step in the slide's build
 *  order. `on-click` breaks the auto-sequence into a build step of its own. */
export type AnimationTrigger = "on-click" | "with-previous" | "after-previous";

export type AnimationEasing = "ease-out" | "ease-in" | "ease-in-out" | "linear";

export type AnimationStep = {
  effect: AnimationEffect;
  trigger: AnimationTrigger;
  /** Build position within the slide. Intentionally sparse — gaps after the
   *  generator prunes elements are normal, so consumers must SORT by this
   *  and must never index by it. */
  order: number;
  /** ms */
  duration: number;
  /** ms, on top of whatever the trigger implies */
  delay: number;
  easing: AnimationEasing;
  /** Emphasis only: repeat until the slide is left instead of beating once.
   *  The build still moves on after ONE iteration — an after-previous step
   *  behind a looping one would otherwise never start — so this changes how
   *  long the element keeps moving, not the sequence. */
  loop?: boolean;
};

const EFFECT_KINDS = new Map<AnimationEffect, AnimationKind>(
  ANIMATION_EFFECTS.map((effect) => [effect.id, effect.kind]),
);

export function animationEffectKind(
  effect: AnimationEffect,
): AnimationKind | undefined {
  return EFFECT_KINDS.get(effect);
}
const TRIGGER_IDS = new Set<string>(["on-click", "with-previous", "after-previous"]);
const EASING_IDS = new Set<string>(["ease-out", "ease-in", "ease-in-out", "linear"]);

export const ANIMATION_KIND_ORDER: AnimationKind[] = [
  "entrance",
  "emphasis",
  "exit",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readIntInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** A step with authoring defaults, for the panel and the "Animate all" preset
 *  to build on — keeps those defaults in one place next to the parser that
 *  re-applies them to stored data. */
export function makeAnimationStep(
  effect: AnimationEffect,
  order: number,
): AnimationStep {
  return {
    effect,
    trigger: "after-previous",
    order,
    duration: 500,
    delay: 0,
    easing: "ease-out",
  };
}

/** Parses the `animations` field off a raw element. Tolerates a single object
 *  where an array was expected (hand-edited JSON) and drops anything the
 *  catalog doesn't know, so garbage never bakes into a shared template.
 *
 *  Enforces at most one step per kind (one entrance, one emphasis, one exit —
 *  first in the array wins): the panel edits one step per kind, and the
 *  planner's grouping stays deterministic. Returns null when nothing valid
 *  remains, so cleanElement never writes an empty key. */
export function parseElementAnimations(raw: unknown): AnimationStep[] | null {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw)
      ? [raw]
      : null;
  if (!list) return null;

  const byKind = new Map<AnimationKind, AnimationStep>();
  for (const item of list) {
    if (!isRecord(item)) continue;
    const effect =
      typeof item.effect === "string" && EFFECT_KINDS.has(item.effect as AnimationEffect)
        ? (item.effect as AnimationEffect)
        : null;
    if (!effect) continue;
    const kind = EFFECT_KINDS.get(effect);
    if (!kind || byKind.has(kind)) continue;
    byKind.set(kind, {
      effect,
      // Looping an entrance or an exit would mean an element that never
      // finishes arriving or leaving, so the flag is dropped for those kinds
      // rather than honoured.
      ...(kind === "emphasis" && item.loop === true ? { loop: true } : {}),
      trigger:
        typeof item.trigger === "string" && TRIGGER_IDS.has(item.trigger)
          ? (item.trigger as AnimationTrigger)
          : "after-previous",
      order: readIntInRange(item.order, 0, 999, 0),
      duration: readIntInRange(item.duration, 100, 4000, 500),
      delay: readIntInRange(item.delay, 0, 10000, 0),
      easing:
        typeof item.easing === "string" && EASING_IDS.has(item.easing)
          ? (item.easing as AnimationEasing)
          : "ease-out",
    });
  }
  return byKind.size > 0 ? [...byKind.values()] : null;
}
