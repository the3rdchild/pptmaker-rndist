"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "@/store/editorStore";
import { setPresentationData } from "@/store/presentationGeneration";
import type { PresentationData } from "@/store/presentationGeneration";
import { useSessionStore } from "@/store/session.store";
import { getDeck, saveDeck } from "@/lib/api";
import { normalizeBackendAssetUrls } from "@/utils/api";
import { Toaster } from "@/components/ui/sonner";

// Konva is client-only — must not SSR.
const TemplateV2KonvaSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide
    ),
  { ssr: false }
);

type Layout = Record<string, unknown>;

// Load a layout from the local Presenton template pack as the starting slide.
async function loadDefaultLayout(): Promise<Layout> {
  const res = await fetch("/templates/general/template.json");
  const template = await res.json();
  const layouts = (template.layouts ?? []) as Layout[];
  return layouts[0] ?? {};
}

function adaptDeckToPresentation(
  deckId: string,
  payload: Record<string, unknown> | null
): PresentationData | null {
  if (!payload) return null;
  // The existing PPTist payload schema is {slides:[...]} but with a different
  // element model. For the vertical slice we only drive slides that already
  // carry a Presenton `ui` layout. If none do, return null so we fall back to
  // a default template layout.
  const rawSlides = Array.isArray(payload.slides) ? payload.slides : [];
  const slides = rawSlides
    .map((s) => {
      const rec = (s ?? {}) as Record<string, unknown>;
      const ui = rec.ui ?? null;
      return { ui: ui as Record<string, unknown> | null };
    })
    .filter((s) => s.ui);
  if (slides.length === 0) return null;
  return {
    id: deckId,
    title: (payload.title as string) ?? "Untitled",
    slides,
  };
}

export default function EditorReactClient({ deckId }: { deckId: string }) {
  const dispatch = useDispatch<AppDispatch>();
  const presentationData = useSelector(
    (s: RootState) => s.presentationGeneration.presentationData
  );
  const token = useSessionStore((s) => s.token);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialLayout, setInitialLayout] = useState<Layout | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load deck → init Redux presentationData (or fall back to default template).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) return;
      try {
        const deck = await getDeck(token, deckId);
        const adapted = adaptDeckToPresentation(
          deckId,
          deck.payload as Record<string, unknown> | null
        );
        if (cancelled) return;
        if (adapted && adapted.slides.length > 0) {
          dispatch(setPresentationData(adapted));
          setInitialLayout(adapted.slides[0].ui as Layout);
        } else {
          // Empty deck: seed with the first template layout so the canvas
          // isn't blank.
          const layout = await loadDefaultLayout();
          if (cancelled) return;
          const normalized = normalizeBackendAssetUrls(layout);
          setInitialLayout(normalized);
          dispatch(
            setPresentationData({
              id: deckId,
              title: deck.title,
              slides: [{ ui: normalized }],
            })
          );
        }
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load deck");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, token, dispatch]);

  // Persist edits back to the API (debounced) whenever the slide UI changes.
  // Skip the first run (initial load) so we don't immediately write back what
  // we just fetched.
  const isFirstSave = useRef(true);
  useEffect(() => {
    if (!presentationData || !token) return;
    if (isFirstSave.current) {
      isFirstSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const slide0 = presentationData.slides[0];
      if (!slide0?.ui) return;
      try {
        await saveDeck(token, deckId, {
          title: presentationData.title ?? "Untitled",
          payload: {
            title: presentationData.title ?? "Untitled",
            slides: presentationData.slides,
          },
        } as unknown as Parameters<typeof saveDeck>[2]);
      } catch {
        // Swallow — toast noise not needed for RnD slice.
      }
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [presentationData, token, deckId]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-zinc-400">
        Loading editor…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-red-400">
        {error}
      </div>
    );
  }
  if (!initialLayout) {
    return (
      <div className="flex h-screen items-center justify-center text-zinc-400">
        No slide to display.
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <h1 className="text-sm font-medium text-zinc-200">
          {presentationData?.title ?? "Editor (React)"}
        </h1>
        <span className="text-xs text-zinc-500">
          RnD React editor · Presenton/Konva
        </span>
      </header>
      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div className="shadow-2xl">
          <TemplateV2KonvaSlide
            layout={initialLayout as never}
            isEditMode
            slideId={null}
            presentationId={deckId}
            slideIndex={0}
          />
        </div>
      </div>
      <Toaster />
    </div>
  );
}
