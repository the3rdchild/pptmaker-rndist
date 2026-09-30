"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type Konva from "konva";
import { ChevronLeft, ChevronRight, LayoutGrid, MonitorPlay, X } from "lucide-react";
import {
  usePresenterChannel,
  type PresenterPoint,
} from "@/components/editor-react/presenter-sync";
import { collectMediaOverlays } from "@/components/editor-react/present-media-overlay";
import { PresentOverview } from "@/components/editor-react/present-overview";
import { recoverPartialAutoEntrance } from "@/components/editor-react/auto-entrance";
import { matchMorphPairs, morphGeometry, walkSlideElements } from "@/components/editor-react/morph";
import { canAddMorphTexture } from "@/components/editor-react/morph-budget.js";
import { contourPolygonAt, shapeImageMorphPlan, shapeMorphPlan, type ShapeMorphPlan } from "@/components/editor-react/morph-shape";
import { MorphShapeFlight } from "@/components/editor-react/morph-shape-flight";
import { borderRadius, getElementAtSelection } from "@/components/slide-editor/model/model";
import type { RawUi } from "@/components/slide-editor/model/core";
import {
  buildAnimationPlan,
  type AnimationPlan,
} from "@/components/editor-react/animation-sequence";
import {
  AnimationOverlay,
  captureAnimationFlights,
  captureStaticForegroundFlights,
  type AnimationFlight,
  type StaticForegroundFlight,
} from "@/components/editor-react/animation-player";
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
import type { SlideTransition } from "@/store/presentationGeneration";

const TemplateV2KonvaSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide
    ),
  { ssr: false }
);

const MORPH_DURATION = 600;
const SLIDE_DURATION = 450;

// ── Why a transition is *prepared* before it is *played* ────────────────────
// A slide change rebuilds the whole Konva scene, and every rebuild repaint is
// a texture invalidation under the CSS animation compositing it. The prepare /
// settle / freeze pipeline that handles this lives in stage-raster.tsx, shared
// with the element-animation player. The same reasoning retired the second
// Konva surface this used to mount for the outgoing slide: building a stage
// costs hundreds of milliseconds of main thread, and it landed squarely inside
// the animation window.
// One flight may use at most a full slide at the scene's 4x ceiling.
// Oversized pairs keep the ordinary slide crossfade. A separate total pixel
// budget allows many small flights without allocating unlimited canvas memory.
const MAX_MORPH_TEXTURE_PIXELS = SLIDE_W * SLIDE_H * 4 * 4;
const MAX_MORPH_TEXTURE_EDGE = 8192;
/** How long the first run waits for the dynamically imported surface to hand
 *  over its stage before giving up and skipping the freeze. */
const MAX_STAGE_WAIT_MS = 1500;

interface MorphFlight {
  /** nodeRefs key of this element on the INCOMING slide. */
  key: string;
  canvas: HTMLCanvasElement | null;
  targetCanvas?: HTMLCanvasElement | null;
  targetImage?: string | null;
  imageSource?: boolean;
  kind: "raster" | "shape" | "crossfade";
  shape?: ShapeMorphPlan | null;
  from: FlightRect;
  to: FlightRect;
  /** Images resize their clipped viewport while their bitmap keeps its ratio. */
  cropImage: boolean;
  borderRadius: string;
}

type TransitionStage =
  | "preparing"
  | "staged"
  | "playing"
  /** Transition finished; the animation overlay owns the slide until its
   *  groups are done. Only set when the slide has an animation run. */
  | "animating";

interface TransitionRun {
  id: number;
  /** "none" is a real stage here: a slide with element animations but no
   *  transition still runs the prepare/stage pipeline, because the animation
   *  overlay needs the frozen base bitmap it produces. */
  type: SlideTransition;
  /** Frozen bitmap of the slide we are leaving. */
  backdrop: HTMLCanvasElement | null;
  /** Frozen bitmap of the slide we are arriving at, captured once the scene
   *  settled. This is what actually moves — the live stage stays hidden for
   *  the duration, so nothing in the animation can be repainted. */
  incoming: HTMLCanvasElement | null;
  flights: MorphFlight[];
  stage: TransitionStage;
  /** Navigating BACKWARDS shows the slide in its final state: every build
   *  already ran, so elements whose last step is an exit are hidden for good
   *  (no playback). Forward runs leave this empty. */
  finalHiddenKeys: string[];
}

/** One navigation's element-animation run. The plan's flights are cut from
 *  the settled incoming stage BEFORE `incoming` is frozen, so the base
 *  bitmap never contains the animated elements. */
interface AnimationRun {
  id: number;
  plan: AnimationPlan;
  flights: AnimationFlight[];
  /** -1 = staged, not started. Further groups advance on Next (#builds). */
  activeGroup: number;
  restore: (opts?: { keepExitedHidden?: boolean }) => void;
  foreground: StaticForegroundFlight[];
  restoreForeground: () => void;
  paintOrder: ReadonlyMap<string, number>;
}

interface MorphCapture {
  flights: MorphFlight[];
  /** The outgoing nodes the flights were cut from. They have to be hidden
   *  before the backdrop is frozen, or each one shows twice: stuck at its old
   *  position inside the backdrop, and again in flight. */
  sources: Konva.Node[];
}

const NO_MORPH: MorphCapture = { flights: [], sources: [] };

/** A detached snapshot of one Konva node, scaled to cover both endpoints. */
function captureMorphCanvas(node: Konva.Node, rect: FlightRect, width: number, height: number, ratio: number) {
  const absolute = node.getAbsoluteTransform().copy();
  const captureTransform = absolute.copy();
  captureTransform.reset();
  captureTransform.scale(width / rect.width, height / rect.height);
  captureTransform.translate(-rect.x, -rect.y);
  captureTransform.multiply(absolute);
  const snapshot = node.clone({
    ...captureTransform.decompose(),
    offsetX: 0,
    offsetY: 0,
    opacity: node.getAbsoluteOpacity(),
    transformsEnabled: "all",
  });
  try {
    return fillHost(snapshot.toCanvas({ x: 0, y: 0, width, height, pixelRatio: ratio }));
  } finally {
    snapshot.destroy();
  }
}

/** Freezes the matched elements of the outgoing slide into bitmaps, read off
 *  the live stage *before* navigating — so they are guaranteed fully painted
 *  and no second Konva surface has to be mounted to produce them. */
function captureMorphFlights(
  uiA: Record<string, unknown> | null | undefined,
  uiB: Record<string, unknown> | null | undefined,
  refs: Map<string, Konva.Node> | null,
): MorphCapture {
  if (!refs || !uiA || !uiB) return NO_MORPH;
  const moved = matchMorphPairs(uiA, uiB).pairs.flatMap((pair) => {
    const from = morphGeometry(uiA, pair.selectionA);
    const to = morphGeometry(uiB, pair.selectionB);
    if (!from || !to) return [];
    // An element that stays put needs no flight — the outgoing bitmap simply
    // crossfades into an identical one underneath. Skipping those is what
    // keeps the common morph workflow (duplicate a slide, move one thing) down
    // to a couple of composited layers instead of one per element.
    const still =
      Math.abs(from.box.x - to.box.x) < 0.5 &&
      Math.abs(from.box.y - to.box.y) < 0.5 &&
      Math.abs(from.box.width - to.box.width) < 0.5 &&
      Math.abs(from.box.height - to.box.height) < 0.5 &&
      Math.abs(from.rotation - to.rotation) < 0.01;
    const sourceElement = getElementAtSelection(uiA as RawUi, pair.selectionA);
    const targetElement = getElementAtSelection(uiB as RawUi, pair.selectionB);
    const changedAppearance = sourceElement?.type !== targetElement?.type ||
      JSON.stringify(sourceElement?.border_radius ?? null) !== JSON.stringify(targetElement?.border_radius ?? null) ||
      JSON.stringify(sourceElement?.fill ?? null) !== JSON.stringify(targetElement?.fill ?? null) ||
      JSON.stringify(sourceElement?.stroke ?? null) !== JSON.stringify(targetElement?.stroke ?? null) ||
      sourceElement?.d !== targetElement?.d || sourceElement?.data !== targetElement?.data;
    return still && !changedAppearance ? [] : [{ pair, from, to, sourceElement, targetElement }];
  });

  moved.sort(
    (a, b) =>
      b.from.box.width * b.from.box.height - a.from.box.width * a.from.box.height,
  );

  const flights: MorphFlight[] = [];
  const sources: Konva.Node[] = [];
  let usedPixels = 0;
  for (const entry of moved) {
    const node = refs.get(entry.pair.keyA);
    const rect = rectFromNode(node);
    if (!node || !rect) continue;
    const sourceElement = entry.sourceElement;
    const targetElement = entry.targetElement;
    const shape = shapeMorphPlan(sourceElement, targetElement);
    const crossfade = !shape && (sourceElement?.type === "image" || targetElement?.type === "image") &&
      (sourceElement?.type !== targetElement?.type || sourceElement?.data !== targetElement?.data);
    const imageContour = crossfade ? shapeImageMorphPlan(sourceElement, targetElement) : null;
    const cropImage = sourceElement?.type === "image" && targetElement?.type === "image";
    const radius = cropImage ? borderRadius(targetElement) : 0;
    const borderRadiusCss = Array.isArray(radius)
      ? radius.map((value) => `${Math.max(0, value)}px`).join(" ")
      : `${Math.max(0, radius)}px`;
    if (shape) {
      flights.push({
        key: entry.pair.keyB, kind: "shape", canvas: null, shape,
        from: rect,
        to: { x: entry.to.box.x, y: entry.to.box.y, width: entry.to.box.width, height: entry.to.box.height },
        cropImage: false, borderRadius: "0px",
      });
      sources.push(node);
      continue;
    }
    const ratio = layerPixelRatio(node.getLayer());
    // The image snapshot stays at its source aspect. Its viewport will grow
    // and crop during the flight; pre-stretching this bitmap would bake in
    // exactly the squashing we are trying to avoid.
    const width = cropImage ? rect.width : Math.ceil(Math.max(rect.width, entry.to.box.width));
    const height = cropImage ? rect.height : Math.ceil(Math.max(rect.height, entry.to.box.height));
    const pixelWidth = Math.ceil(width * ratio);
    const pixelHeight = Math.ceil(height * ratio);
    if (
      pixelWidth > MAX_MORPH_TEXTURE_EDGE ||
      pixelHeight > MAX_MORPH_TEXTURE_EDGE ||
      pixelWidth * pixelHeight > MAX_MORPH_TEXTURE_PIXELS ||
      !canAddMorphTexture(usedPixels, pixelWidth, pixelHeight) ||
      (crossfade && !canAddMorphTexture(usedPixels + pixelWidth * pixelHeight,
        Math.ceil(entry.to.box.width * ratio), Math.ceil(entry.to.box.height * ratio)))
    ) continue;
    let canvas: HTMLCanvasElement;
    try {
      canvas = captureMorphCanvas(node, rect, width, height, ratio);
      if (cropImage) canvas.style.objectFit = "cover";
    } catch {
      // toCanvas only draws (never reads pixels), so a tainted canvas is fine
      // here. A node that cannot be captured keeps the slide crossfade.
      continue;
    }
    usedPixels += pixelWidth * pixelHeight + (crossfade
      ? Math.ceil(entry.to.box.width * ratio) * Math.ceil(entry.to.box.height * ratio) : 0);
    flights.push({
      key: entry.pair.keyB,
      kind: crossfade ? "crossfade" : "raster",
      canvas,
      shape: imageContour,
      imageSource: sourceElement?.type === "image",
      targetImage: crossfade && targetElement?.type === "image" && typeof targetElement.data === "string" ? targetElement.data : null,
      from: rect,
      to: {
        x: entry.to.box.x,
        y: entry.to.box.y,
        width: entry.to.box.width,
        height: entry.to.box.height,
      },
      cropImage,
      borderRadius: borderRadiusCss,
    });
    sources.push(node);
  }
  return { flights, sources };
}

export default function PresentMode({
  slides: sourceSlides,
  startIndex,
  deckId,
  fonts,
  onClose,
}: {
  slides: {
    ui?: Record<string, unknown> | null | undefined;
    isHidden?: boolean;
    transition?: SlideTransition;
  }[];
  startIndex: number;
  deckId?: string | null;
  fonts?: unknown;
  onClose: () => void;
}) {
  const slides = useMemo(() => sourceSlides.map((slide) => {
    const repaired = recoverPartialAutoEntrance(slide.ui);
    if (!repaired) return slide;
    return {
      ...slide,
      ui: repaired.ui,
      transition: repaired.overflow && slide.transition !== "morph"
        ? "fade-black" as const
        : slide.transition,
    };
  }), [sourceSlides]);
  // Hidden slides (#24) are skipped during presentation but stay in the
  // deck — Next/Prev walk this visible-only index list instead of ±1.
  const visibleIndexes = useMemo(() => {
    const indexes = slides
      .map((_, i) => i)
      .filter((i) => !slides[i]?.isHidden);
    return indexes.length > 0 ? indexes : slides.map((_, i) => i);
  }, [slides]);

  const resolveStart = () => {
    const hashSlide = typeof window === "undefined" ? null : /^#(\d+)$/.exec(window.location.hash);
    const requested = hashSlide ? Number(hashSlide[1]) - 1 : startIndex;
    if (visibleIndexes.includes(requested)) return requested;
    return visibleIndexes.find((i) => i >= requested) ?? visibleIndexes[0] ?? startIndex;
  };
  const [index, setIndex] = useState(resolveStart);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Navigation reads both of these synchronously (before React re-renders) to
  // snapshot the slide being left, so they are refs rather than state.
  const indexRef = useRef(index);
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  const stageRef = useRef<Konva.Stage | null>(null);
  const nodeRefs = useRef<Map<string, Konva.Node> | null>(null);
  const runIdRef = useRef(0);
  /** Mirrors `transition` for the driver effect below, which is keyed on the
   *  run id alone so its own stage updates don't restart (and cancel) it. */
  const runRef = useRef<TransitionRun | null>(null);
  const morphRestoreRef = useRef<(() => void)[]>([]);
  const [transition, setTransition] = useState<TransitionRun | null>(null);
  /** Opacity restores for nodes hidden by a backward navigation's final
   *  state — same shape as morphRestoreRef, kept until the next navigation. */
  const exitedRestoreRef = useRef<(() => void)[]>([]);
  /** Plan for the slide being navigated TO, handed to the driver effect —
   *  built here (not there) because the morph exclusion needs the OUTGOING
   *  slide's ui, which the stage no longer holds once navigation commits. */
  const pendingAnimationRef = useRef<AnimationPlan | null>(null);
  const animationRunRef = useRef<AnimationRun | null>(null);
  const [animationRun, setAnimationRun] = useState<AnimationRun | null>(null);

  /** The run is read from two places that cannot see the same value unless it
   *  is written to both: the overlay renders from state, while Next and the
   *  group-done guard run in callbacks that need the CURRENT group
   *  synchronously. Updating only the state left the ref pinned at the staged
   *  -1 forever, which silently killed every build past the first. */
  const commitAnimationRun = useCallback((next: AnimationRun | null) => {
    animationRunRef.current = next;
    setAnimationRun(next);
  }, []);

  /** Puts back the opacity of the incoming elements a morph flight covers, and
   *  repaints synchronously (not batchDraw's scheduled pass) so they are in the
   *  bitmap before the flying copies come down next frame — otherwise they
   *  blink out for a frame in between. */
  const restoreMorphNodes = useCallback(() => {
    if (morphRestoreRef.current.length === 0) return;
    morphRestoreRef.current.forEach((restore) => restore());
    morphRestoreRef.current = [];
    try {
      stageRef.current?.getLayers().forEach((layer) => layer.draw());
    } catch {
      // Unmounting: the stage is already torn down and there is nothing left
      // to repaint.
    }
  }, []);

  /** Puts back the elements left hidden on purpose for the slide being shown:
   *  what a backward navigation parked in its final state, and what a finished
   *  build's exit steps took away. Flushed at the start of every navigation. */
  const restoreExitedNodes = useCallback(() => {
    if (exitedRestoreRef.current.length === 0) return;
    exitedRestoreRef.current.forEach((restore) => restore());
    exitedRestoreRef.current = [];
    try {
      stageRef.current?.getLayers().forEach((layer) => layer.draw());
    } catch {
      // Unmounting — see restoreMorphNodes.
    }
  }, []);

  const goTo = useCallback(
    (target: number) => {
      const list = slidesRef.current;
      const current = indexRef.current;
      if (target === current || target < 0 || target >= list.length) return;

      // Any flight still in the air ends here — its hidden elements go back to
      // full opacity before anything else reads the stage.
      const wasRunning = runRef.current !== null;
      restoreMorphNodes();
      restoreExitedNodes();
      // Full restore, exited elements included: the run is being abandoned,
      // and whichever slide ends up on screen must show every element.
      animationRunRef.current?.restoreForeground();
      animationRunRef.current?.restore();
      commitAnimationRun(null);
      runRef.current = null;

      const type = list[target]?.transition ?? "none";
      const targetUi = list[target]?.ui;
      const captured = type === "morph" && !wasRunning
        ? captureMorphFlights(list[current]?.ui, targetUi, nodeRefs.current)
        : NO_MORPH;
      // Backward navigation shows the slide's FINAL state (every build ran),
      // so no playback — only the exited elements get hidden.
      const backward = target < current;
      // Captured morph flights finish before the other elements enter.
      const excludeMorph = captured.flights.length
        ? new Set(captured.flights.map((flight) => flight.key))
        : undefined;
      const plan = targetUi ? buildAnimationPlan(targetUi, excludeMorph) : null;
      const hasAnimation = Boolean(plan && plan.animatedKeys.length > 0);
      pendingAnimationRef.current = hasAnimation && !backward ? plan : null;

      indexRef.current = target;
      // Navigating again mid-transition cuts straight to the target. The live
      // stage is either mid-rebuild or mid-flight at that point, so freezing it
      // as the next transition's backdrop would capture a half-drawn slide —
      // and someone spamming the arrow key wants the slides, not the animation.
      if (wasRunning || (type === "none" && !hasAnimation) || !list[current]?.ui) {
        setTransition(null);
        setIndex(target);
        return;
      }

      // Cut the flying elements out of the frame that is about to be frozen.
      // The bitmaps were already taken above (at full opacity), so what stays
      // behind is the slide minus everything in flight — otherwise each of
      // them appears twice: once stranded at its old spot in the backdrop, and
      // once travelling. Konva keeps whatever opacity is set imperatively, so
      // this is put back the moment the freeze is done.
      const opacities = captured.sources.map(
        (node) => [node, node.opacity()] as const,
      );
      // The backdrop has a second job besides being the thing a transition
      // animates: it covers the incoming slide while it rebuilds. A "none"
      // transition with animations needs that cover too — without it the new
      // slide appears complete, and then the elements about to animate in
      // visibly pop OUT as the capture hides them. So freeze the outgoing
      // frame whenever there is a prepare phase at all; with no transition to
      // play it is simply dropped (no fade) once the build starts.
      let backdrop: HTMLCanvasElement | null = null;
      if (type !== "none" || hasAnimation) {
        if (opacities.length > 0) {
          opacities.forEach(([node]) => node.opacity(0));
          stageRef.current?.getLayers().forEach((layer) => layer.draw());
        }
        backdrop = rasterizeStage(stageRef.current);
        opacities.forEach(([node, opacity]) => node.opacity(opacity));
      }

      runIdRef.current += 1;
      const run: TransitionRun = {
        id: runIdRef.current,
        type,
        backdrop,
        incoming: null,
        flights: captured.flights,
        stage: "preparing",
        finalHiddenKeys: backward && plan ? plan.hiddenAtEnd : [],
      };
      runRef.current = run;
      setTransition(run);
      setIndex(target);
    },
    [commitAnimationRun, restoreMorphNodes, restoreExitedNodes],
  );

  // Keep a canonical, reloadable link to the current slide. The editor's
  // generation query can contain source text, so it is omitted from the link.
  useEffect(() => {
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set("present", "1");
    url.hash = String(index + 1);
    window.history.replaceState(window.history.state, "", url);
  }, [index]);

  useEffect(() => {
    const onHashChange = () => {
      const match = /^#(\d+)$/.exec(window.location.hash);
      if (!match) return;
      const requested = Number(match[1]) - 1;
      if (visibleIndexes.includes(requested)) goTo(requested);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [goTo, visibleIndexes]);

  const closePresentation = useCallback(() => {
    window.history.replaceState(window.history.state, "", window.location.pathname);
    onClose();
  }, [onClose]);

  // Drives one transition end to end: wait out the incoming slide's rebuild
  // behind the frozen backdrop, read the final geometry off the settled stage,
  // let the flights paint once at their starting transform, play, then hand
  // the real elements back. Keyed on the run id so the stage updates it makes
  // along the way don't re-enter and cancel it.
  const runId = transition?.id ?? 0;
  useEffect(() => {
    const run = runRef.current;
    if (runId === 0 || !run || run.id !== runId) return;
    let cancelled = false;
    const alive = () => !cancelled && runRef.current?.id === runId;
    const settle = (next: (current: TransitionRun) => TransitionRun | null) =>
      setTransition((current) =>
        current && current.id === runId ? next(current) : current,
      );

    (async () => {
      // The surface is a dynamic import that reports its stage through a
      // callback ref, so the very first run (the slide the deck opens on) can
      // arrive here before there is anything to freeze. Navigations find the
      // stage already there and fall straight through.
      const stageDeadline = performance.now() + MAX_STAGE_WAIT_MS;
      while (!stageRef.current && performance.now() < stageDeadline && alive()) {
        await nextFrame();
      }
      if (!alive()) return;
      await waitForSceneSettled(stageRef.current, () => !alive());
      if (!alive()) return;

      const refs = nodeRefs.current;
      const flights = run.flights.map((flight) => {
        const node = refs?.get(flight.key);
        const rect = rectFromNode(node);
        let targetCanvas: HTMLCanvasElement | null = null;
        if (flight.kind === "crossfade" && node && rect) {
          try {
            targetCanvas = captureMorphCanvas(node, rect, rect.width, rect.height, layerPixelRatio(node.getLayer()));
            targetCanvas.style.objectFit = "cover";
          } catch {
            // A linked remote image can still render directly from its URL.
          }
        }
        // The incoming copy hides for the flight, otherwise it sits at the
        // destination in plain sight while a duplicate flies towards it.
        if (node) {
          const original = node.opacity();
          node.opacity(0);
          morphRestoreRef.current.push(() => node.opacity(original));
        }
        return rect ? { ...flight, to: rect, targetCanvas } : flight;
      });
      if (morphRestoreRef.current.length > 0) {
        stageRef.current?.getLayers().forEach((layer) => layer.draw());
      }
      // Backward navigation: park the exited elements at opacity 0 BEFORE the
      // freeze so the bitmap (and later the live stage) shows the slide with
      // every build already finished. No overlay, no playback.
      if (run.finalHiddenKeys.length > 0) {
        for (const key of run.finalHiddenKeys) {
          const node = refs?.get(key);
          if (!node) continue;
          const original = node.opacity();
          node.opacity(0);
          exitedRestoreRef.current.push(() => node.opacity(original));
        }
        stageRef.current?.getLayers().forEach((layer) => layer.draw());
      }
      // Cut the animated elements out too — order matters: morph sources
      // first, then animation flights, and only then the base freeze, so the
      // bitmap holds neither. The animation flights mount with `staged`, two
      // frames before anything moves.
      const pendingPlan = pendingAnimationRef.current;
      if (pendingPlan) {
        const captured = captureAnimationFlights(pendingPlan, refs);
        if (captured.flights.length > 0) {
          commitAnimationRun({
            id: runId,
            plan: pendingPlan,
            flights: captured.flights,
            activeGroup: -1,
            restore: captured.restore,
            foreground: [],
            restoreForeground: () => {},
            paintOrder: new Map(
              walkSlideElements(slidesRef.current[indexRef.current]?.ui)
                .map((ref, index) => [ref.key, index] as const),
            ),
          });
        } else {
          // Nothing survived capture (all nodes detached) — drop the run or
          // the overlay would wait forever on flights that don't exist.
          pendingAnimationRef.current = null;
          captured.restore();
        }
      }
      // Freeze the incoming slide too, and animate THAT instead of the live
      // surface. A Konva stage is five full-size canvases; moving them means
      // the compositor blends five stacked 1280x720 layers every frame, and a
      // late image or font arriving after the readiness gate would repaint one
      // of them mid-flight. One flat bitmap has neither problem.
      const incoming = rasterizeStage(stageRef.current);
      settle((current) => ({ ...current, flights, incoming, stage: "staged" }));

      // Two frames for the flights to paint at their "from" transform — a CSS
      // transition needs a rendered starting value to animate away from.
      await nextFrame();
      await nextFrame();
      if (!alive()) return;

      // Group 0 of the animation starts only after the transition has fully
      // finished — two sets of composited layers moving at once is exactly
      // the scenario that ran at 15fps before.
      const startAnimation = async () => {
        if (animationRunRef.current?.id !== runId) return;
        await nextFrame();
        await nextFrame();
        // Re-read after the wait: a navigation in between clears the run, and
        // committing a stale copy would resurrect it.
        const animRun = animationRunRef.current;
        if (!alive() || !animRun || animRun.id !== runId) return;
        commitAnimationRun({ ...animRun, activeGroup: 0 });
        profileFlight(
          `animation group 0 (${animRun.flights.length} flights)`,
          animRun.plan.groups[0]?.durationMs ?? 0,
        );
      };

      const handoffAnimation = () => {
        const animRun = animationRunRef.current;
        if (!animRun || animRun.id !== runId) return;
        // Restore morph targets, then cut static foreground elements into
        // ordered layers before any entrance flight moves.
        const canHandoff = flights.length === 0 || morphRestoreRef.current.length === flights.length;
        if (canHandoff) restoreMorphNodes();
        const foreground = captureStaticForegroundFlights(
          slidesRef.current[indexRef.current]?.ui,
          animRun.plan.animatedKeys,
          refs,
        );
        const settledIncoming = rasterizeStage(stageRef.current);
        if (settledIncoming) {
          commitAnimationRun({
            ...animRun,
            foreground: foreground.flights,
            restoreForeground: foreground.restore,
          });
        } else {
          foreground.restore();
        }
        settle((current) => ({
          ...current,
          incoming: settledIncoming ?? current.incoming,
          flights: canHandoff && settledIncoming ? [] : current.flights,
          stage: "animating",
        }));
      };

      if (run.type === "none") {
        if (animationRunRef.current) {
          // No transition to play — the staged bitmap simply replaces the
          // live view (identical pixels) and the animation takes over.
          handoffAnimation();
          startAnimation();
          return;
        }
        // Backward final state: nothing to play, hand straight back.
        restoreMorphNodes();
        await nextFrame();
        if (!alive()) return;
        runRef.current = null;
        settle(() => null);
        return;
      }

      const duration = run.type === "morph" ? MORPH_DURATION : SLIDE_DURATION;
      settle((current) => ({ ...current, stage: "playing" }));
      profileFlight(`${run.type} (${run.flights.length} flights)`, duration);

      await sleep(duration + 60);
      if (!alive()) return;
      if (animationRunRef.current) {
        handoffAnimation();
        startAnimation();
        return;
      }
      restoreMorphNodes();
      await nextFrame();
      if (!alive()) return;
      runRef.current = null;
      settle(() => null);
    })();

    return () => {
      cancelled = true;
    };
  }, [runId, commitAnimationRun, restoreMorphNodes]);

  // The slide the deck opens on never passes through goTo, so nothing would
  // ever build its plan and its animations (on-click builds included) would be
  // unreachable. Kick off a transition-less run for it once, on mount: the
  // driver above waits for the surface to hand over its stage, and a "none"
  // run with no animations is a no-op anyway.
  const startedInitialRef = useRef(false);
  useEffect(() => {
    if (startedInitialRef.current) return;
    startedInitialRef.current = true;
    const initialUi = slidesRef.current[indexRef.current]?.ui;
    if (!initialUi) return;
    const plan = buildAnimationPlan(initialUi);
    if (plan.animatedKeys.length === 0) return;
    pendingAnimationRef.current = plan;
    runIdRef.current += 1;
    const run: TransitionRun = {
      id: runIdRef.current,
      type: "none",
      backdrop: null,
      incoming: null,
      flights: [],
      stage: "preparing",
      finalHiddenKeys: [],
    };
    runRef.current = run;
    setTransition(run);
  }, []);

  /** Tears the animation run down once its last group has finished: put the
   *  morph targets back, keep exited elements hidden (they left for good),
   *  repaint synchronously, and only THEN drop the overlay a frame later —
   *  the reverse order blinks (same lesson as restoreMorphNodes). */
  const finishAnimationRun = useCallback(async () => {
    const animRun = animationRunRef.current;
    if (!animRun) return;
    // Ref first, state at the end: nulling the ref is what stops a second
    // group-done or a Next from re-entering, but the overlay has to stay
    // mounted until the restored nodes are painted underneath it.
    animationRunRef.current = null;
    restoreMorphNodes();
    animRun.restoreForeground();
    // The exited elements stay hidden for the rest of THIS slide, so their
    // restore has to outlive the run — the surface reuses Konva nodes across
    // slides, and an imperative opacity(0) left dangling here reappears as a
    // missing element on whatever slide inherits that node. goTo (and unmount)
    // flush this list before anything else touches the stage.
    if (animRun.plan.hiddenAtEnd.length > 0) {
      exitedRestoreRef.current.push(() => animRun.restore());
    }
    animRun.restore({ keepExitedHidden: true });
    await nextFrame();
    runRef.current = null;
    setTransition(null);
    setAnimationRun(null);
  }, [restoreMorphNodes]);

  /** Only the last group ends the run; earlier groups wait for Next (build
   *  steps advance the group, not the slide). */
  const onAnimationGroupDone = useCallback(
    (groupIndex: number) => {
      const animRun = animationRunRef.current;
      if (!animRun || animRun.activeGroup !== groupIndex) return;
      if (groupIndex + 1 < animRun.plan.groups.length) return;
      if (animRun.plan.hasLoop) {
        // A looping emphasis runs until the slide is left, and handing the
        // slide back to the live stage is exactly where it would stop dead —
        // the loop lives on the raster. So the overlay stays up; only the
        // transition bookkeeping is closed out, or the next navigation would
        // read this as still mid-flight and cut without its transition.
        // goTo restores everything on the way out.
        runRef.current = null;
        return;
      }
      finishAnimationRun();
    },
    [finishAnimationRun],
  );

  useEffect(
    () => () => {
      restoreMorphNodes();
      restoreExitedNodes();
      animationRunRef.current?.restoreForeground();
      animationRunRef.current?.restore();
    },
    [restoreMorphNodes, restoreExitedNodes],
  );

  const [scale, setScale] = useState(1);
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const [strokes, setStrokes] = useState<PresenterPoint[][]>([]);
  const [liveStroke, setLiveStroke] = useState<PresenterPoint[] | null>(null);

  const position = Math.max(0, visibleIndexes.indexOf(index));
  const total = visibleIndexes.length;

  const step = useCallback(
    (delta: number) => {
      if (delta > 0) {
        // Next advances the BUILD first: elements still waiting off-stage
        // come in before the slide changes. Reverse-stepping a build is
        // deliberately unsupported (reverse playback per step, little value);
        // Left always leaves the slide.
        const animRun = animationRunRef.current;
        if (animRun && animRun.activeGroup >= 0) {
          const nextGroup = animRun.activeGroup + 1;
          if (nextGroup < animRun.plan.groups.length) {
            const group = animRun.plan.groups[nextGroup];
            commitAnimationRun({ ...animRun, activeGroup: nextGroup });
            profileFlight(
              `animation group ${nextGroup} (${animRun.flights.length} flights)`,
              group.durationMs,
            );
            return;
          }
          // Last group done — fall through and leave the slide. If the last
          // group is STILL playing, the goTo below cancels the run and jumps:
          // someone pressing Next wants the slide, not the tail of a fade.
        }
      }
      const pos = visibleIndexes.indexOf(indexRef.current);
      const nextPos = Math.min(
        Math.max((pos === -1 ? 0 : pos) + delta, 0),
        visibleIndexes.length - 1,
      );
      const target = visibleIndexes[nextPos];
      if (target !== undefined) goTo(target);
    },
    [commitAnimationRun, goTo, visibleIndexes],
  );
  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  // Cross-window sync with a separate Presenter View window (#50): reply to
  // its "where are we" ping, follow slide-change requests it sends, and
  // render the laser pointer / freehand annotations it broadcasts (#41).
  // Re-broadcasting our own index below whenever it changes — even when
  // that change originated from a message we just received — is harmless:
  // the Presenter View window only reacts to a *different* index, so
  // echoing the same value back settles immediately with no feedback loop.
  const buildTotal = animationRun?.plan.groups.length ?? 0;
  const buildStep = animationRun ? Math.max(0, animationRun.activeGroup + 1) : 0;
  const postToPresenter = usePresenterChannel(deckId, (message) => {
    if (message.type === "ping") {
      postToPresenter({
        type: "state",
        index,
        total: visibleIndexes.length,
        buildStep,
        buildTotal,
      });
    } else if (message.type === "step") {
      step(message.delta);
    } else if (message.type === "slide-change") {
      if (visibleIndexes.includes(message.index)) goTo(message.index);
    } else if (message.type === "laser") {
      setLaser(message.visible ? { x: message.x, y: message.y } : null);
    } else if (message.type === "annotation-stroke") {
      if (message.done) {
        setLiveStroke(null);
        if (message.points.length > 1) {
          setStrokes((prev) => [...prev, message.points]);
        }
      } else {
        setLiveStroke(message.points);
      }
    } else if (message.type === "annotation-clear") {
      setStrokes([]);
      setLiveStroke(null);
    }
  });

  useEffect(() => {
    postToPresenter({ type: "slide-change", index });
  }, [index, postToPresenter]);

  // Build steps are NOT slide changes — piggybacking them on the index
  // broadcast above would never fire (the index doesn't move inside a
  // build), so the build counter gets its own state broadcast whenever the
  // run or the active group moves.
  useEffect(() => {
    postToPresenter({
      type: "state",
      index,
      total: visibleIndexes.length,
      buildStep,
      buildTotal,
    });
  }, [index, buildStep, buildTotal, postToPresenter]);

  // Annotations and the laser dot are tied to "this moment", not the slide
  // itself — clear them whenever the slide changes, from either window.
  useEffect(() => {
    setStrokes([]);
    setLiveStroke(null);
    setLaser(null);
  }, [index]);

  // Compute fit scale based on viewport
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setScale(Math.min(w / SLIDE_W, h / SLIDE_H));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (overviewOpen) setOverviewOpen(false);
        else closePresentation();
      } else if (e.key.toLowerCase() === "g") {
        setOverviewOpen((open) => !open);
      } else if (overviewOpen) {
        return;
      } else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown")
        next();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, closePresentation, overviewOpen]);

  const ui = slides[index]?.ui;
  const openPresenterView = () => {
    if (!deckId) return;
    window.open(
      `/editor-react/${deckId}/present`,
      `presenter-view-${deckId}`,
      "width=960,height=680",
    );
  };

  const playing = transition?.stage === "playing";
  const slideAnimation =
    playing && transition?.type === "slide-right"
      ? "slide-transition-slide-right"
      : playing && transition?.type === "slide-left"
        ? "slide-transition-slide-left"
        : "";
  // While preparing, the frozen slide sits on top of everything so the
  // incoming stage can rebuild unseen. Once playing, morph keeps it above the
  // new slide to crossfade over it; the others drop it underneath so the new
  // slide can move across it — and stay under once the animation overlay
  // takes over, or the dead backdrop would suddenly cover the slide again.
  const backdropZ =
    transition &&
    (transition.type === "morph" ||
      transition.stage === "preparing" ||
      transition.stage === "staged")
      ? 3
      : 0;
  // Once the incoming slide is frozen, the live surface steps out of the way
  // entirely and its bitmap does the moving. It stays mounted (Konva keeps
  // drawing into its canvases either way) — only hidden, so the compositor has
  // one flat layer to move instead of five live ones.
  const frozenIncoming = transition?.incoming ?? null;
  // The opening slide's run has no outgoing frame to hide behind (there is no
  // previous slide), so the live stage has to step aside on its own until the
  // freeze is ready — otherwise the deck opens showing every element and then
  // the animated ones blink out. A beat of the black backdrop is the right
  // thing to show there; every other run covers this phase with a backdrop.
  const hideLiveStage =
    Boolean(frozenIncoming) ||
    (transition?.stage === "preparing" && !transition.backdrop);

  return (
    <div
      ref={containerRef}
      // z-index this high (not just on the controls) is deliberate: any
      // floating toolbar TemplateV2KonvaSlide renders internally uses
      // createPortal(..., document.body) — it becomes a *sibling* of this
      // whole container at the body level, not a descendant, so no z-index
      // on a child button here could ever out-rank it. Only raising the
      // root's own z-index fixes that, since z-index only resolves against
      // other elements within the same stacking context.
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black"
    >
      {ui ? (
        <div
          style={{
            width: SLIDE_W * scale,
            height: SLIDE_H * scale,
          }}
          className="relative"
        >
          <div
            className="relative origin-top-left overflow-hidden"
            style={{
              width: SLIDE_W,
              height: SLIDE_H,
              transform: `scale(${scale})`,
            }}
          >
            <div
              className={`relative ${frozenIncoming ? "" : slideAnimation}`}
              style={{
                zIndex: 1,
                visibility: hideLiveStage ? "hidden" : "visible",
              }}
            >
              {/* One live Konva surface for the whole presentation. Slide
                  changes swap its layout instead of mounting a second one —
                  building a fresh stage costs hundreds of milliseconds of main
                  thread, which used to land right inside the animation. */}
              <TemplateV2KonvaSlide
                layout={ui as never}
                isEditMode={false}
                renderScale={scale}
                slideIndex={index}
                fonts={fonts}
                stageRef={(stage: Konva.Stage | null) => {
                  stageRef.current = stage;
                }}
                externalNodeRefs={nodeRefs}
              />
              {/* Real media players overlaid on the Konva static stand-in.
                  Coordinates are in slide space (1280x720); the parent div's
                  CSS transform scales them down with the slide. */}
              {collectMediaOverlays(ui).map((item) =>
                item.media_type === "video" ? (
                  <video
                    key={item.key}
                    src={item.src}
                    poster={item.poster ?? undefined}
                    controls
                    style={{
                      position: "absolute",
                      left: item.x,
                      top: item.y,
                      width: item.width,
                      height: item.height,
                      borderRadius: Math.min(item.width, item.height) * 0.06,
                      background: "#000",
                    }}
                  />
                ) : (
                  <div
                    key={item.key}
                    style={{
                      position: "absolute",
                      left: item.x,
                      top: item.y,
                      width: item.width,
                      height: item.height,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <audio src={item.src} controls style={{ width: "100%" }} />
                  </div>
                ),
              )}
            </div>

            {/* The arriving slide, frozen the moment its scene settled. This
                is the thing that actually slides/fades in — and the element
                flights ride along INSIDE it, because they were cut out of that
                bitmap and are part of the same slide. Animating the bitmap on
                its own left an exit- or emphasis-only element (nothing hides
                those before their group starts) pinned in place while the rest
                of its slide travelled in behind it.

                The wrapper's z-index also puts the flights where they belong
                during a morph: under the outgoing backdrop (z3) while it is
                still crossfading, rather than on top of the slide being left.
                It makes a stacking context, so the flights' own z-index only
                has to out-rank the bitmap beneath them. */}
            {frozenIncoming ? (
              <div
                className={`pointer-events-none absolute inset-0 ${slideAnimation}`}
                style={{ zIndex: 1 }}
              >
                <CanvasHost
                  canvas={frozenIncoming}
                  className="pointer-events-none absolute inset-0"
                />
                {/* Element animation flights: cut from the settled incoming
                    stage before it was frozen, so the bitmap underneath never
                    contained them. Group 0 starts only after the transition
                    finished. */}
                {animationRun ? (
                  <AnimationOverlay
                    flights={animationRun.flights}
                    plan={animationRun.plan}
                    activeGroup={animationRun.activeGroup}
                    onGroupDone={onAnimationGroupDone}
                    paintOrder={animationRun.paintOrder}
                  />
                ) : null}
                {animationRun?.foreground.map((flight) => (
                  <CanvasHost
                    key={flight.key}
                    canvas={flight.canvas}
                    className="static-foreground-flight pointer-events-none absolute"
                    style={{
                      zIndex: 1 + flight.paintIndex,
                      left: flight.box.x,
                      top: flight.box.y,
                      width: flight.box.width,
                      height: flight.box.height,
                    }}
                  />
                ))}
              </div>
            ) : null}

            {/* The slide being left, frozen to a bitmap. Nothing repaints it,
                so animating it is compositor-only work. The morph fade keeps
                its class through "animating" — fill-mode forwards holds it at
                opacity 0 once the crossfade ends, and dropping the class
                early would snap it back over the animation overlay. */}
            {transition?.backdrop ? (
              <CanvasHost
                canvas={transition.backdrop}
                className={
                  transition.type === "morph" &&
                  (transition.stage === "playing" ||
                    transition.stage === "animating")
                    ? "slide-transition-morph-fade pointer-events-none absolute inset-0"
                    : "pointer-events-none absolute inset-0"
                }
                style={{ zIndex: backdropZ }}
              />
            ) : null}

            {/* Morph flights: the outgoing slide's matched elements travelling
                to their new geometry (FLIP — laid out at the destination box,
                animated in from the inverse transform). While the animation
                overlay runs they rest at the final geometry, standing in for
                their still-hidden live nodes. */}
            {transition?.flights.map((flight) => {
              const { from, to } = flight;
              const atStart =
                transition.stage === "preparing" || transition.stage === "staged";
              if (flight.kind === "shape" && flight.shape) {
                return <MorphShapeFlight key={flight.key} plan={flight.shape} from={from} to={to} atStart={atStart} />;
              }
              if (flight.kind === "crossfade" && flight.canvas) {
                const move = `left ${MORPH_DURATION}ms cubic-bezier(0.77, 0, 0.175, 1), top ${MORPH_DURATION}ms cubic-bezier(0.77, 0, 0.175, 1), width ${MORPH_DURATION}ms cubic-bezier(0.77, 0, 0.175, 1), height ${MORPH_DURATION}ms cubic-bezier(0.77, 0, 0.175, 1)`;
                // Reveal the photo evenly throughout the move. The position
                // can ease, but easing opacity the same way hides most of the
                // photo until the final frames and looks like a sudden pop.
                const fade = `opacity ${MORPH_DURATION}ms linear`;
                const clip = flight.shape
                  ? contourPolygonAt(flight.shape.from, flight.shape.to, atStart ? 0 : 1)
                  : undefined;
                const clipTransition = flight.shape ? `, clip-path ${MORPH_DURATION}ms cubic-bezier(0.77, 0, 0.175, 1)` : "";
                const sourceClip = Boolean(flight.shape && flight.imageSource);
                const targetClip = Boolean(flight.shape && !flight.imageSource);
                return (
                  <div key={flight.key}>
                    <div
                      className="morph-flight morph-content-flight pointer-events-none absolute overflow-hidden"
                      style={{
                        zIndex: 4,
                        left: atStart ? from.x : to.x,
                        top: atStart ? from.y : to.y,
                        width: atStart ? from.width : to.width,
                        height: atStart ? from.height : to.height,
                        borderRadius: flight.shape ? 0 : flight.borderRadius,
                        willChange: "left, top, width, height",
                        transition: move,
                      }}
                    >
                      <CanvasHost canvas={flight.canvas} className="morph-source-content absolute inset-0" style={{ opacity: atStart ? 1 : 0, transition: fade + (sourceClip ? clipTransition : ""), ...(sourceClip ? { clipPath: clip } : {}) }} />
                      {flight.targetCanvas ? (
                        <CanvasHost canvas={flight.targetCanvas} className="morph-target-content absolute inset-0" style={{ opacity: atStart ? 0 : 1, transition: fade + (targetClip ? clipTransition : ""), ...(targetClip ? { clipPath: clip } : {}) }} />
                      ) : flight.targetImage ? (
                        <img src={flight.targetImage} alt="" className="morph-target-content absolute inset-0 h-full w-full object-cover" style={{ opacity: atStart ? 0 : 1, transition: fade + (targetClip ? clipTransition : ""), ...(targetClip ? { clipPath: clip } : {}) }} />
                      ) : null}
                    </div>
                    {flight.shape ? <MorphShapeFlight plan={flight.shape} from={from} to={to} atStart={atStart} outlineOnly /> : null}
                  </div>
                );
              }
              if (flight.cropImage) {
                return (
                  <CanvasHost
                    key={flight.key}
                    canvas={flight.canvas!}
                    className="morph-flight morph-image-flight pointer-events-none absolute overflow-hidden"
                    style={{
                      zIndex: 4,
                      left: atStart ? from.x : to.x,
                      top: atStart ? from.y : to.y,
                      width: atStart ? from.width : to.width,
                      height: atStart ? from.height : to.height,
                      borderRadius: flight.borderRadius,
                      willChange: "left, top, width, height",
                      transition: `left ${MORPH_DURATION}ms cubic-bezier(0.77, 0, 0.175, 1), top ${MORPH_DURATION}ms cubic-bezier(0.77, 0, 0.175, 1), width ${MORPH_DURATION}ms cubic-bezier(0.77, 0, 0.175, 1), height ${MORPH_DURATION}ms cubic-bezier(0.77, 0, 0.175, 1)`,
                    }}
                  />
                );
              }
              const dx = from.x + from.width / 2 - (to.x + to.width / 2);
              const dy = from.y + from.height / 2 - (to.y + to.height / 2);
              const sx = from.width / Math.max(1, to.width);
              const sy = from.height / Math.max(1, to.height);
              return (
                <CanvasHost
                  key={flight.key}
                  canvas={flight.canvas!}
                  className="morph-flight pointer-events-none absolute"
                  style={{
                    zIndex: 4,
                    left: to.x,
                    top: to.y,
                    width: to.width,
                    height: to.height,
                    transformOrigin: "center",
                    willChange: "transform",
                    transform: atStart
                      ? `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`
                      : "translate3d(0, 0, 0) scale(1, 1)",
                    transition: `transform ${MORPH_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                  }}
                />
              );
            })}

            {/* fade-white / fade-black: opaque cover over the new slide that
                fades out to reveal it. */}
            {playing &&
            (transition?.type === "fade-white" ||
              transition?.type === "fade-black") ? (
              <div
                className="slide-transition-fade-cover pointer-events-none absolute inset-0"
                style={{
                  zIndex: 5,
                  background: transition.type === "fade-white" ? "#fff" : "#000",
                }}
              />
            ) : null}
          </div>

          {/* Live tools overlay (#41): laser pointer + freehand annotations
              broadcast from the Presenter View window. Pure CSS/SVG on top
              of the Konva stage — never intercepts pointer events here. */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={SLIDE_W * scale}
            height={SLIDE_H * scale}
            viewBox={`0 0 ${SLIDE_W} ${SLIDE_H}`}
          >
            {[...strokes, ...(liveStroke ? [liveStroke] : [])].map(
              (stroke, strokeIndex) =>
                stroke.length > 1 ? (
                  <polyline
                    key={strokeIndex}
                    points={stroke
                      .map((p) => `${p.x * SLIDE_W},${p.y * SLIDE_H}`)
                      .join(" ")}
                    fill="none"
                    stroke="#FF5A36"
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null,
            )}
            {laser ? (
              <circle
                cx={laser.x * SLIDE_W}
                cy={laser.y * SLIDE_H}
                r={10}
                fill="rgba(255,30,30,0.85)"
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={2}
              />
            ) : null}
          </svg>
        </div>
      ) : (
        <p className="text-zinc-500">Empty slide</p>
      )}

      {/* Controls. Solid-ish dark background (not translucent white) is
          deliberate: these float over whatever the current slide looks
          like, and a light/white slide showing through a bg-white/10 tint
          made a button effectively invisible — white-on-white. A dark chip
          keeps the white icon readable regardless of what's under it.
          backdrop-blur is dropped while a transition is playing: blurring
          over content that changes every frame forces an expensive
          re-composite per frame. */}
      <div className="absolute right-4 top-4 z-[10010] flex items-center gap-2">
        <button
          className={`rounded-full border border-white/10 bg-black/70 p-2 text-white shadow-lg transition-colors hover:bg-black/85${transition ? "" : " backdrop-blur"}`}
          onClick={() => setOverviewOpen(true)}
          aria-label="Slide overview"
          title="Slide overview (G)"
        >
          <LayoutGrid size={18} />
        </button>
        {deckId ? (
          <button
            className={`rounded-full border border-white/10 bg-black/70 p-2 text-white shadow-lg transition-colors hover:bg-black/85${transition ? "" : " backdrop-blur"}`}
            onClick={openPresenterView}
            title="Open Presenter View"
          >
            <MonitorPlay size={18} />
          </button>
        ) : null}
        <button
          className={`rounded-full border border-white/10 bg-black/70 p-2 text-white shadow-lg transition-colors hover:bg-black/85${transition ? "" : " backdrop-blur"}`}
          onClick={closePresentation}
          title="Exit (Esc)"
        >
          <X size={18} />
        </button>
      </div>
      <div className={`absolute bottom-5 left-1/2 z-[10010] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-white shadow-lg${transition ? "" : " backdrop-blur"}`}>
        <button
          className="rounded-full p-1 transition-colors hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent"
          onClick={prev}
          disabled={position === 0}
          title="Previous (←)"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="min-w-[56px] text-center text-sm tabular-nums text-white/90">
          {position + 1} / {total}
        </span>
        <button
          className="rounded-full p-1 transition-colors hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent"
          onClick={next}
          disabled={position === total - 1}
          title="Next (→)"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Progress bar. Animated with scaleX rather than width: the width
          version relayouts and repaints on the main thread every frame, and
          its 300ms run overlaps the slide transition it sits under. */}
      <div className="absolute inset-x-0 bottom-0 z-[10010] h-0.5 bg-white/10">
        <div
          className="h-full origin-left bg-[var(--accent)] transition-transform duration-300"
          style={{ transform: `scaleX(${(position + 1) / Math.max(1, total)})` }}
        />
      </div>
      {overviewOpen && (
        <PresentOverview
          slides={slides}
          visibleIndexes={visibleIndexes}
          activeIndex={index}
          fonts={fonts}
          onSelect={(target) => {
            setOverviewOpen(false);
            goTo(target);
          }}
          onClose={() => setOverviewOpen(false)}
        />
      )}
    </div>
  );
}
