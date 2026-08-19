"use client";

import { Ban } from "lucide-react";
import { PanelLabel } from "@/components/editor-react/ui";
import { cn } from "@/lib/utils";
import type { SlideTransition } from "@/store/presentationGeneration";

const OPTIONS: { id: SlideTransition; label: string }[] = [
  { id: "none", label: "None" },
  { id: "slide-right", label: "Slide Right" },
  { id: "slide-left", label: "Slide Left" },
  { id: "fade-white", label: "Fade White" },
  { id: "fade-black", label: "Fade Black" },
];

/** Looping CSS-only mini preview of what the transition looks like: a gray
 *  "old slide" sits still while a lighter "new slide" enters using the same
 *  keyframes Present Mode plays back (globals.css). */
function TransitionPreview({ id }: { id: SlideTransition }) {
  const box = "absolute inset-2 rounded-sm";
  if (id === "none") {
    return (
      <div className="relative h-full w-full">
        <div className={cn(box, "bg-[var(--bg-elevated)]")} />
        <Ban size={14} className="absolute inset-0 m-auto text-[var(--text-muted)]" />
      </div>
    );
  }
  if (id === "slide-right" || id === "slide-left") {
    return (
      <div className="relative h-full w-full overflow-hidden">
        <div className={cn(box, "bg-[var(--bg-elevated)]")} />
        <div
          className={cn(box, "bg-[var(--accent)]/60")}
          style={{
            animation: `${
              id === "slide-right"
                ? "slide-transition-right"
                : "slide-transition-left"
            } 1.6s ease-out infinite`,
          }}
        />
      </div>
    );
  }
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className={cn(box, "bg-[var(--accent)]/60")} />
      <div
        className={cn(box, id === "fade-white" ? "bg-white" : "bg-black")}
        style={{ animation: "slide-transition-fade-cover 1.6s ease-out infinite" }}
      />
    </div>
  );
}

export default function TransitionPanel({
  value,
  onSelect,
}: {
  value: SlideTransition;
  onSelect: (transition: SlideTransition) => void;
}) {
  return (
    <div className="pb-2">
      <PanelLabel>Apply to selected slide</PanelLabel>
      <div className="grid grid-cols-2 gap-2 px-2.5 pb-2">
        {OPTIONS.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              onClick={() => onSelect(option.id)}
              title={option.label}
              className="group flex flex-col items-center gap-1.5 rounded-lg text-center transition-opacity"
            >
              <span
                className={cn(
                  "flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors",
                  active
                    ? "ring-2 ring-[var(--accent)]"
                    : "ring-1 ring-[var(--border-strong)] group-hover:bg-[var(--accent-soft)] group-hover:text-[var(--accent-light)] group-hover:ring-[var(--accent)]/50",
                )}
              >
                <TransitionPreview id={option.id} />
              </span>
              <span
                className={cn(
                  "truncate text-[11px]",
                  active
                    ? "font-medium text-[var(--accent-light)]"
                    : "text-[var(--text-secondary)]",
                )}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
