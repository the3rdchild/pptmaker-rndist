"use client";

// Browse view for the template library.
//
// The template engine could only ever be entered blank, so a pack that had
// already been authored was hard to get back to: you had to know its id and
// re-add its layouts one at a time. This lists every theme on disk and opens
// the whole thing — all of its layouts as pages — in one click.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Layers, Loader2, Plus } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { LazyLayoutThumbnail } from "@/components/editor-react/lazy-layout-thumbnail";
import { loadAllThemes, type TemplateTheme } from "@/lib/templates/themes";

/** One preview per theme, and no more.
 *
 *  A preview is not an image: LazyLayoutThumbnail mounts a real 1280x720 Konva
 *  stage and scales it down with CSS, so a strip of small extra previews costs
 *  exactly as much as a full-size one each. A first cut of this page showed a
 *  cover plus three more per card and killed the renderer outright. The cover
 *  is enough to recognise a pack by; the page count says the rest. */
const PREVIEW_WIDTH = 560;

export function TemplateListPage() {
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

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-8 py-10">
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
            Belum ada theme di public/templates.
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {(themes ?? []).map((theme, index) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              eager={index < 2}
              onOpen={() => openTheme(theme.id)}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
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

function ThemeCard({
  theme,
  eager,
  onOpen,
}: {
  theme: TemplateTheme;
  eager: boolean;
  onOpen: () => void;
}) {
  const cover = theme.layouts[0];
  const [previewRef, previewWidth] = useMeasuredWidth(PREVIEW_WIDTH);

  return (
    <button
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-xl border border-[#2d2e42] bg-[#13131f] text-left transition-colors hover:border-[#6c5ce7]"
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
  );
}
