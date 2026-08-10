"use client";

/**
 * Image containers ("frames" in Canva terms): plain image elements carrying a
 * CSS clip-path, so the whole existing image toolchain — replace, crop,
 * fit/focus, flip — works on them unchanged, and the canvas stays exportable
 * (clip-path is drawn with Konva's clipFunc, see surface/nodes.tsx).
 *
 * Phase 1 ships the three basics (square / rounded / circle). Abstract
 * SVG-path shapes later only need a new IMAGE_FRAMES entry with
 * `clippath: 'path("…")'` — the insert pipeline does not change.
 */

import type { SlideElement } from "@/components/slide-editor/types";

export type ImageFrameDef = {
  key: string;
  label: string;
  /** CSS clip-path value applied to the image element. null = the element's
   *  own box (a plain square — still listed so the category reads complete). */
  clippath: string | null;
};

export const IMAGE_FRAMES: ImageFrameDef[] = [
  { key: "square", label: "Square", clippath: null },
  { key: "rounded", label: "Rounded", clippath: "inset(0 round 12%)" },
  { key: "circle", label: "Circle", clippath: "circle(50% at 50% 50%)" },
];

/** Canva-style placeholder landscape (sky + hills), baked as a data URI so an
 *  inserted frame is self-contained — no network, no bucket, exportable. */
let placeholderCache: string | null = null;
export function framePlaceholderDataUri(): string {
  if (placeholderCache) return placeholderCache;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">` +
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#a9d6f0"/><stop offset="1" stop-color="#e9f5fc"/>` +
    `</linearGradient></defs>` +
    `<rect width="480" height="480" fill="url(#sky)"/>` +
    `<g fill="#ffffff" opacity="0.95"><circle cx="245" cy="118" r="42"/>` +
    `<circle cx="298" cy="130" r="30"/><ellipse cx="270" cy="146" rx="74" ry="24"/></g>` +
    `<path d="M0 292 Q120 236 240 282 T480 272 L480 480 L0 480 Z" fill="#a4ce4e"/>` +
    `<path d="M0 352 Q160 300 330 346 T480 340 L480 480 L0 480 Z" fill="#84b338"/>` +
    `</svg>`;
  placeholderCache = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return placeholderCache;
}

/** The inserted element: a cover-fit image named like a slot, so a frame used
 *  in a template becomes a proper photo slot for the generator. */
export function buildFrameElement(frame: ImageFrameDef): SlideElement {
  return {
    type: "image",
    position: { x: 168, y: 176 },
    size: { width: 240, height: 240 },
    data: framePlaceholderDataUri(),
    fit: "cover",
    name: `frame_${frame.key}`,
    ...(frame.clippath ? { clippath: frame.clippath } : {}),
  };
}

/** Panel preview: the same placeholder clipped by the same CSS value the
 *  canvas will use, so what the author sees in the grid is what they get. */
export function FramePreview({
  clippath,
  size = 22,
}: {
  clippath: string | null;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${framePlaceholderDataUri()}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        ...(clippath ? { clipPath: clippath } : {}),
      }}
    />
  );
}
