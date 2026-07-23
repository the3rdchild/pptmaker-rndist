"use client";

import { useEffect, useMemo, useState } from "react";
import { Image as KonvaImage, Rect } from "react-konva";
import {
  EDITOR_STAGE_HEIGHT,
  EDITOR_STAGE_WIDTH,
} from "@/components/slide-editor/types";
import { backgroundColor } from "@/components/slide-editor/model/render-style";
import { loadKonvaImage } from "@/components/slide-editor/surface/exportAssets";
import type { RawUi } from "@/components/slide-editor/model/core";

/**
 * Stage background: solid color, linear/radial gradient, or an uploaded
 * image (cover-fit), plus an optional subtle repeating pattern (grid or
 * dots) layered on top. Configured via `ui.backgroundStyle` — falls back to
 * the legacy solid `ui.background` string.
 */

/** Repeating tile patterns (drawn small, tiled) vs full-stage abstract
 * patterns (drawn once at stage size — flowing lines/arcs/blobs like Canva). */
export type BackgroundPattern =
  | "none"
  | "grid"
  | "dots"
  | "waves"
  | "diagonal"
  | "arcs"
  | "blobs";

const TILE_PATTERNS = new Set<BackgroundPattern>(["grid", "dots"]);
const STAGE_PATTERNS = new Set<BackgroundPattern>(["waves", "diagonal", "arcs", "blobs"]);
const ALL_PATTERNS = new Set<BackgroundPattern>([...TILE_PATTERNS, ...STAGE_PATTERNS]);

export type BackgroundStyle = {
  type: "solid" | "linear" | "radial" | "image";
  /** Primary color (solid fill, gradient start, or the fallback shown while/if the image fails to load). */
  from: string;
  /** Gradient end color. */
  to?: string;
  /** Linear gradient direction in degrees; 0 = left→right, 90 = top→bottom. */
  angle?: number;
  pattern?: BackgroundPattern;
  /** Uploaded background image URL, used when type === "image". */
  imageUrl?: string;
};

export function readBackgroundStyle(ui: RawUi): BackgroundStyle {
  const raw = ui.backgroundStyle;
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    const type = record.type;
    const from = typeof record.from === "string" ? record.from : null;
    if (
      from &&
      (type === "solid" || type === "linear" || type === "radial" || type === "image")
    ) {
      return {
        type,
        from,
        to: typeof record.to === "string" ? record.to : from,
        angle: typeof record.angle === "number" ? record.angle : 90,
        pattern: ALL_PATTERNS.has(record.pattern as BackgroundPattern)
          ? (record.pattern as BackgroundPattern)
          : "none",
        imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : undefined,
      };
    }
  }
  return { type: "solid", from: backgroundColor(ui) ?? "#FFFFFF", pattern: "none" };
}

function hexLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value.split("").map((c) => c + c).join("")
      : value.padEnd(6, "0");
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function makePatternCanvas(
  kind: "grid" | "dots",
  color: string,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const size = kind === "grid" ? 48 : 28;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (kind === "grid") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, size);
    ctx.moveTo(0, 0.5);
    ctx.lineTo(size, 0.5);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

/** Draws a full-stage (non-repeating) abstract pattern — flowing wave lines,
 * diagonal streaks, concentric arcs, or soft blobs — the kind of decorative
 * motion Canva layers behind a deck. Drawn once at stage size and painted as a
 * single non-tiled image, so the curves read as one continuous composition
 * rather than a repeated tile. `color` already carries its (low) alpha. */
function makeStagePatternCanvas(
  kind: "waves" | "diagonal" | "arcs" | "blobs",
  color: string,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (kind === "waves") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const rows = 7;
    const amplitude = height * 0.06;
    const wavelength = width * 0.55;
    for (let r = 0; r < rows; r++) {
      const baseY = (height / (rows - 1)) * r;
      const phase = r * 0.9;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 8) {
        const y = baseY + Math.sin((x / wavelength) * Math.PI * 2 + phase) * amplitude;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (kind === "diagonal") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const gap = 46;
    const span = width + height;
    for (let d = -height; d < span; d += gap) {
      ctx.beginPath();
      ctx.moveTo(d, 0);
      ctx.lineTo(d + height, height);
      ctx.stroke();
    }
  } else if (kind === "arcs") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    // Concentric arcs radiating from the bottom-right corner (topographic feel).
    const cx = width * 1.02;
    const cy = height * 1.05;
    const maxR = Math.hypot(width, height) * 1.05;
    for (let r = maxR * 0.18; r < maxR; r += 58) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI, Math.PI * 1.5);
      ctx.stroke();
    }
  } else {
    // blobs — a few big soft filled circles for gentle color motion.
    ctx.fillStyle = color;
    const blobs = [
      [width * 0.18, height * 0.24, height * 0.28],
      [width * 0.82, height * 0.32, height * 0.22],
      [width * 0.68, height * 0.86, height * 0.34],
      [width * 0.08, height * 0.9, height * 0.2],
    ];
    for (const [x, y, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

/** Konva `crop` rect (in image-space) that achieves object-fit: cover for boxW x boxH. */
function coverCrop(imgW: number, imgH: number, boxW: number, boxH: number) {
  const imgRatio = imgW / imgH;
  const boxRatio = boxW / boxH;
  if (imgRatio > boxRatio) {
    const cropWidth = imgH * boxRatio;
    return { x: (imgW - cropWidth) / 2, y: 0, width: cropWidth, height: imgH };
  }
  const cropHeight = imgW / boxRatio;
  return { x: 0, y: (imgH - cropHeight) / 2, width: imgW, height: cropHeight };
}

function useLoadedImage(src: string | undefined): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    void loadKonvaImage(src).then((image) => {
      if (!cancelled) setLoaded(image);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return loaded;
}

function BackgroundImageFill({
  src,
  fallbackColor,
}: {
  src: string;
  fallbackColor: string;
}) {
  const image = useLoadedImage(src);
  const crop = useMemo(
    () =>
      image
        ? coverCrop(
            image.naturalWidth || image.width,
            image.naturalHeight || image.height,
            EDITOR_STAGE_WIDTH,
            EDITOR_STAGE_HEIGHT,
          )
        : null,
    [image],
  );

  if (!image || !crop) {
    return (
      <Rect width={EDITOR_STAGE_WIDTH} height={EDITOR_STAGE_HEIGHT} fill={fallbackColor} />
    );
  }

  return (
    <KonvaImage
      image={image}
      crop={crop}
      width={EDITOR_STAGE_WIDTH}
      height={EDITOR_STAGE_HEIGHT}
    />
  );
}

function linearGradientPoints(angleDeg: number) {
  const radians = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const cx = EDITOR_STAGE_WIDTH / 2;
  const cy = EDITOR_STAGE_HEIGHT / 2;
  const half =
    (Math.abs(EDITOR_STAGE_WIDTH * dx) + Math.abs(EDITOR_STAGE_HEIGHT * dy)) /
    2;
  return {
    start: { x: cx - dx * half, y: cy - dy * half },
    end: { x: cx + dx * half, y: cy + dy * half },
  };
}

export function SlideBackground({ ui }: { ui: RawUi }) {
  const style = readBackgroundStyle(ui);
  const { type, from, angle = 90, pattern = "none" } = style;
  const to = style.to ?? from;

  const tilePatternImage = useMemo(() => {
    if (pattern !== "grid" && pattern !== "dots") return null;
    const dark = hexLuminance(from) < 0.5;
    const color = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.10)";
    return makePatternCanvas(pattern, color);
  }, [pattern, from]);

  const stagePatternImage = useMemo(() => {
    if (
      pattern !== "waves" &&
      pattern !== "diagonal" &&
      pattern !== "arcs" &&
      pattern !== "blobs"
    ) {
      return null;
    }
    const dark = hexLuminance(from) < 0.5;
    // Blobs are filled areas — keep them fainter than the line patterns.
    const alpha = pattern === "blobs" ? (dark ? 0.1 : 0.07) : dark ? 0.16 : 0.11;
    const color = dark ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    return makeStagePatternCanvas(pattern, color, EDITOR_STAGE_WIDTH, EDITOR_STAGE_HEIGHT);
  }, [pattern, from]);

  const gradient = type === "linear" ? linearGradientPoints(angle) : null;

  return (
    <>
      {type === "image" ? (
        <BackgroundImageFill src={style.imageUrl ?? ""} fallbackColor={from} />
      ) : type === "solid" ? (
        <Rect
          width={EDITOR_STAGE_WIDTH}
          height={EDITOR_STAGE_HEIGHT}
          fill={from}
        />
      ) : type === "linear" && gradient ? (
        <Rect
          width={EDITOR_STAGE_WIDTH}
          height={EDITOR_STAGE_HEIGHT}
          fillLinearGradientStartPoint={gradient.start}
          fillLinearGradientEndPoint={gradient.end}
          fillLinearGradientColorStops={[0, from, 1, to]}
        />
      ) : (
        <Rect
          width={EDITOR_STAGE_WIDTH}
          height={EDITOR_STAGE_HEIGHT}
          fillRadialGradientStartPoint={{
            x: EDITOR_STAGE_WIDTH / 2,
            y: EDITOR_STAGE_HEIGHT / 2,
          }}
          fillRadialGradientEndPoint={{
            x: EDITOR_STAGE_WIDTH / 2,
            y: EDITOR_STAGE_HEIGHT / 2,
          }}
          fillRadialGradientStartRadius={0}
          fillRadialGradientEndRadius={
            Math.hypot(EDITOR_STAGE_WIDTH, EDITOR_STAGE_HEIGHT) / 2
          }
          fillRadialGradientColorStops={[0, from, 1, to]}
        />
      )}
      {tilePatternImage ? (
        <Rect
          width={EDITOR_STAGE_WIDTH}
          height={EDITOR_STAGE_HEIGHT}
          // Konva accepts a canvas for fillPatternImage at runtime; its types only name HTMLImageElement.
          fillPatternImage={tilePatternImage as unknown as HTMLImageElement}
          fillPatternRepeat="repeat"
          listening={false}
        />
      ) : null}
      {stagePatternImage ? (
        <KonvaImage
          image={stagePatternImage as unknown as HTMLImageElement}
          width={EDITOR_STAGE_WIDTH}
          height={EDITOR_STAGE_HEIGHT}
          listening={false}
        />
      ) : null}
    </>
  );
}
