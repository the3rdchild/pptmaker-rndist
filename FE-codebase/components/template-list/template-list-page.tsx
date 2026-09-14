"use client";

// Browse view for the template library.
//
// The template engine could only ever be entered blank, so a pack that had
// already been authored was hard to get back to: you had to know its id and
// re-add its layouts one at a time. This lists every theme on disk and opens
// the whole thing — all of its layouts as pages — in one click.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Layers, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { LazyLayoutThumbnail } from "@/components/editor-react/lazy-layout-thumbnail";
import {
  invalidateThemeCache,
  loadAllThemes,
  type TemplateTheme,
} from "@/lib/templates/themes";
import { invalidateHtmlThemeCache, loadHtmlThemeRegistry, removeHtmlTheme } from "@/lib/html-themes/client";
import type { HtmlThemeRegistry, HtmlThemeSummary } from "@/lib/html-themes/types";
import { HtmlThemeThumbnail } from "@/components/html-theme/html-theme-thumbnail";
import { templateListKind } from "@/components/template-list/template-list-mode";

/** One preview per theme, and no more.
 *
 *  A preview is not an image: LazyLayoutThumbnail mounts a real 1280x720 Konva
 *  stage and scales it down with CSS, so a strip of small extra previews costs
 *  exactly as much as a full-size one each. A first cut of this page showed a
 *  cover plus three more per card and killed the renderer outright. The cover
 *  is enough to recognise a pack by; the page count says the rest. */
const PREVIEW_WIDTH = 560;

export function TemplateListPage() {
  const searchParams = useSearchParams();
  return templateListKind(searchParams.get("kind")) === "html"
    ? <HtmlThemeListPage />
    : <ManualThemeListPage />;
}

/** Both tabs are separate components so switching the URL never changes the
 * parent component's hook sequence. */
function ManualThemeListPage() {
  const router = useRouter();
  const [themes, setThemes] = useState<TemplateTheme[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await loadAllThemes();
        if (!cancelled) setThemes(all);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load templates");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openTheme = (themeId: string) => {
    router.push(`/template-engine?theme=${encodeURIComponent(themeId)}`);
  };

  /** Mirrors the server: deleteTheme() itself refuses the last theme, but
   *  disabling the button ahead of time means the author sees why instead of
   *  arming a confirm that can only ever fail. */
  const canDeleteThemes = (themes?.length ?? 0) > 1;

  const handleDeleteTheme = async (themeId: string) => {
    const res = await fetch(
      `/api/template-engine/themes?themeId=${encodeURIComponent(themeId)}`,
      { method: "DELETE" },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? "Delete failed");
    invalidateThemeCache();
    setThemes(await loadAllThemes());
  };

  /** Renames the theme's display name only — same PATCH the engine's own
   *  rename field uses. The folder id is untouched, since layout asset paths
   *  and a saved deck's theme tag are keyed on it. */
  const handleRenameTheme = async (themeId: string, name: string) => {
    const res = await fetch("/api/template-engine/themes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId, patch: { name } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? "Rename failed");
    invalidateThemeCache();
    setThemes(await loadAllThemes());
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-8 py-10">
        <LibraryTabs active="manual" />
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Template</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {themes === null
                ? "Memuat…"
                : `${themes.length} theme · ${themes.reduce((total, theme) => total + theme.layouts.length, 0)} layout`}
              . Buka satu theme untuk mengedit seluruh page-nya.
            </p>
          </div>
          <Link
            href="/template-engine"
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#6c5ce7] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Theme baru
          </Link>
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {themes === null && !error && (
          <div className="flex items-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat template…
          </div>
        )}

        {themes !== null && themes.length === 0 && (
          <p className="py-16 text-center text-sm text-zinc-500">
            Belum ada theme tersimpan.
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {(themes ?? []).map((theme, index) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              eager={index < 2}
              canDelete={canDeleteThemes}
              onOpen={() => openTheme(theme.id)}
              onDelete={() => handleDeleteTheme(theme.id)}
              onRename={(name) => handleRenameTheme(theme.id, name)}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function LibraryTabs({ active }: { active: "manual" | "html" }) {
  return <div className="mb-6 flex w-fit rounded-lg border border-[#2d2e42] bg-[#13131f] p-1 text-xs">
    <Link href="/template-list" className={`rounded-md px-3 py-1.5 ${active === "manual" ? "bg-[#6c5ce7] text-white" : "text-zinc-400 hover:text-zinc-100"}`}>Manual templates</Link>
    <Link href="/template-list?kind=html" className={`rounded-md px-3 py-1.5 ${active === "html" ? "bg-[#6c5ce7] text-white" : "text-zinc-400 hover:text-zinc-100"}`}>HTML themes</Link>
  </div>;
}

function HtmlThemeListPage() {
  const router = useRouter();
  const [registry, setRegistry] = useState<HtmlThemeRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => { invalidateHtmlThemeCache(); setRegistry(await loadHtmlThemeRegistry()); };
  useEffect(() => { refresh().catch((e) => setError(e instanceof Error ? e.message : "Could not load HTML themes")); }, []);
  const seed = async () => {
    setError(null);
    const response = await fetch("/api/html-themes/seed", { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body?.error ?? "Could not seed starter themes"); return; }
    invalidateHtmlThemeCache(); setRegistry(body);
  };
  const remove = async (theme: HtmlThemeSummary) => {
    if (!window.confirm(`Delete HTML theme "${theme.name}"?`)) return;
    try { setRegistry(await removeHtmlTheme(theme.id)); } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  };
  return <AppShell><div className="mx-auto max-w-6xl px-8 py-10">
    <LibraryTabs active="html" />
    <div className="mb-6 flex items-end justify-between gap-4"><div><h1 className="text-2xl font-bold text-white">HTML themes</h1><p className="mt-1 text-sm text-zinc-400">{registry ? `${registry.themes.length} theme · aturan visual + layout recipe untuk AI.` : "Memuat…"}</p></div><Link href="/html-theme-engine" className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#6c5ce7] px-3 py-2 text-xs font-medium text-white"><Plus className="h-4 w-4" />HTML theme baru</Link></div>
    {error && <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
    {!registry && !error && <div className="flex gap-2 py-16 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Memuat HTML themes…</div>}
    {registry?.themes.length === 0 && <div className="py-16 text-center"><p className="text-sm text-zinc-500">Belum ada HTML theme tersimpan.</p><button onClick={() => void seed()} className="mt-3 rounded-lg bg-[#6c5ce7] px-3 py-2 text-xs font-medium text-white">Seed starter HTML themes</button></div>}
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">{registry?.themes.map((theme) => <div key={theme.id} className="overflow-hidden rounded-xl border border-[#2d2e42] bg-[#13131f]"><button onClick={() => router.push(`/html-theme-engine?theme=${encodeURIComponent(theme.id)}`)} className="block w-full text-left"><div className="aspect-video"><HtmlThemeThumbnail theme={theme} /></div><div className="p-4"><div className="flex items-center gap-2 text-sm font-semibold text-white">{theme.name}{theme.isDefault && <span className="rounded bg-[#6c5ce7]/20 px-1.5 py-0.5 text-[10px] text-[#c4b5fd]">Default</span>}</div><p className="mt-1 line-clamp-2 text-xs text-zinc-500">{theme.description || "Tanpa deskripsi."}</p><p className="mt-2 text-[11px] text-zinc-500">{theme.recipeCount} layout recipe</p></div></button><div className="border-t border-[#2d2e42] p-2 text-right">{registry.themes.length > 1 && <button onClick={() => void remove(theme)} className="rounded px-2 py-1 text-xs text-red-300 hover:bg-red-500/10">Delete</button>}</div></div>)}</div>
  </div></AppShell>;
}

/** A preview is sized in pixels, not by CSS — it is a fixed 1280x720 stage
 *  scaled by a factor the caller has to compute — so the card has to tell it
 *  how wide it actually ended up. */
function useMeasuredWidth(fallback: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Measured directly rather than only through the observer: a
    // ResizeObserver reports on paint, and there are contexts (a background
    // tab, a pane that is not compositing) where that first callback never
    // arrives and the preview would sit at the fallback width forever.
    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

/** Which overlay panel sits on top of the preview — at most one at a time,
 *  since rename and delete each take over the same corner of the card. */
type CardMode = "idle" | "rename" | "delete";

function ThemeCard({
  theme,
  eager,
  canDelete,
  onOpen,
  onDelete,
  onRename,
}: {
  theme: TemplateTheme;
  eager: boolean;
  /** False when this is the only theme left — deleteTheme() refuses that
   *  server-side too, but disabling ahead of time tells the author why
   *  instead of arming a confirm that can only fail. */
  canDelete: boolean;
  onOpen: () => void;
  onDelete: () => Promise<void>;
  onRename: (name: string) => Promise<void>;
}) {
  const cover = theme.layouts[0];
  const [previewRef, previewWidth] = useMeasuredWidth(PREVIEW_WIDTH);
  const [mode, setMode] = useState<CardMode>("idle");
  const [name, setName] = useState(theme.name);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Resyncs the rename field if the name changes from elsewhere (the engine's
  // own rename field, another tab) while this card isn't the one editing it.
  useEffect(() => {
    if (mode !== "rename") setName(theme.name);
  }, [mode, theme.name]);

  const closeOverlay = () => {
    setMode("idle");
    setFormError(null);
    setName(theme.name);
  };

  const handleRenameSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === theme.name) {
      closeOverlay();
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await onRename(trimmed);
      setMode("idle");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSubmit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await onDelete();
      // No further state to reset on success — the card unmounts with the
      // theme it belonged to.
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Delete failed");
      setBusy(false);
    }
  };

  return (
    // Not a <button>: it holds the open control, the rename/delete controls,
    // and (while either is active) a strip of its own controls, and buttons
    // cannot nest.
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-[#2d2e42] bg-[#13131f] transition-colors hover:border-[#6c5ce7]">
      <button
        onClick={onOpen}
        disabled={mode !== "idle"}
        className="flex flex-col text-left disabled:pointer-events-none"
      >
        <div
          ref={previewRef}
          className="flex aspect-video w-full items-center justify-center overflow-hidden bg-[#1a1b2e]"
        >
          {cover ? (
            <LazyLayoutThumbnail
              layout={cover as Record<string, unknown>}
              width={previewWidth}
              eager={eager}
            />
          ) : (
            <span className="text-xs text-zinc-600">Belum ada layout</span>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[#1e1e30] p-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">
              {theme.name}
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">
              {theme.description || "Tanpa deskripsi."}
            </p>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {theme.layouts.length} page
              </span>
              <span className="font-mono text-zinc-600">{theme.id}</span>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-[#a29bfe]" />
        </div>
      </button>

      {mode === "idle" && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            onClick={() => setMode("rename")}
            title={`Rename ${theme.name}`}
            className="rounded-md bg-black/60 p-1.5 text-zinc-300 backdrop-blur hover:bg-[#6c5ce7]/80 hover:text-white"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {canDelete && (
            <button
              onClick={() => setMode("delete")}
              title={`Delete ${theme.name}`}
              className="rounded-md bg-black/60 p-1.5 text-zinc-300 backdrop-blur hover:bg-red-500/80 hover:text-white"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {mode === "rename" && (
        <div className="absolute inset-x-2 top-2 rounded-md border border-[#2d2e42] bg-[#13131f] p-2 shadow-xl">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleRenameSubmit();
              if (event.key === "Escape") closeOverlay();
            }}
            className="w-full rounded-md border border-[#2d2e42] bg-[#1a1b2e] px-2 py-1.5 text-xs text-white outline-none focus:border-[#6c5ce7]"
          />
          {formError && (
            <p className="mt-1 text-[11px] text-red-300">{formError}</p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              disabled={busy}
              onClick={handleRenameSubmit}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[#6c5ce7] px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </button>
            <button
              disabled={busy}
              onClick={closeOverlay}
              className="rounded-md border border-[#2d2e42] px-2 py-1.5 text-[11px] text-zinc-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "delete" && (
        <div className="absolute inset-x-2 top-2 rounded-md border border-red-500/30 bg-[#13131f] p-2 shadow-xl">
          <p className="text-[11px] leading-snug text-red-300">
            Delete &quot;{theme.name}&quot; and all {theme.layouts.length} of its
            layouts? This removes the folder from disk and cannot be undone.
          </p>
          {formError && (
            <p className="mt-1 text-[11px] text-red-300">{formError}</p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              disabled={busy}
              onClick={handleDeleteSubmit}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-500/80 px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Delete
            </button>
            <button
              disabled={busy}
              onClick={closeOverlay}
              className="rounded-md border border-[#2d2e42] px-2 py-1.5 text-[11px] text-zinc-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
