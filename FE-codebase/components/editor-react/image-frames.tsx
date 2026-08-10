"use client";

/**
 * Image containers ("frames" in Canva terms): plain image elements carrying a
 * clip-path, so the whole existing image toolchain — replace, crop,
 * fit/focus, flip — works on them unchanged, and the canvas stays exportable
 * (clips are drawn with Konva's clipFunc, see surface/nodes.tsx).
 *
 * Two clip encodings, both resize-safe:
 *  - CSS functions with % coordinates (inset / circle / ellipse / polygon) —
 *    the renderer resolves % against the element box, so straight-edged
 *    shapes reshape on resize for free.
 *  - frame-path("M…") — a pseudo-function wrapping an SVG path authored in a
 *    normalized 100×100 box, for curved shapes (heart/cloud/blob/…). The
 *    renderer scales it onto the element with a DOMMatrix at draw time.
 *    Plain path("…") stays absolute for pptx-import compatibility.
 *
 * Adding a frame = adding an IMAGE_FRAMES entry; the insert pipeline does not
 * change.
 */

import { useId } from "react";
import type { SlideElement } from "@/components/slide-editor/types";

export type ImageFrameDef = {
  key: string;
  label: string;
  /** Value stored on the element's clippath. null = the element's own box
   *  (a plain square — still listed so the category reads complete). */
  clippath: string | null;
  /** Wide frames insert at this size instead of the 240×240 default. */
  size?: { width: number; height: number };
};

// ── Path/clip authoring helpers ────────────────────────────────────────────

/** Wraps a normalized 100×100 SVG path in the pseudo-function the renderer
 *  scales onto the element. */
function framePath(data: string): string {
  return `frame-path("${data}")`;
}

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

function polygonClip(points: [number, number][]): string {
  return `polygon(${points.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(", ")})`;
}

/** Regular n-gon centered in the box, first vertex at `rotateDeg` (0 = 3
 *  o'clock, -90 = straight up). */
function regularPolygon(sides: number, rotateDeg = -90): string {
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = ((rotateDeg + (360 / sides) * i) * Math.PI) / 180;
    points.push([50 + 50 * Math.cos(angle), 50 + 50 * Math.sin(angle)]);
  }
  return polygonClip(points);
}

/** Star/burst: alternating outer (50) and inner (50×innerRatio) vertices. */
function starPolygon(points: number, innerRatio: number, rotateDeg = -90): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? 50 : 50 * innerRatio;
    const angle = ((rotateDeg + (180 / points) * i) * Math.PI) / 180;
    pts.push([50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)]);
  }
  return polygonClip(pts);
}

const WIDE = { width: 320, height: 240 };

// ── The library ────────────────────────────────────────────────────────────

export const IMAGE_FRAMES: ImageFrameDef[] = [
  // — Basics (CSS functions) —
  { key: "square", label: "Square", clippath: null },
  { key: "rounded", label: "Rounded", clippath: "inset(0 round 12%)" },
  { key: "circle", label: "Circle", clippath: "circle(50% at 50% 50%)" },
  { key: "oval", label: "Oval", clippath: "ellipse(50% 38% at 50% 50%)", size: WIDE },
  { key: "pill", label: "Pill", clippath: "inset(0 round 50%)", size: WIDE },

  // — Polygons (CSS polygon with % — straight edges) —
  { key: "triangle", label: "Triangle", clippath: polygonClip([[50, 0], [100, 100], [0, 100]]) },
  { key: "triangle-down", label: "Triangle down", clippath: polygonClip([[0, 0], [100, 0], [50, 100]]) },
  { key: "diamond", label: "Diamond", clippath: polygonClip([[50, 0], [100, 50], [50, 100], [0, 50]]) },
  { key: "pentagon", label: "Pentagon", clippath: regularPolygon(5) },
  { key: "hexagon", label: "Hexagon", clippath: regularPolygon(6) },
  { key: "hexagon-flat", label: "Hexagon flat", clippath: regularPolygon(6, -60) },
  { key: "heptagon", label: "Heptagon", clippath: regularPolygon(7) },
  { key: "octagon", label: "Octagon", clippath: regularPolygon(8, -67.5) },
  { key: "trapezoid", label: "Trapezoid", clippath: polygonClip([[20, 0], [80, 0], [100, 100], [0, 100]]), size: WIDE },
  { key: "parallelogram", label: "Parallelogram", clippath: polygonClip([[25, 0], [100, 0], [75, 100], [0, 100]]), size: WIDE },
  { key: "chevron", label: "Chevron", clippath: polygonClip([[0, 0], [75, 0], [100, 50], [75, 100], [0, 100], [25, 50]]), size: WIDE },
  { key: "arrow-right", label: "Arrow", clippath: polygonClip([[0, 25], [55, 25], [55, 0], [100, 50], [55, 100], [55, 75], [0, 75]]), size: WIDE },
  { key: "arrow-up", label: "Arrow up", clippath: polygonClip([[25, 100], [25, 45], [0, 45], [50, 0], [100, 45], [75, 45], [75, 100]]) },
  { key: "cross", label: "Cross", clippath: polygonClip([[35, 0], [65, 0], [65, 35], [100, 35], [100, 65], [65, 65], [65, 100], [35, 100], [35, 65], [0, 65], [0, 35], [35, 35]]) },
  { key: "gem", label: "Gem", clippath: polygonClip([[25, 5], [75, 5], [98, 38], [50, 98], [2, 38]]) },
  { key: "ribbon", label: "Ribbon", clippath: polygonClip([[0, 0], [100, 0], [100, 100], [50, 80], [0, 100]]) },
  { key: "zigzag", label: "Zigzag", clippath: polygonClip([[0, 0], [100, 0], [100, 88], [92, 100], [83, 88], [75, 100], [67, 88], [58, 100], [50, 88], [42, 100], [33, 88], [25, 100], [17, 88], [8, 100], [0, 88]]) },
  { key: "star", label: "Star", clippath: starPolygon(5, 0.42) },
  { key: "star-6", label: "Star 6", clippath: starPolygon(6, 0.58) },
  { key: "star-8", label: "Star 8", clippath: starPolygon(8, 0.62) },
  { key: "burst-12", label: "Burst", clippath: starPolygon(12, 0.78) },
  { key: "burst-16", label: "Sunburst", clippath: starPolygon(16, 0.84) },

  // — Curved shapes (normalized 100×100 SVG paths) —
  { key: "heart", label: "Heart", clippath: framePath("M50 88 C22 64 4 44 4 28 C4 13 15 4 27 4 C37 4 46 10 50 18 C54 10 63 4 73 4 C85 4 96 13 96 28 C96 44 78 64 50 88 Z") },
  { key: "cloud", label: "Cloud", clippath: framePath("M26 82 C13 82 4 72 4 61 C4 51 11 43 21 40 C23 26 35 16 50 16 C63 16 74 24 78 36 C88 38 96 47 96 58 C96 71 86 82 74 82 Z"), size: WIDE },
  { key: "blob-a", label: "Blob", clippath: framePath("M50 5 C72 2 92 16 94 40 C96 64 86 88 60 94 C34 100 10 86 6 58 C2 30 22 8 50 5 Z") },
  { key: "blob-b", label: "Blob 2", clippath: framePath("M58 8 C82 6 96 26 90 52 C84 78 66 96 42 92 C18 88 4 68 10 44 C16 20 34 10 58 8 Z") },
  { key: "blob-c", label: "Blob 3", clippath: framePath("M32 12 C56 2 86 12 91 36 C96 60 80 76 60 86 C40 96 16 90 9 66 C2 42 12 20 32 12 Z") },
  { key: "shield", label: "Shield", clippath: framePath("M50 3 L88 15 L88 48 C88 72 71 88 50 97 C29 88 12 72 12 48 L12 15 Z") },
  { key: "drop", label: "Drop", clippath: framePath("M50 2 C68 26 84 46 84 63 C84 82 69 97 50 97 C31 97 16 82 16 63 C16 46 32 26 50 2 Z") },
  { key: "leaf", label: "Leaf", clippath: framePath("M50 5 C85 5 97 50 97 50 C97 50 85 95 50 95 C15 95 3 50 3 50 C3 50 15 5 50 5 Z"), size: WIDE },
  { key: "arch", label: "Arch", clippath: framePath("M12 100 L12 46 C12 22 29 6 50 6 C71 6 88 22 88 46 L88 100 Z") },
  { key: "dome", label: "Dome", clippath: framePath("M6 98 A44 44 0 0 1 94 98 Z"), size: WIDE },
  { key: "wave", label: "Wave", clippath: framePath("M0 0 L100 0 L100 70 C84 86 66 62 50 74 C34 86 16 88 0 72 Z"), size: WIDE },
  { key: "ticket", label: "Ticket", clippath: framePath("M0 0 L100 0 L100 38 C90 44 90 56 100 62 L100 100 L0 100 L0 62 C10 56 10 44 0 38 Z"), size: WIDE },
  { key: "speech", label: "Speech", clippath: framePath("M12 6 L88 6 Q96 6 96 14 L96 58 Q96 66 88 66 L40 66 L24 88 L28 66 L12 66 Q4 66 4 58 L4 14 Q4 6 12 6 Z"), size: WIDE },
];

// ── Insert ─────────────────────────────────────────────────────────────────

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
    size: frame.size ? { ...frame.size } : { width: 240, height: 240 },
    data: framePlaceholderDataUri(),
    fit: "cover",
    name: `frame_${frame.key}`,
    ...(frame.clippath ? { clippath: frame.clippath } : {}),
  };
}

// ── Panel preview ──────────────────────────────────────────────────────────

/** Extracts the path data from a frame-path("…") clip value, null for
 *  anything else. Mirrors the renderer's framePathDataFromValue. */
function framePathData(clippath: string | null): string | null {
  if (!clippath) return null;
  const match = /^frame-path\(["']([\s\S]*)["']\)$/i.exec(clippath.trim());
  return match ? match[1] : null;
}

/** Panel preview: the same placeholder clipped by the same shape the canvas
 *  will use, so what the author sees in the grid is what they get. CSS
 *  clip-path on a div covers the CSS-function frames; curved frame-path
 *  shapes render through an SVG clipPath (which scales via viewBox). */
export function FramePreview({
  clippath,
  size = 22,
}: {
  clippath: string | null;
  size?: number;
}) {
  const clipId = `frame-preview-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const path = framePathData(clippath);

  if (path) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <defs>
          <clipPath id={clipId}>
            <path d={path} />
          </clipPath>
        </defs>
        <image
          href={framePlaceholderDataUri()}
          width="100"
          height="100"
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
      </svg>
    );
  }

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
