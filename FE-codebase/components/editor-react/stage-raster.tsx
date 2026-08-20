"use client";

// Shared stage-freezing pipeline for everything that animates over a Konva
// slide: Present Mode's transitions and the per-element animation player.
// Extracted verbatim from present-mode.tsx so the two share ONE copy of the
// ordering rules (hide → settle → raster → animate → restore) — those rules
// were paid for dearly (see the 15fps history) and must not fork.
//
// ── Why a flight is *prepared* before it is *played* ────────────────────────
// A slide change rebuilds the whole Konva scene: the surface swaps its ui
// draft in a post-commit effect, every element node remounts, images resolve,
// then the font loader bumps its revision and forces one more full redraw.
// Each of those repaints the layer canvases, which is exactly the texture a
// CSS transform/opacity animation is compositing — so an animation started at
// slide-change time spends its first frames fighting the rebuild and reads as
// ~15fps.
//
// So navigation freezes the outgoing slide into a bitmap, lets the incoming
// stage rebuild *behind* that frozen frame, and only starts animating once the
// scene has gone quiet. From then on nothing touches a canvas and the motion
// is pure compositor work.

import { useCallback, type CSSProperties } from "react";
import type Konva from "konva";
import { pendingKonvaImageLoads } from "@/components/slide-editor/surface/exportAssets";

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

const MAX_PREPARE_MS = 600;
const IMAGE_WAIT_MS = 350;
const FONT_WAIT_MS = 450;
/** No layer redraw for this long ⇒ the incoming scene has settled. */
const SCENE_QUIET_MS = 40;

export interface FlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const nextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function withDeadline(promise: Promise<unknown>, deadline: number) {
  return Promise.race([
    promise.then(() => undefined),
    new Promise<void>((resolve) =>
      window.setTimeout(resolve, Math.max(0, deadline - performance.now())),
    ),
  ]);
}

/** The resolution the live stage is actually drawn at, so a frozen copy of it
 *  is neither softer nor needlessly heavier than the canvas it replaces. */
export function layerPixelRatio(layer: Konva.Layer | null | undefined) {
  const ratio = layer?.getCanvas().getPixelRatio();
  if (ratio && ratio > 0) return ratio;
  if (typeof window === "undefined") return 1;
  return Math.max(1, window.devicePixelRatio || 1);
}

export function fillHost(canvas: HTMLCanvasElement) {
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  return canvas;
}

/** Flattens the stage into one bitmap by blitting the layer canvases that are
 *  already on screen — no scene re-render, unlike stage.toCanvas(), which
 *  redraws every layer from scratch. */
export function rasterizeStage(stage: Konva.Stage | null): HTMLCanvasElement | null {
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

export async function waitForSceneSettled(
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

/** Opt-in frame profiler for any flight (slide transition or element
 *  animation group). Turn it on in the console with
 *  `localStorage.setItem("ppt:profile-transitions", "1")`, reload, then
 *  navigate — every flight logs its real frame timings. Measuring this from
 *  an automation browser is worthless (a backgrounded tab throttles rAF), so
 *  the only honest numbers come from the machine actually complaining. */
export function profileFlight(label: string, durationMs: number) {
  if (typeof window === "undefined") return;
  if (window.localStorage?.getItem("ppt:profile-transitions") !== "1") return;
  const times: number[] = [];
  const start = performance.now();
  const tick = (now: number) => {
    times.push(now);
    if (now - start < durationMs) window.requestAnimationFrame(tick);
    else {
      const deltas = times.slice(1).map((t, i) => t - times[i]);
      if (deltas.length === 0) return;
      const sorted = [...deltas].sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      console.info(
        `[transition] ${label}: ${deltas.length} frames, ~${(1000 / median).toFixed(0)}fps ` +
          `(median ${median.toFixed(1)}ms, worst ${sorted[sorted.length - 1].toFixed(1)}ms, ` +
          `${deltas.filter((d) => d > 20).length} over 20ms)`,
      );
    }
  };
  window.requestAnimationFrame(tick);
}

export function rectFromNode(node: Konva.Node | undefined): FlightRect | null {
  if (!node) return null;
  const box = node.getClientRect();
  const width = Math.ceil(box.width);
  const height = Math.ceil(box.height);
  if (!(width > 0) || !(height > 0)) return null;
  // Matches how Konva frames node.toCanvas(), so the bitmap lands pixel-exact.
  return { x: Math.floor(box.x), y: Math.floor(box.y), width, height };
}

/** Hosts a detached canvas element inside the React tree. */
export function CanvasHost({
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
