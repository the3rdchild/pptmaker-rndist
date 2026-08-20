"use client";

// Raster-flight player for per-element animations — the sibling of
// present-mode.tsx's transition machinery, built on the same stage-raster
// pipeline and bound by the same contract: never animate the live Konva
// stage, only bitmaps; cut the animated elements out of the base bitmap
// BEFORE freezing it; hide → sync draw → rasterize → animate → restore, in
// that order.
//
// The overlay drives CSS animations per GROUP. When a group becomes active,
// each flight gets inline animation longhands for its running steps —
// comma-joined lists when one element runs several steps in the same group,
// because two effect classes would fight over `animation-name` (one property,
// one winner). That stacking requirement is why playback builds the longhand
// lists here instead of toggling CSS classes.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type Konva from "konva";
import {
  CanvasHost,
  SLIDE_H,
  SLIDE_W,
  fillHost,
  layerPixelRatio,
  nextFrame,
  profileFlight,
  rasterizeStage,
  rectFromNode,
  sleep,
  waitForSceneSettled,
  type FlightRect,
} from "@/components/editor-react/stage-raster";
import {
  buildAnimationPlan,
  type AnimationPlan,
  type PlannedStep,
} from "@/components/editor-react/animation-sequence";
import {
  animationEffectKind,
  type AnimationEffect,
  type AnimationKind,
} from "@/components/slide-editor/animation/animation-meta";

export interface AnimationFlight {
  key: string;
  canvas: HTMLCanvasElement;
  box: FlightRect;
}

/** Fill-mode per kind. Entrance "backwards" holds the from-state through
 *  animation-delay; exit "forwards" keeps the element hidden after it ends
 *  (the animation values must STAY applied for that — see heldExits in the
 *  overlay); emphasis ends at identity so nothing needs holding. */
const FILL_MODE: Record<AnimationKind, string> = {
  entrance: "backwards",
  emphasis: "both",
  exit: "forwards",
};

function willChangeFor(effects: AnimationEffect[]): string | undefined {
  const props = new Set<string>();
  for (const effect of effects) {
    if (effect.startsWith("wipe")) props.add("clip-path");
    else {
      props.add("transform");
      if (/^(fade|rise|sink|zoom|pop)/.test(effect)) props.add("opacity");
    }
  }
  return props.size > 0 ? [...props].join(", ") : undefined;
}

/** Freezes every animated element into its own bitmap and hides the live
 *  nodes (with one synchronous layer draw) so the caller's next
 *  rasterizeStage() produces the base WITHOUT them — miss that cut and each
 *  element shows twice: stranded in the base bitmap and again in flight.
 *  Same rule the morph backdrop lives by. */
export function captureAnimationFlights(
  plan: AnimationPlan,
  refs: Map<string, Konva.Node> | null,
): {
  flights: AnimationFlight[];
  restore: (opts?: { keepExitedHidden?: boolean }) => void;
} {
  const flights: AnimationFlight[] = [];
  const hidden: { node: Konva.Node; opacity: number; exited: boolean }[] = [];
  const exitedKeys = new Set(plan.hiddenAtEnd);

  // pop/grow overshoot past the resting size; capture those elements at a
  // higher ratio so the enlarged frames don't arrive soft. Everything else
  // stays at the layer's own resolution — buffer memory is the real cost
  // here, not draw time.
  const growing = new Set<string>();
  for (const group of plan.groups) {
    for (const { key, step } of group.steps) {
      if (step.effect === "pop" || step.effect === "grow") growing.add(key);
    }
  }

  for (const key of plan.animatedKeys) {
    const node = refs?.get(key);
    const box = rectFromNode(node);
    if (!node || !box) continue;
    let canvas: HTMLCanvasElement;
    try {
      canvas = node.toCanvas({
        pixelRatio: Math.min(
          3,
          layerPixelRatio(node.getLayer()) * (growing.has(key) ? 1.35 : 1),
        ),
      });
    } catch {
      // A detached node would throw here — that element just sits the
      // animation out (same policy as morph flights).
      continue;
    }
    flights.push({ key, canvas: fillHost(canvas), box });
    hidden.push({
      node,
      opacity: node.opacity(),
      exited: exitedKeys.has(key),
    });
    node.opacity(0);
  }

  const stage = hidden[0]?.node.getStage() ?? null;
  if (hidden.length > 0) {
    try {
      stage?.getLayers().forEach((layer) => layer.draw());
    } catch {
      // Stage already torn down — nothing left to paint.
    }
  }

  return {
    flights,
    restore: (opts) => {
      hidden.forEach(({ node, opacity, exited }) => {
        node.opacity(opts?.keepExitedHidden && exited ? 0 : opacity);
      });
      try {
        stage?.getLayers().forEach((layer) => layer.draw());
      } catch {
        // Unmounting — see above.
      }
    },
  };
}

/** The flights themselves: absolutely-positioned bitmaps at their resting
 *  boxes, with the active group's animation longhands applied inline. Group
 *  completion is a timer, not animation events — steps are spread across
 *  elements and stacked per element, so per-element events would fire over
 *  and over; group.durationMs already spans the last step. */
export function AnimationOverlay({
  flights,
  plan,
  activeGroup,
  onGroupDone,
}: {
  flights: AnimationFlight[];
  plan: AnimationPlan;
  /** -1 = staged but not started; everything sits in its pre-play state. */
  activeGroup: number;
  onGroupDone: (groupIndex: number) => void;
}) {
  const stepsByKey = useMemo(() => {
    const map = new Map<string, { groupIndex: number; planned: PlannedStep }[]>();
    plan.groups.forEach((group, groupIndex) => {
      group.steps.forEach((planned) => {
        const list = map.get(planned.key) ?? [];
        list.push({ groupIndex, planned });
        map.set(planned.key, list);
      });
    });
    return map;
  }, [plan]);

  useEffect(() => {
    if (activeGroup < 0 || activeGroup >= plan.groups.length) return;
    const timer = window.setTimeout(
      () => onGroupDone(activeGroup),
      plan.groups[activeGroup].durationMs + 60,
    );
    return () => window.clearTimeout(timer);
  }, [activeGroup, plan, onGroupDone]);

  return (
    <>
      {flights.map((flight) => {
        const steps = stepsByKey.get(flight.key) ?? [];
        // The element's first step (build order) decides when it may appear.
        const entranceGroup = steps[0]?.groupIndex ?? -1;
        const startsHidden =
          plan.hiddenAtStart.includes(flight.key) && activeGroup < entranceGroup;
        const running = steps.filter((s) => s.groupIndex === activeGroup);
        // Finished exits keep their animation applied: fill-mode forwards is
        // what holds the element hidden once its group is over.
        const heldExits = steps.filter(
          (s) =>
            s.groupIndex < activeGroup &&
            animationEffectKind(s.planned.step.effect) === "exit",
        );
        const active = [...running, ...heldExits];

        const style = {
          position: "absolute",
          left: flight.box.x,
          top: flight.box.y,
          width: flight.box.width,
          height: flight.box.height,
          zIndex: 6,
          transformOrigin: "center",
          opacity: startsHidden ? 0 : 1,
          // Travel distances so the slide effects start fully off the slide
          // edge, whatever the element's position. Percentages here would
          // resolve against the element's own box, which slides it by its own
          // width — visibly still on-slide for anything near the middle.
          "--anim-travel-x-neg": `${flight.box.x + flight.box.width}px`,
          "--anim-travel-x-pos": `${SLIDE_W - flight.box.x}px`,
          "--anim-travel-y-pos": `${SLIDE_H - flight.box.y}px`,
          "--anim-travel-y-neg": `${flight.box.y + flight.box.height}px`,
          ...(active.length > 0
            ? {
                animationName: active
                  .map((s) => `anim-kf-${s.planned.step.effect}`)
                  .join(", "),
                animationDuration: active
                  .map((s) => `${s.planned.step.duration}ms`)
                  .join(", "),
                animationDelay: active
                  .map((s) => `${s.planned.startAt + s.planned.step.delay}ms`)
                  .join(", "),
                animationTimingFunction: active
                  .map((s) => s.planned.step.easing)
                  .join(", "),
                animationFillMode: active
                  .map(
                    (s) =>
                      FILL_MODE[animationEffectKind(s.planned.step.effect)!],
                  )
                  .join(", "),
                // Dropped the moment the group finishes (running empties and
                // only the forwards-filling exits keep values at all) — a
                // permanently promoted layer per animated element is a slow
                // GPU leak.
                willChange: willChangeFor(
                  running.map((s) => s.planned.step.effect),
                ),
              }
            : {}),
        } as CSSProperties;

        return (
          <CanvasHost
            key={flight.key}
            canvas={flight.canvas}
            className="pointer-events-none absolute"
            style={style}
          />
        );
      })}
    </>
  );
}

/** Editor-canvas preview: auto-plays EVERY group (on-click ones included —
 *  the preview exists to check the motion, not to rehearse the talk) with a
 *  pause between groups, then puts the canvas back exactly as it was.
 *  Present Mode does not use this; it drives groups from navigation. */
export function AnimationPreviewLayer({
  ui,
  stageRef,
  nodeRefs,
  onFinished,
}: {
  /** The slide the preview was started for, captured once — later edits
   *  shouldn't restart or reshape a run in flight. */
  ui: Record<string, unknown> | null;
  stageRef: { current: Konva.Stage | null };
  nodeRefs: { current: Map<string, Konva.Node> | null };
  onFinished: () => void;
}) {
  const [state, setState] = useState<{
    plan: AnimationPlan;
    flights: AnimationFlight[];
    base: HTMLCanvasElement | null;
    activeGroup: number;
  } | null>(null);
  const restoreRef = useRef<((opts?: { keepExitedHidden?: boolean }) => void) | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const plan = buildAnimationPlan(ui);
      if (plan.animatedKeys.length === 0) {
        onFinished();
        return;
      }
      // The surface mounts asynchronously (dynamic import, stage callback) —
      // poll briefly instead of giving up on the first frame.
      const deadline = performance.now() + 600;
      let stage = stageRef.current;
      while (!stage && performance.now() < deadline && !cancelled) {
        await nextFrame();
        stage = stageRef.current;
      }
      if (!stage || cancelled) {
        onFinished();
        return;
      }
      // Selection was cleared by the Play button; the settle also covers the
      // transformer teardown so none of it bakes into the rasters.
      await waitForSceneSettled(stage, () => cancelled);
      if (cancelled) return;
      const captured = captureAnimationFlights(plan, nodeRefs.current);
      restoreRef.current = captured.restore;
      if (captured.flights.length === 0) {
        restoreRef.current = null;
        captured.restore();
        onFinished();
        return;
      }
      const base = rasterizeStage(stage);
      setState({ plan, flights: captured.flights, base, activeGroup: -1 });
      // Two frames at rest before the first group: mounting flights and
      // starting their animations in the same commit spends the first frames
      // fighting the mount.
      await nextFrame();
      await nextFrame();
      if (cancelled) return;
      profileFlight(
        `animation group 0 (${captured.flights.length} flights)`,
        plan.groups[0]?.durationMs ?? 0,
      );
      setState((current) => (current ? { ...current, activeGroup: 0 } : current));
    })();
    return () => {
      cancelled = true;
    };
    // One-shot run keyed by the parent's token: deliberately no reactive
    // deps, so a concurrent ui edit can't restart the capture mid-flight.
  }, []);

  // Restore on unmount (Stop button, slide change, editor teardown). The
  // overlay comes down a frame AFTER restore so the restored nodes are
  // already painted underneath it — the reverse order blinks.
  useEffect(
    () => () => {
      doneRef.current = true;
      restoreRef.current?.();
      restoreRef.current = null;
    },
    [],
  );

  const finish = async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const restore = restoreRef.current;
    restoreRef.current = null;
    restore?.();
    await nextFrame();
    setState(null);
    onFinished();
  };

  const handleGroupDone = async (groupIndex: number) => {
    const plan = state?.plan;
    if (!plan || doneRef.current) return;
    if (groupIndex + 1 < plan.groups.length) {
      // A pause between groups so consecutive builds read as separate beats.
      await sleep(700);
      if (doneRef.current || !restoreRef.current || !state) return;
      profileFlight(
        `animation group ${groupIndex + 1} (${state.flights.length} flights)`,
        plan.groups[groupIndex + 1]?.durationMs ?? 0,
      );
      setState((current) =>
        current ? { ...current, activeGroup: groupIndex + 1 } : current,
      );
      return;
    }
    finish();
  };

  if (!state) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[60]">
      {state.base ? (
        <CanvasHost canvas={state.base} className="absolute inset-0" />
      ) : null}
      <AnimationOverlay
        flights={state.flights}
        plan={state.plan}
        activeGroup={state.activeGroup}
        onGroupDone={handleGroupDone}
      />
    </div>
  );
}
