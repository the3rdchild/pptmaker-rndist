"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  slides: { ui?: Record<string, unknown> | null | undefined }[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const total = slides.length;

  const next = useCallback(() => {
    setIndex((i) => Math.min(i + 1, total - 1));
  }, [total]);
  const prev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

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
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        onClick={onClose}
        title="Exit (Esc)"
      >
        <X size={20} />
      </button>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-white/10 px-4 py-2 text-white">
        <button
          className="disabled:opacity-30"
          onClick={prev}
          disabled={index === 0}
          title="Previous (←)"
        >
          <ChevronLeft size={22} />
        </button>
        <span className="min-w-[60px] text-center text-sm">
          {index + 1} / {total}
        </span>
        <button
          className="disabled:opacity-30"
          onClick={next}
          disabled={index === total - 1}
          title="Next (→)"
        >
          <ChevronRight size={22} />
        </button>
      </div>
    </div>
  );
}
