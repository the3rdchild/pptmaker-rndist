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
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(eager);
  const height = Math.round((width / 1280) * 720);

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
        if (entry) setMounted(entry.isIntersecting);
      },
      { rootMargin: ROOT_MARGIN }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [eager]);

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
