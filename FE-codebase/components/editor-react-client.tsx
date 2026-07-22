"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import {
  Check,
  Download,
  LayoutGrid,
  Loader2,
  Lock,
  Play,
  Redo2,
  Search,
  Sparkles,
  Undo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolButton, ToolDivider } from "@/components/editor-react/ui";
import {
  TEMPLATE_V2_APPLY_COLOR_EVENT,
  TEMPLATE_V2_HISTORY_EVENT,
  TEMPLATE_V2_REDO_EVENT,
  TEMPLATE_V2_SELECT_ELEMENT_EVENT,
  TEMPLATE_V2_UNDO_EVENT,
  type TemplateV2ApplyColorDetail,
  type TemplateV2HistoryDetail,
  type TemplateV2SelectElementDetail,
} from "@/components/slide-editor/events/events";
import type { RootState, AppDispatch } from "@/store/editorStore";
import {
  setPresentationData,
  updateSlideUi,
  addSlide,
  deleteSlide,
  duplicateSlide,
  reorderSlide,
  setSlideLocked,
  setSlideHidden,
} from "@/store/presentationGeneration";
import type { PresentationData, SlideData } from "@/store/presentationGeneration";
import { useSessionStore } from "@/store/session.store";
import { getDeck, saveDeck, streamAipptDeck, generateImage, type AgentAction } from "@/lib/api";
import { normalizeBackendAssetUrls } from "@/utils/api";
import { Toaster } from "@/components/ui/sonner";
import SlideSidebar from "@/components/editor-react/slide-sidebar";
import InsertToolbar from "@/components/editor-react/insert-toolbar";
import PresentMode from "@/components/editor-react/present-mode";
import { exportToPptx } from "@/components/editor-react/export-pptx";
import AIAssistantPanel from "@/components/editor-react/ai-assistant-panel";
import FindReplacePanel from "@/components/editor-react/find-replace-panel";
import SlideSorter from "@/components/editor-react/slide-sorter";
import OnboardingTour from "@/components/editor-react/onboarding-tour";
import type { FindMatchLocation } from "@/components/editor-react/find-replace";
import {
  DeckLayoutPicker,
  mapAIPPTSlideToTemplateUi,
  patchHeroImage,
  type AIPPTSlide,
} from "@/components/editor-react/ai-layout-fill";
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
  const searchParams = useSearchParams();
  const autoGenerateRan = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [saveState, setSaveState] = useState<
    "idle" | "pending" | "saving" | "saved"
  >("idle");
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showSlideSorter, setShowSlideSorter] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<{
    message: string;
    topic: string;
    language?: string;
  } | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // The active slide's TemplateV2KonvaSlide surface owns the actual undo/redo
  // stack; it announces availability via this event whenever it commits an
  // edit or becomes the active surface (switching slides).
  useEffect(() => {
    const onHistory = (event: Event) => {
      const detail = (event as CustomEvent<TemplateV2HistoryDetail>).detail;
      if (!detail) return;
      setHistoryState({ canUndo: detail.canUndo, canRedo: detail.canRedo });
    };
    window.addEventListener(TEMPLATE_V2_HISTORY_EVENT, onHistory);
    return () => window.removeEventListener(TEMPLATE_V2_HISTORY_EVENT, onHistory);
  }, []);

  const handleApplyColorToSelection = (color: string) => {
    window.dispatchEvent(
      new CustomEvent<TemplateV2ApplyColorDetail>(TEMPLATE_V2_APPLY_COLOR_EVENT, {
        detail: { color },
      }),
    );
  };

  const handleUndo = () => window.dispatchEvent(new CustomEvent(TEMPLATE_V2_UNDO_EVENT));
  const handleRedo = () => window.dispatchEvent(new CustomEvent(TEMPLATE_V2_REDO_EVENT));

  // Native wheel listener (passive:false) so preventDefault works.
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.002;
        setZoom((z) => Math.min(3, Math.max(0.2, z + delta)));
      } else if (zoomRef.current > 1) {
        e.preventDefault();
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    if (e.button !== 0 && e.button !== 1) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    });
  };

  const onCanvasMouseUp = () => setIsPanning(false);
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
    setSaveState("pending");
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      try {
        await saveDeck(token, deckId, {
          title: presentationData.title ?? "Untitled",
          payload: {
            title: presentationData.title ?? "Untitled",
            slides: presentationData.slides,
          },
        } as unknown as Parameters<typeof saveDeck>[2]);
        setSaveState("saved");
      } catch {
        // Swallow — save errors are non-critical here.
        setSaveState("pending");
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
  const handleAddAt = (index: number, layout?: Record<string, unknown>) => {
    dispatch(
      addSlide({
        ui: layout ?? { id: "blank", components: [], elements: [] },
        atIndex: index,
      })
    );
    setActiveIndex(index);
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
  const handleToggleLock = (i: number) => {
    dispatch(setSlideLocked({ index: i, locked: !slides[i]?.isLocked }));
  };
  const handleToggleHide = (i: number) => {
    dispatch(setSlideHidden({ index: i, hidden: !slides[i]?.isHidden }));
  };

  // Find & Replace's Prev/Next navigate to a match that may be on a
  // different slide. Switching slides remounts that slide's
  // TemplateV2KonvaSlide (key={safeActive}), so the select-element event
  // can only be dispatched once the new instance has mounted and attached
  // its listener — stash the target and fire it on the next paint after
  // activeIndex actually changes.
  const pendingMatchSelectRef = useRef<{ componentIndex: number; elementPath: number[] } | null>(null);
  useEffect(() => {
    if (!pendingMatchSelectRef.current) return;
    const detail = { slideIndex: safeActive, ...pendingMatchSelectRef.current };
    pendingMatchSelectRef.current = null;
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent<TemplateV2SelectElementDetail>(TEMPLATE_V2_SELECT_ELEMENT_EVENT, { detail }),
      );
    });
    return () => cancelAnimationFrame(id);
  }, [safeActive]);

  const handleNavigateToMatch = (match: FindMatchLocation) => {
    const target = { componentIndex: match.componentIndex, elementPath: match.elementPath };
    if (match.slideIndex === safeActive) {
      window.dispatchEvent(
        new CustomEvent<TemplateV2SelectElementDetail>(TEMPLATE_V2_SELECT_ELEMENT_EVENT, {
          detail: { slideIndex: match.slideIndex, ...target },
        }),
      );
      return;
    }
    pendingMatchSelectRef.current = target;
    setActiveIndex(match.slideIndex);
  };
  const handleExport = async () => {
    const blob = await exportToPptx(
      presentationData?.title ?? "Untitled Presentation",
      slides
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${presentationData?.title ?? "presentation"}.pptx`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleInsert = (ui: Record<string, unknown>) => {
    dispatch(updateSlideUi({ index: safeActive, ui }));
  };

  // Streams AIPPTSlide JSONL for a topic and appends each mapped slide.
  // Shared by the AI Assistant's create_deck tool and the one-time
  // auto-generate-on-open flow (?prompt= from the homepage). Throws on real
  // failure (bad response, dead stream) so callers can show a graceful
  // error + retry (PRD #19) instead of silently ending up with 0 slides.
  const generateDeckFromTopic = async (topic: string, language?: string): Promise<number> => {
    if (!token) return 0;
    const res = await streamAipptDeck(token, { content: topic, language });
    if (!(res instanceof Response) || !res.body) {
      const message =
        res && typeof res === "object" && "message" in res
          ? String((res as { message?: unknown }).message)
          : "Couldn't start generation.";
      throw new Error(message);
    }

    if (presentationData) {
      dispatch(setPresentationData({ ...presentationData, slides: [] }));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let count = 0;
    const layoutPicker = new DeckLayoutPicker(topic);
    const currentToken = token;

    const slideSubject = (slide: AIPPTSlide): string => {
      if (slide.type === "cover" || slide.type === "transition") return slide.data.title;
      if (slide.type === "content") return slide.data.title;
      return topic;
    };

    // Hero photo generated per slide, kept in one consistent style so a
    // deck doesn't look like a grab-bag of unrelated stock photos.
    const heroStyle =
      "editorial photograph, cinematic natural lighting, cohesive color grading, " +
      "no text, no watermark, no logo";

    const requestHeroImage = (index: number, ui: Record<string, unknown>, marker: { componentId: string; elementName: string }, subject: string) => {
      const prompt = `${subject} — related to ${topic}. ${heroStyle}`;
      void generateImage(currentToken, prompt).then((dataUrl) => {
        if (!dataUrl) return;
        const patched = patchHeroImage(ui, marker, dataUrl);
        dispatch(updateSlideUi({ index, ui: patched }));
      });
    };

    const mapLine = async (
      line: string
    ): Promise<{ ui: Record<string, unknown>; heroImage: { componentId: string; elementName: string } | null; subject: string } | null> => {
      try {
        const slide = JSON.parse(line) as AIPPTSlide;
        const filled = await mapAIPPTSlideToTemplateUi(slide, layoutPicker);
        if (!filled) return null;
        return { ui: filled.ui, heroImage: filled.heroImage, subject: slideSubject(slide) };
      } catch {
        return null;
      }
    };

    const READ_IDLE_TIMEOUT_MS = 60000;
    const readWithTimeout = () =>
      Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Generation timed out. Please try again.")), READ_IDLE_TIMEOUT_MS),
        ),
      ]);

    for (;;) {
      const { done, value } = await readWithTimeout();
      if (done) {
        if (buf.trim()) {
          const filled = await mapLine(buf.trim());
          if (filled) {
            const index = count;
            dispatch(addSlide({ ui: filled.ui }));
            count++;
            if (filled.heroImage) requestHeroImage(index, filled.ui, filled.heroImage, filled.subject);
          }
        }
        break;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith("```")) continue;
        const filled = await mapLine(t);
        if (filled) {
          const index = count;
          dispatch(addSlide({ ui: filled.ui }));
          count++;
          setActiveIndex(0);
          if (filled.heroImage) requestHeroImage(index, filled.ui, filled.heroImage, filled.subject);
        }
      }
    }
    return count;
  };

  // Auto-generate once when opened with ?prompt= (homepage "Generate" flow
  // creates an empty deck, then routes here with the prompt in the query
  // string — cross-origin-safe, survives a reload).
  useEffect(() => {
    if (autoGenerateRan.current || loading || !token) return;
    const prompt = searchParams.get("prompt");
    if (!prompt) return;
    autoGenerateRan.current = true;
    const language = searchParams.get("lang") ?? undefined;
    runGeneration(prompt, language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, token, searchParams]);

  // Shared by the auto-generate effect and the "Try Again" button — keeps
  // the original prompt text around on failure so retrying doesn't require
  // retyping it (PRD #19).
  const runGeneration = (topic: string, language?: string) => {
    setGenerationError(null);
    setIsGenerating(true);
    generateDeckFromTopic(topic, language)
      .catch((e) => {
        setGenerationError({
          message: e instanceof Error ? e.message : "Something went wrong while generating your deck.",
          topic,
          language,
        });
      })
      .finally(() => setIsGenerating(false));
  };

  const retryGeneration = () => {
    if (!generationError) return;
    runGeneration(generationError.topic, generationError.language);
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
      case "create_deck": {
        const topic = String(action.args.topic || action.args.content || "");
        const language = action.args.language ? String(action.args.language) : undefined;
        if (!topic) return "Please specify a topic to generate a deck about.";
        if (!token) return "Session not ready — try again in a moment.";

        try {
          const count = await generateDeckFromTopic(topic, language);
          return count > 0
            ? `Generated ${count} slides about "${topic}".`
            : `No slides generated for "${topic}". Try a different prompt.`;
        } catch (e) {
          const message = e instanceof Error ? e.message : "Generation failed.";
          return `Couldn't generate a deck about "${topic}": ${message}`;
        }
      }
      case "regenerate_slide": {
        const slideIndex = Number(action.args.slide_index);
        if (!currentSlides[slideIndex]) return `Slide ${slideIndex} doesn't exist.`;
        const title = String(action.args.title || "");
        const items = Array.isArray(action.args.items)
          ? (action.args.items as { title: string; text: string }[])
          : [];
        if (!title || !items.length) return "Missing slide content.";
        if (!token) return "Session not ready — try again in a moment.";

        // Same pack every time for this deck (seeded by deckId) so a
        // regenerated slide stays visually consistent with the rest.
        const picker = new DeckLayoutPicker(deckId);
        const filled = await mapAIPPTSlideToTemplateUi({ type: "content", data: { title, items } }, picker);
        if (!filled) return "Couldn't find a layout to use.";

        dispatch(updateSlideUi({ index: slideIndex, ui: filled.ui }));

        if (filled.heroImage) {
          const marker = filled.heroImage;
          const baseUi = filled.ui;
          const imagePrompt = String(action.args.image_prompt || title);
          const prompt = `${imagePrompt}. editorial photograph, cinematic natural lighting, cohesive color grading, no text, no watermark, no logo`;
          void generateImage(token, prompt).then((dataUrl) => {
            if (!dataUrl) return;
            dispatch(updateSlideUi({ index: slideIndex, ui: patchHeroImage(baseUi, marker, dataUrl) }));
          });
        }

        return `Updated slide ${slideIndex}: "${title}"${filled.heroImage ? " (generating a new hero image…)" : ""}.`;
      }
      default:
        return `Unknown action: ${action.tool}`;
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[var(--bg-base)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-light)]" />
        <p className="text-sm text-[var(--text-secondary)]">Loading editor…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-base)] px-6">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300 shadow-[var(--shadow-panel)]">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-base)]">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-panel)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[var(--accent)] to-[var(--accent-light)] shadow-[var(--shadow-soft)]">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <h1 className="truncate text-sm font-medium text-[var(--text-primary)]">
            {presentationData?.title ?? "Untitled Presentation"}
          </h1>
          {saveState !== "idle" && (
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                saveState === "saved"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
              )}
            >
              {saveState === "saving" ? (
                <>
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  Saving…
                </>
              ) : saveState === "saved" ? (
                <>
                  <Check className="h-2.5 w-2.5" />
                  Saved
                </>
              ) : (
                "Unsaved changes"
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <ToolButton
            size="sm"
            onClick={handleUndo}
            disabled={!historyState.canUndo}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton
            size="sm"
            onClick={handleRedo}
            disabled={!historyState.canRedo}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolDivider className="mx-1" />
          <div className="relative">
            <ToolButton
              size="sm"
              active={showFindReplace}
              onClick={() => setShowFindReplace((v) => !v)}
              title="Find & Replace"
            >
              <Search className="h-3.5 w-3.5" />
            </ToolButton>
            {showFindReplace && (
              <div className="absolute left-0 top-[calc(100%+6px)] z-50">
                <FindReplacePanel
                  slides={slides}
                  onApplySlides={(nextSlides) => {
                    if (presentationData) {
                      dispatch(setPresentationData({ ...presentationData, slides: nextSlides }));
                    }
                  }}
                  onNavigateToMatch={handleNavigateToMatch}
                  onClose={() => setShowFindReplace(false)}
                />
              </div>
            )}
          </div>
          <ToolDivider className="mx-1" />
          <ToolButton
            id="onboarding-ai-assistant"
            variant="solid"
            active={showAiPanel}
            onClick={() => setShowAiPanel((v) => !v)}
            className="px-2.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI Assistant
          </ToolButton>
          <ToolButton
            id="onboarding-slide-sorter"
            size="sm"
            onClick={() => setShowSlideSorter(true)}
            title="Slide Sorter"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton
            id="onboarding-present"
            variant="solid"
            onClick={() => setPresenting(true)}
            title="Present"
            className="px-2.5"
          >
            <Play className="h-3.5 w-3.5" />
            Present
          </ToolButton>
          <ToolDivider className="mx-1" />
          <ToolButton
            id="onboarding-export"
            variant="accent"
            onClick={handleExport}
            title="Export to PPTX"
            className="px-3"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </ToolButton>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div id="onboarding-sidebar" className="flex h-full shrink-0">
          <SlideSidebar
            slides={slides}
            activeIndex={safeActive}
            onSelect={setActiveIndex}
            onAdd={handleAdd}
            onAddAt={handleAddAt}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            onReorder={handleReorder}
            onToggleLock={handleToggleLock}
            onToggleHide={handleToggleHide}
          />
        </div>
        <div
          ref={canvasAreaRef}
          id="onboarding-canvas"
          className="editor-canvas-grid relative flex flex-1 items-center justify-center overflow-hidden"
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
          style={{ cursor: isPanning ? "grabbing" : zoom > 1 ? "grab" : "default" }}
        >
          {slides[safeActive]?.isLocked && (
            <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)]/95 px-3 py-1 text-xs text-[var(--text-secondary)] shadow-[var(--shadow-panel)] backdrop-blur">
              <Lock size={12} />
              This slide is locked
            </div>
          )}
          {activeUi ? (
            <div
              className="editor-slide-frame"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: isPanning ? "none" : "transform 0.1s ease-out",
              }}
            >
              <TemplateV2KonvaSlide
                key={safeActive}
                layout={activeUi as never}
                isEditMode={!slides[safeActive]?.isLocked}
                slideId={null}
                presentationId={deckId}
                slideIndex={safeActive}
              />
            </div>
          ) : generationError ? (
            <div className="flex max-w-[320px] flex-col items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-6 py-5 text-center">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Generation failed
              </p>
              <p className="text-xs text-[var(--text-secondary)]">{generationError.message}</p>
              <ToolButton variant="accent" onClick={retryGeneration} className="px-4">
                Try Again
              </ToolButton>
            </div>
          ) : isGenerating ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-light)]" />
              <p className="text-sm text-[var(--text-secondary)]">
                Generating your presentation…
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-[var(--text-secondary)]">
                No slide selected
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Pick a slide from the sidebar, or add a new one.
              </p>
            </div>
          )}

          {/* Zoom controls bottom-right */}
          <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)]/95 p-1 shadow-[var(--shadow-panel)] backdrop-blur">
            <ToolButton
              size="sm"
              onClick={() => setZoom((z) => Math.max(0.2, z - 0.2))}
              title="Zoom out"
            >
              <ZoomOut size={15} />
            </ToolButton>
            <ToolButton
              size="sm"
              onClick={resetView}
              title="Reset view"
              className="min-w-[46px] tabular-nums"
            >
              {Math.round(zoom * 100)}%
            </ToolButton>
            <ToolButton
              size="sm"
              onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
              title="Zoom in"
            >
              <ZoomIn size={15} />
            </ToolButton>
            <ToolDivider className="mx-0.5 h-4" />
            <ToolButton size="sm" onClick={resetView} title="Fit to screen">
              <Maximize2 size={13} />
            </ToolButton>
          </div>
        </div>
        <InsertToolbar
          activeUi={activeUi}
          onInsert={handleInsert}
          onApplyColorToSelection={handleApplyColorToSelection}
        />
        {showAiPanel && (
          <AIAssistantPanel
            slides={slides}
            activeIndex={safeActive}
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
      {showSlideSorter && (
        <SlideSorter
          slides={slides}
          activeIndex={safeActive}
          onSelect={setActiveIndex}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onReorder={handleReorder}
          onToggleLock={handleToggleLock}
          onToggleHide={handleToggleHide}
          onClose={() => setShowSlideSorter(false)}
        />
      )}
      <OnboardingTour ready={Boolean(activeUi) && !presenting && !showSlideSorter} />
    </div>
  );
}
