"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const ThumbnailSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide
    ),
  { ssr: false }
);

/** Mounted a little before the card scrolls into view, dropped once it is well
 *  out of it. Without the unmount the cost is only deferred: scrolling the
 *  whole library would still end up with every stage alive at once. */
const ROOT_MARGIN = "300px";

/**
 * A template preview that only becomes a real Konva stage while it is on
 * screen.
 *
 * Each preview is a full editor surface — a Stage with content, snap-guide,
 * spacing-badge and marquee layers, all backed by 1280x720 canvases. Rendering
 * the whole library at once meant ~5 canvases per template and, across five
 * themes, roughly a gigabyte of canvas backing store before the panel could
 * paint. Everything outside the viewport is a plain div until it is needed.
 */
export function LazyLayoutThumbnail({
  layout,
  width,
  slideIndex = 0,
  className,
  eager = false,
  unmountWhenHidden = true,
}: {
  layout: Record<string, unknown>;
  width: number;
  slideIndex?: number;
  className?: string;
  /** Render immediately instead of waiting for the observer. Set on the cards
   *  that are above the fold: they are going to be seen anyway, and it means a
   *  browser that never reports intersections (a background tab, a pane that
   *  is not compositing) still shows previews instead of empty boxes. */
  eager?: boolean;
  /** Drop the stage again once it scrolls away. Right for a long library of
   *  large cards; wrong for a short strip of small ones that stays on screen,
   *  where it just makes previews flicker back to placeholders. */
  unmountWhenHidden?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(eager);
  const height = Math.round((width / 1280) * 720);

  // `eager` is a prop, not just a seed: React reuses these components by index
  // when slides are inserted or reordered, so an instance that started life
  // non-eager can become eager. Latching on the initial state alone left those
  // stuck on the placeholder forever.
  useEffect(() => {
    if (eager) setMounted(true);
  }, [eager]);

  useEffect(() => {
    if (eager) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) setMounted(true);
        else if (unmountWhenHidden) setMounted(false);
      },
      { rootMargin: ROOT_MARGIN }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [eager, unmountWhenHidden]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ width, height, overflow: "hidden" }}
    >
      {mounted ? (
        <div
          className="pointer-events-none origin-top-left"
          style={{
            width: 1280,
            height: 720,
            transform: `scale(${width / 1280})`,
          }}
        >
          <ThumbnailSlide
            layout={layout as never}
            isEditMode={false}
            slideIndex={slideIndex}
          />
        </div>
      ) : (
        <div className="h-full w-full animate-pulse bg-[var(--bg-elevated)]" />
      )}
    </div>
  );
}
