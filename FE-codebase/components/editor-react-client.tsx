"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import {
  Check,
  ChevronDown,
  Download,
  LayoutGrid,
  Loader2,
  Lock,
  Play,
  Redo2,
  Search,
  Sparkles,
  StickyNote,
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
  setSlideNotes,
  applyAccentBackground,
} from "@/store/presentationGeneration";
import type { SlideData } from "@/store/presentationGeneration";
import {
  extractDominantColors,
  pickVividColor,
} from "@/components/slide-editor/utils/extract-image-colors";
import { buildPaletteFromSeed, type GeneratedPalette } from "@/components/slide-editor/utils/color-theory";
import { applyPaletteToUi, type IconCounter } from "@/components/slide-editor/utils/ai-palette";
import { adaptDeckToPresentation } from "@/components/editor-react/deck-adapt";
import { useSessionStore } from "@/store/session.store";
import { getDeck, saveDeck, streamAipptDeck, generateImage, type AgentAction } from "@/lib/api";
import { normalizeBackendAssetUrls } from "@/utils/api";
import { Toaster, notify } from "@/components/ui/sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SlideSidebar from "@/components/editor-react/slide-sidebar";
import InsertToolbar from "@/components/editor-react/insert-toolbar";
import PresentMode from "@/components/editor-react/present-mode";
import { exportToPptx } from "@/components/editor-react/export-pptx";
import { buildPdfFromSlideImages } from "@/components/editor-react/export-pdf";
import {
  PdfExportCapture,
  type PdfExportSlide,
} from "@/components/editor-react/PdfExportCapture";
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
  insertFormulaIntoSlide,
  insertShapeIntoSlide,
  insertIconIntoSlide,
  setSlideBackground,
  insertTextIntoSlide,
  insertChartIntoSlide,
  insertTableIntoSlide,
  insertImagePlaceholderIntoSlide,
  patchInsertedImage,
  moveElementInSlide,
  recolorElementInSlide,
  setElementShadowInSlide,
  type ShadowPatch,
} from "@/components/editor-react/agent-dispatch";
import type { BackgroundStyle } from "@/components/slide-editor/surface/SlideBackground";

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
  const [pdfExportSlides, setPdfExportSlides] = useState<
    PdfExportSlide[] | null
  >(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
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
  const handleNotesChange = (notes: string) => {
    dispatch(setSlideNotes({ index: safeActive, notes }));
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
  // Kicks off PdfExportCapture (mounted below in the JSX tree), which
  // renders every slide off-screen at full resolution and reports back via
  // handlePdfCaptured once every slide's Stage is ready to rasterize.
  const handleExportPdf = () => {
    if (slides.length === 0) return;
    notify.loading("Preparing PDF…", undefined, { id: "pdf-export" });
    setPdfExportSlides(slides.map((slide) => ({ ui: slide.ui })));
  };
  const handlePdfCaptured = useCallback(
    async (dataUrls: string[] | null) => {
      setPdfExportSlides(null);
      if (!dataUrls) {
        notify.error("Couldn't export PDF", "Try again in a moment.", {
          id: "pdf-export",
        });
        return;
      }
      try {
        const blob = await buildPdfFromSlideImages(dataUrls);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${presentationData?.title ?? "presentation"}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        notify.dismiss("pdf-export");
      } catch {
        notify.error("Couldn't export PDF", "Try again in a moment.", {
          id: "pdf-export",
        });
      }
    },
    [presentationData?.title],
  );
  const handleInsert = (ui: Record<string, unknown>) => {
    dispatch(updateSlideUi({ index: safeActive, ui }));
  };

  // Streams AIPPTSlide JSONL for a topic and appends each mapped slide.
  // Shared by the AI Assistant's create_deck tool and the one-time
  // auto-generate-on-open flow (?prompt= from the homepage). Throws on real
  // failure (bad response, dead stream) so callers can show a graceful
  // error + retry (PRD #19) instead of silently ending up with 0 slides.
  const generateDeckFromTopic = async (topic: string, language?: string, colorPreference?: string): Promise<number> => {
    if (!token) return 0;
    const res = await streamAipptDeck(token, { content: topic, language, colorPreference });
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

    // The deck-generation LLM's own topic-color pick (the JSONL stream's very
    // first line) arrives BEFORE any slide exists — dispatching a "recolor
    // every slide in state" action at that point is a no-op (the slides array
    // is still empty; setPresentationData({slides: []}) ran just above).
    // So instead of dispatching immediately, remember the resolved PALETTE
    // here and apply it to each slide's `ui` at the moment it's created
    // below, regardless of whether the theme line or a slide arrives first.
    // The icon counter is shared/mutated across the WHOLE deck (not reset
    // per slide) so icon accents rotate through the palette's tetradic hues
    // instead of every icon in the deck landing on the same one.
    let pendingPalette: GeneratedPalette | null = null;
    const iconCounter: IconCounter = { current: 0 };
    const tintIfThemed = (ui: Record<string, unknown>): Record<string, unknown> =>
      pendingPalette
        ? (applyPaletteToUi(ui, pendingPalette, iconCounter) as Record<string, unknown>)
        : ui;

    // Generates a photo for ONE slot on an already-added slide and patches it
    // in once ready. `currentUi` accumulates across every slot on this same
    // slide (hero + every secondary photo) — each patch starts from the
    // LATEST known ui for this slide, not the original, so multiple async
    // photos resolving in any order never clobber each other (JS's single
    // -threaded event loop makes the read-modify-write here safe as long as
    // it isn't split across an await).
    const requestPhotoForSlot = (
      index: number,
      getUi: () => Record<string, unknown>,
      setUi: (ui: Record<string, unknown>) => void,
      marker: { componentId: string; elementName: string; occurrenceIndex: number },
      subject: string,
      isHero: boolean,
    ) => {
      const prompt = `${subject} — related to ${topic}. ${heroStyle}`;
      void generateImage(currentToken, prompt).then((dataUrl) => {
        if (!dataUrl) return;
        const patched = patchHeroImage(getUi(), marker, dataUrl) as Record<string, unknown>;
        setUi(patched);
        dispatch(updateSlideUi({ index, ui: patched }));

        // Fallback only: if the theme line never arrived/validated, fall back
        // to the cover photo's own dominant color instead of staying plain
        // white. Skipped once a palette is already set — the topic/
        // color-preference-aware theme line is more informed than whatever a
        // random generated photo happens to contain (e.g. a portrait's skin
        // tones), so it should never be overridden by this fallback.
        if (isHero && index === 0 && !pendingPalette) {
          void extractDominantColors(dataUrl, 5).then((colors) => {
            if (pendingPalette) return;
            const accent = pickVividColor(colors);
            if (!accent) return;
            pendingPalette = buildPaletteFromSeed(accent);
            dispatch(applyAccentBackground(pendingPalette));
          });
        }
      });
    };

    // Kicks off a photo generation for the hero slot AND every secondary
    // photo slot the layout has (team-grid portraits, multi-card rows, ...)
    // instead of leaving anything besides the single largest slot on the
    // generic placeholder image.
    const requestSlidePhotos = (
      index: number,
      ui: Record<string, unknown>,
      heroImage: { componentId: string; elementName: string; occurrenceIndex: number } | null,
      secondaryImages: { componentId: string; elementName: string; occurrenceIndex: number }[],
      subject: string,
    ) => {
      let currentUi = ui;
      const getUi = () => currentUi;
      const setUi = (next: Record<string, unknown>) => {
        currentUi = next;
      };
      if (heroImage) requestPhotoForSlot(index, getUi, setUi, heroImage, subject, true);
      for (const marker of secondaryImages) {
        requestPhotoForSlot(index, getUi, setUi, marker, subject, false);
      }
    };

    const mapLine = async (
      line: string
    ): Promise<{
      ui: Record<string, unknown>;
      heroImage: { componentId: string; elementName: string; occurrenceIndex: number } | null;
      secondaryImages: { componentId: string; elementName: string; occurrenceIndex: number }[];
      subject: string;
    } | null> => {
      try {
        const slide = JSON.parse(line) as AIPPTSlide;
        const filled = await mapAIPPTSlideToTemplateUi(slide, layoutPicker);
        if (!filled) return null;
        return {
          ui: tintIfThemed(filled.ui),
          heroImage: filled.heroImage,
          secondaryImages: filled.secondaryImages,
          subject: slideSubject(slide),
        };
      } catch {
        return null;
      }
    };

    const tryApplyThemeLine = (line: string): boolean => {
      if (pendingPalette) return false;
      try {
        const parsed = JSON.parse(line) as { type?: string; color?: string };
        if (parsed.type !== "theme" || typeof parsed.color !== "string") return false;
        if (!/^#[0-9a-fA-F]{6}$/.test(parsed.color)) return false;
        pendingPalette = buildPaletteFromSeed(parsed.color);
        return true;
      } catch {
        return false;
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
        if (buf.trim() && !tryApplyThemeLine(buf.trim())) {
          const filled = await mapLine(buf.trim());
          if (filled) {
            const index = count;
            dispatch(addSlide({ ui: filled.ui }));
            count++;
            requestSlidePhotos(index, filled.ui, filled.heroImage, filled.secondaryImages, filled.subject);
          }
        }
        break;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith("```") || tryApplyThemeLine(t)) continue;
        const filled = await mapLine(t);
        if (filled) {
          const index = count;
          dispatch(addSlide({ ui: filled.ui }));
          count++;
          setActiveIndex(0);
          requestSlidePhotos(index, filled.ui, filled.heroImage, filled.secondaryImages, filled.subject);
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
        const colorPreference = action.args.color_preference ? String(action.args.color_preference) : undefined;
        if (!topic) return "Please specify a topic to generate a deck about.";
        if (!token) return "Session not ready — try again in a moment.";

        try {
          const count = await generateDeckFromTopic(topic, language, colorPreference);
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
      case "insert_formula": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const latex = String(action.args.latex || "");
        if (!latex) return "No LaTeX provided.";
        const newUi = insertFormulaIntoSlide(slide.ui as Record<string, unknown>, latex);
        if (!newUi) return "Couldn't render that formula.";
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return `Inserted a formula on slide ${slideIndex}.`;
      }
      case "insert_shape": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const shape = String(action.args.shape || "");
        if (!shape) return "No shape specified.";
        const newUi = insertShapeIntoSlide(slide.ui as Record<string, unknown>, shape);
        if (!newUi) return `Couldn't insert a "${shape}" shape.`;
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return `Inserted a ${shape} on slide ${slideIndex}.`;
      }
      case "insert_icon": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const query = String(action.args.query || "");
        if (!query) return "No icon search query provided.";
        const newUi = await insertIconIntoSlide(slide.ui as Record<string, unknown>, query);
        if (!newUi) return `Couldn't find an icon matching "${query}".`;
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return `Inserted a "${query}" icon on slide ${slideIndex}.`;
      }
      case "set_background": {
        const style: BackgroundStyle = {
          type: action.args.style === "linear" || action.args.style === "radial" ? action.args.style : "solid",
          from: String(action.args.color || "#1a1b2e"),
          to: action.args.color_to ? String(action.args.color_to) : undefined,
          angle: typeof action.args.angle === "number" ? action.args.angle : undefined,
        };
        if (action.args.apply_to_all) {
          const next = currentSlides.map((slide) =>
            slide.ui ? { ...slide, ui: setSlideBackground(slide.ui as Record<string, unknown>, style) } : slide,
          );
          if (presentationData) dispatch(setPresentationData({ ...presentationData, slides: next }));
          return "Updated the background on every slide.";
        }
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const newUi = setSlideBackground(slide.ui as Record<string, unknown>, style);
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return `Updated the background on slide ${slideIndex}.`;
      }
      case "insert_text": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const text = String(action.args.text || "");
        if (!text) return "No text provided.";
        const style = action.args.style ? String(action.args.style) : undefined;
        const newUi = insertTextIntoSlide(slide.ui as Record<string, unknown>, text, style);
        if (!newUi) return "Couldn't insert that text.";
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return `Inserted text on slide ${slideIndex}.`;
      }
      case "insert_chart": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const chartType = String(action.args.chart_type || "");
        const title = String(action.args.title || "");
        const categories = Array.isArray(action.args.categories) ? (action.args.categories as string[]) : [];
        const series = Array.isArray(action.args.series)
          ? (action.args.series as { name: string; values: number[] }[])
          : [];
        if (!chartType || !categories.length || !series.length) return "Missing chart data.";
        const newUi = insertChartIntoSlide(slide.ui as Record<string, unknown>, chartType, title, categories, series);
        if (!newUi) return `Couldn't insert a "${chartType}" chart.`;
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return `Inserted a ${chartType} chart on slide ${slideIndex}.`;
      }
      case "insert_table": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const headers = Array.isArray(action.args.headers) ? (action.args.headers as string[]) : [];
        const rows = Array.isArray(action.args.rows) ? (action.args.rows as string[][]) : [];
        if (!headers.length) return "Missing table headers.";
        const newUi = insertTableIntoSlide(slide.ui as Record<string, unknown>, headers, rows);
        if (!newUi) return "Couldn't insert that table.";
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return `Inserted a table on slide ${slideIndex}.`;
      }
      case "insert_image": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const prompt = String(action.args.prompt || "");
        if (!prompt) return "No image prompt provided.";
        if (!token) return "Session not ready — try again in a moment.";

        const label = `ai-image-${Date.now()}`;
        const { ui: placeholderUi, componentId } = insertImagePlaceholderIntoSlide(
          slide.ui as Record<string, unknown>,
          label,
        );
        if (!componentId) return "Couldn't insert an image.";
        dispatch(updateSlideUi({ index: slideIndex, ui: placeholderUi }));

        const fullPrompt = `${prompt}. editorial photograph, cinematic natural lighting, cohesive color grading, no text, no watermark, no logo`;
        void generateImage(token, fullPrompt).then((dataUrl) => {
          if (!dataUrl) return;
          dispatch(
            updateSlideUi({
              index: slideIndex,
              ui: patchInsertedImage(placeholderUi, componentId, dataUrl),
            }),
          );
        });

        return `Generating an image on slide ${slideIndex}…`;
      }
      case "move_element": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const elementIndex = Number(action.args.element_index);
        const anchor = typeof action.args.position === "string" ? action.args.position : undefined;
        const x = typeof action.args.x === "number" ? action.args.x : undefined;
        const y = typeof action.args.y === "number" ? action.args.y : undefined;
        const newUi = moveElementInSlide(slide.ui as Record<string, unknown>, elementIndex, { anchor, x, y });
        if (!newUi) return `Couldn't move element ${elementIndex} on slide ${slideIndex}.`;
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return `Moved the element on slide ${slideIndex}.`;
      }
      case "recolor_element": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const elementIndex = Number(action.args.element_index);
        const color = String(action.args.color || "");
        if (!color) return "No color provided.";
        const newUi = recolorElementInSlide(slide.ui as Record<string, unknown>, elementIndex, color);
        if (!newUi) return `Couldn't find element ${elementIndex} on slide ${slideIndex}.`;
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return `Recolored the element on slide ${slideIndex}.`;
      }
      case "set_shadow": {
        const slideIndex = Number(action.args.slide_index);
        const slide = currentSlides[slideIndex];
        if (!slide || !slide.ui) return `Slide ${slideIndex} doesn't exist.`;
        const elementIndex = Number(action.args.element_index);
        const enabled = Boolean(action.args.enabled);
        const patch: ShadowPatch = {
          color: typeof action.args.color === "string" ? action.args.color : undefined,
          blur: typeof action.args.blur === "number" ? action.args.blur : undefined,
          opacity: typeof action.args.opacity === "number" ? action.args.opacity : undefined,
          offset_x: typeof action.args.offset_x === "number" ? action.args.offset_x : undefined,
          offset_y: typeof action.args.offset_y === "number" ? action.args.offset_y : undefined,
        };
        const newUi = setElementShadowInSlide(slide.ui as Record<string, unknown>, elementIndex, enabled, patch);
        if (!newUi) return `Couldn't find element ${elementIndex} on slide ${slideIndex}.`;
        dispatch(updateSlideUi({ index: slideIndex, ui: newUi }));
        return enabled ? `Added a shadow on slide ${slideIndex}.` : `Removed the shadow on slide ${slideIndex}.`;
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
            size="sm"
            active={showNotes}
            onClick={() => setShowNotes((v) => !v)}
            title="Speaker Notes"
          >
            <StickyNote className="h-3.5 w-3.5" />
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolButton
                id="onboarding-export"
                variant="accent"
                title="Export"
                className="px-3"
              >
                <Download className="h-3.5 w-3.5" />
                Export
                <ChevronDown className="h-3 w-3" />
              </ToolButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text-primary)]"
            >
              <DropdownMenuItem
                onSelect={handleExport}
                className="focus:bg-[var(--bg-elevated)] focus:text-[var(--text-primary)]"
              >
                Export to PPTX
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleExportPdf}
                className="focus:bg-[var(--bg-elevated)] focus:text-[var(--text-primary)]"
              >
                Export to PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <PdfExportCapture slides={pdfExportSlides} onCapture={handlePdfCaptured} />
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
      {showNotes && (
        <div className="flex h-[160px] shrink-0 flex-col border-t border-[var(--border)] bg-[var(--bg-panel)] px-4 py-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              Speaker Notes
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              Slide {safeActive + 1}
            </span>
          </div>
          <textarea
            value={slides[safeActive]?.notes ?? ""}
            onChange={(event) => handleNotesChange(event.target.value)}
            placeholder="Add notes for this slide — visible to you in Presenter View, not to your audience."
            className="w-full flex-1 resize-none rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
      )}
      <Toaster />
      {presenting && (
        <PresentMode
          slides={slides}
          startIndex={safeActive}
          deckId={deckId}
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
