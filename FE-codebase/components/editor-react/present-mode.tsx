"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

const TemplateV2KonvaSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide
    ),
  { ssr: false }
);

const SLIDE_W = 1280;
const SLIDE_H = 720;

export default function PresentMode({
  slides,
  startIndex,
  onClose,
}: {
  slides: {
    ui?: Record<string, unknown> | null | undefined;
    isHidden?: boolean;
  }[];
  startIndex: number;
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
  const [scale, setScale] = useState(1);

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

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black"
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
            className="origin-top-left"
            style={{
              width: SLIDE_W,
              height: SLIDE_H,
              transform: `scale(${scale})`,
            }}
          >
            <TemplateV2KonvaSlide
              layout={ui as never}
              isEditMode={false}
              slideIndex={index}
            />
          </div>
        </div>
      ) : (
        <p className="text-zinc-500">Empty slide</p>
      )}

      {/* Controls */}
      <button
        className="absolute right-4 top-4 rounded-full border border-white/15 bg-white/10 p-2 text-white/90 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
        onClick={onClose}
        title="Exit (Esc)"
      >
        <X size={18} />
      </button>
      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-white backdrop-blur">
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
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
        <div
          className="h-full bg-[var(--accent)] transition-[width] duration-300"
          style={{ width: `${((position + 1) / Math.max(1, total)) * 100}%` }}
        />
      </div>
    </div>
  );
}
