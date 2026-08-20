"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import dynamic from "next/dynamic";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  MousePointerClick,
  Pause,
  Pencil,
  Play,
  RotateCcw,
} from "lucide-react";
import { useSessionStore } from "@/store/session.store";
import { getDeck } from "@/lib/api";
import { adaptDeckToPresentation } from "@/components/editor-react/deck-adapt";
import {
  usePresenterChannel,
  type PresenterPoint,
} from "@/components/editor-react/presenter-sync";

const TemplateV2KonvaSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide,
    ),
  { ssr: false },
);

type PresenterSlide = {
  ui?: Record<string, unknown> | null;
  isHidden?: boolean;
  notes?: string;
};

const SLIDE_W = 1280;
const SLIDE_H = 720;
const PREVIEW_W = 480;
const PREVIEW_H = (PREVIEW_W / SLIDE_W) * SLIDE_H;
const NEXT_PREVIEW_W = 240;
const NEXT_PREVIEW_H = (NEXT_PREVIEW_W / SLIDE_W) * SLIDE_H;

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Separate window (PRD #50), opened via window.open() from present-mode.tsx.
// Re-fetches the deck on its own (rather than receiving props from the
// opener) so it works as a genuinely independent window/second screen, and
// stays in sync with whichever Present Mode window is showing the deck to
// the audience over a BroadcastChannel (presenter-sync.ts) — including
// driving its laser pointer / freehand annotation live tools (#41).
export function PresenterView({ deckId }: { deckId: string }) {
  const token = useSessionStore((s) => s.token);
  const sessionReady = useSessionStore((s) => s.ready);
  const [slides, setSlides] = useState<PresenterSlide[]>([]);
  const [index, setIndex] = useState(0);
  const [build, setBuild] = useState<{ step: number; total: number } | null>(
    null,
  );
  const [tool, setTool] = useState<"none" | "laser" | "pen">("none");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const drawingRef = useRef<PresenterPoint[] | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  /** True once a Present Mode window has answered/broadcast anything. Until
   *  then this window may be standalone, and arrows drive the local preview
   *  directly — there is no build authority to defer to. */
  const sawPresentModeRef = useRef(false);

  useEffect(() => {
    if (!sessionReady || !token) return;
    let cancelled = false;
    void getDeck(token, deckId).then((deck) => {
      if (cancelled) return;
      const adapted = adaptDeckToPresentation(
        deckId,
        deck.payload as Record<string, unknown> | null,
      );
      setSlides(adapted?.slides ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionReady, token, deckId]);

  const postToPresenter = usePresenterChannel(deckId, (message) => {
    if (message.type === "state" || message.type === "slide-change") {
      sawPresentModeRef.current = true;
      setIndex(message.index);
      // Build fields only ride "state"; a bare slide-change resets the
      // counter until the next state broadcast arrives.
      if (
        message.type === "state" &&
        message.buildTotal != null &&
        message.buildTotal > 1
      ) {
        setBuild({ step: message.buildStep ?? 0, total: message.buildTotal });
      } else {
        setBuild(null);
      }
    }
  });

  // Ask the (presumably already-running) Present Mode window where it
  // currently is — it may have been navigated before this window opened.
  useEffect(() => {
    postToPresenter({ type: "ping" });
  }, [postToPresenter]);

  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now() - elapsedMs;
    const interval = window.setInterval(
      () => setElapsedMs(Date.now() - startedAt),
      250,
    );
    return () => window.clearInterval(interval);
    // Intentionally excludes elapsedMs — it's only read once to compute
    // startedAt when the timer (re)starts, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    if (tool !== "laser") {
      postToPresenter({ type: "laser", x: 0, y: 0, visible: false });
    }
  }, [tool, postToPresenter]);

  const total = slides.length;
  const goTo = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= total) return;
    setIndex(nextIndex);
    postToPresenter({ type: "slide-change", index: nextIndex });
  };

  /** Arrows send INTENT (`step`), not state: Present Mode owns the build
   *  order and decides whether a forward step means the next animation
   *  group or the next slide. The local index only moves when the state /
   *  slide-change broadcast comes back — except in standalone mode, where
   *  there is no other window to answer. */
  const advance = (delta: 1 | -1) => {
    if (sawPresentModeRef.current) {
      postToPresenter({ type: "step", delta });
      return;
    }
    goTo(index + delta);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "PageDown") advance(1);
      else if (event.key === "ArrowLeft" || event.key === "PageUp") advance(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total]);

  const pointFromEvent = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): PresenterPoint | null => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(event);
    if (!point) return;
    if (tool === "laser") {
      postToPresenter({ type: "laser", x: point.x, y: point.y, visible: true });
    } else if (tool === "pen" && drawingRef.current) {
      drawingRef.current = [...drawingRef.current, point];
      postToPresenter({
        type: "annotation-stroke",
        points: drawingRef.current,
        done: false,
      });
    }
  };

  const handlePointerLeave = () => {
    if (tool === "laser") {
      postToPresenter({ type: "laser", x: 0, y: 0, visible: false });
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== "pen") return;
    const point = pointFromEvent(event);
    if (!point) return;
    drawingRef.current = [point];
  };

  const handlePointerUp = () => {
    if (tool === "pen" && drawingRef.current) {
      postToPresenter({
        type: "annotation-stroke",
        points: drawingRef.current,
        done: true,
      });
      drawingRef.current = null;
    }
  };

  const currentUi = slides[index]?.ui;
  const nextUi = slides[index + 1]?.ui;
  const notes = slides[index]?.notes;

  return (
    <div className="flex h-screen flex-col bg-[#0b0b0f] text-white">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <span className="text-sm font-medium">Presenter View</span>
        <div className="flex items-center gap-2 text-sm">
          <button
            className="rounded-md p-1.5 hover:bg-white/10"
            onClick={() => setRunning((r) => !r)}
            title={running ? "Pause timer" : "Start timer"}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="min-w-[52px] tabular-nums">
            {formatElapsed(elapsedMs)}
          </span>
          <button
            className="rounded-md p-1.5 hover:bg-white/10"
            onClick={() => {
              setRunning(false);
              setElapsedMs(0);
            }}
            title="Reset timer"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        <div className="flex flex-1 flex-col gap-3">
          <div
            ref={previewRef}
            className="relative shrink-0 select-none overflow-hidden rounded-lg bg-black"
            style={{
              width: PREVIEW_W,
              height: PREVIEW_H,
              cursor: tool === "none" ? "default" : "crosshair",
            }}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
          >
            {currentUi ? (
              <div
                className="pointer-events-none origin-top-left"
                style={{
                  width: SLIDE_W,
                  height: SLIDE_H,
                  transform: `scale(${PREVIEW_W / SLIDE_W})`,
                }}
              >
                <TemplateV2KonvaSlide
                  layout={currentUi as never}
                  isEditMode={false}
                  slideIndex={index}
                />
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-md p-2 hover:bg-white/10 disabled:opacity-30"
              onClick={() => advance(-1)}
              disabled={index <= 0}
              title="Previous (←)"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-[48px] text-center text-xs tabular-nums text-white/60">
              {index + 1} / {total}
            </span>
            <button
              className="rounded-md p-2 hover:bg-white/10 disabled:opacity-30"
              onClick={() => advance(1)}
              disabled={index >= total - 1}
              title="Next (→)"
            >
              <ChevronRight size={16} />
            </button>
            {build ? (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] tabular-nums text-white/60">
                Build {Math.max(1, build.step)} / {build.total}
              </span>
            ) : null}
            <div className="mx-1 h-4 w-px bg-white/15" />
            <button
              className={`rounded-md p-2 hover:bg-white/10 ${tool === "laser" ? "bg-white/15 text-[var(--accent-light)]" : ""}`}
              onClick={() => setTool((t) => (t === "laser" ? "none" : "laser"))}
              title="Laser pointer"
            >
              <MousePointerClick size={16} />
            </button>
            <button
              className={`rounded-md p-2 hover:bg-white/10 ${tool === "pen" ? "bg-white/15 text-[var(--accent-light)]" : ""}`}
              onClick={() => setTool((t) => (t === "pen" ? "none" : "pen"))}
              title="Draw"
            >
              <Pencil size={16} />
            </button>
            <button
              className="rounded-md p-2 hover:bg-white/10"
              onClick={() => postToPresenter({ type: "annotation-clear" })}
              title="Clear drawing"
            >
              <Eraser size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="mb-1 text-xs font-medium text-white/50">
              Speaker Notes
            </p>
            <p className="whitespace-pre-wrap text-sm text-white/90">
              {notes || "No notes for this slide."}
            </p>
          </div>
        </div>

        <div className="w-[260px] shrink-0">
          <p className="mb-2 text-xs font-medium text-white/50">Next slide</p>
          <div
            className="overflow-hidden rounded-lg bg-black"
            style={{ width: NEXT_PREVIEW_W, height: NEXT_PREVIEW_H }}
          >
            {nextUi ? (
              <div
                className="pointer-events-none origin-top-left"
                style={{
                  width: SLIDE_W,
                  height: SLIDE_H,
                  transform: `scale(${NEXT_PREVIEW_W / SLIDE_W})`,
                }}
              >
                <TemplateV2KonvaSlide
                  layout={nextUi as never}
                  isEditMode={false}
                  slideIndex={index + 1}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-white/30">
                End of deck
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
