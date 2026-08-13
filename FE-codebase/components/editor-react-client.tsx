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
import { getGlobalFonts } from "@/lib/fonts/global-fonts";
import type { StockImageResult } from "@/lib/stock-image-providers";
import {
  DEFAULT_THEME_ID,
  invalidateThemeCache,
  loadAllThemes,
  loadDefaultTheme,
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
  fillPlaceholderIcons,
  resolveThemeFromPrompt,
  type AIPPTSlide,
  type HeroImageMarker,
} from "@/components/editor-react/ai-layout-fill";
import {
  fillManifestSlide,
  parseManifestSlideLine,
  parseSlideStartLine,
  parseStreamFillLine,
  isSlideEndLine,
  applyFillsToUi,
  buildEmptySlideUi,
  finalizeStreamedSlide,
  describeLayoutSlots,
  type ManifestSlideLine,
  type SlotFill,
} from "@/components/editor-react/ai-slot-fill";
import { captureSlidePng } from "@/components/editor-react/slide-capture";
import {
  applyFontToAllSlides,
  applyThemeToAllSlides,
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
  // loadDefaultTheme, not loadTheme(DEFAULT_THEME_ID) — the default theme id
  // can point at an entry with zero layouts, and a blank deck needs an
  // actually-populated theme to start from, not {}.
  const theme = await loadDefaultTheme();
  return theme?.layouts[0] ?? {};
}

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.2;

// Per-slide verify→repair rounds in the visual review (pipelined behind
// generation — each slide is reviewed as soon as its slide_end arrives).
// Pass 1 fixes the initial fill's issues; pass 2 re-verifies the repaired
// slide and fixes again if the repair itself introduced a new issue. A clean
// verify short-circuits early, so clean slides still cost only one call.
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

const STOCK_QUERY_STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "with", "and", "or",
  "that", "this", "such", "as", "is", "are", "be", "high", "quality",
  "related", "topic", "topic's",
]);

/** AI-authored photo hints ("A candid lifestyle or adventure shot, square
 *  orientation.") are full sentences meant as generation prompts — but
 *  Unsplash/Pixabay's search is keyword-oriented and unreliable on them
 *  (verified empirically: some full-sentence hints return ZERO results,
 *  where the same words as bare keywords return thousands). Strips
 *  punctuation and filler words, keeps the first few remaining words —
 *  composition/orientation notes ("square orientation") are usually near
 *  the end of the sentence, so capping naturally drops them along with the
 *  filler. Never returns empty for non-empty input. */
function simplifyStockSearchQuery(text: string): string {
  const clean = text.replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = clean
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOCK_QUERY_STOPWORDS.has(w.toLowerCase()));
  const simplified = words.slice(0, 6).join(" ").trim();
  return simplified || clean.trim().split(/\s+/).slice(0, 6).join(" ");
}

/** Search results for a stock-photo hint, for the homepage's "Stock photos"
 *  image-source mode. Same-origin fetch to this app's own route — the
 *  provider keys live server-side in lib/stock-image-providers.ts and are
 *  never reachable from client code directly. Fetches a small pool (not just
 *  the top hit) so the caller can skip photos already used elsewhere in the
 *  same deck — many photo slots share the same generic authored hint (e.g.
 *  "A scenic travel or adventure photo..."), and a fixed search always
 *  returns the same top result for the same query, so always taking #1
 *  means every slot with that hint gets the identical photo. Never throws:
 *  returns [] on any failure so callers fall back to AI generation. */
async function fetchStockPhotosForHint(hint: string, perPage = 8): Promise<StockImageResult[]> {
  const query = simplifyStockSearchQuery(hint.trim());
  if (!query) return [];
  try {
    const res = await fetch(`/api/stock-images/search?query=${encodeURIComponent(query)}&per_page=${perPage}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: StockImageResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

/** First result whose id hasn't been used yet in this deck; falls back to
 *  the top result (accepting a repeat) rather than leaving a slot empty if
 *  every candidate in the pool is already taken. */
function pickUnusedStockPhoto(
  results: StockImageResult[],
  usedIds: Set<string>,
): StockImageResult | null {
  if (results.length === 0) return null;
  return results.find((r) => !usedIds.has(r.id)) ?? results[0];
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
  /** Stock-photo ids already used in this deck (across every slide), so the
   *  same photo doesn't get reused for a different slot just because two
   *  slots share a generic hint. Reset per deck generation; regenerate_slide
   *  adds to the same set so a regenerated slide doesn't reintroduce a photo
   *  already sitting on another slide. */
  const usedStockPhotoIdsRef = useRef<Set<string>>(new Set());
  /** The theme id generation actually resolved to (explicit ask, or
   *  chooseThemeForTopic's pick). add_slide and regenerate_slide read this so
   *  a slide added/redone via chat matches the deck's REAL current template,
   *  instead of re-deriving a theme from a DeckLayoutPicker(deckId) seed hash
   *  that has no relationship to how the deck's theme was actually chosen at
   *  generation time. Set on generation, AND restored from the deck's saved
   *  payload.deckThemeId on load (the save effect below writes it back) — so
   *  a reopened deck still knows its own theme, not just one generated fresh
   *  this session. A deck saved before this field existed has none stored;
   *  falls back to the seed hash same as before until it's saved once. */
  const currentThemeIdRef = useRef<string | null>(null);

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
      // Global font library: uploaded once anywhere, available in every
      // context. Merged UNDER the theme's own fonts so a theme-defined family
      // always wins a same-named global one.
      const globalFonts = await getGlobalFonts();
      if (cancelled) return;
      const mergedFonts = { ...globalFonts, ...(requested?.fonts ?? {}) };
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
          // Seed the theme's font map (plus the global library) so uploaded
          // fonts survive a reload — registerThemeFont persists bundle.fonts
          // to template.json, and loadTheme surfaces it as requested.fonts,
          // but without seeding it here presentationData.fonts stays
          // undefined on every reopen and the canvas loses the font until
          // the next in-session upload.
          ...(Object.keys(mergedFonts).length > 0 ? { fonts: mergedFonts } : {}),
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
        const [deck, globalFonts] = await Promise.all([
          getDeck(token, deckId),
          getGlobalFonts(),
        ]);
        const rawPayload = deck.payload as Record<string, unknown> | null;
        // Survives reload: a deck saved after this session's autosave carries
        // the theme id it was generated with (see the save effect below), so
        // add_slide/regenerate_slide can pin to it immediately on reopen
        // instead of falling back to a DeckLayoutPicker seed hash that has no
        // relationship to which theme the deck actually uses. Decks saved
        // before this existed just have no field here — same fallback as
        // before.
        currentThemeIdRef.current =
          rawPayload && typeof rawPayload.deckThemeId === "string" ? rawPayload.deckThemeId : null;
        const adapted = adaptDeckToPresentation(deckId, rawPayload);
        if (cancelled) return;
        if (adapted && adapted.slides.length > 0) {
          // The global font library rides along under the deck's own saved
          // fonts, so an uploaded font is usable in every deck — even decks
          // saved before the library existed.
          const mergedFonts = {
            ...globalFonts,
            ...((adapted.fonts as Record<string, string> | null) ?? {}),
          };
          dispatch(
            setPresentationData({
              ...adapted,
              ...(Object.keys(mergedFonts).length > 0
                ? { fonts: mergedFonts }
                : {}),
            })
          );
        } else {
          const layout = await loadDefaultLayout();
          if (cancelled) return;
          dispatch(
            setPresentationData({
              id: deckId,
              title: deck.title,
              ...(Object.keys(globalFonts).length > 0
                ? { fonts: globalFonts }
                : {}),
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
            // The font map (theme typefaces + uploaded fonts) is part of the
            // deck — dropping it here is what made uploaded/theme fonts
            // vanish on reload. adaptDeckToPresentation already reads
            // payload.fonts back; the write side was the missing half.
            ...(presentationData.fonts
              ? { fonts: presentationData.fonts }
              : {}),
            // Same idea for the theme id generation resolved to — read back
            // on load (above) so add_slide/regenerate_slide can pin to the
            // deck's real template across reloads, not just within the
            // session that generated it.
            ...(currentThemeIdRef.current
              ? { deckThemeId: currentThemeIdRef.current }
              : {}),
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
    usedStockPhotoIdsRef.current = new Set(); // fresh deck — start with no photos "used"
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
    // A terse prompt ("ppt tentang kopi") starves the generator of material —
    // expand it into a richer brief (audience, angle, structure, tone) BEFORE
    // theme choice and generation. Theme-name detection above still runs on
    // the RAW prompt so an explicit "pakai tema X" survives the rewrite, and
    // the deck title keeps the user's own words.
    let genTopic = topic;
    if (topic.trim().split(/\s+/).length < 12) {
      setGenerationStatus("Enriching your prompt…");
      try {
        const enhanceRes = await fetch("/api/ai/enhance-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, language }),
        });
        const enhanceBody = (await enhanceRes.json().catch(() => null)) as {
          enhanced?: unknown;
        } | null;
        if (
          enhanceRes.ok &&
          typeof enhanceBody?.enhanced === "string" &&
          enhanceBody.enhanced.trim()
        ) {
          genTopic = enhanceBody.enhanced.trim();
        }
      } catch {
        // Enhancement is a bonus — the raw prompt still works.
      }
    }
    let preferredTheme = askedTheme;
    let themeChoiceReason: string | null = null;
    if (!preferredTheme) {
      setGenerationStatus("Choosing a theme…");
      const choice = await chooseThemeForTopic(genTopic, language);
      if (choice) {
        preferredTheme = choice.themeId;
        themeChoiceReason = choice.reason;
      }
    }
    const layoutPicker = new DeckLayoutPicker(genTopic, preferredTheme);
    await layoutPicker.ensureLoaded();
    const themeId = layoutPicker.getThemeId();
    currentThemeIdRef.current = themeId;
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

    const res = await streamAipptDeck(token, { content: genTopic, language, model, manifest: manifest ?? undefined });
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
    /** Photo slot markers per generated slide, so the visual review's image
     *  check can name them to the reviewer and route a flagged mismatch back
     *  to the exact element when regenerating it. */
    const slidePhotoMarkers = new Map<number, { hero: HeroImageMarker | null; secondary: HeroImageMarker[] }>();

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
      return genTopic;
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

    /** Latest store ui for a slide. Async patches (photos, streamed fills,
     *  finalize, repairs) must always start from THIS — never from a ui
     *  captured when the slide was added — or whichever update lands last
     *  silently wipes the others. */
    const slideUiAt = (index: number): Record<string, unknown> | undefined =>
      reduxStore.getState().presentationGeneration.presentationData?.slides[index]
        ?.ui as Record<string, unknown> | undefined;

    // One photo resolution — AI-generated or stock-searched depending on
    // imageSource — returning the URL to patch in, or null if nothing came
    // back. Factored out (awaitable) so both the fire-and-forget initial
    // generation below AND the visual review's regeneration of a
    // reviewer-flagged mismatched photo (reviewSlide, further down — it needs
    // the replacement in hand before it can re-verify) share one path instead
    // of two copies of the AI/stock fallback logic drifting apart.
    const resolvePhotoForSlot = async (
      prompt: string,
      searchHint: string,
    ): Promise<{ url: string; extra?: { credit: string; credit_url: string | null; source_url: string } } | null> => {
      // "Stock photos" mode: search first. Empty/failed search falls back to
      // AI generation — a slot must never end up unfilled just because the
      // stock search had no match.
      if (imageSource === "stock") {
        const results = await fetchStockPhotosForHint(searchHint);
        const result = pickUnusedStockPhoto(results, usedStockPhotoIdsRef.current);
        if (result) {
          usedStockPhotoIdsRef.current.add(result.id);
          trackStockPhotoDownload(result);
          return {
            url: result.url,
            extra: { credit: result.credit, credit_url: result.creditUrl ?? null, source_url: result.sourceUrl },
          };
        }
      }
      const dataUrl = await generateImage(currentToken, prompt);
      return dataUrl ? { url: dataUrl } : null;
    };

    // Generates a photo for ONE slot on an already-added slide and patches it
    // in once ready. The patch re-reads the slide's LATEST store ui at
    // resolution time (slideUiAt) because streamed text fills and the
    // slide_end finalize keep mutating that slide while the photo job runs;
    // the getUi/setUi closure is only the fallback for a slide that somehow
    // isn't in the store anymore (JS's single-threaded event loop makes the
    // read-modify-write here safe as long as it isn't split across an await).
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
        : `${subject} — related to ${genTopic}. ${heroStyle}`;

      void resolvePhotoForSlot(prompt, hint || subject).then((resolved) => {
        if (!resolved) return;
        const patched = patchHeroImage(slideUiAt(index) ?? getUi(), marker, resolved.url, resolved.extra) as Record<string, unknown>;
        setUi(patched);
        dispatch(updateSlideUi({ index, ui: patched }));
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
          const filled = await fillManifestSlide(layout, manifestLine, { topic: genTopic, pageNumber });
          if (!filled) return null;
          const subject =
            manifestLine.fills.find((f) => /title|headline|heading/i.test(f.name))?.text || genTopic;
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

    /** The slide currently streaming — set at slide_start, null after
     *  slide_end. `fills` accumulates for the review pass and the finalize
     *  safety-net. */
    let pendingStream: { index: number; layoutId: string; fills: SlotFill[] } | null = null;

    // Pipelined visual review: each slide is verified→repaired as soon as its
    // slide_end arrives, WHILE later slides are still streaming in — the old
    // flow only started reviewing slide 1 after slide N was generated, which
    // was the long tail of dead waiting at the end. Serialized via promise
    // chaining (one capture/verify call at a time). Failures are silent — a
    // reviewed deck is a bonus, never a blocker.
    let reviewChain: Promise<void> = Promise.resolve();
    /** Identifies a photo marker to the reviewer/back to itself — matches how
     *  the slide's photos are keyed in the verify payload's `photos` list and
     *  in any "kind":"image" issue the reviewer flags. */
    const photoSlotName = (marker: HeroImageMarker): string => `${marker.elementName}#${marker.occurrenceIndex}`;
    const reviewSlide = async (slideIndex: number) => {
      const manifestLine = slideManifestLines.get(slideIndex);
      if (!manifestLine) return;
      try {
        const layout = layoutPicker.getLayoutById(manifestLine.layout_id);
        const textFills = manifestLine.fills
          .filter((f) => f.text)
          .map((f) => ({ name: f.name, text: f.text }));
        const markers = slidePhotoMarkers.get(slideIndex);
        const photoMarkers: HeroImageMarker[] = markers
          ? [markers.hero, ...markers.secondary].filter((m): m is HeroImageMarker => Boolean(m))
          : [];

        // Each slide gets up to MAX_REVIEW_PASSES verify→repair rounds. Pass
        // 1 catches the issues the initial fill left; pass 2 re-verifies the
        // repaired slide and repairs again if the fix introduced a new issue
        // (e.g. a shortened string that now wraps differently). A clean
        // verify short-circuits the loop early. The same pass also covers
        // photos: a "kind":"image" issue means the reviewer judged the
        // rendered photo a poor fit for THIS slide's specific concept (not
        // just off the deck's broad topic) — that's regenerated instead of
        // sent to the text-only repair call.
        for (let pass = 1; pass <= MAX_REVIEW_PASSES; pass++) {
          setGenerationStatus(
            pass > 1
              ? `Re-verifying slide ${slideIndex + 1}…`
              : `Reviewing slide ${slideIndex + 1}…`,
          );
          const freshUi = slideUiAt(slideIndex);
          if (!freshUi) break;
          const image = await captureSlidePng(freshUi);
          if (!image) break;

          const photos = photoMarkers.map((marker) => ({
            name: photoSlotName(marker),
            hint: findPhotoSlotHint(freshUi, marker) ?? undefined,
          }));

          const verifyRes = await fetch("/api/ai/visual-review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "verify",
              image,
              topic: genTopic,
              language: language ?? "Bahasa Indonesia",
              slots: layout ? describeLayoutSlots(layout) : [],
              fills: textFills,
              photos,
              provider: providers?.verify ?? null,
            }),
          });
          const verifyBody = await verifyRes.json().catch(() => null);
          const issues: { slot: string; problem: string; kind?: string; suggestedPhotoPrompt?: string }[] =
            Array.isArray(verifyBody?.issues) ? verifyBody.issues : [];
          if (issues.length === 0) break; // slide passed, no more passes needed

          const imageIssues = issues.filter((i) => i.kind === "image");
          const textIssues = issues.filter((i) => i.kind !== "image");
          let appliedFix = false;

          if (imageIssues.length > 0) {
            setGenerationStatus(`Refreshing photo on slide ${slideIndex + 1}…`);
            await Promise.all(
              imageIssues.map(async (issue) => {
                const marker = photoMarkers.find((m) => photoSlotName(m) === issue.slot);
                if (!marker) return;
                const prompt = issue.suggestedPhotoPrompt
                  ? `${issue.suggestedPhotoPrompt}. ${heroStyle}`
                  : `${issue.problem}. ${heroStyle}`;
                const resolved = await resolvePhotoForSlot(prompt, issue.suggestedPhotoPrompt || genTopic);
                if (!resolved) return;
                const base = slideUiAt(slideIndex);
                if (!base) return;
                const patched = patchHeroImage(base, marker, resolved.url, resolved.extra) as Record<string, unknown>;
                dispatch(updateSlideUi({ index: slideIndex, ui: patched }));
                appliedFix = true;
              }),
            );
          }

          if (textIssues.length > 0) {
            setGenerationStatus(`Fixing slide ${slideIndex + 1}…`);
            const repairRes = await fetch("/api/ai/visual-review", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "repair",
                language: language ?? "Bahasa Indonesia",
                slots: layout ? describeLayoutSlots(layout) : [],
                fills: textFills,
                issues: textIssues,
                provider: providers?.repair ?? null,
              }),
            });
            const repairBody = await repairRes.json().catch(() => null);
            const repaired = Array.isArray(repairBody?.fills) ? repairBody.fills : [];
            if (repaired.length > 0) {
              const base = slideUiAt(slideIndex) ?? freshUi;
              dispatch(updateSlideUi({ index: slideIndex, ui: applyFillsToUi(base, repaired) }));
              appliedFix = true;
            }
          }

          if (!appliedFix) break; // nothing to apply, stop
          // loop continues to re-verify (unless this was the last pass)
        }
      } catch {
        // one slide's review failing must never abort the rest
      }
    };
    const enqueueReview = (slideIndex: number) => {
      if (!withReview) return;
      reviewChain = reviewChain.then(() => reviewSlide(slideIndex));
    };

    // slide_end (explicit, or implicit when a new slide_start / the stream
    // end arrives first): finalize the streamed slide — safety-net
    // fallbacks/pruning for slots that never got a fill, then placeholder
    // icons (they need the FINAL text for relevance, so they run here, not at
    // slide_start) — and hand the slide to the review pipeline.
    const closePendingStream = async () => {
      const pending = pendingStream;
      if (!pending) return;
      pendingStream = null;
      const manifestLine: ManifestSlideLine = {
        type: "slide",
        layout_id: pending.layoutId,
        fills: pending.fills,
      };
      slideManifestLines.set(pending.index, manifestLine);

      // The icon pass awaits network calls and a photo patch can land in that
      // window, so read → build → dispatch runs in a short re-base loop: if
      // the store moved while we awaited, rebuild from the newest ui instead
      // of clobbering the patch that just landed.
      for (let attempt = 0; attempt < 3; attempt++) {
        const base = slideUiAt(pending.index);
        if (!base) break;
        let ui = finalizeStreamedSlide(base, manifestLine, {
          topic: genTopic,
          pageNumber: pending.index + 1,
        });
        try {
          ui = await fillPlaceholderIcons(ui, genTopic);
        } catch {
          // icons are decorative — a failed pick never blocks the slide
        }
        if (slideUiAt(pending.index) === base) {
          dispatch(updateSlideUi({ index: pending.index, ui }));
          break;
        }
      }
      enqueueReview(pending.index);
    };

    // One streamed line, in any of the accepted forms:
    //   {"type":"slide_start",...} / {"type":"fill",...} / {"type":"slide_end"}
    //     — the current manifest contract, rendered element by element
    //   {"type":"slide",...} — the old one-line manifest slide (older worker)
    //   legacy AIPPTSlide union — the no-manifest fallback contract
    const handleStreamLine = async (t: string) => {
      if (!t || t.startsWith("```") || tryApplyThemeLine(t)) return;
      throwIfErrorLine(t);

      const start = parseSlideStartLine(t);
      if (start) {
        await closePendingStream(); // model skipped a slide_end — close it
        const layout = layoutPicker.getLayoutById(start.layout_id);
        if (!layout) return; // hallucinated layout id — drop the sequence
        const index = count;
        // Mount the EMPTY layout immediately — the user watches the template
        // appear first, then each text element land as its fill streams in.
        const empty = buildEmptySlideUi(layout, index + 1);
        dispatch(addSlide({ ui: empty.ui }));
        count++;
        // Follow the build: the canvas shows the slide CURRENTLY being
        // generated (the newest one), not slide 1 — so the user watches each
        // page fill in as it streams instead of being pinned to the cover.
        setActiveIndex(index);
        setGenerationStatus(`Building slide ${index + 1}…`);
        pendingStream = { index, layoutId: start.layout_id, fills: [] };
        slidePhotoMarkers.set(index, { hero: empty.heroImage, secondary: empty.secondaryImages });
        // Photos start NOW — image generation is the slowest piece, and the
        // slot markers don't move with text fills, so there's no reason to
        // wait for the copy.
        requestSlidePhotos(index, empty.ui, empty.heroImage, empty.secondaryImages, genTopic);
        return;
      }

      const fill = parseStreamFillLine(t);
      if (fill) {
        if (!pendingStream) return; // a fill outside any slide — ignore
        pendingStream.fills.push(fill);
        const latest = slideUiAt(pendingStream.index);
        if (latest) {
          dispatch(updateSlideUi({
            index: pendingStream.index,
            ui: applyFillsToUi(latest, [fill]),
          }));
        }
        return;
      }

      if (isSlideEndLine(t)) {
        await closePendingStream();
        return;
      }

      const filled = await mapLine(t, count + 1);
      if (filled) {
        const index = count;
        dispatch(addSlide({ ui: filled.ui }));
        if (filled.manifestLine) {
          slideManifestLines.set(index, filled.manifestLine);
          enqueueReview(index);
        }
        count++;
        setActiveIndex(index); // follow the newest slide as it's generated
        slidePhotoMarkers.set(index, { hero: filled.heroImage, secondary: filled.secondaryImages });
        requestSlidePhotos(index, filled.ui, filled.heroImage, filled.secondaryImages, filled.subject);
      }
    };

    for (;;) {
      const { done, value } = await readWithTimeout();
      if (done) {
        const t = buf.trim();
        if (t) await handleStreamLine(t);
        break;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (t) await handleStreamLine(t);
      }
    }

    // The stream cut mid-slide (or the model forgot the final slide_end) —
    // close whatever was streaming so it still finalizes + gets reviewed.
    await closePendingStream();

    // Reviews pipeline behind generation — only the tail slides are still in
    // flight here; the earlier ones were reviewed WHILE later slides streamed.
    await reviewChain;
    setGenerationStatus(null);
    return count;
  };

  // Auto-generate once when opened with ?prompt= (homepage "Generate" flow
  // creates an empty deck, then routes here with the prompt in the query
  // string — cross-origin-safe, survives a reload). ?review=off comes from
  // the homepage toggle and skips the pipelined visual review that otherwise
  // verifies/fixes each slide as it finishes streaming.
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

        // currentThemeIdRef pins the pack to the theme generation actually
        // resolved to (explicit ask or chooseThemeForTopic) — deckId alone is
        // just the RNG seed for decks with no preference at all, and reusing
        // it here would pick an essentially unrelated theme most of the time.
        const picker = new DeckLayoutPicker(deckId, currentThemeIdRef.current);
        const filled = await mapAIPPTSlideToTemplateUi({ type: "content", data: { title, items } }, picker);
        if (!filled) return "Couldn't find a layout to use.";

        const index = safeActive + 1;
        dispatch(addSlide({ ui: filled.ui, atIndex: index }));
        setActiveIndex(index);

        if (filled.heroImage && token) {
          const marker = filled.heroImage;
          const baseUi = filled.ui;
          const imagePrompt = String(action.args.image_prompt || title);

          const applyAiGenerated = () => {
            const prompt = `${imagePrompt}. editorial photograph, cinematic natural lighting, cohesive color grading, no text, no watermark, no logo`;
            void generateImage(token, prompt).then((dataUrl) => {
              if (!dataUrl) return;
              dispatch(updateSlideUi({ index, ui: patchHeroImage(baseUi, marker, dataUrl) }));
            });
          };

          // Honours the same homepage image-source toggle used at
          // generation time (imageSourceRef, set once per deck generation);
          // falls back to AI generation if the stock search comes up empty.
          if (imageSourceRef.current === "stock") {
            void fetchStockPhotosForHint(imagePrompt).then((results) => {
              const result = pickUnusedStockPhoto(results, usedStockPhotoIdsRef.current);
              if (!result) {
                applyAiGenerated();
                return;
              }
              usedStockPhotoIdsRef.current.add(result.id);
              dispatch(updateSlideUi({
                index,
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

        return `Added a new slide: "${title}"${filled.heroImage ? " (generating a new hero image…)" : ""}.`;
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

        // currentThemeIdRef pins this to the theme generation actually
        // resolved to, same reasoning as add_slide above — deckId alone as a
        // seed has no relationship to which theme the deck was generated with.
        const picker = new DeckLayoutPicker(deckId, currentThemeIdRef.current);
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
            void fetchStockPhotosForHint(imagePrompt).then((results) => {
              const result = pickUnusedStockPhoto(results, usedStockPhotoIdsRef.current);
              if (!result) {
                applyAiGenerated();
                return;
              }
              usedStockPhotoIdsRef.current.add(result.id);
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
                // The frame above is magnified with a CSS transform, so the
                // canvas has to be told to redraw at that scale — otherwise
                // zooming just enlarges the bitmap it already painted.
                renderScale={zoom}
                isEditMode={!slides[safeActive]?.isLocked}
                slideId={null}
                presentationId={deckId}
                slideIndex={safeActive}
                fonts={presentationData?.fonts}
                themeId={templateMode ? templateThemeId : null}
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
