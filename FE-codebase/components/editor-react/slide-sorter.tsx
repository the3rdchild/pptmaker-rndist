"use client";

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
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, Eye, EyeOff, Lock, Trash2, Unlock, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ThumbnailSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide
    ),
  { ssr: false }
);

const CARD_W = 220;
const CARD_H = (CARD_W / 1280) * 720;

export interface SlideSorterProps {
  slides: {
    ui?: Record<string, unknown> | null | undefined;
    isLocked?: boolean;
    isHidden?: boolean;
  }[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onToggleLock: (index: number) => void;
  onToggleHide: (index: number) => void;
  onClose: () => void;
}

// Full-grid view of every slide at once (PRD #45 "Slide Sorter") — same
// slide-level actions as the sidebar (lock/hide/duplicate/delete/reorder),
// just laid out for scanning a whole deck's structure instead of a single
// vertical list.
export default function SlideSorter({
  slides,
  activeIndex,
  onSelect,
  onDuplicate,
  onDelete,
  onReorder,
  onToggleLock,
  onToggleHide,
  onClose,
}: SlideSorterProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onReorder(Number(active.id), Number(over.id));
  };

  const itemIds = slides.map((_, i) => i);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-[var(--bg-base)]"
      data-inline-edit-ignore="true"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] px-5">
        <div>
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Slide Sorter</h2>
          <p className="text-xs text-[var(--text-muted)]">{slides.length} slides — drag to reorder</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <X size={18} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={itemIds} strategy={rectSortingStrategy}>
            <div
              className="grid justify-center gap-5"
              style={{ gridTemplateColumns: `repeat(auto-fill, ${CARD_W}px)` }}
            >
              {slides.map((slide, i) => (
                <SortableSorterCard
                  key={i}
                  id={i}
                  slide={slide}
                  isActive={i === activeIndex}
                  canDelete={slides.length > 1}
                  onSelect={() => {
                    onSelect(i);
                    onClose();
                  }}
                  onDuplicate={() => onDuplicate(i)}
                  onDelete={() => onDelete(i)}
                  onToggleLock={() => onToggleLock(i)}
                  onToggleHide={() => onToggleHide(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

function SortableSorterCard({
  id,
  slide,
  isActive,
  canDelete,
  onSelect,
  onDuplicate,
  onDelete,
  onToggleLock,
  onToggleHide,
}: {
  id: number;
  slide: {
    ui?: Record<string, unknown> | null | undefined;
    isLocked?: boolean;
    isHidden?: boolean;
  };
  isActive: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  onToggleHide: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: slide.isLocked });
  const isLocked = Boolean(slide.isLocked);
  const isHidden = Boolean(slide.isHidden);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative overflow-hidden rounded-xl transition-shadow",
        isLocked ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        isActive
          ? "shadow-[var(--shadow-accent-glow)] ring-2 ring-[var(--accent)]"
          : "ring-1 ring-[var(--border-strong)] hover:ring-[var(--text-muted)]",
        isDragging && "z-50 opacity-60",
        isHidden && "opacity-45"
      )}
      style={{
        width: CARD_W,
        height: CARD_H,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={onSelect}
      {...attributes}
      {...(isLocked ? {} : listeners)}
    >
      <div
        className="pointer-events-none origin-top-left bg-white"
        style={{ width: 1280, height: 720, transform: `scale(${CARD_W / 1280})` }}
      >
        {slide.ui ? (
          <ThumbnailSlide layout={slide.ui as never} isEditMode={false} slideIndex={id} />
        ) : null}
      </div>
      <span
        className={cn(
          "absolute bottom-1.5 left-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
          isActive ? "bg-[var(--accent)] text-white" : "bg-black/60 text-white/90"
        )}
      >
        {id + 1}
      </span>
      {(isLocked || isHidden) && (
        <div className="absolute bottom-1.5 right-1.5 flex gap-1">
          {isLocked && (
            <span className="rounded bg-black/70 p-1 text-white/90" title="Locked">
              <Lock size={11} />
            </span>
          )}
          {isHidden && (
            <span className="rounded bg-black/70 p-1 text-white/90" title="Hidden in presentation">
              <EyeOff size={11} />
            </span>
          )}
        </div>
      )}
      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="rounded-md bg-black/70 p-1.5 text-zinc-300 backdrop-blur transition-colors hover:text-white"
          title={isHidden ? "Show in presentation" : "Hide in presentation"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleHide();
          }}
        >
          {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
        <button
          className="rounded-md bg-black/70 p-1.5 text-zinc-300 backdrop-blur transition-colors hover:text-white"
          title={isLocked ? "Unlock slide" : "Lock slide"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
        >
          {isLocked ? <Unlock size={12} /> : <Lock size={12} />}
        </button>
        <button
          className="rounded-md bg-black/70 p-1.5 text-zinc-300 backdrop-blur transition-colors hover:text-white"
          title="Duplicate"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
        >
          <Copy size={12} />
        </button>
        {canDelete && (
          <button
            className="rounded-md bg-black/70 p-1.5 text-zinc-300 backdrop-blur transition-colors hover:text-red-400"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
