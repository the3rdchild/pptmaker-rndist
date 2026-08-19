"use client";

// Deck-wide generation/review progress: a strip under the editor header plus
// an expandable per-slide activity log.
//
// Why deck-wide and not per-slide: generation and review run PIPELINED — the
// canvas follows the slide currently streaming while the reviewer works its
// way through earlier ones. Any indicator keyed to "the slide you're looking
// at" is therefore blank almost the whole time, which is exactly how the
// previous header pill failed. Progress belongs to the deck; per-slide state
// belongs on the filmstrip thumbnails (see slide-sidebar) and in the log here.

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Loader2,
  Type as TypeIcon,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type ReviewFixKind = "text" | "image" | "resize";

/** One reviewer finding plus what the pipeline actually did about it — the
 *  raw material for the log. `action` is null when the issue was flagged but
 *  nothing could be applied (e.g. the photo slot no longer matched). */
export interface SlideReviewIssue {
  slot: string;
  problem: string;
  kind: ReviewFixKind;
  action: string | null;
}

export type SlidePhase = "building" | "reviewing" | "done";

export interface SlideProgress {
  phase: SlidePhase;
  issues: SlideReviewIssue[];
}

interface GenerationProgressProps {
  /** Current deck-level phase label ("Building slide 6…"). */
  stage: string | null;
  /** Per-slide state, keyed by slide index. */
  slides: Record<number, SlideProgress>;
  /** Slides the outline asked for, when known — null when generating straight
   *  from a free-text prompt, which makes the bar indeterminate. */
  expected: number | null;
  /** Slides actually mounted so far. */
  built: number;
  onSelectSlide: (index: number) => void;
}

const KIND_ICON = {
  text: TypeIcon,
  image: ImageIcon,
  resize: TypeIcon,
} as const;

export default function GenerationProgress({
  stage,
  slides,
  expected,
  built,
  onSelectSlide,
}: GenerationProgressProps) {
  const [open, setOpen] = useState(false);

  const entries = Object.values(slides);
  const done = entries.filter((s) => s.phase === "done").length;
  // A slide only counts as finished once it has streamed AND passed review, so
  // the bar can't sit at 100% while reviews are still in flight.
  const total = Math.max(expected ?? 0, built, done);
  const determinate = total > 0;
  const pct = determinate ? Math.round((done / total) * 100) : 0;
  const rowCount = Math.max(total, built);

  return (
    <div className="relative shrink-0 border-b border-[var(--border)] bg-[var(--bg-panel)]">
      <div className="flex items-center gap-2 px-4 py-1.5">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent-light)]" />
        <span className="truncate text-xs text-[var(--text-secondary)]">
          {stage ?? "Preparing your presentation…"}
        </span>
        <div className="flex-1" />
        {determinate && (
          <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-muted)]">
            {done} / {total}
          </span>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          title={open ? "Hide review details" : "Show review details"}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          Details
          {open ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </div>
      <div className="h-[3px] w-full overflow-hidden bg-[var(--bg-surface)]">
        <div
          className={cn(
            "h-full bg-[var(--accent)]",
            determinate
              ? "transition-[width] duration-500 ease-out"
              : "w-1/3 animate-[genprogress-slide_1.4s_ease-in-out_infinite]",
          )}
          style={determinate ? { width: `${pct}%` } : undefined}
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 max-h-[320px] overflow-y-auto border-b border-[var(--border)] bg-[var(--bg-panel)] shadow-[var(--shadow-panel)]">
          {rowCount === 0 ? (
            <p className="px-4 py-3 text-xs text-[var(--text-muted)]">
              Waiting for the first slide…
            </p>
          ) : (
            Array.from({ length: rowCount }, (_, index) => (
              <SlideRow
                key={index}
                index={index}
                progress={slides[index]}
                onSelect={onSelectSlide}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SlideRow({
  index,
  progress,
  onSelect,
}: {
  index: number;
  progress: SlideProgress | undefined;
  onSelect: (index: number) => void;
}) {
  const phase = progress?.phase;
  const issues = progress?.issues ?? [];

  return (
    <button
      onClick={() => onSelect(index)}
      className="flex w-full items-start gap-2.5 border-b border-[var(--border)] px-4 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--bg-elevated)]"
    >
      <span className="mt-0.5 shrink-0">
        {phase === "done" ? (
          issues.length > 0 ? (
            <TriangleAlert className="h-3.5 w-3.5 text-amber-400" />
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          )
        ) : phase ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-light)]" />
        ) : (
          <span className="block h-3.5 w-3.5 rounded-full border border-[var(--border-strong)]" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-[var(--text-primary)]">
          Slide {index + 1}
          {phase === "building"
            ? " — building"
            : phase === "reviewing"
              ? " — checking"
              : phase === "done"
                ? issues.length > 0
                  ? ` — fixed ${issues.length} ${issues.length === 1 ? "issue" : "issues"}`
                  : " — passed"
                : " — queued"}
        </span>
        {phase === "reviewing" && (
          <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
            Looking for overlapping text, text that doesn&apos;t fit, undersized
            text, and photos that don&apos;t match this slide
          </span>
        )}
        {phase === "done" && issues.length === 0 && (
          <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
            Layout, photo relevance and text fit all clear
          </span>
        )}
        {issues.map((issue, i) => {
          const Icon = KIND_ICON[issue.kind];
          return (
            <span
              key={i}
              className="mt-1 flex items-start gap-1.5 text-[11px] text-[var(--text-muted)]"
            >
              <Icon className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              <span className="min-w-0">
                {issue.problem}
                {issue.action && (
                  <span className="text-[var(--text-secondary)]">
                    {" → "}
                    {issue.action}
                  </span>
                )}
              </span>
            </span>
          );
        })}
      </span>
    </button>
  );
}
