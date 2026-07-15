"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, Copy, GripVertical, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeBackendAssetUrls } from "@/utils/api";

const ThumbnailSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide
    ),
  { ssr: false }
);

const THUMB_SCALE = 0.094; // ~120px wide for a 1280px slide
const THUMB_W = 1280 * THUMB_SCALE;
const THUMB_H = 720 * THUMB_SCALE;

type Layout = Record<string, unknown>;

export interface SlideSidebarProps {
  slides: { ui?: Record<string, unknown> | null | undefined }[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd: (layout: Record<string, unknown>) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export default function SlideSidebar({
  slides,
  activeIndex,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onReorder,
}: SlideSidebarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = Number(active.id);
    const to = Number(over.id);
    onReorder(from, to);
  };

  const itemIds = slides.map((_, i) => i);

  return (
    <div className="flex h-full shrink-0">
      <aside className="flex h-full w-[150px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            {slides.map((slide, i) => (
              <SortableSlide
                key={i}
                id={i}
                slide={slide}
                isActive={i === activeIndex}
                canDelete={slides.length > 1}
                onSelect={() => onSelect(i)}
                onDuplicate={() => onDuplicate(i)}
                onDelete={() => onDelete(i)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <div
          className="flex shrink-0 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900"
          style={{ width: THUMB_W + 8, height: THUMB_H + 8 }}
        >
          <button
            className="flex flex-1 items-center justify-center text-zinc-400 transition-colors hover:text-white"
            onClick={() => onAdd({ id: "blank", components: [], elements: [] })}
            title="Add blank slide"
          >
            <Plus size={20} />
          </button>
          <button
            className={cn(
              "flex w-7 items-center justify-center border-l border-zinc-700 transition-colors",
              pickerOpen
                ? "bg-indigo-500/20 text-white"
                : "text-zinc-400 hover:text-white"
            )}
            onClick={() => setPickerOpen((v) => !v)}
            title="Pick a layout"
          >
            <ChevronRight size={14} className={cn("transition-transform", pickerOpen && "rotate-90")} />
          </button>
        </div>
      </div>
      </aside>
      {pickerOpen && (
        <LayoutPicker
          onPick={(layout) => {
            onAdd(layout);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function SortableSlide({
  id,
  slide,
  isActive,
  canDelete,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  id: number;
  slide: { ui?: Record<string, unknown> | null | undefined };
  isActive: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-md border-2 transition-colors",
        isActive
          ? "border-indigo-500"
          : "border-transparent hover:border-zinc-600",
        isDragging && "opacity-50 z-50"
      )}
      style={{
        width: THUMB_W + 8,
        height: THUMB_H + 8,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={onSelect}
    >
      <div
        className="pointer-events-none origin-top-left bg-white"
        style={{
          width: 1280,
          height: 720,
          transform: `scale(${THUMB_SCALE})`,
        }}
      >
        {slide.ui ? (
          <ThumbnailSlide
            layout={slide.ui as never}
            isEditMode={false}
            slideIndex={id}
          />
        ) : null}
      </div>
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">
        {id + 1}
      </span>
      {/* Drag handle — visible on hover */}
      <div
        className="absolute left-0 top-0 flex h-full w-4 cursor-grab items-center justify-center bg-gradient-to-r from-black/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={10} className="text-white/70" />
      </div>
      <div className="absolute bottom-0 right-0 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="rounded bg-black/70 p-1 text-zinc-300 hover:text-white"
          title="Duplicate"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
        >
          <Copy size={10} />
        </button>
        {canDelete && (
          <button
            className="rounded bg-black/70 p-1 text-zinc-300 hover:text-red-400"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function LayoutPicker({
  onPick,
  onClose,
}: {
  onPick: (layout: Layout) => void;
  onClose: () => void;
}) {
  const [layouts, setLayouts] = useState<Layout[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/templates/general/template.json");
        const tpl = await res.json();
        setLayouts((tpl.layouts ?? []) as Layout[]);
      } catch {
        // ignore
      }
    })();
  }, []);

  return (
    <div className="h-full w-[320px] shrink-0 border-r border-zinc-800 bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <h2 className="text-xs font-medium text-zinc-300">Pick a layout</h2>
        <button
          className="text-zinc-500 hover:text-white"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="grid grid-cols-2 gap-3 overflow-y-auto p-3" style={{ maxHeight: "calc(100vh - 48px)" }}>
        {layouts.map((layout, i) => {
          const scale = 0.22;
          return (
            <button
              key={i}
              className="overflow-hidden rounded-lg border border-zinc-700 bg-white transition-colors hover:border-indigo-500"
              style={{ width: 1280 * scale, height: 720 * scale }}
              onClick={() => onPick(normalizeBackendAssetUrls(layout))}
              title={String(layout.description ?? `Layout ${i + 1}`).slice(0, 80)}
            >
              <div
                className="pointer-events-none origin-top-left"
                style={{
                  width: 1280,
                  height: 720,
                  transform: `scale(${scale})`,
                }}
              >
                <ThumbnailSlide
                  layout={normalizeBackendAssetUrls(layout) as never}
                  isEditMode={false}
                  slideIndex={0}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
