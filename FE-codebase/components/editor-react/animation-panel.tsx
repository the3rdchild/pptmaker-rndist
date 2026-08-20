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
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Ban, GripVertical, Play, Square } from "lucide-react";
import { PanelLabel } from "@/components/editor-react/ui";
import { cn } from "@/lib/utils";
import {
  ANIMATION_EFFECTS,
  ANIMATION_KIND_ORDER,
  animationEffectKind,
  makeAnimationStep,
  parseElementAnimations,
  type AnimationEffect,
  type AnimationKind,
  type AnimationStep,
  type AnimationTrigger,
  type AnimationEasing,
} from "@/components/slide-editor/animation/animation-meta";
import {
  applyAnimateAllPreset,
  clearAllAnimations,
  collectSlideAnimationSteps,
  rewriteAnimationOrders,
} from "@/components/editor-react/animation-sequence";
import { keyForSelection } from "@/components/slide-editor/model/model";
import type { TemplateSelectionPayload } from "@/components/slide-editor/surface/TemplateV2KonvaSlide";

const TRIGGER_OPTIONS: { id: AnimationTrigger; label: string }[] = [
  { id: "on-click", label: "On Click" },
  { id: "with-previous", label: "With Previous" },
  { id: "after-previous", label: "After Previous" },
];

const EASING_OPTIONS: { id: AnimationEasing; label: string }[] = [
  { id: "ease-out", label: "Ease Out" },
  { id: "ease-in", label: "Ease In" },
  { id: "ease-in-out", label: "Ease In Out" },
  { id: "linear", label: "Linear" },
];

const effectLabel = (effect: AnimationEffect) =>
  ANIMATION_EFFECTS.find((entry) => entry.id === effect)?.label ?? effect;

/** Looping mini preview — the anim-preview-* keyframes in globals.css carry
 *  their own hold + settle-back so the loop reads as a demo. */
function EffectPreview({ effect }: { effect: AnimationEffect }) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="absolute inset-0 m-auto h-3 w-8 rounded-full bg-[var(--accent)]/70"
        style={{ animation: `anim-preview-${effect} 1.8s ease-out infinite` }}
      />
    </div>
  );
}

function NonePreview() {
  return (
    <div className="relative h-full w-full">
      <Ban size={14} className="absolute inset-0 m-auto text-[var(--text-muted)]" />
    </div>
  );
}

function EffectCard({
  active,
  title,
  onClick,
  preview,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  preview: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="group flex flex-col items-center gap-1.5 rounded-lg text-center transition-opacity"
    >
      <span
        className={cn(
          "flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-lg bg-[var(--bg-surface)] transition-colors",
          active
            ? "ring-2 ring-[var(--accent)]"
            : "ring-1 ring-[var(--border-strong)] group-hover:bg-[var(--accent-soft)] group-hover:ring-[var(--accent)]/50",
        )}
      >
        {preview}
      </span>
      <span
        className={cn(
          "truncate text-[11px]",
          active
            ? "font-medium text-[var(--accent-light)]"
            : "text-[var(--text-secondary)]",
        )}
      >
        {title}
      </span>
    </button>
  );
}

/** Per-step controls. Number fields keep a local draft and commit on blur —
 *  every patch lands in the surface's undo stack, so per-keystroke commits
 *  would flood it (same reasoning as the morph link editor). */
function StepControls({
  step,
  onCommit,
}: {
  step: AnimationStep;
  onCommit: (partial: Partial<AnimationStep>) => void;
}) {
  const [durationDraft, setDurationDraft] = useState(String(step.duration));
  const [delayDraft, setDelayDraft] = useState(String(step.delay));

  const commitDuration = () => {
    const n = Math.min(4000, Math.max(100, Math.round(Number(durationDraft) || 500)));
    setDurationDraft(String(n));
    if (n !== step.duration) onCommit({ duration: n });
  };
  const commitDelay = () => {
    const n = Math.min(10000, Math.max(0, Math.round(Number(delayDraft) || 0)));
    setDelayDraft(String(n));
    if (n !== step.delay) onCommit({ delay: n });
  };

  const inputClass =
    "h-8 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-2.5 text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]/60";
  const selectClass =
    "h-8 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]/60";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-primary)]">
          {effectLabel(step.effect)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          {animationEffectKind(step.effect)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Starts</span>
          <select
            className={selectClass}
            value={step.trigger}
            onChange={(e) =>
              onCommit({ trigger: e.target.value as AnimationTrigger })
            }
          >
            {TRIGGER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Easing</span>
          <select
            className={selectClass}
            value={step.easing}
            onChange={(e) =>
              onCommit({ easing: e.target.value as AnimationEasing })
            }
          >
            {EASING_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Duration (ms)</span>
          <input
            type="number"
            min={100}
            max={4000}
            step={50}
            className={inputClass}
            value={durationDraft}
            onChange={(e) => setDurationDraft(e.target.value)}
            onBlur={commitDuration}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Delay (ms)</span>
          <input
            type="number"
            min={0}
            max={10000}
            step={50}
            className={inputClass}
            value={delayDraft}
            onChange={(e) => setDelayDraft(e.target.value)}
            onBlur={commitDelay}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
      </div>
    </div>
  );
}

const rowId = (key: string, effect: AnimationEffect) => `${key}|${effect}`;

/** The preset patterns — one entrance effect each, applied to every
 *  meaningful element on the slide (replacing existing steps). */
const ANIMATE_ALL_PRESETS: {
  id: string;
  label: string;
  effect: AnimationEffect;
  duration: number;
}[] = [
  { id: "fade", label: "Fade", effect: "fade-in", duration: 500 },
  { id: "rise", label: "Rise", effect: "rise", duration: 550 },
  { id: "slide", label: "Slide", effect: "slide-in-up", duration: 550 },
  { id: "pop", label: "Pop", effect: "pop", duration: 450 },
];

const TRIGGER_BADGE: Record<AnimationTrigger, string> = {
  "on-click": "bg-[var(--accent-soft)] text-[var(--accent-light)]",
  "with-previous": "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
  "after-previous": "bg-[var(--bg-elevated)] text-[var(--text-muted)]",
};

const TRIGGER_SHORT: Record<AnimationTrigger, string> = {
  "on-click": "click",
  "with-previous": "with",
  "after-previous": "after",
};

function BuildRow({
  index,
  entry,
  selected,
  onSelect,
}: {
  index: number;
  entry: ReturnType<typeof collectSlideAnimationSteps>[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: rowId(entry.key, entry.step.effect) });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 transition-colors",
        selected
          ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/50"
          : "ring-1 ring-transparent hover:bg-[var(--bg-elevated)]",
        isDragging && "z-50 opacity-60",
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={onSelect}
    >
      <button
        className="cursor-grab touch-none p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
      >
        <GripVertical size={13} />
      </button>
      <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-muted)]">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-[var(--text-primary)]">
          {entry.elementName}
        </div>
        <div className="truncate text-[10px] text-[var(--text-muted)]">
          {effectLabel(entry.step.effect)}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] leading-none",
          TRIGGER_BADGE[entry.step.trigger],
        )}
        title={TRIGGER_OPTIONS.find((o) => o.id === entry.step.trigger)?.label}
      >
        {TRIGGER_SHORT[entry.step.trigger]}
      </span>
    </div>
  );
}

export default function AnimationPanel({
  elementSelection,
  activeUi,
  onCommitUi,
  onPreviewAnimation,
  previewActive,
}: {
  /** The canvas element currently selected — effect edits write through its
   *  patch so the surface keeps ownership of its ui draft. */
  elementSelection?: TemplateSelectionPayload | null;
  activeUi?: Record<string, unknown> | null;
  /** Slide-level commits (reorder, presets): a whole new ui, like the
   *  Background panel's onApply. This resets the canvas selection — acceptable
   *  for whole-slide actions. */
  onCommitUi: (ui: Record<string, unknown>) => void;
  /** Starts/stops the on-canvas preview run of the whole build. */
  onPreviewAnimation?: () => void;
  previewActive?: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const element = elementSelection?.element ?? null;
  const patch = elementSelection?.patch ?? null;
  const canEdit = Boolean(element && patch);
  const steps =
    element && patch ? parseElementAnimations(element.animations) ?? [] : [];
  const entries = collectSlideAnimationSteps(activeUi);
  const selectedKey = elementSelection?.selection
    ? keyForSelection(elementSelection.selection)
    : null;

  /** Setting/unsetting the step of one kind. A new kind appends to the end of
   *  the slide's build order; replacing keeps the existing step's slot and
   *  timing, only swapping the effect. */
  const setKindStep = (kind: AnimationKind, effect: AnimationEffect | null) => {
    if (!element || !patch) return;
    const current = parseElementAnimations(element.animations) ?? [];
    const existing = current.find(
      (step) => animationEffectKind(step.effect) === kind,
    );
    let next = current.filter(
      (step) => animationEffectKind(step.effect) !== kind,
    );
    if (effect) {
      next.push(existing ? { ...existing, effect } : (
        makeAnimationStep(
          effect,
          entries.reduce((max, entry) => Math.max(max, entry.step.order), 0) + 1,
        )
      ));
      next.sort((a, b) => a.order - b.order);
    }
    patch((el) => ({ ...el, animations: next.length > 0 ? next : undefined }));
  };

  const commitStep = (
    effect: AnimationEffect,
    partial: Partial<AnimationStep>,
  ) => {
    if (!patch) return;
    patch((el) => {
      const current = parseElementAnimations(el.animations) ?? [];
      const next = current.map((step) =>
        step.effect === effect ? { ...step, ...partial } : step,
      );
      return { ...el, animations: next.length > 0 ? next : undefined };
    });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !activeUi) return;
    const from = entries.findIndex(
      (entry) => rowId(entry.key, entry.step.effect) === String(active.id),
    );
    const insertAt = entries.findIndex(
      (entry) => rowId(entry.key, entry.step.effect) === String(over.id),
    );
    if (from < 0 || insertAt < 0) return;
    const next = [...entries];
    const [moved] = next.splice(from, 1);
    next.splice(insertAt, 0, moved);
    const updated = rewriteAnimationOrders(
      activeUi,
      next.map((entry) => ({ key: entry.key, effect: entry.step.effect })),
    );
    if (updated) onCommitUi(updated);
  };

  return (
    <div className="flex flex-col gap-3 pb-2">
      {canEdit ? (
        <>
          <PanelLabel>Selected element</PanelLabel>
          {ANIMATION_KIND_ORDER.map((kind) => {
            const activeEffect =
              steps.find((step) => animationEffectKind(step.effect) === kind)
                ?.effect ?? null;
            return (
              <div key={kind} className="flex flex-col gap-1.5">
                <span className="px-2.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  {kind}
                </span>
                <div className="grid grid-cols-3 gap-1.5 px-2.5">
                  <EffectCard
                    active={activeEffect === null}
                    title="None"
                    onClick={() => setKindStep(kind, null)}
                    preview={<NonePreview />}
                  />
                  {ANIMATION_EFFECTS.filter((effect) => effect.kind === kind).map(
                    (effect) => (
                      <EffectCard
                        key={effect.id}
                        active={activeEffect === effect.id}
                        title={effect.label}
                        onClick={() => setKindStep(kind, effect.id)}
                        preview={<EffectPreview effect={effect.id} />}
                      />
                    ),
                  )}
                </div>
              </div>
            );
          })}
          {steps.length > 0 && (
            <>
              <PanelLabel>Step timing</PanelLabel>
              {/* key resets the drafts when the canvas selection moves */}
              {steps.map((step) => (
                <StepControls
                  key={`${JSON.stringify(elementSelection?.selection ?? null)}:${step.effect}`}
                  step={step}
                  onCommit={(partial) => commitStep(step.effect, partial)}
                />
              ))}
            </>
          )}
        </>
      ) : (
        <div className="mx-2.5 mt-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Select an element on the canvas to give it an animation. The build
          order below applies to the whole slide.
        </div>
      )}

      <PanelLabel>Build order</PanelLabel>
      {entries.length === 0 ? (
        <p className="px-2.5 pb-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
          No animated elements on this slide yet.
        </p>
      ) : (
        <div className="px-2.5" data-inline-edit-ignore="true">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={entries.map((entry) => rowId(entry.key, entry.step.effect))}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-0.5">
                {entries.map((entry, index) => (
                  <BuildRow
                    key={rowId(entry.key, entry.step.effect)}
                    index={index}
                    entry={entry}
                    selected={entry.key === selectedKey}
                    onSelect={() =>
                      elementSelection?.selectElement?.(entry.selection)
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
      <PanelLabel>Animate all</PanelLabel>
      <div className="flex flex-col gap-1.5 px-2.5">
        <div className="grid grid-cols-4 gap-1.5">
          {ANIMATE_ALL_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => {
                const next = applyAnimateAllPreset(
                  activeUi,
                  preset.effect,
                  preset.duration,
                );
                if (next) onCommitUi(next);
              }}
              title={`One ${preset.label.toLowerCase()} entrance per element, in reading order (replaces existing steps)`}
              className="flex h-8 items-center justify-center rounded-lg text-[11px] ring-1 ring-[var(--border-strong)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent-light)] hover:ring-[var(--accent)]/50"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            const next = clearAllAnimations(activeUi);
            if (next) onCommitUi(next);
          }}
          disabled={entries.length === 0}
          className="flex h-8 items-center justify-center gap-1.5 rounded-lg text-[11px] text-[var(--text-secondary)] ring-1 ring-[var(--border-strong)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Ban size={12} />
          Clear all animations
        </button>
      </div>

      {onPreviewAnimation && (
        <div className="px-2.5">
          <button
            onClick={onPreviewAnimation}
            disabled={entries.length === 0 && !previewActive}
            className={cn(
              "flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-medium transition-colors",
              previewActive
                ? "bg-[var(--accent-soft)] text-[var(--accent-light)] ring-1 ring-[var(--accent)]/50"
                : "bg-[var(--accent)] text-white hover:opacity-90",
              entries.length === 0 &&
                !previewActive && "cursor-not-allowed opacity-40",
            )}
          >
            {previewActive ? <Square size={13} /> : <Play size={13} />}
            {previewActive ? "Stop preview" : "Play preview"}
          </button>
        </div>
      )}
    </div>
  );
}
