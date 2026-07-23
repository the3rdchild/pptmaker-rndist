"use client";

import {
  asRecord,
  readArray,
  readNumber,
  readString,
} from "@/components/slide-editor/model/model";

export type MediaOverlayItem = {
  key: string;
  src: string;
  media_type: "video" | "audio";
  poster: string | null;
  caption: string | null;
  // Absolute stage-space box (1280x720 coordinate space).
  x: number;
  y: number;
  width: number;
  height: number;
};

// Collects every `media` element in a slide's ui with its absolute
// stage-space box, so Present Mode can overlay real <video>/<audio> players
// on top of the Konva static stand-in. Media elements only live at the top
// level of a component's elements[] (they're inserted as their own component),
// so this walks one level deep — no need to resolve nested flow-layout boxes.
export function collectMediaOverlays(ui: unknown): MediaOverlayItem[] {
  const record = asRecord(ui);
  if (!record) return [];
  const items: MediaOverlayItem[] = [];
  let counter = 0;
  for (const component of readArray(record.components)) {
    const comp = asRecord(component);
    if (!comp) continue;
    const compPos = asRecord(comp.position);
    const compX = readNumber(compPos?.x) ?? 0;
    const compY = readNumber(compPos?.y) ?? 0;
    for (const element of readArray(comp.elements)) {
      const el = asRecord(element);
      if (!el || readString(el.type) !== "media") continue;
      const pos = asRecord(el.position);
      const size = asRecord(el.size);
      const x = compX + (readNumber(pos?.x) ?? 0);
      const y = compY + (readNumber(pos?.y) ?? 0);
      const width = readNumber(size?.width) ?? 0;
      const height = readNumber(size?.height) ?? 0;
      const src = readString(el.src) ?? "";
      if (!src || !width || !height) continue;
      items.push({
        key: `media-${counter++}`,
        src,
        media_type: readString(el.media_type) === "audio" ? "audio" : "video",
        poster: readString(el.poster) || null,
        caption: readString(el.caption) || null,
        x,
        y,
        width,
        height,
      });
    }
  }
  return items;
}
