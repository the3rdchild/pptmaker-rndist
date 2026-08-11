"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useDispatch, useSelector, useStore } from "react-redux";
import {
  Check,
  ChevronDown,
  Download,
  FilePlus2,
  History,
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
  Hand,
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
  patchSlideUi,
  addSlide,
  addSlides,
  deleteSlide,
  duplicateSlide,
  reorderSlide,
  setSlideLocked,
  setSlideHidden,
  setSlideNotes,
} from "@/store/presentationGeneration";
import type { SlideData } from "@/store/presentationGeneration";
import { adaptDeckToPresentation } from "@/components/editor-react/deck-adapt";
import { useSessionStore } from "@/store/session.store";
import { getDeck, saveDeck, streamAipptDeck, fetchThemeManifest, chooseThemeForTopic, generateImage, type AgentAction } from "@/lib/api";
import type { StockImageResult } from "@/lib/stock-image-providers";
import {
  DEFAULT_THEME_ID,
  invalidateThemeCache,
  loadAllThemes,
  loadTheme,
  type TemplateTheme,
} from "@/lib/templates/themes";
import { TemplateEnginePanel } from "@/components/template-engine/template-engine-panel";
import type { TemplateSelectionPayload } from "@/components/slide-editor/surface/TemplateV2KonvaSlide";
import {
  imageFileFromClipboard,
  isTextEntryTarget,
  readImageFile,
  withPastedImage,
  type PastedImage,
} from "@/components/editor-react/paste-image";
import { SaveToLibraryDialog } from "@/components/editor-react/save-to-library-dialog";
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
import { SlideCaptureHost } from "@/components/editor-react/slide-capture";
import AIAssistantPanel from "@/components/editor-react/ai-assistant-panel";
import FindReplacePanel from "@/components/editor-react/find-replace-panel";
import VersionHistoryPanel from "@/components/editor-react/version-history-panel";
import SlideSorter from "@/components/editor-react/slide-sorter";
import OnboardingTour from "@/components/editor-react/onboarding-tour";
import type { FindMatchLocation } from "@/components/editor-react/find-replace";
import {
  DeckLayoutPicker,
  mapAIPPTSlideToTemplateUi,
  patchHeroImage,
  findPhotoSlotHint,
  resolveThemeFromPrompt,
  type AIPPTSlide,
} from "@/components/editor-react/ai-layout-fill";
import {
  fillManifestSlide,
  parseManifestSlideLine,
  applyFillsToUi,
  describeLayoutSlots,
  type ManifestSlideLine,
} from "@/components/editor-react/ai-slot-fill";
import { captureSlidePng } from "@/components/editor-react/slide-capture";
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
  const theme = await loadTheme(DEFAULT_THEME_ID);
  return theme?.layouts[0] ?? {};
}

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.2;

// Per-slide verify→repair rounds in the post-generation Kimi review. Pass 1
// fixes the initial fill's issues; pass 2 re-verifies the repaired slide and
// fixes again if the repair itself introduced a new issue. A clean verify
// short-circuits early, so clean slides still cost only one Kimi call.
const MAX_REVIEW_PASSES = 2;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Position of the current zoom along the slider track, as a percentage. */
function zoomFraction(zoom: number): number {
  return ((clampZoom(zoom) - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100;
}

/** An empty slide for the template engine. No id, so the first save mints one
 *  from the name the author types rather than overwriting something. */
function blankTemplateLayout(): Record<string, unknown> {
  return { id: "", description: "", components: [], elements: [] };
}

/** True for a slide that still holds nothing the author put there. */
function isBlankTemplateUi(ui: unknown): boolean {
  if (!ui || typeof ui !== "object") return true;
  const record = ui as Record<string, unknown>;
  const components = Array.isArray(record.components) ? record.components : [];
  const elements = Array.isArray(record.elements) ? record.elements : [];
  return components.length === 0 && elements.length === 0;
}

/** Top result for a stock-photo search, for the homepage's "Stock photos"
 *  image-source mode. Same-origin fetch to this app's own route — the
 *  provider keys live server-side in lib/stock-image-providers.ts and are
 *  never reachable from client code directly. Never throws: returns null on
 *  any failure or empty result so callers fall back to AI generation. */
async function fetchStockPhotoForHint(hint: string): Promise<StockImageResult | null> {
  const query = hint.trim();
  if (!query) return null;
  try {
    const res = await fetch(`/api/stock-images/search?query=${encodeURIComponent(query)}&per_page=1`);
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: StockImageResult[] };
    return data.results?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Fire-and-forget Unsplash download-tracking ping (API Guidelines require
 *  this once a photo is actually applied, not just previewed). */
function trackStockPhotoDownload(result: StockImageResult): void {
  if (result.provider !== "unsplash" || !result.downloadLocation) return;
  void fetch("/api/stock-images/track-download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ downloadLocation: result.downloadLocation }),
  }).catch(() => {});
}

export default function EditorReactClient({
  deckId,
  templateMode = false,
}: {
  deckId: string;
  /** Template-engine mode: the "deck" is a theme, its slides are that theme's
   *  layouts, and edits are saved to template storage instead of the deck API.
   *  Everything else — canvas, toolbars, undo, insert panel — is the editor
   *  the authors already know, which is the point of running it as a mode
   *  rather than a fork. */
  templateMode?: boolean;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const reduxStore = useStore<RootState>();
  const presentationData = useSelector(
    (s: RootState) => s.presentationGeneration.presentationData
  );
  const token = useSessionStore((s) => s.token);
  const searchParams = useSearchParams();
  const autoGenerateRan = useRef(false);
  /** The homepage's "Stock photos" toggle (?images=stock), captured once at
   *  generation time so regenerate_slide (a separate code path) can honour
   *  the same choice without re-parsing searchParams. */
  const imageSourceRef = useRef<"ai" | "stock">("ai");

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
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  /** Sub-status during generation ("Reviewing slide 2 of 9…") shown under
   *  the spinner. */
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  // Template mode only.
  const [themes, setThemes] = useState<TemplateTheme[]>([]);
  const [templateThemeId, setTemplateThemeId] = useState(
    () => searchParams?.get("theme") ?? DEFAULT_THEME_ID
  );
  /** The theme the canvas was hydrated from, or null for a blank canvas. */
  const [templateOriginThemeId, setTemplateOriginThemeId] = useState<string | null>(
    null
  );
  const [templateSelection, setTemplateSelection] =
    useState<TemplateSelectionPayload | null>(null);
  /** A pasted image the author chose to keep in the reusable element library. */
  const [libraryImage, setLibraryImage] = useState<PastedImage | null>(null);
  const [generationError, setGenerationError] = useState<{
    message: string;
    topic: string;
    language?: string;
    /** Carried into "Try Again" so a retry honours the homepage toggle. */
    withReview?: boolean;
    /** Per-section provider choices from the homepage, carried into retry. */
    providers?: { verify?: string | null; repair?: string | null };
    /** Homepage image-source toggle, carried into retry. */
    imageSource?: "ai" | "stock";
  } | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [handTool, setHandTool] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Panning only makes sense once the slide is larger than its viewport. */
  const canPan = zoom > 1;

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Below 100% the whole slide fits, so any offset is just the slide sitting
  // off-centre with no way to notice. Recentre and drop the hand tool.
  useEffect(() => {
    if (canPan) return;
    setHandTool(false);
    setPan((current) => (current.x === 0 && current.y === 0 ? current : { x: 0, y: 0 }));
  }, [canPan]);

  const startEditingTitle = () => {
    setTitleDraft(presentationData?.title ?? "Untitled Presentation");
    setIsEditingTitle(true);
    // Focus+select after the input actually mounts (it's conditionally
    // rendered), not on this same synchronous pass.
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  };

  const commitTitle = () => {
    setIsEditingTitle(false);
    const next = titleDraft.trim();
    if (!next || !presentationData || next === presentationData.title) return;
    dispatch(setPresentationData({ ...presentationData, title: next }));
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
        setZoom((z) => clampZoom(z + delta));
      } else if (zoomRef.current > 1) {
        e.preventDefault();
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Panning is opt-in via the hand tool. It used to trigger on any drag while
  // zoomed in, which meant dragging an element also dragged the canvas out
  // from under it. Middle-drag still pans without switching tools.
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (!canPan) return;
    const wantsPan = handTool ? e.button === 0 || e.button === 1 : e.button === 1;
    if (!wantsPan) return;
    e.preventDefault();
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

  // Template mode opens either a whole theme or an empty canvas.
  //
  // `?theme=<id>` — how /template-list links here — loads every layout of that
  // theme as a page, so an existing pack can be reopened and edited rather than
  // only added to. Without it (or for a theme with no layouts yet) the canvas
  // starts blank, which is what authoring a new template wants. Either way the
  // theme selector picks the save target; switching it does not touch the
  // canvas.
  useEffect(() => {
    if (!templateMode) return;
    let cancelled = false;
    (async () => {
      const all = await loadAllThemes();
      if (cancelled) return;
      setThemes(all);
      if (all.length === 0) {
        setError("No template themes found in storage.");
        setLoading(false);
        return;
      }

      const requestedId = searchParams?.get("theme") ?? null;
      const requested = requestedId
        ? all.find((theme) => theme.id === requestedId) ?? null
        : null;
      // Cloned: these records are the theme registry's cached copies, and the
      // canvas is about to be edited in place from here on.
      const pages = (requested?.layouts ?? []).map(
        (layout) => structuredClone(layout) as Record<string, unknown>
      );
      // Remembered separately from the save-target selector, which the author
      // can point anywhere: only a canvas actually hydrated FROM a theme holds
      // that theme's full set of layouts, and only then may saving it delete
      // the ones no longer on the canvas.
      setTemplateOriginThemeId(requested?.id ?? null);

      dispatch(
        setPresentationData({
          id: "template-engine",
          title: requested ? requested.name : "Untitled template",
          slides:
            pages.length > 0
              ? pages.map((ui) => ({ ui }))
              : [{ ui: blankTemplateLayout() }],
        } as never)
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch, searchParams, templateMode]);

  // Load deck → init Redux presentationData (or fall back to default template).
  useEffect(() => {
    if (templateMode) return;
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
  }, [deckId, token, dispatch, templateMode]);

  // Persist edits back to the API (debounced) whenever the deck changes.
  // Template mode saves explicitly to disk instead — an autosave here would
  // write half-finished layouts into the repo on every drag.
  useEffect(() => {
    if (templateMode) return;
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
  }, [presentationData, token, deckId, templateMode]);

  // Keep activeIndex in bounds after delete.
  const slides = presentationData?.slides ?? [];
  const safeActive = Math.min(activeIndex, Math.max(0, slides.length - 1));
  const activeUi = slides[safeActive]?.ui ?? null;

  const handleTemplateSelection = useCallback(
    (payload: TemplateSelectionPayload | null) => setTemplateSelection(payload),
    []
  );

  /** Every page on the template canvas — the engine's Theme scope saves the
   *  whole canvas at once, not just the page being looked at. */
  const templatePageUis = useMemo(
    () =>
      templateMode
        ? slides.map(
            (slide) => (slide?.ui ?? null) as Record<string, unknown> | null
          )
        : [],
    [slides, templateMode]
  );

  /** Stamps the layout identity a save assigned onto the pages themselves.
   *
   *  The panel is unmounted whenever its flyout closes, so an id it only held
   *  in its own state was gone by the next save — which then allocated a fresh
   *  id per page and wrote a second copy of the whole theme. The page carries
   *  it now, which is also how a theme opened from /template-list arrives. */
  const handleTemplatePagesPersisted = useCallback(
    (
      pages: {
        index: number;
        id: string;
        description: string;
        meta: Record<string, unknown>;
      }[]
    ) => {
      pages.forEach(({ index, id, description, meta }) => {
        dispatch(
          patchSlideUi({
            index,
            patch: { id, description, ...(meta ? { meta } : {}) },
          })
        );
      });
    },
    [dispatch]
  );

  // A saved layout changes the theme's layout list (and its id set), so pull
  // the registry again rather than trusting the page-lifetime cache.
  const handleTemplateSaved = useCallback(async () => {
    invalidateThemeCache();
    setThemes(await loadAllThemes());
  }, []);

  /** "Apply all N pages": adds a whole theme at once. Lands on the untouched
   *  blank slide the editor starts with (replacing it) rather than leaving an
   *  empty slide in front of the theme; otherwise it appends after the current
   *  slide so an existing deck is never discarded. */
  const handleApplyAllLayouts = useCallback(
    (layouts: Record<string, unknown>[], themeName: string) => {
      if (layouts.length === 0) return;
      const onlyUntouchedBlank =
        slides.length === 1 && isBlankTemplateUi(slides[0]?.ui);
      dispatch(
        addSlides({
          uis: layouts,
          atIndex: safeActive + 1,
          replaceAll: onlyUntouchedBlank,
        })
      );
      setActiveIndex(onlyUntouchedBlank ? 0 : safeActive + 1);
      notify.success(`Added ${layouts.length} ${themeName} layouts`);
    },
    [dispatch, safeActive, slides]
  );

  /** A freshly created theme is empty, so switching to it immediately is the
   *  only useful next step — the author made it to save into. */
  const handleThemeCreated = useCallback(async (newThemeId: string) => {
    invalidateThemeCache();
    setThemes(await loadAllThemes());
    setTemplateThemeId(newThemeId);
    notify.success(`Theme "${newThemeId}" created`);
  }, []);

  const handleThemeDeleted = useCallback(
    async (deletedThemeId: string) => {
      invalidateThemeCache();
      const next = await loadAllThemes();
      setThemes(next);
      // The canvas keeps whatever is on it; only the save target has to move.
      setTemplateThemeId((current) =>
        current === deletedThemeId ? next[0]?.id ?? DEFAULT_THEME_ID : current
      );
      notify.success(`Theme "${deletedThemeId}" deleted`);
    },
    []
  );

  const handleLayoutDeleted = useCallback(async (layoutId: string) => {
    invalidateThemeCache();
    setThemes(await loadAllThemes());
    notify.success(`Layout "${layoutId}" deleted`);
  }, []);

  const handleAddBlankTemplate = useCallback(() => {
    dispatch(addSlide({ ui: blankTemplateLayout(), atIndex: safeActive + 1 }));
    setActiveIndex(safeActive + 1);
  }, [dispatch, safeActive]);

  /** Drops the pages of an imported .pptx onto the template canvas. The
   *  untouched blank the engine opens on is replaced rather than kept — it is a
   *  starting point, not something the author put there. */
  const handleImportTemplatePages = useCallback(
    (pages: Record<string, unknown>[]) => {
      if (pages.length === 0) return;
      const replaceBlank = slides.length === 1 && isBlankTemplateUi(slides[0]?.ui);
      dispatch(
        addSlides({
          uis: pages,
          atIndex: safeActive + 1,
          replaceAll: replaceBlank,
        })
      );
      setActiveIndex(replaceBlank ? 0 : safeActive + 1);
    },
    [dispatch, safeActive, slides],
  );

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

  // Held in refs so the paste listener is registered once instead of on every
  // slide change, while still acting on the slide that is current when the
  // image finishes decoding.
  const activeUiRef = useRef(activeUi);
  activeUiRef.current = activeUi;
  const handleInsertRef = useRef(handleInsert);
  handleInsertRef.current = handleInsert;

  // Ctrl+V for an image copied from anywhere else. The surface's own clipboard
  // hook handles the editor's element payload and ignores image files, so this
  // fills that gap without disturbing element paste; a paste aimed at a text
  // field is left to that field.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isTextEntryTarget(event.target)) return;
      const file = imageFileFromClipboard(event.clipboardData);
      if (!file || !activeUiRef.current) return;
      event.preventDefault();
      void readImageFile(file)
        .then((image) => {
          const ui = activeUiRef.current;
          if (!ui) return;
          handleInsertRef.current(
            withPastedImage(ui as never, image) as Record<string, unknown>
          );
          // Onto the slide by default; keeping it for future templates is one
          // click away rather than a separate upload trip.
          notify.success("Image pasted", undefined, {
            action: {
              label: "Save to My elements",
              onClick: () => setLibraryImage(image),
            },
          });
        })
        .catch((error: unknown) =>
          notify.error(
            error instanceof Error ? error.message : "Could not paste the image"
          )
        );
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  // Streams AIPPTSlide JSONL for a topic and appends each mapped slide.
  // Shared by the AI Assistant's create_deck tool and the one-time
  // auto-generate-on-open flow (?prompt= from the homepage). Throws on real
  // failure (bad response, dead stream) so callers can show a graceful
  // error + retry (PRD #19) instead of silently ending up with 0 slides.
  const generateDeckFromTopic = async (
    topic: string,
    language?: string,
    model?: string,
    withReview = true,
    providers?: { verify?: string | null; repair?: string | null },
    imageSource: "ai" | "stock" = "ai",
  ): Promise<number> => {
    if (!token) return 0;
    imageSourceRef.current = imageSource;
    // Resolve the theme FIRST and fetch its layout manifest — with the
    // manifest in the request body the worker switches to the slot-by-slot
    // contract (model fills NAMED slots under their authored budgets) instead
    // of the legacy 5-type guess-where-text-goes contract.
    //
    // Priority: a theme named explicitly in the prompt wins; otherwise the
    // theme-choice step (Kimi + the themes' authored when_to_use/avoid_when)
    // picks one; the DeckLayoutPicker seed hash is only the last-resort
    // fallback when the choice call fails or declines.
    const askedTheme = await resolveThemeFromPrompt(topic);
    let preferredTheme = askedTheme;
    let themeChoiceReason: string | null = null;
    if (!preferredTheme) {
      setGenerationStatus("Choosing a theme…");
      const choice = await chooseThemeForTopic(topic, language);
      if (choice) {
        preferredTheme = choice.themeId;
        themeChoiceReason = choice.reason;
      }
    }
    const layoutPicker = new DeckLayoutPicker(topic, preferredTheme);
    await layoutPicker.ensureLoaded();
    const themeId = layoutPicker.getThemeId();
    const manifest = themeId ? await fetchThemeManifest(themeId) : null;
    const chosenThemeName =
      manifest && typeof (manifest as { name?: unknown }).name === "string"
        ? String((manifest as { name?: unknown }).name)
        : null;
    if (chosenThemeName) {
      setGenerationStatus(
        themeChoiceReason
          ? `${chosenThemeName} — ${themeChoiceReason}`
          : `Using the “${chosenThemeName}” theme…`,
      );
    }

    const res = await streamAipptDeck(token, { content: topic, language, model, manifest: manifest ?? undefined });
    if (!(res instanceof Response) || !res.body) {
      const message =
        res && typeof res === "object" && "message" in res
          ? String((res as { message?: unknown }).message)
          : "Couldn't start generation.";
      throw new Error(message);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let count = 0;
    const currentToken = token;
    /** Fills per generated slide (manifest mode), for the visual review pass. */
    const slideManifestLines = new Map<number, ManifestSlideLine>();

    // Resolve the chosen pack's font map up front and reset the deck in ONE
    // dispatch. Splitting these used to be a stale-closure bug: the second
    // dispatch spread the PRE-generation `presentationData` (still holding the
    // old slides) back over the just-cleared `slides: []`, so a regenerate on
    // an already-populated deck appended new slides on top of the old ones.
    const deckFonts = layoutPicker.getFonts();
    dispatch(setPresentationData({
      ...(presentationData ?? { id: deckId, title: topic, slides: [] }),
      slides: [],
      ...(deckFonts ? { fonts: deckFonts } : {}),
    }));

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

    // Template colors are kept VERBATIM — the generator only swaps text (and
    // photos) inside the hand-designed layout. The old flow asked the LLM for
    // a theme color and repainted every slide with a derived palette here;
    // that whole path is gone, so a generated deck looks exactly like the
    // theme the user picked.

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
    ) => {
      // An authored slot hint ("what photo belongs here", written by hand or
      // by auto-label) is a far better generation prompt than the generic
      // slide subject — use it verbatim when the slot carries one.
      const hint = findPhotoSlotHint(getUi(), marker);
      const prompt = hint
        ? `${hint}. ${heroStyle}`
        : `${subject} — related to ${topic}. ${heroStyle}`;

      const applyAiGenerated = () => {
        void generateImage(currentToken, prompt).then((dataUrl) => {
          if (!dataUrl) return;
          const patched = patchHeroImage(getUi(), marker, dataUrl) as Record<string, unknown>;
          setUi(patched);
          dispatch(updateSlideUi({ index, ui: patched }));
        });
      };

      // "Stock photos" mode: search first, using the same hint that would
      // otherwise become the AI prompt. Empty/failed search falls back to AI
      // generation — a slot must never end up unfilled just because the
      // stock search had no match.
      if (imageSource !== "stock") {
        applyAiGenerated();
        return;
      }
      void fetchStockPhotoForHint(hint || `${subject} ${topic}`).then((result) => {
        if (!result) {
          applyAiGenerated();
          return;
        }
        const patched = patchHeroImage(getUi(), marker, result.url, {
          credit: result.credit,
          credit_url: result.creditUrl ?? null,
          source_url: result.sourceUrl,
        }) as Record<string, unknown>;
        setUi(patched);
        dispatch(updateSlideUi({ index, ui: patched }));
        trackStockPhotoDownload(result);
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
      if (heroImage) requestPhotoForSlot(index, getUi, setUi, heroImage, subject);
      for (const marker of secondaryImages) {
        requestPhotoForSlot(index, getUi, setUi, marker, subject);
      }
    };

    const mapLine = async (
      line: string,
      pageNumber: number,
    ): Promise<{
      ui: Record<string, unknown>;
      heroImage: { componentId: string; elementName: string; occurrenceIndex: number } | null;
      secondaryImages: { componentId: string; elementName: string; occurrenceIndex: number }[];
      subject: string;
      /** Present when the line came from the manifest contract — kept per
       *  slide so the post-generation visual review can reference the fills. */
      manifestLine?: ManifestSlideLine;
    } | null> => {
      try {
        // Manifest-driven contract first: the model picked the layout id and
        // wrote copy per named slot — the client only applies + enforces.
        const manifestLine = parseManifestSlideLine(line);
        if (manifestLine) {
          const layout = layoutPicker.getLayoutById(manifestLine.layout_id);
          const filled = await fillManifestSlide(layout, manifestLine, { topic, pageNumber });
          if (!filled) return null;
          const subject =
            manifestLine.fills.find((f) => /title|headline|heading/i.test(f.name))?.text || topic;
          return {
            ui: filled.ui,
            heroImage: filled.heroImage,
            secondaryImages: filled.secondaryImages,
            subject,
            manifestLine,
          };
        }
        const slide = JSON.parse(line) as AIPPTSlide;
        const filled = await mapAIPPTSlideToTemplateUi(slide, layoutPicker);
        if (!filled) return null;
        return {
          ui: filled.ui,
          heroImage: filled.heroImage,
          secondaryImages: filled.secondaryImages,
          subject: slideSubject(slide),
        };
      } catch {
        return null;
      }
    };

    // Legacy `{"type":"theme","color":...}` lines (from a worker build that
    // still emits them) are swallowed and IGNORED — template colors win,
    // always. Kept as a filter so a stray theme line is never misparsed as
    // a slide.
    const tryApplyThemeLine = (line: string): boolean => {
      try {
        const parsed = JSON.parse(line) as { type?: string };
        return parsed.type === "theme";
      } catch {
        return false;
      }
    };

    // Worker failures arrive as {"type":"error","message":...} — surface the
    // real reason (provider quota, LLM outage, ...) instead of "0 slides".
    const throwIfErrorLine = (line: string): void => {
      try {
        const parsed = JSON.parse(line) as { type?: string; message?: string };
        if (parsed.type === "error") {
          throw new Error(parsed.message || "Generation failed on the server.");
        }
      } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
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
          throwIfErrorLine(buf.trim());
          const filled = await mapLine(buf.trim(), count + 1);
          if (filled) {
            const index = count;
            dispatch(addSlide({ ui: filled.ui }));
            if (filled.manifestLine) slideManifestLines.set(index, filled.manifestLine);
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
        throwIfErrorLine(t);
        const filled = await mapLine(t, count + 1);
        if (filled) {
          const index = count;
          dispatch(addSlide({ ui: filled.ui }));
          if (filled.manifestLine) slideManifestLines.set(index, filled.manifestLine);
          count++;
          setActiveIndex(0);
          requestSlidePhotos(index, filled.ui, filled.heroImage, filled.secondaryImages, filled.subject);
        }
      }
    }

    // Post-generation visual review: each slide is rendered and shown to Kimi
    // vision; fixable issues (overflow, placeholder leftovers, wrong length
    // for the box, ...) go back for up to MAX_REVIEW_PASSES targeted
    // verify→repair rounds. Only the manifest contract carries per-slot fills,
    // so legacy-mode decks skip this — and the homepage toggle (?review=off)
    // skips it entirely for a faster, cheaper run. Failures are silent — a
    // reviewed deck is a bonus, never a blocker.
    if (withReview && slideManifestLines.size > 0) {
      let reviewed = 0;
      for (const [slideIndex, manifestLine] of slideManifestLines) {
        reviewed += 1;
        setGenerationStatus(`Reviewing slide ${reviewed} of ${slideManifestLines.size}…`);
        try {
          const layout = layoutPicker.getLayoutById(manifestLine.layout_id);
          const textFills = manifestLine.fills
            .filter((f) => f.text)
            .map((f) => ({ name: f.name, text: f.text }));

          // Each slide gets up to MAX_REVIEW_PASSES verify→repair rounds. Pass
          // 1 catches the issues the initial fill left; pass 2 re-verifies the
          // repaired slide and repairs again if the fix introduced a new issue
          // (e.g. a shortened string that now wraps differently). A clean
          // verify short-circuits the loop early.
          for (let pass = 1; pass <= MAX_REVIEW_PASSES; pass++) {
            if (pass > 1) {
              setGenerationStatus(`Re-verifying slide ${reviewed} of ${slideManifestLines.size}…`);
            }
            const freshUi = reduxStore.getState().presentationGeneration.presentationData
              ?.slides[slideIndex]?.ui;
            if (!freshUi) break;
            const image = await captureSlidePng(freshUi);
            if (!image) break;

            const verifyRes = await fetch("/api/ai/visual-review", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "verify",
                image,
                topic,
                language: language ?? "Bahasa Indonesia",
                slots: layout ? describeLayoutSlots(layout) : [],
                fills: textFills,
                provider: providers?.verify ?? null,
              }),
            });
            const verifyBody = await verifyRes.json().catch(() => null);
            const issues = Array.isArray(verifyBody?.issues) ? verifyBody.issues : [];
            if (issues.length === 0) break; // slide passed, no more passes needed

            setGenerationStatus(`Fixing slide ${reviewed} of ${slideManifestLines.size}…`);
            const repairRes = await fetch("/api/ai/visual-review", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "repair",
                language: language ?? "Bahasa Indonesia",
                slots: layout ? describeLayoutSlots(layout) : [],
                fills: textFills,
                issues,
                provider: providers?.repair ?? null,
              }),
            });
            const repairBody = await repairRes.json().catch(() => null);
            const repaired = Array.isArray(repairBody?.fills) ? repairBody.fills : [];
            if (repaired.length === 0) break; // nothing to apply, stop
            dispatch(updateSlideUi({ index: slideIndex, ui: applyFillsToUi(freshUi, repaired) }));
            // loop continues to re-verify (unless this was the last pass)
          }
        } catch {
          // one slide's review failing must never abort the rest
        }
      }
      setGenerationStatus(null);
    }
    return count;
  };

  // Auto-generate once when opened with ?prompt= (homepage "Generate" flow
  // creates an empty deck, then routes here with the prompt in the query
  // string — cross-origin-safe, survives a reload). ?review=off comes from
  // the homepage toggle and skips the post-generation Kimi visual review.
  // ?gen= / ?verify= / ?repair= carry the per-section provider choices from
  // the homepage dropdowns; absent = the server applies its default.
  // ?images=stock switches photo slots from AI generation to stock-photo
  // search (falls back to AI per-slot if a search comes up empty).
  useEffect(() => {
    if (autoGenerateRan.current || loading || !token) return;
    const prompt = searchParams.get("prompt");
    if (!prompt) return;
    autoGenerateRan.current = true;
    const language = searchParams.get("lang") ?? undefined;
    const genProvider = searchParams.get("gen") ?? undefined;
    const verifyProvider = searchParams.get("verify") ?? null;
    const repairProvider = searchParams.get("repair") ?? null;
    const withReview = searchParams.get("review") !== "off";
    const imageSource = searchParams.get("images") === "stock" ? "stock" : "ai";
    runGeneration(prompt, language, genProvider, withReview, { verify: verifyProvider, repair: repairProvider }, imageSource);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, token, searchParams]);

  // Shared by the auto-generate effect and the "Try Again" button — keeps
  // the original prompt text around on failure so retrying doesn't require
  // retyping it (PRD #19).
  const runGeneration = (
    topic: string,
    language?: string,
    model?: string,
    withReview = true,
    providers?: { verify?: string | null; repair?: string | null },
    imageSource: "ai" | "stock" = "ai",
  ) => {
    setGenerationError(null);
    setGenerationStatus(null);
    setIsGenerating(true);
    generateDeckFromTopic(topic, language, model, withReview, providers, imageSource)
      .catch((e) => {
        setGenerationError({
          message: e instanceof Error ? e.message : "Something went wrong while generating your deck.",
          topic,
          language,
          withReview,
          providers,
          imageSource,
        });
      })
      .finally(() => {
        setIsGenerating(false);
        setGenerationStatus(null);
      });
  };

  const retryGeneration = () => {
    if (!generationError) return;
    runGeneration(
      generationError.topic,
      generationError.language,
      undefined,
      generationError.withReview,
      generationError.providers,
      generationError.imageSource,
    );
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

          const applyAiGenerated = () => {
            const prompt = `${imagePrompt}. editorial photograph, cinematic natural lighting, cohesive color grading, no text, no watermark, no logo`;
            void generateImage(token, prompt).then((dataUrl) => {
              if (!dataUrl) return;
              dispatch(updateSlideUi({ index: slideIndex, ui: patchHeroImage(baseUi, marker, dataUrl) }));
            });
          };

          // Honours the same homepage image-source toggle used at
          // generation time (imageSourceRef, set once per deck generation);
          // falls back to AI generation if the stock search comes up empty.
          if (imageSourceRef.current === "stock") {
            void fetchStockPhotoForHint(imagePrompt).then((result) => {
              if (!result) {
                applyAiGenerated();
                return;
              }
              dispatch(updateSlideUi({
                index: slideIndex,
                ui: patchHeroImage(baseUi, marker, result.url, {
                  credit: result.credit,
                  credit_url: result.creditUrl ?? null,
                  source_url: result.sourceUrl,
                }),
              }));
              trackStockPhotoDownload(result);
            });
          } else {
            applyAiGenerated();
          }
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
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTitle();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setIsEditingTitle(false);
                }
              }}
              className="min-w-0 max-w-[240px] rounded-md border border-[var(--accent)]/50 bg-[var(--bg-surface)] px-1.5 py-0.5 text-sm font-medium text-[var(--text-primary)] outline-none"
            />
          ) : (
            <h1
              onDoubleClick={startEditingTitle}
              title="Double-click to rename"
              className="min-w-0 shrink cursor-text truncate text-sm font-medium text-[var(--text-primary)]"
            >
              {presentationData?.title ?? "Untitled Presentation"}
            </h1>
          )}
          <button
            onClick={() => window.open("/editor-react", "_blank")}
            title="Create new design"
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            Create new design
          </button>
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
          <div className="relative">
            <ToolButton
              size="sm"
              active={showVersionHistory}
              onClick={() => setShowVersionHistory((v) => !v)}
              title="Version History"
            >
              <History className="h-3.5 w-3.5" />
            </ToolButton>
            {showVersionHistory && token && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-50">
                <VersionHistoryPanel
                  token={token}
                  deckId={deckId}
                  onRestored={(payload) => {
                    const adapted = adaptDeckToPresentation(deckId, payload);
                    if (adapted) dispatch(setPresentationData(adapted));
                  }}
                  onClose={() => setShowVersionHistory(false)}
                />
              </div>
            )}
          </div>
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
      <SlideCaptureHost />
      <div className="flex flex-1 overflow-hidden">
        <InsertToolbar
          activeUi={activeUi}
          onInsert={handleInsert}
          onApplyColorToSelection={handleApplyColorToSelection}
          onApplyAllLayouts={handleApplyAllLayouts}
          templatePanel={
            templateMode ? (
              <TemplateEnginePanel
                themes={themes}
                themeId={templateThemeId}
                onThemeChange={setTemplateThemeId}
                activeIndex={safeActive}
                activeUi={activeUi as Record<string, unknown> | null}
                pageUis={templatePageUis}
                selection={templateSelection}
                onSaved={handleTemplateSaved}
                onPagesPersisted={handleTemplatePagesPersisted}
                onAddBlank={handleAddBlankTemplate}
                onImportPages={handleImportTemplatePages}
                onThemeCreated={handleThemeCreated}
                onThemeDeleted={handleThemeDeleted}
                onLayoutDeleted={handleLayoutDeleted}
                onThemeUpdated={handleTemplateSaved}
                onApplyPageUi={(index, ui) => dispatch(updateSlideUi({ index, ui }))}
                originThemeId={templateOriginThemeId}
              />
            ) : undefined
          }
        />
        <div
          ref={canvasAreaRef}
          id="onboarding-canvas"
          className="editor-canvas-grid relative flex flex-1 items-center justify-center overflow-hidden"
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
          style={{
            cursor: isPanning ? "grabbing" : handTool ? "grab" : "default",
          }}
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
                // With the hand tool up, the slide must not swallow the drag —
                // otherwise Konva starts moving an element mid-pan.
                pointerEvents: handTool ? "none" : undefined,
              }}
            >
              <TemplateV2KonvaSlide
                key={safeActive}
                layout={activeUi as never}
                isEditMode={!slides[safeActive]?.isLocked}
                slideId={null}
                presentationId={deckId}
                slideIndex={safeActive}
                fonts={presentationData?.fonts}
                onTemplateSelection={
                  templateMode ? handleTemplateSelection : undefined
                }
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
              {generationStatus && (
                <p className="text-xs text-[var(--text-muted)]">{generationStatus}</p>
              )}
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
              onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
              title="Zoom out"
            >
              <ZoomOut size={15} />
            </ToolButton>
            <input
              type="range"
              min={ZOOM_MIN * 100}
              max={ZOOM_MAX * 100}
              step={5}
              value={Math.round(zoom * 100)}
              onChange={(event) => setZoom(Number(event.target.value) / 100)}
              aria-label="Zoom"
              title={`Zoom ${Math.round(zoom * 100)}%`}
              // The filled portion of the track is painted with a gradient
              // stop — range inputs have no cross-browser "progress" part.
              style={{
                background: `linear-gradient(to right, var(--accent) ${zoomFraction(zoom)}%, var(--border-strong) ${zoomFraction(zoom)}%)`,
              }}
              className="mx-1 h-1 w-24 cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[var(--shadow-soft)]"
            />
            <ToolButton
              size="sm"
              onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
              title="Zoom in"
            >
              <ZoomIn size={15} />
            </ToolButton>
            <ToolButton
              size="sm"
              onClick={resetView}
              title="Reset to 100%"
              className="min-w-[46px] tabular-nums"
            >
              {Math.round(zoom * 100)}%
            </ToolButton>
            <ToolDivider className="mx-0.5 h-4" />
            <ToolButton
              size="sm"
              active={handTool}
              disabled={!canPan}
              onClick={() => setHandTool((v) => !v)}
              title={
                canPan
                  ? handTool
                    ? "Hand tool on — drag to move the slide"
                    : "Hand tool — drag to move the slide"
                  : "Zoom past 100% to pan"
              }
            >
              <Hand size={13} />
            </ToolButton>
            <ToolButton size="sm" onClick={resetView} title="Fit to screen">
              <Maximize2 size={13} />
            </ToolButton>
          </div>
        </div>
        {/* The AI assistant is the one panel that stays on the right — it is a
            conversation alongside the work, not a tool you reach for. */}
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
      <div id="onboarding-sidebar" className="shrink-0">
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
      {libraryImage && (
        <SaveToLibraryDialog
          image={libraryImage}
          onClose={() => setLibraryImage(null)}
          onSaved={(category) => notify.success(`Saved to "${category}"`)}
        />
      )}
      <Toaster />
      {presenting && (
        <PresentMode
          slides={slides}
          startIndex={safeActive}
          deckId={deckId}
          fonts={presentationData?.fonts}
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
