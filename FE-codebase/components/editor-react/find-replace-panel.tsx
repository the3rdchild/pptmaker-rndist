"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/components/ui/sonner";
import { PopPanel, ToolButton } from "@/components/editor-react/ui";
import {
  applyTextTransformToSlides,
  buildFindRegex,
  countTransform,
  replaceTransform,
} from "@/components/editor-react/find-replace";
import type { SlideData } from "@/store/presentationGeneration";

export interface FindReplacePanelProps {
  slides: SlideData[];
  onReplaceAll: (slides: SlideData[]) => void;
  onClose: () => void;
}

export default function FindReplacePanel({
  slides,
  onReplaceAll,
  onClose,
}: FindReplacePanelProps) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);

  const matchCount = useMemo(() => {
    const regex = buildFindRegex(find, matchCase);
    if (!regex) return 0;
    return applyTextTransformToSlides(slides, countTransform(regex)).count;
  }, [find, matchCase, slides]);

  const handleReplaceAll = () => {
    const regex = buildFindRegex(find, matchCase);
    if (!regex) return;
    const result = applyTextTransformToSlides(slides, replaceTransform(regex, replace));
    if (result.count === 0) {
      notify.warning("No matches", `"${find}" wasn't found in this deck.`);
      return;
    }
    onReplaceAll(result.slides);
    notify.success("Replaced", `${result.count} occurrence${result.count === 1 ? "" : "s"} replaced.`);
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
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find in deck…"
          className="h-9 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-base)] pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent)]/60"
        />
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
            onChange={(e) => setMatchCase(e.target.checked)}
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
          {find ? `${matchCount} match${matchCount === 1 ? "" : "es"}` : ""}
        </span>
      </div>

      <ToolButton
        variant="accent"
        onClick={handleReplaceAll}
        disabled={!find || matchCount === 0}
        className="h-8 w-full"
      >
        Replace all
      </ToolButton>
    </PopPanel>
  );
}
