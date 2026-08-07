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
const STAGE_READY_TIMEOUT_MS = 15000;
const STAGE_READY_POLL_MS = 50;

async function nextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// `CaptureSlide` is a next/dynamic(..., { ssr: false }) component — on its
// first use in a session it renders null until the chunk finishes loading,
// which is a network+parse delay a fixed number of requestAnimationFrame
// waits doesn't reliably cover (confirmed by logging stageRefs.current at
// capture time: it was still all-null on the first export attempt).
// Poll until every stage ref is actually attached instead of guessing.
async function waitForAllStages(
  stageRefs: { current: (Konva.Stage | null)[] },
  isCancelled: () => boolean,
): Promise<boolean> {
  const start = Date.now();
  while (!isCancelled()) {
    if (stageRefs.current.every((stage) => stage !== null)) return true;
    if (Date.now() - start > STAGE_READY_TIMEOUT_MS) return false;
    await delay(STAGE_READY_POLL_MS);
  }
  return false;
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
      const ready = await waitForAllStages(stageRefs, () => cancelled);
      if (cancelled) return;
      if (!ready) {
        onCaptureRef.current(null);
        return;
      }

      // Let mount effects (image/formula loads, chart construction) run.
      await Promise.all(pendingKonvaImageLoads());
      // Give Konva a couple of frames to actually paint the now-resolved
      // images before we rasterize.
      await nextFrame();
      await nextFrame();
      if (cancelled) return;

      const dataUrls = stageRefs.current.map((stage) => {
        if (!stage) return null;
        // A tainted stage (cross-origin image without CORS) throws — keep the
        // whole export alive and report it as a failed capture instead.
        try {
          return stage.toDataURL({ pixelRatio: CAPTURE_PIXEL_RATIO, mimeType: "image/png" });
        } catch {
          return null;
        }
      });
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
