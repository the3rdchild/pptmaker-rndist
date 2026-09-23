"use client";

// The planned transition INTO an outline page: a chip on the collapsed card
// and an editor (type + "what carries across" note) inside the expanded one.
// Only shown when the homepage Transisi toggle is on.

import { Clapperboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRANSITION_IDS, type TransitionId } from "@/lib/outline-transition";

const LABELS: Record<TransitionId, string> = {
  morph: "Morph",
  "fade-black": "Fade Black",
  "fade-white": "Fade White",
  "slide-left": "Slide Left",
  "slide-right": "Slide Right",
  none: "None",
};

export function OutlineTransitionChip({ transition }: { transition?: TransitionId }) {
  if (!transition || transition === "none") return null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
        transition === "morph"
          ? "bg-[var(--accent)]/15 text-[var(--accent-light)] ring-[var(--accent)]/40"
          : "text-[var(--text-muted)] ring-[var(--border)]",
      )}
    >
      <Clapperboard className="h-2.5 w-2.5" />
      {LABELS[transition]}
    </span>
  );
}

export function OutlineTransitionField({
  isFirst,
  transition,
  note,
  disabled,
  onChange,
}: {
  /** Nothing comes before the first page, so it never gets a transition. */
  isFirst: boolean;
  transition?: TransitionId;
  note?: string;
  disabled: boolean;
  onChange: (patch: { transition?: TransitionId; transitionNote?: string }) => void;
}) {
  if (isFirst) {
    return (
      <p className="mb-3 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <Clapperboard className="h-3 w-3" /> Slide pertama — tanpa transisi masuk.
      </p>
    );
  }
  const value = transition ?? "none";
  return (
    <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-2 focus-within:border-[var(--accent)]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-light)]">
          <Clapperboard className="h-3 w-3" /> Transisi masuk
        </span>
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange({ transition: e.target.value as TransitionId })}
          className="rounded border border-[var(--border)] bg-[var(--bg-base)] px-1.5 py-0.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        >
          {TRANSITION_IDS.map((id) => (
            <option key={id} value={id}>{LABELS[id]}</option>
          ))}
        </select>
      </div>
      <textarea
        value={note ?? ""}
        disabled={disabled || value === "none"}
        onChange={(e) => onChange({ transitionNote: e.target.value })}
        placeholder={
          value === "morph"
            ? "Apa yang tetap dan bergerak dari slide sebelumnya, mis. judul cover mengecil ke pojok kiri atas"
            : "Catatan (opsional)"
        }
        rows={2}
        className="w-full resize-none bg-transparent text-sm text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-50"
      />
    </div>
  );
}
