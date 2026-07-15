"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useDispatch, useSelector } from "react-redux";
import { Play, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/editorStore";
import {
  setPresentationData,
  updateSlideUi,
  addSlide,
  deleteSlide,
  duplicateSlide,
  reorderSlide,
} from "@/store/presentationGeneration";
import type { PresentationData, SlideData } from "@/store/presentationGeneration";
import { useSessionStore } from "@/store/session.store";
import { getDeck, saveDeck, type AgentAction } from "@/lib/api";
import { normalizeBackendAssetUrls } from "@/utils/api";
import { Toaster } from "@/components/ui/sonner";
import SlideSidebar from "@/components/editor-react/slide-sidebar";
import InsertToolbar from "@/components/editor-react/insert-toolbar";
import PresentMode from "@/components/editor-react/present-mode";
import AIAssistantPanel from "@/components/editor-react/ai-assistant-panel";
import {
  applyFontToAllSlides,
  applyThemeToAllSlides,
  buildAddSlideUi,
  updateSlideText,
} from "@/components/editor-react/agent-dispatch";

// Konva is client-only — must not SSR.
const TemplateV2KonvaSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide
    ),
  { ssr: false }
);

async function loadDefaultLayout(): Promise<Record<string, unknown>> {
  const res = await fetch("/templates/general/template.json");
  const template = await res.json();
  const layouts = (template.layouts ?? []) as Record<string, unknown>[];
  return normalizeBackendAssetUrls(layouts[0] ?? {});
}

function adaptDeckToPresentation(
  deckId: string,
  payload: Record<string, unknown> | null
): PresentationData | null {
  if (!payload) return null;
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
  const [activeIndex, setActiveIndex] = useState(0);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstSave = useRef(true);

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
        } else {
          const layout = await loadDefaultLayout();
          if (cancelled) return;
          dispatch(
            setPresentationData({
              id: deckId,
              title: deck.title,
              slides: [{ ui: layout }],
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

  // Persist edits back to the API (debounced) whenever the deck changes.
  useEffect(() => {
    if (!presentationData || !token) return;
    if (isFirstSave.current) {
      isFirstSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveDeck(token, deckId, {
          title: presentationData.title ?? "Untitled",
          payload: {
            title: presentationData.title ?? "Untitled",
            slides: presentationData.slides,
          },
        } as unknown as Parameters<typeof saveDeck>[2]);
      } catch {
        // Swallow — save errors are non-critical here.
      }
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [presentationData, token, deckId]);

  // Keep activeIndex in bounds after delete.
  const slides = presentationData?.slides ?? [];
  const safeActive = Math.min(activeIndex, Math.max(0, slides.length - 1));
  const activeUi = slides[safeActive]?.ui ?? null;

  const handleAdd = (layout: Record<string, unknown>) => {
    dispatch(addSlide({ ui: layout, atIndex: safeActive + 1 }));
    setActiveIndex(safeActive + 1);
  };
  const handleDuplicate = (i: number) => {
    dispatch(duplicateSlide(i));
    setActiveIndex(i + 1);
  };
  const handleDelete = (i: number) => {
    dispatch(deleteSlide(i));
    if (i <= activeIndex) setActiveIndex(Math.max(0, activeIndex - 1));
  };
  const handleReorder = (from: number, to: number) => {
    dispatch(reorderSlide({ fromIndex: from, toIndex: to }));
    setActiveIndex(to);
  };
  const handleInsert = (ui: Record<string, unknown>) => {
    dispatch(updateSlideUi({ index: safeActive, ui }));
  };

  // Every branch calls an EXISTING function (Redux action or an
  // agent-dispatch.ts transform) — the agent only decides + supplies text
  // content, it never authors layout/HTML itself. Returns the chat message
  // shown to the user; never mutates the deck if it can't resolve the action.
  const handleAgentAction = async (action: AgentAction): Promise<string> => {
    const currentSlides: SlideData[] = presentationData?.slides ?? [];
    switch (action.tool) {
      case "set_font": {
        const fontName = String(action.args.font_name || "");
        if (!fontName) return "No font name provided.";
        const next = applyFontToAllSlides(currentSlides, fontName);
        if (presentationData) dispatch(setPresentationData({ ...presentationData, slides: next }));
        return `Font changed to ${fontName} across all slides.`;
      }
      case "set_theme": {
        const background = action.args.background ? String(action.args.background) : undefined;
        const fontColor = action.args.font_color ? String(action.args.font_color) : undefined;
        if (!background && !fontColor) return "No background or font color provided.";
        const next = applyThemeToAllSlides(currentSlides, { background, fontColor });
        if (presentationData) dispatch(setPresentationData({ ...presentationData, slides: next }));
        const parts = [background && "background", fontColor && "font color"].filter(Boolean);
        let msg = `Updated ${parts.join(" and ")} across all slides.`;
        if (action.args.accent_color) {
          msg += " (Accent color isn't automated yet — only background and font color are applied.)";
        }
        return msg;
      }
      case "add_slide": {
        const title = String(action.args.title || "");
        const items = Array.isArray(action.args.items) ? (action.args.items as { title: string; text: string }[]) : [];
        if (!title || !items.length) return "Missing slide content.";
        const ui = await buildAddSlideUi(title, items);
        dispatch(addSlide({ ui, atIndex: safeActive + 1 }));
        setActiveIndex(safeActive + 1);
        return `Added a new slide: "${title}".`;
      }
      case "update_text": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const target = action.args.target === "title" ? "title" : "content";
        const newUi = updateSlideText(slide.ui as Record<string, unknown>, target, String(action.args.new_text || ""));
        if (!newUi) return `Couldn't find a ${target} element on slide ${slideIndex}.`;
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return `Updated ${target} on slide ${slideIndex}.`;
      }
      case "delete_slide": {
        const slideIndex = Number(action.args.slide_index);
        if (!currentSlides[slideIndex]) return `Slide ${slideIndex} doesn't exist.`;
        if (currentSlides.length <= 1) return "Can't delete the only slide left.";
        dispatch(deleteSlide(slideIndex));
        if (slideIndex <= activeIndex) setActiveIndex(Math.max(0, activeIndex - 1));
        return `Deleted slide ${slideIndex}.`;
      }
      case "reorder_slide": {
        const from = Number(action.args.from_index);
        const to = Number(action.args.to_index);
        if (!currentSlides[from]) return `Slide ${from} doesn't exist.`;
        dispatch(reorderSlide({ fromIndex: from, toIndex: to }));
        return `Moved slide ${from} to position ${to}.`;
      }
      case "create_deck":
        return "Generating a whole new deck from a topic isn't wired up yet — try editing the current one instead.";
      default:
        return `Unknown action: ${action.tool}`;
    }
  };

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

  return (
    <div className="flex h-screen flex-col bg-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <h1 className="text-sm font-medium text-zinc-200">
          {presentationData?.title ?? "Editor (React)"}
        </h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAiPanel((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              showAiPanel
                ? "bg-[#6c5ce7] text-white"
                : "bg-[#1a1b2e] text-zinc-300 hover:bg-[#2d2e42]"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI Assistant
          </button>
          <button
            onClick={() => setPresenting(true)}
            className="flex items-center gap-1.5 rounded-md bg-[#1a1b2e] px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-[#2d2e42]"
            title="Present"
          >
            <Play className="h-3.5 w-3.5" />
            Present
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <SlideSidebar
          slides={slides}
          activeIndex={safeActive}
          onSelect={setActiveIndex}
          onAdd={handleAdd}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onReorder={handleReorder}
        />
        <div className="flex flex-1 items-center justify-center overflow-auto p-6">
          {activeUi ? (
            <div className="shadow-2xl">
              <TemplateV2KonvaSlide
                key={safeActive}
                layout={activeUi as never}
                isEditMode
                slideId={null}
                presentationId={deckId}
                slideIndex={safeActive}
              />
            </div>
          ) : (
            <p className="text-zinc-400">No slide selected.</p>
          )}
        </div>
        <InsertToolbar activeUi={activeUi} onInsert={handleInsert} />
        {showAiPanel && (
          <AIAssistantPanel
            slides={slides}
            onAction={handleAgentAction}
            onClose={() => setShowAiPanel(false)}
          />
        )}
      </div>
      <Toaster />
      {presenting && (
        <PresentMode
          slides={slides}
          startIndex={safeActive}
          onClose={() => setPresenting(false)}
        />
      )}
    </div>
  );
}
