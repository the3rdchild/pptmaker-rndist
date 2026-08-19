"use client";

// Shimmer placeholders for the parts of a slide that haven't landed yet.
//
// Rendered as a DOM overlay INSIDE .editor-slide-frame rather than as Konva
// nodes: the frame already carries the zoom transform, so absolutely-positioned
// children laid out in raw 1280×720 stage coordinates scale for free, and the
// slide's own data is never polluted with throwaway placeholder elements.
//
// Text slots are inferred — buildEmptySlideUi clears every named text slot at
// slide_start, so "named, visible, still empty" means "not streamed in yet",
// but ONLY while the slide is still building (after finalize an empty slot is
// legitimately empty and must not shimmer forever). Photo slots can't be
// inferred the same way: the template ships an authored sample image, so a
// pending photo looks identical to a filled one and has to be tracked by the
// caller instead.

import { EDITOR_STAGE_HEIGHT, EDITOR_STAGE_WIDTH } from "@/components/slide-editor/types";

type Rec = Record<string, unknown>;

/** Identifies a photo slot the same way ai-layout-fill's markers do. */
export function photoSlotKey(componentId: string, name: string, occurrenceIndex: number) {
  return `${componentId}::${name}::${occurrenceIndex}`;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function readBox(el: Rec): Box | null {
  const pos = el.position as Rec | undefined;
  const size = el.size as Rec | undefined;
  const x = typeof pos?.x === "number" ? pos.x : null;
  const y = typeof pos?.y === "number" ? pos.y : null;
  const w = typeof size?.width === "number" ? size.width : null;
  const h = typeof size?.height === "number" ? size.height : null;
  if (x == null || y == null || w == null || h == null) return null;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function textIsEmpty(el: Rec): boolean {
  if (el.type === "text-list") {
    const items = Array.isArray(el.items) ? el.items : [];
    return items.every((item) => !itemText(item).trim());
  }
  const runs = Array.isArray(el.runs) ? (el.runs as Rec[]) : [];
  if (runs.length > 0) {
    return runs.every((run) => !(typeof run?.text === "string" ? run.text : "").trim());
  }
  return !(typeof el.text === "string" ? el.text : "").trim();
}

function itemText(item: unknown): string {
  if (typeof item === "string") return item;
  if (Array.isArray(item)) {
    return item.map((run) => (typeof (run as Rec)?.text === "string" ? String((run as Rec).text) : "")).join("");
  }
  const rec = item as Rec | null;
  if (!rec || typeof rec !== "object") return "";
  if (typeof rec.text === "string") return rec.text;
  const runs = Array.isArray(rec.runs) ? rec.runs : [];
  return runs.map((run) => (typeof (run as Rec)?.text === "string" ? String((run as Rec).text) : "")).join("");
}

/** Collects the boxes that should shimmer: empty named text slots (only while
 *  `includeText`) and photo slots the caller reports as still pending. */
function collectPendingBoxes(
  ui: Rec | null,
  pendingPhotos: Set<string>,
  includeText: boolean,
): Box[] {
  if (!ui) return [];
  const components = Array.isArray(ui.components) ? (ui.components as Rec[]) : [];
  const out: Box[] = [];

  for (const component of components) {
    const componentId = typeof component.id === "string" ? component.id : "";
    const occurrences = new Map<string, number>();
    const elements = Array.isArray(component.elements) ? (component.elements as Rec[]) : [];

    const visit = (el: Rec) => {
      if (!el || typeof el !== "object") return;

      if (el.type === "image") {
        const name = typeof el.name === "string" ? el.name : "";
        if (name) {
          const seen = occurrences.get(name) ?? 0;
          occurrences.set(name, seen + 1);
          if (pendingPhotos.has(photoSlotKey(componentId, name, seen))) {
            const box = readBox(el);
            if (box) out.push(box);
          }
        }
        return;
      }

      if (el.type === "text" || el.type === "text-list") {
        if (
          includeText &&
          el.decorative !== true &&
          typeof el.name === "string" &&
          el.name.trim() &&
          textIsEmpty(el)
        ) {
          const box = readBox(el);
          if (box) out.push(box);
        }
        return;
      }

      const children = el.children as Rec[] | undefined;
      if (Array.isArray(children)) {
        for (const child of children) visit(child);
        return;
      }
      const child = el.child as Rec | undefined;
      if (child) visit(child);
    };

    for (const el of elements) visit(el);
  }

  return out;
}

interface SlideBuildSkeletonProps {
  ui: Rec | null;
  /** Photo slot keys still waiting on their image job. */
  pendingPhotos: Set<string>;
  /** True while the slide is still streaming — gates the text inference. */
  building: boolean;
}

export default function SlideBuildSkeleton({
  ui,
  pendingPhotos,
  building,
}: SlideBuildSkeletonProps) {
  const boxes = collectPendingBoxes(ui, pendingPhotos, building);
  if (boxes.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ width: EDITOR_STAGE_WIDTH, height: EDITOR_STAGE_HEIGHT }}
    >
      {boxes.map((box, index) => (
        <div
          key={index}
          className="absolute animate-pulse rounded-[3px] bg-[color:rgba(148,163,184,0.22)]"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      ))}
    </div>
  );
}
