"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type Konva from "konva";
import {
  EDITOR_STAGE_HEIGHT,
  EDITOR_STAGE_WIDTH,
} from "@/components/slide-editor/types";
import { pendingKonvaImageLoads } from "@/components/slide-editor/surface/exportAssets";

const CaptureSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide,
    ),
  { ssr: false },
);

const CAPTURE_PIXEL_RATIO = 2;

async function nextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export type PdfExportSlide = { ui?: Record<string, unknown> | null };

// Renders every slide off-screen at full resolution (unlike the Slide
// Sorter's scaled-down 220px thumbnails) so PDF export gets a real Stage per
// slide to rasterize, then hands back one PNG data URL per slide. Has to
// live inside the same React tree as the editor (not a separate
// ReactDOM.createRoot) because TemplateV2KonvaSlide calls useDispatch() and
// needs the surrounding Redux Provider.
export function PdfExportCapture({
  slides,
  onCapture,
}: {
  slides: PdfExportSlide[] | null;
  onCapture: (dataUrls: string[] | null) => void;
}) {
  const stageRefs = useRef<(Konva.Stage | null)[]>([]);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  useEffect(() => {
    if (!slides || slides.length === 0) return;
    let cancelled = false;
    stageRefs.current = new Array(slides.length).fill(null);

    const run = async () => {
      // Let mount effects (image/formula loads, chart construction) run.
      await nextFrame();
      await Promise.all(pendingKonvaImageLoads());
      // Give Konva a couple of frames to actually paint the now-resolved
      // images before we rasterize.
      await nextFrame();
      await nextFrame();
      if (cancelled) return;

      const dataUrls = stageRefs.current.map((stage) =>
        stage
          ? stage.toDataURL({ pixelRatio: CAPTURE_PIXEL_RATIO, mimeType: "image/png" })
          : null,
      );
      onCaptureRef.current(
        dataUrls.every((url): url is string => Boolean(url)) ? dataUrls : null,
      );
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [slides]);

  if (!slides || slides.length === 0) return null;

  return (
    <div
      aria-hidden
      style={{ position: "fixed", left: -99999, top: 0, pointerEvents: "none" }}
    >
      {slides.map((slide, index) => (
        <div
          key={index}
          style={{ width: EDITOR_STAGE_WIDTH, height: EDITOR_STAGE_HEIGHT }}
        >
          {slide.ui ? (
            <CaptureSlide
              layout={slide.ui as never}
              isEditMode={false}
              slideIndex={index}
              stageRef={(stage) => {
                stageRefs.current[index] = stage;
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
