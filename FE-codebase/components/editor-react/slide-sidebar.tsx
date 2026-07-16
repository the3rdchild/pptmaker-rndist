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
import { ChevronRight, Copy, LayoutTemplate, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeBackendAssetUrls } from "@/utils/api";
import { ToolButton } from "@/components/editor-react/ui";

const ThumbnailSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide
    ),
  { ssr: false }
);

const THUMB_SCALE = 0.1; // 128px wide for a 1280px slide
const THUMB_W = 1280 * THUMB_SCALE;
const THUMB_H = 720 * THUMB_SCALE;

type Layout = Record<string, unknown>;

export interface SlideSidebarProps {
  slides: { ui?: Record<string, unknown> | null | undefined }[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd: (layout: Record<string, unknown>) => void;
  onAddAt: (index: number, layout?: Record<string, unknown>) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export default function SlideSidebar({
  slides,
  activeIndex,
  onSelect,
  onAdd,
  onAddAt,
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
      <aside className="flex h-full w-[168px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              {slides.map((slide, i) => (
                <div key={i}>
                  {i === 0 && <InsertSlot onAdd={() => onAddAt(0)} />}
                  <SortableSlide
                    id={i}
                    slide={slide}
                    isActive={i === activeIndex}
                    canDelete={slides.length > 1}
                    onSelect={() => onSelect(i)}
                    onDuplicate={() => onDuplicate(i)}
                    onDelete={() => onDelete(i)}
                  />
                  <InsertSlot onAdd={() => onAddAt(i + 1)} />
                </div>
              ))}
            </SortableContext>
          </DndContext>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 border-t border-[var(--border)] p-2">
          <button
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--bg-surface)] text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent-light)]"
            onClick={() => onAdd({ id: "blank", components: [], elements: [] })}
            title="Add blank slide"
          >
            <Plus size={14} />
            Add slide
          </button>
          <ToolButton
            variant="solid"
            active={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
            title="Pick a layout"
            className="w-8"
          >
            <LayoutTemplate size={14} />
          </ToolButton>
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
        "group relative mx-auto cursor-grab overflow-hidden rounded-lg transition-shadow active:cursor-grabbing",
        isActive
          ? "shadow-[var(--shadow-accent-glow)] ring-2 ring-[var(--accent)]"
          : "ring-1 ring-[var(--border-strong)] hover:ring-[var(--text-muted)]",
        isDragging && "z-50 opacity-60"
      )}
      style={{
        width: THUMB_W,
        height: THUMB_H,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={onSelect}
      {...attributes}
      {...listeners}
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
      <span
        className={cn(
          "absolute bottom-1 left-1 rounded px-1 text-[10px] font-medium tabular-nums",
          isActive
            ? "bg-[var(--accent)] text-white"
            : "bg-black/60 text-white/90"
        )}
      >
        {id + 1}
      </span>
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="rounded-md bg-black/70 p-1 text-zinc-300 backdrop-blur transition-colors hover:text-white"
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
            className="rounded-md bg-black/70 p-1 text-zinc-300 backdrop-blur transition-colors hover:text-red-400"
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

function InsertSlot({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="group/insert relative mx-auto flex h-3 items-center justify-center" style={{ width: THUMB_W }}>
      <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-[var(--accent)] opacity-0 transition-opacity group-hover/insert:opacity-100" />
      <button
        className="relative z-10 flex h-4 w-4 scale-75 items-center justify-center rounded-full bg-[var(--accent)] text-white opacity-0 shadow-[var(--shadow-soft)] transition-all hover:bg-[var(--accent-hover)] group-hover/insert:scale-100 group-hover/insert:opacity-100"
        title="Insert slide here"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
      >
        <Plus size={10} />
      </button>
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

  // Two columns of fixed-width cards; panel width = 2*card + gap + padding.
  const cardW = 176;
  const cardH = Math.round((cardW / 1280) * 720);

  return (
    <div className="flex h-full w-[400px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <LayoutTemplate size={14} className="text-[var(--accent-light)]" />
          <h2 className="text-xs font-medium text-[var(--text-primary)]">
            Pick a layout
          </h2>
        </div>
        <button
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </header>
      <div className="grid flex-1 grid-cols-2 content-start justify-items-center gap-3 overflow-y-auto p-3">
        {layouts.map((layout, i) => {
          const scale = cardW / 1280;
          return (
            <button
              key={i}
              className="group relative overflow-hidden rounded-lg bg-white ring-1 ring-[var(--border-strong)] transition-shadow hover:shadow-[var(--shadow-accent-glow)] hover:ring-[var(--accent)]"
              style={{ width: cardW, height: cardH }}
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
              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex h-6 items-center justify-center bg-gradient-to-t from-black/70 to-transparent text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                Use layout
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
