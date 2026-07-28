"use client";

import { useState } from "react";

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
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  LayoutTemplate,
  Lock,
  Plus,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ThemeFilterBar,
  useTemplateThemes,
} from "@/components/editor-react/theme-picker";
import { LazyLayoutThumbnail } from "@/components/editor-react/lazy-layout-thumbnail";

const THUMB_SCALE = 0.1; // 128px wide for a 1280px slide
const THUMB_W = 1280 * THUMB_SCALE;
const THUMB_H = 720 * THUMB_SCALE;

type Layout = Record<string, unknown>;

export interface SlideSidebarProps {
  slides: {
    ui?: Record<string, unknown> | null | undefined;
    isLocked?: boolean;
    isHidden?: boolean;
  }[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd: (layout: Record<string, unknown>) => void;
  onAddAt: (index: number, layout?: Record<string, unknown>) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onToggleLock: (index: number) => void;
  onToggleHide: (index: number) => void;
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
  onToggleLock,
  onToggleHide,
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
    <div
      className="relative w-full shrink-0 border-t border-[var(--border)] bg-[var(--bg-panel)]"
      data-inline-edit-ignore="true"
    >
      <div className="overflow-x-auto overflow-y-hidden px-3 py-2.5">
        {/* w-max + mx-auto centres the strip while it fits and falls back to a
            normal left-anchored scroll once it doesn't. Plain justify-center
            would clip the first slides out of reach when the strip overflows. */}
        <div className="mx-auto flex w-max items-center gap-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}>
              {slides.map((slide, i) => (
                <div key={i} className="flex shrink-0 items-center">
                  {i === 0 && <InsertSlot onAdd={() => onAddAt(0)} />}
                  <SortableSlide
                    id={i}
                    slide={slide}
                    isActive={i === activeIndex}
                    canDelete={slides.length > 1}
                    onSelect={() => onSelect(i)}
                    onDuplicate={() => onDuplicate(i)}
                    onDelete={() => onDelete(i)}
                    onToggleLock={() => onToggleLock(i)}
                    onToggleHide={() => onToggleHide(i)}
                  />
                  <InsertSlot onAdd={() => onAddAt(i + 1)} />
                </div>
              ))}
            </SortableContext>
          </DndContext>
          <div
            className="flex shrink-0 overflow-hidden rounded-lg bg-[var(--bg-surface)] ring-1 ring-[var(--border-strong)] transition-shadow hover:ring-[var(--text-muted)]"
            style={{ width: THUMB_W, height: THUMB_H }}
          >
            <button
              className="flex flex-1 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              onClick={() => onAdd({ id: "blank", components: [], elements: [] })}
              title="Add blank slide"
            >
              <Plus size={18} />
            </button>
            <button
              className={cn(
                "flex w-7 items-center justify-center border-l border-[var(--border-strong)] transition-colors",
                pickerOpen
                  ? "bg-[var(--accent-soft)] text-[var(--accent-light)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              )}
              onClick={() => setPickerOpen((v) => !v)}
              title="Pick a layout"
            >
              <ChevronUp
                size={13}
                className={cn("transition-transform", pickerOpen && "rotate-180")}
              />
            </button>
          </div>
        </div>
      </div>
      {pickerOpen && (
        // Anchored above the strip rather than beside it — at the bottom of the
        // window there is no room to open downwards.
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
        "group relative shrink-0 overflow-hidden rounded-lg transition-shadow",
        isLocked ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        isActive
          ? "shadow-[var(--shadow-accent-glow)] ring-2 ring-[var(--accent)]"
          : "ring-1 ring-[var(--border-strong)] hover:ring-[var(--text-muted)]",
        isDragging && "z-50 opacity-60",
        isHidden && "opacity-45"
      )}
      style={{
        width: THUMB_W,
        height: THUMB_H,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={onSelect}
      {...attributes}
      {...(isLocked ? {} : listeners)}
    >
      {slide.ui ? (
        <LazyLayoutThumbnail
          layout={slide.ui}
          width={THUMB_W}
          slideIndex={id}
          className="bg-white"
          // The strip is always on screen and short: render the first slides
          // outright, and never drop one once it has rendered — a filmstrip
          // tile flickering back to a placeholder reads as a stuck load.
          eager={id < 12}
          unmountWhenHidden={false}
        />
      ) : (
        <div className="h-full w-full bg-white" />
      )}
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
      {(isLocked || isHidden) && (
        <div className="absolute bottom-1 right-1 flex gap-0.5">
          {isLocked && (
            <span className="rounded bg-black/70 p-0.5 text-white/90" title="Locked">
              <Lock size={9} />
            </span>
          )}
          {isHidden && (
            <span className="rounded bg-black/70 p-0.5 text-white/90" title="Hidden in presentation">
              <EyeOff size={9} />
            </span>
          )}
        </div>
      )}
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="rounded-md bg-black/70 p-1 text-zinc-300 backdrop-blur transition-colors hover:text-white"
          title={isHidden ? "Show in presentation" : "Hide in presentation"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleHide();
          }}
        >
          {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
        </button>
        <button
          className="rounded-md bg-black/70 p-1 text-zinc-300 backdrop-blur transition-colors hover:text-white"
          title={isLocked ? "Unlock slide" : "Lock slide"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
        >
          {isLocked ? <Unlock size={10} /> : <Lock size={10} />}
        </button>
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
    <div className="group/insert relative flex w-3 shrink-0 items-center justify-center" style={{ height: THUMB_H }}>
      <div className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-[var(--accent)] opacity-0 transition-opacity group-hover/insert:opacity-100" />
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
  const { themes, activeThemeId, setActiveThemeId, visibleLayouts } =
    useTemplateThemes();

  // Two columns of fixed-width cards; panel width = 2*card + gap + padding.
  const cardW = 176;
  const cardH = Math.round((cardW / 1280) * 720);

  return (
    <div className="absolute bottom-full left-3 z-50 mb-2 flex h-[min(460px,60vh)] w-[400px] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-[var(--shadow-panel)]">
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
      <div className="shrink-0 pt-2">
        <ThemeFilterBar
          themes={themes}
          activeThemeId={activeThemeId}
          onChange={setActiveThemeId}
        />
      </div>
      <div className="grid flex-1 grid-cols-2 content-start justify-items-center gap-3 overflow-y-auto p-3">
        {visibleLayouts.map((layout, i) => {
          return (
            <button
              key={`${layout.id ?? i}`}
              className="group relative overflow-hidden rounded-lg bg-white ring-1 ring-[var(--border-strong)] transition-shadow hover:shadow-[var(--shadow-accent-glow)] hover:ring-[var(--accent)]"
              style={{ width: cardW, height: cardH }}
              onClick={() => onPick(layout)}
              title={String(layout.description ?? `Layout ${i + 1}`).slice(0, 80)}
            >
              <LazyLayoutThumbnail layout={layout} width={cardW} eager={i < 6} />
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
