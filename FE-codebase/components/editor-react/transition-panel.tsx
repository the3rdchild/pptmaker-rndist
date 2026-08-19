"use client";

import { useState } from "react";
import { Ban, Link2 } from "lucide-react";
import { PanelLabel } from "@/components/editor-react/ui";
import { cn } from "@/lib/utils";
import { collectMorphLinks } from "@/components/editor-react/morph";
import type { TemplateSelectionPayload } from "@/components/slide-editor/surface/TemplateV2KonvaSlide";
import type { SlideTransition } from "@/store/presentationGeneration";

const OPTIONS: { id: SlideTransition; label: string }[] = [
  { id: "none", label: "None" },
  { id: "slide-right", label: "Slide Right" },
  { id: "slide-left", label: "Slide Left" },
  { id: "fade-white", label: "Fade White" },
  { id: "fade-black", label: "Fade Black" },
  { id: "morph", label: "Morph" },
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
  if (id === "morph") {
    return (
      <div className="relative h-full w-full overflow-hidden">
        <div className={cn(box, "bg-[var(--bg-elevated)]")} />
        <div className="slide-transition-morph-chip absolute left-[10%] top-1/2 h-5 w-5 -translate-y-1/2 rounded-md bg-[var(--accent)]/70" />
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

/** "Link name" editor for the morph transition: two elements carrying the
 *  same morph_id are treated as the same element even when the id/name
 *  heuristic can't pair them. Commits on blur/Enter — patching per keystroke
 *  would spam the undo stack. */
function MorphLinkEditor({
  elementSelection,
  activeUi,
}: {
  elementSelection: TemplateSelectionPayload | null | undefined;
  activeUi: Record<string, unknown> | null;
}) {
  const morphId =
    typeof elementSelection?.element?.morph_id === "string"
      ? elementSelection.element.morph_id
      : "";
  const [draft, setDraft] = useState(morphId);
  const patch = elementSelection?.patch ?? null;
  const links = collectMorphLinks(activeUi);

  const commit = (value: string) => {
    if (!patch) return;
    const link = value.trim();
    if (link === morphId) return;
    patch((el) => ({ ...el, morph_id: link || undefined }));
  };

  if (!elementSelection?.element || !patch) {
    return (
      <p className="px-2.5 pb-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Morph matches elements across slides by id/name automatically. To pair
        two elements it can&apos;t detect, select an element on the canvas and
        give it a link name here — then give its counterpart on the other
        slide the same name.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-2.5 pb-3">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        placeholder="Link name (e.g. hero-image)"
        className="h-8 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-2.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent)]/60"
      />
      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
        Give the same link name to the matching element on the previous/next
        slide.
      </p>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.map((link) => (
            <button
              key={link}
              onClick={() => {
                setDraft(link);
                commit(link);
              }}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ring-1 transition-colors",
                link === morphId
                  ? "bg-[var(--accent-soft)] text-[var(--accent-light)] ring-[var(--accent)]/50"
                  : "text-[var(--text-secondary)] ring-[var(--border-strong)] hover:bg-[var(--bg-elevated)]",
              )}
            >
              <Link2 size={10} />
              {link}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TransitionPanel({
  value,
  onSelect,
  elementSelection,
  activeUi,
}: {
  value: SlideTransition;
  onSelect: (transition: SlideTransition) => void;
  /** The canvas element currently selected (for the morph link editor). */
  elementSelection?: TemplateSelectionPayload | null;
  activeUi?: Record<string, unknown> | null;
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
      {value === "morph" && (
        <>
          <PanelLabel>Morph links</PanelLabel>
          {/* key resets the draft input when the canvas selection moves to
              another element. */}
          <MorphLinkEditor
            key={JSON.stringify(elementSelection?.selection ?? null)}
            elementSelection={elementSelection}
            activeUi={activeUi ?? null}
          />
        </>
      )}
    </div>
  );
}
