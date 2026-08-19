"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import dynamic from "next/dynamic";
import type Konva from "konva";
import { ChevronLeft, ChevronRight, MonitorPlay, X } from "lucide-react";
import {
  usePresenterChannel,
  type PresenterPoint,
} from "@/components/editor-react/presenter-sync";
import { collectMediaOverlays } from "@/components/editor-react/present-media-overlay";
import { matchMorphPairs, morphGeometry } from "@/components/editor-react/morph";
import { pendingKonvaImageLoads } from "@/components/slide-editor/surface/exportAssets";
import type { SlideTransition } from "@/store/presentationGeneration";

const TemplateV2KonvaSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide
    ),
  { ssr: false }
);

const SLIDE_W = 1280;
const SLIDE_H = 720;
const MORPH_DURATION = 600;
const SLIDE_DURATION = 450;

// ── Why a transition is *prepared* before it is *played* ────────────────────
// A slide change rebuilds the whole Konva scene: the surface swaps its ui
// draft in a post-commit effect, every element node remounts, images resolve,
// then the font loader bumps its revision and forces one more full redraw.
// Each of those repaints the layer canvases, which is exactly the texture a
// CSS transform/opacity animation is compositing — so an animation started at
// slide-change time spends its first frames fighting the rebuild and reads as
// ~15fps.
//
// So navigation now freezes the outgoing slide into a bitmap, lets the
// incoming stage rebuild *behind* that frozen frame, and only starts animating
// once the scene has gone quiet. From then on nothing touches a canvas and the
// motion is pure compositor work.
//
// The same reasoning retired the second Konva surface this used to mount for
// the outgoing slide: building a stage costs hundreds of milliseconds of main
// thread, and it landed squarely inside the animation window.
const MAX_PREPARE_MS = 600;
const IMAGE_WAIT_MS = 350;
const FONT_WAIT_MS = 450;
/** No layer redraw for this long ⇒ the incoming scene has settled. */
const SCENE_QUIET_MS = 40;
/** Each flight is a composited layer of its own; cap what one morph can spawn. */
const MAX_MORPH_FLIGHTS = 24;

interface FlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MorphFlight {
  /** nodeRefs key of this element on the INCOMING slide. */
  key: string;
  canvas: HTMLCanvasElement;
  from: FlightRect;
  to: FlightRect;
}

type TransitionStage = "preparing" | "staged" | "playing";

interface TransitionRun {
  id: number;
  type: Exclude<SlideTransition, "none">;
  /** Frozen bitmap of the slide we are leaving. */
  backdrop: HTMLCanvasElement | null;
  flights: MorphFlight[];
  stage: TransitionStage;
}

const nextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function withDeadline(promise: Promise<unknown>, deadline: number) {
  return Promise.race([
    promise.then(() => undefined),
    new Promise<void>((resolve) =>
      window.setTimeout(resolve, Math.max(0, deadline - performance.now())),
    ),
  ]);
}

/** The resolution the live stage is actually drawn at, so a frozen copy of it
 *  is neither softer nor needlessly heavier than the canvas it replaces. */
function layerPixelRatio(layer: Konva.Layer | null | undefined) {
  const ratio = layer?.getCanvas().getPixelRatio();
  if (ratio && ratio > 0) return ratio;
  if (typeof window === "undefined") return 1;
  return Math.max(1, window.devicePixelRatio || 1);
}

function fillHost(canvas: HTMLCanvasElement) {
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  return canvas;
}

/** Flattens the stage into one bitmap by blitting the layer canvases that are
 *  already on screen — no scene re-render, unlike stage.toCanvas(), which
 *  redraws every layer from scratch. */
function rasterizeStage(stage: Konva.Stage | null): HTMLCanvasElement | null {
  if (!stage || typeof document === "undefined") return null;
  const ratio = layerPixelRatio(stage.getLayers()[0]);
  const out = document.createElement("canvas");
  out.width = Math.round(SLIDE_W * ratio);
  out.height = Math.round(SLIDE_H * ratio);
  const context = out.getContext("2d");
  if (!context) return null;
  // The surface's own root div supplies the white base under the layers (a
  // slide without a background paints nothing into the canvas), so the freeze
  // has to start from white or it comes out see-through onto the black stage.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, out.width, out.height);
  let painted = false;
  for (const layer of stage.getLayers()) {
    if (!layer.isVisible()) continue;
    const source = layer.getNativeCanvasElement();
    if (!source || !source.width || !source.height) continue;
    context.drawImage(source, 0, 0, out.width, out.height);
    painted = true;
  }
  return painted ? fillHost(out) : null;
}

/** Records when each layer was last asked to redraw, so the preparing step can
 *  wait for "the scene stopped changing" instead of guessing a delay. The
 *  overrides are own properties shadowing the prototype methods; deleting them
 *  restores Konva's originals. */
function watchLayerDraws(stage: Konva.Stage | null) {
  const state = { lastDrawAt: performance.now(), stop: () => {} };
  if (!stage) return state;
  const restores: (() => void)[] = [];
  for (const layer of stage.getLayers()) {
    const target = layer as unknown as Record<string, unknown>;
    for (const method of ["draw", "batchDraw"] as const) {
      const original = layer[method].bind(layer);
      target[method] = (...args: unknown[]) => {
        state.lastDrawAt = performance.now();
        return (original as (...rest: unknown[]) => unknown)(...args);
      };
      restores.push(() => {
        delete target[method];
      });
    }
  }
  state.stop = () => restores.forEach((restore) => restore());
  return state;
}

async function waitForSceneSettled(
  stage: Konva.Stage | null,
  isCancelled: () => boolean,
) {
  const start = performance.now();
  const spy = watchLayerDraws(stage);
  try {
    // Two frames: React commits the layout→uiDraft swap in a passive effect,
    // and the element nodes request their images from that same pass.
    await nextFrame();
    await nextFrame();
    if (isCancelled()) return;
    await withDeadline(
      Promise.all(pendingKonvaImageLoads()),
      start + IMAGE_WAIT_MS,
    );
    if (isCancelled()) return;
    if (typeof document !== "undefined" && document.fonts) {
      await withDeadline(document.fonts.ready, start + FONT_WAIT_MS);
      if (isCancelled()) return;
    }
    while (!isCancelled() && performance.now() - start < MAX_PREPARE_MS) {
      if (performance.now() - spy.lastDrawAt > SCENE_QUIET_MS) break;
      await nextFrame();
    }
    await nextFrame();
  } finally {
    spy.stop();
  }
}

function rectFromNode(node: Konva.Node | undefined): FlightRect | null {
  if (!node) return null;
  const box = node.getClientRect();
  const width = Math.ceil(box.width);
  const height = Math.ceil(box.height);
  if (!(width > 0) || !(height > 0)) return null;
  // Matches how Konva frames node.toCanvas(), so the bitmap lands pixel-exact.
  return { x: Math.floor(box.x), y: Math.floor(box.y), width, height };
}

interface MorphCapture {
  flights: MorphFlight[];
  /** The outgoing nodes the flights were cut from. They have to be hidden
   *  before the backdrop is frozen, or each one shows twice: stuck at its old
   *  position inside the backdrop, and again in flight. */
  sources: Konva.Node[];
}

const NO_MORPH: MorphCapture = { flights: [], sources: [] };

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
    return still ? [] : [{ pair, from, to }];
  });

  moved.sort(
    (a, b) =>
      b.from.box.width * b.from.box.height - a.from.box.width * a.from.box.height,
  );

  const flights: MorphFlight[] = [];
  const sources: Konva.Node[] = [];
  for (const entry of moved.slice(0, MAX_MORPH_FLIGHTS)) {
    const node = refs.get(entry.pair.keyA);
    const rect = rectFromNode(node);
    if (!node || !rect) continue;
    // Capture at the resolution the element ends up at, so an element that
    // grows during the flight doesn't arrive soft.
    const growth = Math.max(
      1,
      entry.to.box.width / Math.max(1, entry.from.box.width),
      entry.to.box.height / Math.max(1, entry.from.box.height),
    );
    let canvas: HTMLCanvasElement;
    try {
      canvas = node.toCanvas({
        pixelRatio: Math.min(3, layerPixelRatio(node.getLayer()) * growth),
      });
    } catch {
      // toCanvas only draws (never reads pixels), so a tainted canvas is fine
      // here — but a detached node would throw, and that one just sits it out.
      continue;
    }
    flights.push({
      key: entry.pair.keyB,
      canvas: fillHost(canvas),
      from: rect,
      to: {
        x: entry.to.box.x,
        y: entry.to.box.y,
        width: entry.to.box.width,
        height: entry.to.box.height,
      },
    });
    sources.push(node);
  }
  return { flights, sources };
}

/** Hosts a detached canvas element inside the React tree. */
function CanvasHost({
  canvas,
  className,
  style,
}: {
  canvas: HTMLCanvasElement;
  className?: string;
  style?: CSSProperties;
}) {
  const attach = useCallback(
    (host: HTMLDivElement | null) => {
      host?.replaceChildren(canvas);
    },
    [canvas],
  );
  return <div ref={attach} className={className} style={style} />;
}

export default function PresentMode({
  slides,
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
  // Hidden slides (#24) are skipped during presentation but stay in the
  // deck — Next/Prev walk this visible-only index list instead of ±1.
  const visibleIndexes = useMemo(() => {
    const indexes = slides
      .map((_, i) => i)
      .filter((i) => !slides[i]?.isHidden);
    return indexes.length > 0 ? indexes : slides.map((_, i) => i);
  }, [slides]);

  const resolveStart = () => {
    if (visibleIndexes.includes(startIndex)) return startIndex;
    return visibleIndexes.find((i) => i >= startIndex) ?? visibleIndexes[0] ?? startIndex;
  };
  const [index, setIndex] = useState(resolveStart);
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

  const goTo = useCallback(
    (target: number) => {
      const list = slidesRef.current;
      const current = indexRef.current;
      if (target === current || target < 0 || target >= list.length) return;

      // Any flight still in the air ends here — its hidden elements go back to
      // full opacity before anything else reads the stage.
      const wasRunning = runRef.current !== null;
      restoreMorphNodes();
      runRef.current = null;

      const type = list[target]?.transition;
      indexRef.current = target;
      // Navigating again mid-transition cuts straight to the target. The live
      // stage is either mid-rebuild or mid-flight at that point, so freezing it
      // as the next transition's backdrop would capture a half-drawn slide —
      // and someone spamming the arrow key wants the slides, not the animation.
      if (wasRunning || !type || type === "none" || !list[current]?.ui) {
        setTransition(null);
        setIndex(target);
        return;
      }

      const captured =
        type === "morph"
          ? captureMorphFlights(
              list[current]?.ui,
              list[target]?.ui,
              nodeRefs.current,
            )
          : NO_MORPH;
      // Cut the flying elements out of the frame that is about to be frozen.
      // The bitmaps were already taken above (at full opacity), so what stays
      // behind is the slide minus everything in flight — otherwise each of
      // them appears twice: once stranded at its old spot in the backdrop, and
      // once travelling. Konva keeps whatever opacity is set imperatively, so
      // this is put back the moment the freeze is done.
      const opacities = captured.sources.map(
        (node) => [node, node.opacity()] as const,
      );
      if (opacities.length > 0) {
        opacities.forEach(([node]) => node.opacity(0));
        stageRef.current?.getLayers().forEach((layer) => layer.draw());
      }
      const backdrop = rasterizeStage(stageRef.current);
      opacities.forEach(([node, opacity]) => node.opacity(opacity));

      runIdRef.current += 1;
      const run: TransitionRun = {
        id: runIdRef.current,
        type,
        backdrop,
        flights: captured.flights,
        stage: "preparing",
      };
      runRef.current = run;
      setTransition(run);
      setIndex(target);
    },
    [restoreMorphNodes],
  );

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
      await waitForSceneSettled(stageRef.current, () => !alive());
      if (!alive()) return;

      const refs = nodeRefs.current;
      const flights = run.flights.map((flight) => {
        const node = refs?.get(flight.key);
        const rect = rectFromNode(node);
        // The incoming copy hides for the flight, otherwise it sits at the
        // destination in plain sight while a duplicate flies towards it.
        if (node) {
          const original = node.opacity();
          node.opacity(0);
          morphRestoreRef.current.push(() => node.opacity(original));
        }
        return rect ? { ...flight, to: rect } : flight;
      });
      if (morphRestoreRef.current.length > 0) {
        stageRef.current?.getLayers().forEach((layer) => layer.draw());
      }
      settle((current) => ({ ...current, flights, stage: "staged" }));

      // Two frames for the flights to paint at their "from" transform — a CSS
      // transition needs a rendered starting value to animate away from.
      await nextFrame();
      await nextFrame();
      if (!alive()) return;
      settle((current) => ({ ...current, stage: "playing" }));

      await sleep((run.type === "morph" ? MORPH_DURATION : SLIDE_DURATION) + 60);
      if (!alive()) return;
      restoreMorphNodes();
      await nextFrame();
      if (!alive()) return;
      runRef.current = null;
      settle(() => null);
    })();

    return () => {
      cancelled = true;
    };
  }, [runId, restoreMorphNodes]);

  useEffect(() => () => restoreMorphNodes(), [restoreMorphNodes]);

  const [scale, setScale] = useState(1);
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const [strokes, setStrokes] = useState<PresenterPoint[][]>([]);
  const [liveStroke, setLiveStroke] = useState<PresenterPoint[] | null>(null);

  const position = Math.max(0, visibleIndexes.indexOf(index));
  const total = visibleIndexes.length;

  const step = useCallback(
    (delta: number) => {
      const pos = visibleIndexes.indexOf(indexRef.current);
      const nextPos = Math.min(
        Math.max((pos === -1 ? 0 : pos) + delta, 0),
        visibleIndexes.length - 1,
      );
      const target = visibleIndexes[nextPos];
      if (target !== undefined) goTo(target);
    },
    [goTo, visibleIndexes],
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
  const postToPresenter = usePresenterChannel(deckId, (message) => {
    if (message.type === "ping") {
      postToPresenter({ type: "state", index, total: visibleIndexes.length });
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
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown")
        next();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

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
  // slide can move across it.
  const backdropZ = playing && transition?.type !== "morph" ? 0 : 3;

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
              className={`relative ${slideAnimation}`}
              style={{ zIndex: 1 }}
            >
              {/* One live Konva surface for the whole presentation. Slide
                  changes swap its layout instead of mounting a second one —
                  building a fresh stage costs hundreds of milliseconds of main
                  thread, which used to land right inside the animation. */}
              <TemplateV2KonvaSlide
                layout={ui as never}
                isEditMode={false}
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

            {/* The slide being left, frozen to a bitmap. Nothing repaints it,
                so animating it is compositor-only work. */}
            {transition?.backdrop ? (
              <CanvasHost
                canvas={transition.backdrop}
                className={
                  playing && transition.type === "morph"
                    ? "slide-transition-morph-fade pointer-events-none absolute inset-0"
                    : "pointer-events-none absolute inset-0"
                }
                style={{ zIndex: backdropZ }}
              />
            ) : null}

            {/* Morph flights: the outgoing slide's matched elements travelling
                to their new geometry (FLIP — laid out at the destination box,
                animated in from the inverse transform). */}
            {transition?.flights.map((flight) => {
              const { from, to } = flight;
              const dx = from.x + from.width / 2 - (to.x + to.width / 2);
              const dy = from.y + from.height / 2 - (to.y + to.height / 2);
              const sx = from.width / Math.max(1, to.width);
              const sy = from.height / Math.max(1, to.height);
              return (
                <CanvasHost
                  key={flight.key}
                  canvas={flight.canvas}
                  className="pointer-events-none absolute"
                  style={{
                    zIndex: 4,
                    left: to.x,
                    top: to.y,
                    width: to.width,
                    height: to.height,
                    transformOrigin: "center",
                    willChange: "transform",
                    transform: playing
                      ? "translate3d(0, 0, 0) scale(1, 1)"
                      : `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`,
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
          onClick={onClose}
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

      {/* Progress bar */}
      <div className="absolute inset-x-0 bottom-0 z-[10010] h-0.5 bg-white/10">
        <div
          className="h-full bg-[var(--accent)] transition-[width] duration-300"
          style={{ width: `${((position + 1) / Math.max(1, total)) * 100}%` }}
        />
      </div>
    </div>
  );
}
