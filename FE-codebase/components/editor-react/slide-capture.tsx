"use client";

// Imperative one-off slide rasterizer. Two consumers:
//   - template-engine auto-label (sends a page PNG to Kimi vision)
//   - post-generation visual verify (sends each generated slide for review)
//
// Same approach as PdfExportCapture: render the ui off-screen through the real
// Konva slide component (must live inside the editor's React tree — the slide
// component uses useDispatch), wait for the stage + images, then toDataURL.

import { useEffect, useRef, useState } from "react";
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

type Rec = Record<string, unknown>;

type Job = { ui: Rec; resolve: (dataUrl: string | null) => void };

let handler: ((ui: Rec) => Promise<string | null>) | null = null;

/** Renders one slide ui to a PNG data URL. Serializes concurrent callers —
 *  one off-screen stage exists at a time. Returns null when the host isn't
 *  mounted (outside the editor) or the stage never comes up. */
export function captureSlidePng(ui: Rec): Promise<string | null> {
  if (!handler) return Promise.resolve(null);
  return handler(ui);
}

const STAGE_TIMEOUT_MS = 15000;

// Both consumers send this straight to a vision model, and neither needs a
// print-quality frame: the models downscale to roughly 1024px internally, so a
// 2x PNG of a photo-heavy slide (measured at 4.7MB, 6.3MB once base64'd) buys
// no accuracy and costs the whole request. That payload was enough on its own
// to push auto-label past its provider timeout on every vision preset. At 1x
// the stage is already 1280x720, comfortably above what the models use, and
// JPEG takes it to double-digit KB. Slides always have an opaque background,
// so losing PNG's alpha costs nothing here.
//
// This is NOT the PDF export path — that has its own pixel ratio in
// PdfExportCapture.tsx and stays lossless.
const CAPTURE_FORMAT = {
  pixelRatio: 1,
  mimeType: "image/jpeg",
  quality: 0.85,
} as const;

export function SlideCaptureHost() {
  const [queue, setQueue] = useState<Job[]>([]);
  const stageRef = useRef<Konva.Stage | null>(null);

  useEffect(() => {
    handler = (ui) =>
      new Promise<string | null>((resolve) => {
        setQueue((current) => [...current, { ui, resolve }]);
      });
    return () => {
      handler = null;
    };
  }, []);

  const job = queue[0] ?? null;

  useEffect(() => {
    if (!job) return;
    let cancelled = false;

    const run = async () => {
      const start = Date.now();
      while (!cancelled && !stageRef.current) {
        if (Date.now() - start > STAGE_TIMEOUT_MS) break;
        await new Promise<void>((r) => setTimeout(r, 50));
      }
      if (cancelled) return;
      try {
        await Promise.all(pendingKonvaImageLoads());
      } catch {
        // image loads failing must not block the capture
      }
      // Two frames so Konva paints resolved images before rasterizing.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (cancelled) return;

      // A tainted stage (a cross-origin image that refused both the proxy
      // and the anonymous load) throws here — fail this ONE capture soft
      // instead of killing the queue.
      let dataUrl: string | null = null;
      try {
        dataUrl = stageRef.current?.toDataURL(CAPTURE_FORMAT) ?? null;
      } catch (error) {
        console.warn("[slide-capture] stage not exportable (tainted)", error);
      }
      job.resolve(dataUrl);
      stageRef.current = null;
      setQueue((current) => current.slice(1));
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [job]);

  if (!job) return null;

  return (
    <div
      aria-hidden
      style={{ position: "fixed", left: -99999, top: 0, pointerEvents: "none" }}
    >
      <div style={{ width: EDITOR_STAGE_WIDTH, height: EDITOR_STAGE_HEIGHT }}>
        <CaptureSlide
          layout={job.ui as never}
          isEditMode={false}
          slideIndex={0}
          stageRef={(stage) => {
            stageRef.current = stage;
          }}
        />
      </div>
    </div>
  );
}
