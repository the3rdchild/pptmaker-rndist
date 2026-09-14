"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { loadHtmlThemeRegistry } from "@/lib/html-themes/client";
import type { HtmlThemeRegistry } from "@/lib/html-themes/types";
import { HtmlThemeThumbnail } from "./html-theme-thumbnail";

export function resolveOutlineHtmlTheme(requestedId: string | null, registry: HtmlThemeRegistry) {
  if (!registry.themes.length) return null;
  return registry.themes.some((theme) => theme.id === requestedId) ? requestedId : registry.defaultThemeId;
}

export function HtmlThemePicker({ requestedId, value, onChange }: { requestedId: string | null; value: string | null; onChange: (id: string | null) => void }) {
  const [registry, setRegistry] = useState<HtmlThemeRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadHtmlThemeRegistry().then(setRegistry).catch((e) => setError(e instanceof Error ? e.message : "Could not load HTML themes")); }, []);
  useEffect(() => { if (registry) onChange(resolveOutlineHtmlTheme(requestedId, registry)); }, [registry, requestedId, onChange]);
  if (error) return <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">{error}</p>;
  if (!registry) return <div className="flex gap-2 text-xs text-[var(--text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" />Memuat HTML theme…</div>;
  if (!registry.themes.length) return <p className="rounded-lg border border-[var(--border)] p-2 text-[11px] text-[var(--text-muted)]">Belum ada HTML theme. <Link href="/template-list?kind=html" className="text-[var(--accent-light)] underline">Buka library</Link>.</p>;
  return <div className="grid grid-cols-2 gap-2.5">{registry.themes.map((theme) => <button key={theme.id} onClick={() => onChange(theme.id)} className={`group overflow-hidden rounded-lg border text-left ${value === theme.id ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"}`}>
    <div className="relative aspect-video overflow-hidden"><HtmlThemeThumbnail theme={theme} />{value === theme.id && <span className="absolute right-1 top-1 rounded-full bg-[var(--accent)] p-0.5"><Check className="h-3 w-3 text-white" /></span>}</div>
    <div className="truncate px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">{theme.name}</div>
  </button>)}</div>;
}
