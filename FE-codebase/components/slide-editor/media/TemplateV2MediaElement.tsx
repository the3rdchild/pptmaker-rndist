"use client";

import { useEffect, useState } from "react";
import { Circle, Group, Image as KonvaImage, Line, Rect, Text } from "react-konva";
import { loadKonvaImage } from "@/components/slide-editor/surface/exportAssets";
import {
  readString,
  type RawElement,
} from "@/components/slide-editor/model/core";

// Static authoring view for a media (audio/video) element. Konva cannot play
// media, so the editor renders a representative still: a video shows its
// poster (or a dark placeholder) with a centered play affordance; an audio
// clip shows a compact player card with a play icon and a faux waveform.
// Playback happens in Present Mode, not in the editor canvas.
export function TemplateV2MediaElement({
  element,
  width,
  height,
  interactive,
}: {
  element: RawElement;
  width: number;
  height: number;
  interactive: boolean;
}) {
  const src = readString(element.src) ?? "";
  const mediaType = readString(element.media_type) === "audio" ? "audio" : "video";
  const poster = readString(element.poster) ?? "";
  const caption = readString(element.caption) ?? "";
  const [posterImage, setPosterImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!poster) {
      setPosterImage(null);
      return;
    }
    void loadKonvaImage(poster).then((loaded) => {
      if (!cancelled) setPosterImage(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [poster]);

  if (mediaType === "audio") {
    return <AudioChrome width={width} height={height} caption={caption} interactive={interactive} src={src} />;
  }

  return (
    <VideoChrome
      width={width}
      height={height}
      posterImage={posterImage}
      caption={caption}
      interactive={interactive}
      hasSrc={Boolean(src)}
    />
  );
}

function VideoChrome({
  width,
  height,
  posterImage,
  caption,
  interactive,
  hasSrc,
}: {
  width: number;
  height: number;
  posterImage: HTMLImageElement | null;
  caption: string;
  interactive: boolean;
  hasSrc: boolean;
}) {
  const radius = Math.min(width, height) * 0.12;
  const playR = Math.min(width, height) * 0.14;
  const playCx = width / 2;
  const playCy = height / 2;
  return (
    <Group listening={interactive}>
      <Rect width={width} height={height} fill="#0B0F19" cornerRadius={radius} />
      {posterImage ? (
        <KonvaImage
          image={posterImage}
          width={width}
          height={height}
          cornerRadius={radius}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}
      {/* Dark scrim so the play glyph reads on any poster. */}
      <Rect width={width} height={height} fill="rgba(0,0,0,0.28)" cornerRadius={radius} listening={false} />
      <Circle x={playCx} y={playCy} radius={playR} fill="rgba(255,255,255,0.92)" listening={false} />
      {/* Play triangle, nudged right to optical-center it in the circle. */}
      <Triangle
        cx={playCx + playR * 0.12}
        cy={playCy}
        size={playR * 0.9}
        color="#0B0F19"
      />
      {!hasSrc ? (
        <Text
          text="No media source"
          x={0}
          y={height - 28}
          width={width}
          height={20}
          align="center"
          fontSize={13}
          fill="rgba(255,255,255,0.7)"
          listening={false}
        />
      ) : null}
      {caption ? (
        <Text
          text={caption}
          x={0}
          y={height - 28}
          width={width}
          height={20}
          align="center"
          fontSize={13}
          fill="rgba(255,255,255,0.9)"
          listening={false}
        />
      ) : null}
    </Group>
  );
}

function AudioChrome({
  width,
  height,
  caption,
  interactive,
  src,
}: {
  width: number;
  height: number;
  caption: string;
  interactive: boolean;
  src: string;
}) {
  const pad = Math.max(8, Math.min(width, height) * 0.08);
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  const iconR = Math.min(innerH, innerW * 0.18) * 0.5;
  const waveX = pad + iconR * 2 + pad;
  const waveW = Math.max(1, width - waveX - pad);
  return (
    <Group listening={interactive}>
      <Rect width={width} height={height} fill="#111827" cornerRadius={Math.min(width, height) * 0.1} />
      <Group x={pad + iconR} y={height / 2}>
        <Circle radius={iconR} fill="rgba(255,255,255,0.92)" listening={false} />
        <Triangle cx={iconR * 0.12} cy={0} size={iconR * 0.9} color="#111827" />
      </Group>
      <Waveform x={waveX} y={height / 2} width={waveW} height={innerH * 0.5} />
      {!src ? (
        <Text
          text="No media source"
          x={0}
          y={height - 22}
          width={width}
          align="center"
          fontSize={12}
          fill="rgba(255,255,255,0.6)"
          listening={false}
        />
      ) : null}
      {caption ? (
        <Text
          text={caption}
          x={0}
          y={height - 22}
          width={width}
          align="center"
          fontSize={12}
          fill="rgba(255,255,255,0.85)"
          listening={false}
        />
      ) : null}
    </Group>
  );
}

// Equilateral-ish play triangle pointing right, centered at (cx, cy).
function Triangle({ cx, cy, size, color }: { cx: number; cy: number; size: number; color: string }) {
  const h = size * 0.5;
  // Filled via a closed polyline (Konva Line with closed shape, no stroke).
  const points = [
    cx - h * 0.6,
    cy - h,
    cx - h * 0.6,
    cy + h,
    cx + h,
    cy,
  ];
  return (
    <Line
      points={points}
      closed
      fill={color}
      stroke={color}
      strokeWidth={1}
      listening={false}
    />
  );
}

// Deterministic faux waveform bars so the audio element reads as audio at a
// glance. Purely decorative — not derived from the actual signal.
function Waveform({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const barCount = Math.max(4, Math.floor(width / Math.max(6, height * 0.18)));
  const gap = width / barCount;
  const barW = Math.max(2, gap * 0.55);
  const bars = [];
  for (let i = 0; i < barCount; i++) {
    // Pseudo-random but stable amplitude per index.
    const amp = 0.3 + 0.7 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
    const barH = Math.max(2, height * amp);
    bars.push(
      <Rect
        key={i}
        x={x + i * gap + (gap - barW) / 2}
        y={y - barH / 2}
        width={barW}
        height={barH}
        fill="rgba(255,255,255,0.6)"
        cornerRadius={barW / 2}
        listening={false}
      />,
    );
  }
  return <Group>{bars}</Group>;
}
