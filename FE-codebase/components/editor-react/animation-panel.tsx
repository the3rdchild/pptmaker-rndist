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
import {
  Ban,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Play,
  Repeat,
  Square,
  Timer,
} from "lucide-react";
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
  applyTimingToAll,
  clearAllAnimations,
  collectSlideAnimationSteps,
  rewriteAnimationOrders,
  type AnimateAllTiming,
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

  // No card chrome: this sits flush in the pinned footer the way the timing
  // row sits in the pinned header. Several steps on one element are separated
  // by the parent's divider instead of by a box each.
  return (
    <div className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
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
      {animationEffectKind(step.effect) === "emphasis" && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={step.loop === true}
            onChange={(e) => onCommit({ loop: e.target.checked || undefined })}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
          />
          <span className="text-[10px] leading-relaxed text-[var(--text-muted)]">
            <span className="text-[var(--text-secondary)]">Loop</span> — keep
            beating until the slide is left. The build still moves on after the
            first pass, so anything set to follow this step still runs.
          </span>
        </label>
      )}
    </div>
  );
}

const rowId = (key: string, effect: AnimationEffect) => `${key}|${effect}`;

/** Label row of a pinned strip, doubling as its collapse control — the strips
 *  are the only thing between the scrolling middle and the panel edges, so
 *  folding one away is how you get the room back without unpinning it. */
function StripHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
      className="flex w-full items-center justify-between rounded text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
    >
      {label}
      {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
    </button>
  );
}

type PanelView = "effects" | "build";

/** The preset patterns — one entrance effect each, applied to every
 *  meaningful element on the slide (replacing existing steps). Pacing comes
 *  from the timing row next to them, not from the pattern. */
const ANIMATE_ALL_PRESETS: {
  id: string;
  label: string;
  effect: AnimationEffect;
}[] = [
  { id: "fade", label: "Fade", effect: "fade-in" },
  { id: "rise", label: "Rise", effect: "rise" },
  { id: "slide", label: "Slide", effect: "slide-in-up" },
  { id: "pop", label: "Pop", effect: "pop" },
];

const DEFAULT_ANIMATE_ALL_TIMING: AnimateAllTiming = {
  trigger: "after-previous",
  duration: 500,
  delay: 0,
  easing: "ease-out",
};

/** Timing shared by every step an "Animate all" pass writes, and by the
 *  "apply to all" button that retimes what is already there. Numbers commit
 *  on blur like the per-step fields — but these only ever produce ONE ui
 *  commit when a button is pressed, so the draft state stays local. */
function AnimateAllTimingRow({
  timing,
  onChange,
}: {
  timing: AnimateAllTiming;
  onChange: (next: AnimateAllTiming) => void;
}) {
  const [durationDraft, setDurationDraft] = useState(String(timing.duration));
  const [delayDraft, setDelayDraft] = useState(String(timing.delay));

  const fieldClass =
    "h-8 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]/60";

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-[var(--text-muted)]">Starts</span>
        <select
          className={fieldClass}
          value={timing.trigger}
          onChange={(e) =>
            onChange({ ...timing, trigger: e.target.value as AnimationTrigger })
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
          className={fieldClass}
          value={timing.easing}
          onChange={(e) =>
            onChange({ ...timing, easing: e.target.value as AnimationEasing })
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
          className={fieldClass}
          value={durationDraft}
          onChange={(e) => setDurationDraft(e.target.value)}
          onBlur={() => {
            const n = Math.min(
              4000,
              Math.max(100, Math.round(Number(durationDraft) || 500)),
            );
            setDurationDraft(String(n));
            onChange({ ...timing, duration: n });
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
          className={fieldClass}
          value={delayDraft}
          onChange={(e) => setDelayDraft(e.target.value)}
          onBlur={() => {
            const n = Math.min(
              10000,
              Math.max(0, Math.round(Number(delayDraft) || 0)),
            );
            setDelayDraft(String(n));
            onChange({ ...timing, delay: n });
          }}
        />
      </label>
    </div>
  );
}

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
      {/* Mirrors the two lines on the left: how long it runs over how long it
          waits first. A looping step gets the repeat mark, or its duration
          reads as the whole story when it is really one iteration of many. */}
      <div className="shrink-0 text-right tabular-nums">
        <div className="flex items-center justify-end gap-1 text-[10px] text-[var(--text-secondary)]">
          {entry.step.loop && <Repeat size={9} />}
          {entry.step.duration}ms
        </div>
        <div
          className={cn(
            "text-[10px]",
            entry.step.delay > 0
              ? "text-[var(--text-muted)]"
              : "text-[var(--text-muted)]/40",
          )}
        >
          +{entry.step.delay}ms
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
  const [animateAllTiming, setAnimateAllTiming] = useState<AnimateAllTiming>(
    DEFAULT_ANIMATE_ALL_TIMING,
  );
  const [view, setView] = useState<PanelView>("effects");
  const [headerOpen, setHeaderOpen] = useState(true);
  const [footerOpen, setFooterOpen] = useState(true);

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

  // Pinned to the flyout's scroll container (insert-toolbar's overflow-y-auto
  // body), not to the panel: the whole-slide actions stay reachable at the top
  // and the selected step's timing at the bottom while the long middle — three
  // grids of effect cards plus the build list — scrolls between them. Two
  // stickies at opposite edges rather than stacked at the top, so neither has
  // to know how tall the other one happens to be.
  // Three surfaces that all have to differ from each OTHER and from the effect
  // cards scrolling between them: the strips are --bg-panel, the well is
  // --bg-canvas (darkest), and the cards keep their --bg-surface. Putting the
  // strips on --bg-surface too is what made a card vanish into the chrome the
  // moment it scrolled under one. The shadows do the rest of that work —
  // colour alone is a weak edge, a card sliding UNDER something should look
  // like it. min-h-full + flex-1 on the middle so its tone still reaches the
  // footer when a slide has almost nothing on it.
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20 flex flex-col gap-1.5 border-b border-[var(--border)] bg-[var(--bg-panel)] px-2.5 pb-2.5 pt-2.5 shadow-[0_3px_10px_rgba(0,0,0,0.45)]">
        {onPreviewAnimation && (
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
        )}
        <div className="pt-0.5">
          <StripHeader
            label="Animate all"
            open={headerOpen}
            onToggle={() => setHeaderOpen((open) => !open)}
          />
        </div>
        {headerOpen && (
          <>
        <AnimateAllTimingRow timing={animateAllTiming} onChange={setAnimateAllTiming} />
        <div className="grid grid-cols-4 gap-1.5">
          {ANIMATE_ALL_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => {
                const next = applyAnimateAllPreset(
                  activeUi,
                  preset.effect,
                  animateAllTiming,
                );
                if (next) onCommitUi(next);
              }}
              title={`One ${preset.label.toLowerCase()} entrance per element, in reading order, at the timing above (replaces existing steps)`}
              className="flex h-8 items-center justify-center rounded-lg text-[11px] ring-1 ring-[var(--border-strong)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent-light)] hover:ring-[var(--accent)]/50"
            >
              {preset.label}
            </button>
          ))}
        </div>
        {/* Side by side: the header is pinned, so every row it keeps costs the
            scrolling area below it. */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => {
              const next = applyTimingToAll(activeUi, animateAllTiming);
              if (next) onCommitUi(next);
            }}
            disabled={entries.length === 0}
            title="Retime every step already on this slide, leaving the effects alone"
            className="flex h-8 items-center justify-center gap-1.5 rounded-lg text-[11px] text-[var(--text-secondary)] ring-1 ring-[var(--border-strong)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Timer size={12} />
            Apply timing to all
          </button>
          <button
            onClick={() => {
              const next = clearAllAnimations(activeUi);
              if (next) onCommitUi(next);
            }}
            disabled={entries.length === 0}
            className="flex h-8 items-center justify-center gap-1.5 rounded-lg text-[11px] text-[var(--text-secondary)] ring-1 ring-[var(--border-strong)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Ban size={12} />
            Clear all
          </button>
        </div>
          </>
        )}
        {/* Outside the collapsible block on purpose: folding the whole header
            away must not take the view switch with it. */}
        <div className="mt-0.5 grid grid-cols-2 gap-1 rounded-lg bg-[var(--bg-canvas)] p-0.5">
          {(
            [
              ["effects", "Effects"],
              ["build", `Build order${entries.length > 0 ? ` (${entries.length})` : ""}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={cn(
                "h-7 rounded-md text-[11px] font-medium transition-colors",
                view === id
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Two views, one scroll well. The effects half needs an element; the
          build half describes the whole slide and stands on its own. */}
      <div className="flex flex-1 flex-col gap-3 bg-[var(--bg-canvas)] pb-3">
      {view === "effects" ? (
        // ── Effects: pick one entrance / emphasis / exit for the selection ──
        canEdit ? (
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
        </>
      ) : (
        <div className="mx-2.5 mt-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Select an element on the canvas to give it an animation, or switch to
          Build order to see what the whole slide already does.
        </div>
        )
      ) : /* ── Build order: the slide's whole sequence, reorderable ── */
      entries.length === 0 ? (
        <p className="px-2.5 pt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          No animated elements on this slide yet. Pick an element and give it an
          effect, or use one of the Animate all presets above.
        </p>
      ) : (
        <div className="px-2.5 pt-3" data-inline-edit-ignore="true">
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
      </div>

      {/* Pinned to the bottom edge instead of stacked under the header: the
          block only exists while a step is selected, so its height changes as
          you work, and a second top sticky would have to be offset by whatever
          the header currently measures. Capped and scrollable for the rare
          element carrying all three kinds at once — capped in vh, not %,
          because the panel's own height is content-driven inside the scroll
          container and a percentage max-height would resolve to none. */}
      {canEdit && steps.length > 0 && (
        <div className="sticky bottom-0 z-20 max-h-[38vh] overflow-y-auto border-t border-[var(--border)] bg-[var(--bg-panel)] px-2.5 pb-2.5 pt-2 shadow-[0_-3px_10px_rgba(0,0,0,0.45)]">
          <StripHeader
            label="Step timing"
            open={footerOpen}
            onToggle={() => setFooterOpen((open) => !open)}
          />
          <div
            className={cn(
              "mt-1.5 flex-col divide-y divide-[var(--border)]",
              footerOpen ? "flex" : "hidden",
            )}
          >
            {/* key resets the drafts when the canvas selection moves */}
            {steps.map((step) => (
              <StepControls
                key={`${JSON.stringify(elementSelection?.selection ?? null)}:${step.effect}`}
                step={step}
                onCommit={(partial) => commitStep(step.effect, partial)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
