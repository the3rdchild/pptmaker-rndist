"use client";

import { useMemo } from "react";
import { Rect } from "react-konva";
import {
  EDITOR_STAGE_HEIGHT,
  EDITOR_STAGE_WIDTH,
} from "@/components/slide-editor/types";
import { backgroundColor } from "@/components/slide-editor/model/render-style";
import type { RawUi } from "@/components/slide-editor/model/core";

/**
 * Stage background: solid color, linear/radial gradient, plus an optional
 * subtle repeating pattern (grid or dots). Configured via `ui.backgroundStyle`
 * — falls back to the legacy solid `ui.background` string.
 */

export type BackgroundStyle = {
  type: "solid" | "linear" | "radial";
  /** Primary color (solid fill, or gradient start). */
  from: string;
  /** Gradient end color. */
  to?: string;
  /** Linear gradient direction in degrees; 0 = left→right, 90 = top→bottom. */
  angle?: number;
  pattern?: "none" | "grid" | "dots";
};

export function readBackgroundStyle(ui: RawUi): BackgroundStyle {
  const raw = ui.backgroundStyle;
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    const type = record.type;
    const from = typeof record.from === "string" ? record.from : null;
    if (
      from &&
      (type === "solid" || type === "linear" || type === "radial")
    ) {
      return {
        type,
        from,
        to: typeof record.to === "string" ? record.to : from,
        angle: typeof record.angle === "number" ? record.angle : 90,
        pattern:
          record.pattern === "grid" || record.pattern === "dots"
            ? record.pattern
            : "none",
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

  const patternImage = useMemo(() => {
    if (pattern !== "grid" && pattern !== "dots") return null;
    const dark = hexLuminance(from) < 0.5;
    const color = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.10)";
    return makePatternCanvas(pattern, color);
  }, [pattern, from]);

  const gradient = type === "linear" ? linearGradientPoints(angle) : null;

  return (
    <>
      {type === "solid" ? (
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
      {patternImage ? (
        <Rect
          width={EDITOR_STAGE_WIDTH}
          height={EDITOR_STAGE_HEIGHT}
          // Konva accepts a canvas for fillPatternImage at runtime; its types only name HTMLImageElement.
          fillPatternImage={patternImage as unknown as HTMLImageElement}
          fillPatternRepeat="repeat"
          listening={false}
        />
      ) : null}
    </>
  );
}
