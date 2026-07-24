"use client";

import { useEffect, useState } from "react";
import { History, Loader2, RotateCcw, X } from "lucide-react";
import { PopPanel } from "@/components/editor-react/ui";
import { listDeckVersions, restoreDeckVersion, type DeckVersionRow } from "@/lib/api";
import { notify } from "@/components/ui/sonner";

export interface VersionHistoryPanelProps {
  token: string;
  deckId: string;
  onRestored: (payload: Record<string, unknown> | null) => void;
  onClose: () => void;
}

// Checkpoints are throttled server-side (~1 per 10min of active editing, see
// api/src/modules/deck-version/service.ts) — this list is short by design,
// not a full undo log, so no pagination/virtualization needed here.
export default function VersionHistoryPanel({
  token,
  deckId,
  onRestored,
  onClose,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<DeckVersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDeckVersions(token, deckId)
      .then((rows) => {
        if (!cancelled) setVersions(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load version history");
      });
    return () => {
      cancelled = true;
    };
  }, [token, deckId]);

  const handleRestore = async (version: DeckVersionRow) => {
    if (restoringId) return;
    const confirmed = window.confirm(
      `Restore the version from ${formatTimestamp(version.created_at)}? Your current state will be saved as a new version first, so nothing is lost.`,
    );
    if (!confirmed) return;

    setRestoringId(version.id);
    try {
      const restored = await restoreDeckVersion(token, deckId, version.id);
      onRestored(restored.payload as Record<string, unknown> | null);
      notify.success("Version restored", `Reverted to ${formatTimestamp(version.created_at)}.`);
      onClose();
    } catch (e) {
      notify.error("Restore failed", e instanceof Error ? e.message : "Could not restore this version.");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <PopPanel className="w-80 p-2">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
          <History className="h-3.5 w-3.5" />
          Version History
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {versions === null && !error && (
        <div className="flex items-center justify-center gap-1.5 py-6 text-xs text-[var(--text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      )}

      {error && <p className="px-1 py-3 text-xs text-red-400">⚠ {error}</p>}

      {versions !== null && versions.length === 0 && !error && (
        <p className="px-1 py-3 text-xs text-[var(--text-muted)]">
          No checkpoints yet — versions appear automatically as you keep editing.
        </p>
      )}

      {versions && versions.length > 0 && (
        <ul className="max-h-80 space-y-0.5 overflow-y-auto">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-elevated)]"
            >
              <span className="min-w-0 truncate text-xs text-[var(--text-secondary)]">
                {formatTimestamp(v.created_at)}
              </span>
              <button
                onClick={() => handleRestore(v)}
                disabled={restoringId !== null}
                title="Restore this version"
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-light)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                {restoringId === v.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </PopPanel>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
