"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type Konva from "konva";
import { ChevronLeft, ChevronRight, MonitorPlay, X } from "lucide-react";
import {
  usePresenterChannel,
  type PresenterPoint,
} from "@/components/editor-react/presenter-sync";
import { collectMediaOverlays } from "@/components/editor-react/present-media-overlay";
import {
  matchMorphPairs,
  morphGeometry,
  type MorphGeometry,
} from "@/components/editor-react/morph";
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

interface MorphOverlay {
  key: string;
  src: string;
  from: MorphGeometry;
  to: MorphGeometry;
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
  // Entrance-transition playback: navigating *to* a slide that carries a
  // transition keeps the previous slide rendered underneath while the new
  // one animates in (keyframes in globals.css). Set in useLayoutEffect so
  // the animation class lands before the new slide paints.
  const [anim, setAnim] = useState<{ from: number; type: SlideTransition } | null>(null);
  const lastIndexRef = useRef(index);
  useLayoutEffect(() => {
    const from = lastIndexRef.current;
    if (from === index) return;
    lastIndexRef.current = index;
    const type = slides[index]?.transition;
    if (type && type !== "none" && slides[from]?.ui) {
      setAnim({ from, type });
      // Morph owns its lifecycle (async prepare, then a timed finish) in the
      // effect below — a fixed timer here would cut it off mid-flight.
      if (type === "morph") return;
      // 60ms animation delay + 450ms duration (see globals.css), plus slack.
      const timer = window.setTimeout(() => setAnim(null), 560);
      return () => window.clearTimeout(timer);
    }
    setAnim(null);
  }, [index, slides]);

  // ── Morph (match & move) ────────────────────────────────────────────────
  // Raster-overlay FLIP: matched elements on the previous slide are
  // snapshotted to PNGs via their Konva nodes, both stages' copies are
  // hidden, and the snapshots fly from A's geometry to B's as DOM images
  // (GPU-composited CSS transform). Unmatched elements fade out with A's
  // container / fade in via a rAF opacity ramp on B's nodes.
  const [morph, setMorph] = useState<{ overlays: MorphOverlay[]; playing: boolean } | null>(null);
  const morphRefsA = useRef<Map<string, Konva.Node> | null>(null);
  const morphRefsB = useRef<Map<string, Konva.Node> | null>(null);
  const morphRestoreRef = useRef<(() => void)[]>([]);
  const morphFinishTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!anim || anim.type !== "morph") return;
    let cancelled = false;

    const restoreNodes = () => {
      morphRestoreRef.current.forEach((restore) => restore());
      morphRestoreRef.current = [];
    };

    const finish = () => {
      restoreNodes();
      // Synchronous draw (not batchDraw's scheduled one) so the restored
      // nodes are painted into the canvas bitmap before the overlay images
      // come down next frame — otherwise matched elements blink out for a
      // frame in between.
      morphRefsB.current?.values().next().value?.getLayer()?.draw();
      requestAnimationFrame(() => {
        setMorph(null);
        setAnim(null);
      });
    };

    (async () => {
      // Wait for the new slide's images so the snapshots aren't blank.
      try {
        await Promise.all(pendingKonvaImageLoads());
      } catch {
        // A failed image just snapshots without it.
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      if (cancelled) return;

      const uiA = slides[anim.from]?.ui;
      const uiB = slides[index]?.ui;
      const refsA = morphRefsA.current;
      const refsB = morphRefsB.current;
      if (!uiA || !uiB || !refsA || !refsB) {
        finish();
        return;
      }

      const match = matchMorphPairs(uiA, uiB);
      // Safety valve: every pair costs a decoded PNG layer in the flight.
      // On element-dense slides, morph the biggest N and let the rest simply
      // be revealed by the outgoing slide's fade — better a few elements
      // popping than the whole flight dropping frames.
      const MORPH_MAX_OVERLAYS = 30;
      const pairs = [...match.pairs]
        .sort((a, b) => {
          const boxA = morphGeometry(uiA, a.selectionA)?.box;
          const boxB = morphGeometry(uiA, b.selectionA)?.box;
          return (boxB?.width ?? 0) * (boxB?.height ?? 0) - (boxA?.width ?? 0) * (boxA?.height ?? 0);
        })
        .slice(0, MORPH_MAX_OVERLAYS);
      const overlays: MorphOverlay[] = [];
      for (const pair of pairs) {
        const nodeA = refsA.get(pair.keyA);
        const nodeB = refsB.get(pair.keyB);
        const from = morphGeometry(uiA, pair.selectionA);
        const to = morphGeometry(uiB, pair.selectionB);
        if (!nodeA || !nodeB || !from || !to) continue;
        let src: string;
        try {
          src = nodeA.toDataURL({ pixelRatio: 1 });
        } catch {
          continue;
        }
        overlays.push({ key: pair.keyB, src, from, to });
        const origA = nodeA.opacity();
        const origB = nodeB.opacity();
        nodeA.opacity(0);
        nodeB.opacity(0);
        morphRestoreRef.current.push(() => {
          nodeA.opacity(origA);
          nodeB.opacity(origB);
        });
      }

      // B's unmatched elements need no work of their own: the outgoing slide
      // sits on top and fades out, revealing them — that reads as a fade-in
      // for free. The flight itself is pure CSS translate3d transforms on
      // the overlay images, which stay on the GPU compositor; any per-frame
      // Konva batchDraw() here (a per-node opacity ramp was tried and
      // dropped) repaints the whole canvas layer and kills the frame rate.
      const layerB = refsB.values().next().value?.getLayer();
      layerB?.batchDraw();
      refsA.values().next().value?.getLayer()?.batchDraw();

      // Decode every snapshot before the flight starts — an <img> that
      // decodes its data URL mid-animation stutters its first frames.
      await Promise.all(
        overlays.map((overlay) => {
          const img = new window.Image();
          img.src = overlay.src;
          return img.decode().catch(() => {});
        })
      );

      if (cancelled) return;
      setMorph({ overlays, playing: false });
      // Let the overlays paint at their "from" geometry, then flip to the
      // final state so the CSS transitions run.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return;
          setMorph((current) => (current ? { ...current, playing: true } : current));
          morphFinishTimerRef.current = window.setTimeout(finish, MORPH_DURATION + 100);
        })
      );
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(morphFinishTimerRef.current);
      restoreNodes();
      setMorph(null);
    };
    // anim is set exactly when index moves to a morph slide; re-running on
    // slides/index identity changes would restart a running animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim]);
  const [scale, setScale] = useState(1);
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const [strokes, setStrokes] = useState<PresenterPoint[][]>([]);
  const [liveStroke, setLiveStroke] = useState<PresenterPoint[] | null>(null);

  const position = Math.max(0, visibleIndexes.indexOf(index));
  const total = visibleIndexes.length;

  const next = useCallback(() => {
    setIndex((i) => {
      const pos = visibleIndexes.indexOf(i);
      const nextPos = Math.min((pos === -1 ? 0 : pos) + 1, visibleIndexes.length - 1);
      return visibleIndexes[nextPos] ?? i;
    });
  }, [visibleIndexes]);
  const prev = useCallback(() => {
    setIndex((i) => {
      const pos = visibleIndexes.indexOf(i);
      const prevPos = Math.max((pos === -1 ? 0 : pos) - 1, 0);
      return visibleIndexes[prevPos] ?? i;
    });
  }, [visibleIndexes]);

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
      if (visibleIndexes.includes(message.index)) setIndex(message.index);
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
            {/* Previous slide. During morph it sits ON TOP (z-10) and fades
                out over the fully opaque new slide — fading the new slide in
                from opacity 0 over present mode's black backdrop reads as a
                dark flash halfway through the crossfade. */}
            {anim && slides[anim.from]?.ui ? (
              <div
                className={
                  anim.type === "morph"
                    ? morph?.playing
                      ? "slide-transition-morph-fade absolute inset-0 z-10"
                      : "absolute inset-0 z-10"
                    : "absolute inset-0"
                }
              >
                <TemplateV2KonvaSlide
                  layout={slides[anim.from].ui as never}
                  isEditMode={false}
                  slideIndex={anim.from}
                  fonts={fonts}
                  externalNodeRefs={morphRefsA}
                />
              </div>
            ) : null}
            <div
              className={
                anim?.type === "slide-right"
                  ? "relative slide-transition-slide-right"
                  : anim?.type === "slide-left"
                    ? "relative slide-transition-slide-left"
                    : "relative"
              }
            >
              <TemplateV2KonvaSlide
                layout={ui as never}
                isEditMode={false}
                slideIndex={index}
                fonts={fonts}
                externalNodeRefs={morphRefsB}
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
            {/* Morph overlays: snapshots of the previous slide's matched
                elements flying to their new geometry (FLIP — rendered at the
                final box, animated in from the inverse transform). */}
            {morph?.overlays.map((overlay) => {
              const { from, to } = overlay;
              const dx =
                from.box.x + from.box.width / 2 - (to.box.x + to.box.width / 2);
              const dy =
                from.box.y + from.box.height / 2 - (to.box.y + to.box.height / 2);
              const sx = from.box.width / Math.max(1, to.box.width);
              const sy = from.box.height / Math.max(1, to.box.height);
              return (
                <img
                  key={overlay.key}
                  src={overlay.src}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute"
                  style={{
                    // Above the outgoing slide (z-10) that's fading out.
                    zIndex: 20,
                    left: to.box.x,
                    top: to.box.y,
                    width: to.box.width,
                    height: to.box.height,
                    transformOrigin: "center",
                    willChange: "transform",
                    transform: morph.playing
                      ? "translate3d(0, 0, 0) scale(1, 1)"
                      : `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`,
                    transition: `transform ${MORPH_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                  }}
                />
              );
            })}
            {/* fade-white / fade-black: opaque cover over the new slide that
                fades out to reveal it. */}
            {anim?.type === "fade-white" || anim?.type === "fade-black" ? (
              <div
                className="slide-transition-fade-cover pointer-events-none absolute inset-0"
                style={{ background: anim.type === "fade-white" ? "#fff" : "#000" }}
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
            className={`rounded-full border border-white/10 bg-black/70 p-2 text-white shadow-lg transition-colors hover:bg-black/85${anim ? "" : " backdrop-blur"}`}
            onClick={openPresenterView}
            title="Open Presenter View"
          >
            <MonitorPlay size={18} />
          </button>
        ) : null}
        <button
          className={`rounded-full border border-white/10 bg-black/70 p-2 text-white shadow-lg transition-colors hover:bg-black/85${anim ? "" : " backdrop-blur"}`}
          onClick={onClose}
          title="Exit (Esc)"
        >
          <X size={18} />
        </button>
      </div>
      <div className={`absolute bottom-5 left-1/2 z-[10010] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-white shadow-lg${anim ? "" : " backdrop-blur"}`}>
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
