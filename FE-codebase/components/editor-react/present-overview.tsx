"use client";

import { X } from "lucide-react";
import { LazyLayoutThumbnail } from "@/components/editor-react/lazy-layout-thumbnail";

const CARD_WIDTH = 240;

export function PresentOverview({
  slides,
  visibleIndexes,
  activeIndex,
  fonts,
  onSelect,
  onClose,
}: {
  slides: { ui?: Record<string, unknown> | null }[];
  visibleIndexes: number[];
  activeIndex: number;
  fonts?: unknown;
  onSelect: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Slide overview"
      className="absolute inset-0 z-[10020] flex flex-col bg-zinc-950/95 text-white"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold">Slide overview</h2>
          <p className="text-sm text-white/55">{visibleIndexes.length} slides · pilih untuk lompat</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close slide overview" className="rounded-lg p-2 hover:bg-white/10">
          <X size={20} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-6xl justify-center gap-5" style={{ gridTemplateColumns: `repeat(auto-fill, ${CARD_WIDTH}px)` }}>
          {visibleIndexes.map((index) => (
            <button
              key={index}
              type="button"
              aria-label={`Go to slide ${index + 1}`}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => onSelect(index)}
              className={`overflow-hidden rounded-lg text-left outline-none transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-white ${index === activeIndex ? "ring-2 ring-[var(--accent)]" : "ring-1 ring-white/20"}`}
            >
              {slides[index]?.ui ? (
                <LazyLayoutThumbnail
                  layout={slides[index].ui}
                  width={CARD_WIDTH}
                  slideIndex={index}
                  fonts={fonts}
                  eager={index === activeIndex}
                />
              ) : (
                <div className="bg-zinc-800" style={{ width: CARD_WIDTH, height: CARD_WIDTH * 720 / 1280 }} />
              )}
              <div className="bg-zinc-900 px-3 py-2 text-sm font-medium tabular-nums">Slide {index + 1}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
