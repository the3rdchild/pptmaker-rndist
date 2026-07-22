"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/components/ui/sonner";
import { PopPanel, ToolButton } from "@/components/editor-react/ui";
import {
  applyTextTransformToSlides,
  buildFindRegex,
  countTransform,
  findMatchLocationsInSlides,
  replaceMatchAtLocation,
  replaceTransform,
  type FindMatchLocation,
} from "@/components/editor-react/find-replace";
import type { SlideData } from "@/store/presentationGeneration";

export interface FindReplacePanelProps {
  slides: SlideData[];
  onApplySlides: (slides: SlideData[]) => void;
  onNavigateToMatch: (match: FindMatchLocation) => void;
  onClose: () => void;
}

export default function FindReplacePanel({
  slides,
  onApplySlides,
  onNavigateToMatch,
  onClose,
}: FindReplacePanelProps) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const regex = useMemo(() => buildFindRegex(find, matchCase), [find, matchCase]);

  const matches = useMemo(() => {
    if (!regex) return [];
    return findMatchLocationsInSlides(slides, regex);
  }, [regex, slides]);

  const matchCount = useMemo(() => {
    if (!regex) return 0;
    return applyTextTransformToSlides(slides, countTransform(regex)).count;
  }, [regex, slides]);

  // Every time the match list changes (new search, or the deck changed
  // under us), snap the cursor back into range and jump the canvas to it.
  useEffect(() => {
    if (matches.length === 0) return;
    const clamped = Math.min(activeMatchIndex, matches.length - 1);
    if (clamped !== activeMatchIndex) {
      setActiveMatchIndex(clamped);
      return;
    }
    onNavigateToMatch(matches[clamped]);
    // Only re-run when the match list itself changes shape/identity or the
    // cursor moves — not on every onNavigateToMatch identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, activeMatchIndex]);

  const goToNext = () => {
    if (matches.length === 0) return;
    setActiveMatchIndex((i) => (i + 1) % matches.length);
  };
  const goToPrev = () => {
    if (matches.length === 0) return;
    setActiveMatchIndex((i) => (i - 1 + matches.length) % matches.length);
  };

  const handleReplaceAll = () => {
    if (!regex) return;
    const result = applyTextTransformToSlides(slides, replaceTransform(regex, replace));
    if (result.count === 0) {
      notify.warning("No matches", `"${find}" wasn't found in this deck.`);
      return;
    }
    onApplySlides(result.slides);
    notify.success("Replaced", `${result.count} occurrence${result.count === 1 ? "" : "s"} replaced.`);
  };

  const handleReplaceSelected = () => {
    if (!regex || matches.length === 0) return;
    const location = matches[Math.min(activeMatchIndex, matches.length - 1)];
    const result = replaceMatchAtLocation(slides, location, regex, replace);
    if (result.count === 0) return;
    onApplySlides(result.slides);
    notify.success("Replaced", `${result.count} occurrence${result.count === 1 ? "" : "s"} replaced on this element.`);
  };

  return (
    <PopPanel className="w-[300px] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-primary)]">Find & Replace</span>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="relative mb-2">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <input
          type="text"
          autoFocus
          value={find}
          onChange={(e) => {
            setFind(e.target.value);
            setActiveMatchIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.shiftKey ? goToPrev : goToNext)();
          }}
          placeholder="Find in deck…"
          className="h-9 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] pl-8 pr-16 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent)]/60"
        />
        {matches.length > 0 && (
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <button
              onClick={goToPrev}
              title="Previous match (Shift+Enter)"
              className="grid h-6 w-6 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <ChevronUp size={13} />
            </button>
            <button
              onClick={goToNext}
              title="Next match (Enter)"
              className="grid h-6 w-6 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <ChevronDown size={13} />
            </button>
          </div>
        )}
      </div>

      <input
        type="text"
        value={replace}
        onChange={(e) => setReplace(e.target.value)}
        placeholder="Replace with…"
        className="mb-2 h-9 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] px-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent)]/60"
      />

      <div className="mb-3 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => {
              setMatchCase(e.target.checked);
              setActiveMatchIndex(0);
            }}
            className="h-3 w-3 accent-[var(--accent)]"
          />
          Match case
        </label>
        <span
          className={cn(
            "text-[11px]",
            find && matchCount === 0 ? "text-[var(--text-muted)]" : "text-[var(--text-secondary)]"
          )}
        >
          {find
            ? matches.length > 0
              ? `${Math.min(activeMatchIndex, matches.length - 1) + 1} of ${matches.length} element${matches.length === 1 ? "" : "s"} (${matchCount} match${matchCount === 1 ? "" : "es"})`
              : `${matchCount} matches`
            : ""}
        </span>
      </div>

      <div className="flex gap-1.5">
        <ToolButton
          onClick={handleReplaceSelected}
          disabled={!find || matches.length === 0}
          className="h-8 flex-1"
        >
          Replace selected
        </ToolButton>
        <ToolButton
          variant="accent"
          onClick={handleReplaceAll}
          disabled={!find || matchCount === 0}
          className="h-8 flex-1"
        >
          Replace all
        </ToolButton>
      </div>
    </PopPanel>
  );
}
