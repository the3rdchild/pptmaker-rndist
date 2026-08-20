"use client";

// Renders a rectangle element's fill when it's one of the richer ShapeFill
// variants (checkered / lines / gradient / image) instead of a plain color.
// Solid stays on the same plain <Rect fill=.../> nodes.tsx already used —
// this only exists for the other four.
//
// Deliberately reuses the stage-level background system's own techniques
// (SlideBackground.tsx) rather than inventing new ones, per the "make it
// look like the existing Background tab" ask: makeStagePatternCanvas for the
// diagonal-line look, coverCrop for the cover-fit image math. The one new
// primitive is the checkerboard tile, which has no prior art anywhere in
// this codebase.

import { useMemo } from "react";
import { Group, Image as KonvaImage, Rect } from "react-konva";
import type Konva from "konva";

import type { ShapeFill } from "@/components/slide-editor/types";
import {
  coverCrop,
  hexLuminance,
  makeStagePatternCanvas,
  useLoadedImage,
} from "@/components/slide-editor/surface/SlideBackground";
import { withHash } from "@/components/slide-editor/model/model";

const DEFAULT_INK = "#00000022";
const DEFAULT_PAPER = "#FFFFFF";

function makeCheckeredPatternCanvas(
  colorA: string,
  colorB: string,
  cell = 20,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = cell * 2;
  canvas.height = cell * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = colorB;
  ctx.fillRect(0, 0, cell * 2, cell * 2);
  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, cell, cell);
  ctx.fillRect(cell, cell, cell, cell);
  return canvas;
}

/** Composites the base color behind a one-shot diagonal-stripe overlay,
 *  auto-deriving the (subtle, low-alpha) line color from the base color's
 *  luminance — the exact same rule the general editor's Background panel
 *  uses for its "Diagonal" pattern, just scoped to one element's box instead
 *  of the whole stage, so this reads as the identical pattern. */
function makeLinesPatternCanvas(
  backgroundColor: string,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined" || width <= 0 || height <= 0) return null;
  const dark = hexLuminance(backgroundColor) < 0.5;
  const lineColor = dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.11)";
  const strokes = makeStagePatternCanvas("diagonal", lineColor, width, height);
  if (!strokes) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(strokes, 0, 0);
  return canvas;
}

function linearGradientPoints(angleDeg: number, width: number, height: number) {
  const radians = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const cx = width / 2;
  const cy = height / 2;
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  return {
    start: { x: cx - dx * half, y: cy - dy * half },
    end: { x: cx + dx * half, y: cy + dy * half },
  };
}

/** Traces a rounded-rect path for a Group's clipFunc — Konva.Context mirrors
 *  the native CanvasRenderingContext2D methods used here. `radius` matches
 *  render-style.ts's borderRadius() return shape (a single number, or
 *  [tl, tr, br, bl]). */
function roundedRectClip(
  ctx: Konva.Context,
  width: number,
  height: number,
  radius: number | number[],
) {
  const [tl, tr, br, bl] = Array.isArray(radius)
    ? radius
    : [radius, radius, radius, radius];
  ctx.beginPath();
  ctx.moveTo(tl, 0);
  ctx.lineTo(width - tr, 0);
  if (tr) ctx.arcTo(width, 0, width, tr, tr);
  ctx.lineTo(width, height - br);
  if (br) ctx.arcTo(width, height, width - br, height, br);
  ctx.lineTo(bl, height);
  if (bl) ctx.arcTo(0, height, 0, height - bl, bl);
  ctx.lineTo(0, tl);
  if (tl) ctx.arcTo(0, 0, tl, 0, tl);
  ctx.closePath();
}

export interface ShapeFillRectProps {
  fill: ShapeFill | null | undefined;
  width: number;
  height: number;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  cornerRadius: number | number[];
  listening: boolean;
  shadowProps: Record<string, unknown>;
}

/** Renders one rectangle's fill, dispatching on `fill.type`. Stroke/shadow/
 *  cornerRadius stay on the SAME node the solid case uses wherever possible
 *  (gradient, pattern) so Konva's own clipping keeps working for free; only
 *  the image case needs an explicit clip (KonvaImage has no cornerRadius). */
export function ShapeFillRect({
  fill,
  width,
  height,
  stroke,
  strokeWidth,
  dash,
  cornerRadius,
  listening,
  shadowProps,
}: ShapeFillRectProps) {
  const type = fill?.type ?? "solid";
  const nodeOpacity = typeof fill?.opacity === "number" ? fill.opacity : 1;

  const patternCanvas = useMemo(() => {
    if (type === "checkered" && fill?.type === "checkered") {
      return makeCheckeredPatternCanvas(
        withHash(fill.color) ?? DEFAULT_INK,
        withHash(fill.background_color ?? undefined) ?? DEFAULT_PAPER,
      );
    }
    if (type === "lines" && fill?.type === "lines") {
      // One-shot canvas sized to THIS element's own box, painted no-repeat —
      // mirrors how the stage-level "Diagonal" pattern draws once at stage
      // size rather than tiling, just scoped to the element instead.
      return makeLinesPatternCanvas(
        withHash(fill.background_color) ?? DEFAULT_PAPER,
        width,
        height,
      );
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, fill, width, height]);

  const imageUrl = type === "image" && fill?.type === "image" ? fill.url : undefined;
  const loadedImage = useLoadedImage(imageUrl);
  const crop = useMemo(() => {
    if (!loadedImage) return null;
    return coverCrop(
      loadedImage.naturalWidth || loadedImage.width,
      loadedImage.naturalHeight || loadedImage.height,
      width,
      height,
    );
  }, [loadedImage, width, height]);

  if (type === "image") {
    const fallback = withHash((fill as { color?: string })?.color ?? undefined) ?? DEFAULT_PAPER;
    return (
      <Group
        opacity={nodeOpacity}
        clipFunc={(ctx) => roundedRectClip(ctx, width, height, cornerRadius)}
      >
        {loadedImage && crop ? (
          <KonvaImage image={loadedImage} crop={crop} width={width} height={height} />
        ) : (
          <Rect width={width} height={height} fill={fallback} />
        )}
      </Group>
    );
  }

  if (type === "checkered" || type === "lines") {
    if (!patternCanvas) return null;
    return (
      <Rect
        width={width}
        height={height}
        fillPatternImage={patternCanvas as unknown as HTMLImageElement}
        fillPatternRepeat={type === "checkered" ? "repeat" : "no-repeat"}
        opacity={nodeOpacity}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={dash}
        cornerRadius={cornerRadius}
        {...shadowProps}
        listening={listening}
      />
    );
  }

  if (type === "gradient" && fill?.type === "gradient") {
    const from = withHash(fill.from) ?? DEFAULT_INK;
    const to = withHash(fill.to) ?? from;
    if (fill.shape === "radial") {
      const cx = width / 2;
      const cy = height / 2;
      return (
        <Rect
          width={width}
          height={height}
          fillRadialGradientStartPoint={{ x: cx, y: cy }}
          fillRadialGradientEndPoint={{ x: cx, y: cy }}
          fillRadialGradientStartRadius={0}
          fillRadialGradientEndRadius={Math.hypot(width, height) / 2}
          fillRadialGradientColorStops={[0, from, 1, to]}
          opacity={nodeOpacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          cornerRadius={cornerRadius}
          {...shadowProps}
          listening={listening}
        />
      );
    }
    const points = linearGradientPoints(fill.angle ?? 90, width, height);
    return (
      <Rect
        width={width}
        height={height}
        fillLinearGradientStartPoint={points.start}
        fillLinearGradientEndPoint={points.end}
        fillLinearGradientColorStops={[0, from, 1, to]}
        opacity={nodeOpacity}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={dash}
        cornerRadius={cornerRadius}
        {...shadowProps}
        listening={listening}
      />
    );
  }

  // Solid (or a malformed/unknown type) — same plain fill nodes.tsx used
  // before this component existed.
  const solidColor = withHash((fill as { color?: string } | null | undefined)?.color ?? undefined);
  if (!solidColor && !(stroke && (strokeWidth ?? 0) > 0)) return null;
  return (
    <Rect
      width={width}
      height={height}
      fill={solidColor}
      stroke={stroke}
      strokeWidth={strokeWidth}
      dash={dash}
      cornerRadius={cornerRadius}
      {...shadowProps}
      listening={listening}
    />
  );
}
