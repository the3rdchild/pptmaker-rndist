"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Clapperboard,
  LayoutTemplate,
  PaintBucket,
  Palette,
  Shapes,
  Tag,
  Type,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelLabel, RailTabButton, SearchField } from "@/components/editor-react/ui";
import AnimationPanel from "@/components/editor-react/animation-panel";
import BackgroundPanel, {
  applyBackgroundStyle,
} from "@/components/editor-react/background-panel";
import ColorPalettePanel from "@/components/editor-react/color-palette-panel";
import TransitionPanel from "@/components/editor-react/transition-panel";
import {
  ElementsTab,
  TemplatesTab,
  TextTab,
  type UploadedAsset,
} from "@/components/editor-react/insert-panel-content";
import {
  buildCustomElementImage,
  type ElementCatalogEntry,
} from "@/components/editor-react/element-catalog";
import { appendInsertedContent } from "@/components/slide-editor/model/inserted-content";
import {
  createIconInsertElement,
  createImageInsertContent,
} from "@/components/slide-editor/insert/insert-elements";
import {
  readBackgroundStyle,
  type BackgroundStyle,
} from "@/components/slide-editor/surface/SlideBackground";
import type { RawUi } from "@/components/slide-editor/model/core";
import type { TemplateSelectionPayload } from "@/components/slide-editor/surface/TemplateV2KonvaSlide";
import type { SlideTransition } from "@/store/presentationGeneration";
import {
  EDITOR_STAGE_HEIGHT,
  EDITOR_STAGE_WIDTH,
  type SlideElement,
} from "@/components/slide-editor/types";
import type { TemplateV2InsertComponent } from "@/components/slide-editor/events/events";

type InsertHandler = (ui: Record<string, unknown>) => void;

// Loads an image's natural dimensions (used to size a freshly uploaded image
// to its real aspect ratio instead of forcing a fixed box that crops it).
function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("window unavailable"));
      return;
    }
    const img = new window.Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

function fitWithin(
  size: { width: number; height: number },
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const ratio = size.width / size.height || 1;
  let width = size.width;
  let height = size.height;
  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / ratio);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * ratio);
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

export interface InsertToolbarProps {
  activeUi: Record<string, unknown> | null;
  onInsert: InsertHandler;
  onApplyColorToSelection: (color: string) => void;
  /** Adds a whole theme as slides ("Apply all N pages"). */
  onApplyAllLayouts?: (
    layouts: Record<string, unknown>[],
    themeName: string
  ) => void;
  /** Template-engine mode: the authoring panel, mounted as its own rail tab so
   *  it collapses like every other panel instead of permanently occupying
   *  320px next to the canvas. */
  templatePanel?: React.ReactNode;
  /** Entrance transition of the currently selected slide (undefined = none). */
  activeTransition?: SlideTransition;
  onSelectTransition?: (transition: SlideTransition) => void;
  /** The element selected on the canvas — the Transition tab's morph link
   *  editor writes `morph_id` through its patch. */
  elementSelection?: TemplateSelectionPayload | null;
  /** Starts/stops the Animation tab's on-canvas preview run. */
  onPreviewAnimation?: () => void;
  animationPreviewActive?: boolean;
}

type TabId =
  | "template-engine"
  | "templates"
  | "elements"
  | "text"
  | "palette"
  | "background"
  | "animation"
  | "transition";

const TABS: {
  id: TabId;
  label: string;
  icon: typeof LayoutTemplate;
  searchPlaceholder?: string;
}[] = [
  { id: "template-engine", label: "Template", icon: Tag },
  { id: "templates", label: "Templates", icon: LayoutTemplate, searchPlaceholder: "Search templates" },
  { id: "elements", label: "Elements", icon: Shapes, searchPlaceholder: "Search elements, charts, media" },
  { id: "text", label: "Text", icon: Type, searchPlaceholder: "Search text, tables, formulas" },
  { id: "palette", label: "Palette", icon: Palette },
  { id: "background", label: "Background", icon: PaintBucket },
  { id: "animation", label: "Animation", icon: Clapperboard },
  { id: "transition", label: "Transition", icon: ArrowRightLeft },
];

/** The flyout used to be a fixed 560px, which crowded the canvas on a laptop
 *  screen. It now opens at 400px and can be dragged wider from its inner edge;
 *  every tab's content is fluid, and the one measurement that isn't (the
 *  template card) is derived from the live width. */
const PANEL_DEFAULT_WIDTH = 400;
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 720;
const PANEL_WIDTH_STORAGE_KEY = "ppt:insert-panel-width";

/** Bounded by the constants above and by what the window can spare — a panel
 *  dragged past the viewport would otherwise squeeze the canvas to nothing. */
function clampPanelWidth(width: number): number {
  const viewportCap =
    typeof window === "undefined"
      ? PANEL_MAX_WIDTH
      : Math.max(PANEL_MIN_WIDTH, window.innerWidth - 420);
  const ceiling = Math.min(PANEL_MAX_WIDTH, viewportCap);
  return Math.round(Math.min(ceiling, Math.max(PANEL_MIN_WIDTH, width)));
}

function backgroundSwatchStyle(style: BackgroundStyle): React.CSSProperties {
  if (style.type === "image" && style.imageUrl) {
    return {
      backgroundImage: `url(${style.imageUrl})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  if (style.type === "linear") {
    return { background: `linear-gradient(${style.angle ?? 90}deg, ${style.from}, ${style.to ?? style.from})` };
  }
  if (style.type === "radial") {
    return { background: `radial-gradient(circle, ${style.from}, ${style.to ?? style.from})` };
  }
  return { backgroundColor: style.from };
}

function backgroundStyleKey(style: BackgroundStyle): string {
  return `${style.type}:${style.from}:${style.to ?? ""}:${style.angle ?? ""}:${style.imageUrl ?? ""}:${style.pattern ?? ""}`;
}

export default function InsertToolbar({
  activeUi,
  onInsert,
  onApplyColorToSelection,
  onApplyAllLayouts,
  templatePanel,
  activeTransition,
  onSelectTransition,
  elementSelection,
  onPreviewAnimation,
  animationPreviewActive,
}: InsertToolbarProps) {
  // The template tab only exists in the engine; the normal editor never sees it.
  const tabs = templatePanel
    ? TABS
    : TABS.filter((tab) => tab.id !== "template-engine");
  const [openTab, setOpenTab] = useState<TabId | null>(null);
  const [search, setSearch] = useState("");
  const [recentElementKeys, setRecentElementKeys] = useState<string[]>([]);
  const [recentBackgrounds, setRecentBackgrounds] = useState<BackgroundStyle[]>([]);
  const [uploads, setUploads] = useState<UploadedAsset[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  /** Mirrors what the drag has written to the node. A re-render triggered from
   *  outside mid-drag would otherwise reapply the pre-drag width and snap the
   *  panel back under the cursor. */
  const liveWidthRef = useRef(PANEL_DEFAULT_WIDTH);

  // Read after mount rather than in the initializer: localStorage doesn't
  // exist during SSR, and seeding from it would desync the hydrated markup.
  // Nothing flashes — the flyout is closed until a tab is picked.
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
    if (!Number.isFinite(stored) || stored <= 0) return;
    const restored = clampPanelWidth(stored);
    liveWidthRef.current = restored;
    setPanelWidth(restored);
  }, []);

  if (!activeUi) return null;

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = Math.round(
      panelRef.current?.getBoundingClientRect().width ?? panelWidth,
    );
    liveWidthRef.current = startWidth;
    handle.setPointerCapture(pointerId);
    setResizing(true);

    // The drag writes straight to the node instead of through state: the open
    // tab can hold dozens of Konva template thumbnails, and re-rendering them
    // on every pointermove would drop the drag to a crawl. React only learns
    // the new width once the pointer is released.
    const onMove = (move: PointerEvent) => {
      const next = clampPanelWidth(startWidth + (move.clientX - startX));
      liveWidthRef.current = next;
      if (panelRef.current) panelRef.current.style.width = `${next}px`;
    };
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      setResizing(false);
      const settled = liveWidthRef.current;
      setPanelWidth(settled);
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(settled));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  };

  const resetPanelWidth = () => {
    liveWidthRef.current = PANEL_DEFAULT_WIDTH;
    if (panelRef.current) panelRef.current.style.width = `${PANEL_DEFAULT_WIDTH}px`;
    setPanelWidth(PANEL_DEFAULT_WIDTH);
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(PANEL_DEFAULT_WIDTH));
  };

  const selectTab = (id: TabId) => {
    setSearch("");
    setOpenTab((current) => (current === id ? null : id));
  };

  const runInsert = (elements: SlideElement[]) => {
    if (!elements.length) return;
    const next = appendInsertedContent(activeUi as RawUi, elements, []);
    onInsert(next);
  };

  const runInsertComponent = (component: TemplateV2InsertComponent) => {
    const next = appendInsertedContent(activeUi as RawUi, [], [component]);
    onInsert(next);
  };

  /** Several components in one go, as one undo step. */
  const runInsertComponents = (components: Record<string, unknown>[]) => {
    if (components.length === 0) return;
    const next = appendInsertedContent(
      activeUi as RawUi,
      [],
      components as TemplateV2InsertComponent[],
    );
    onInsert(next);
  };

  const handleElementInsert = (entry: ElementCatalogEntry) => {
    const built = entry.build();
    if (Array.isArray(built)) {
      runInsert(built);
    } else {
      runInsertComponent(built);
    }
    setRecentElementKeys((prev) => [entry.key, ...prev.filter((k) => k !== entry.key)].slice(0, 8));
  };

  const handleInsertUploadedImage = (url: string) => {
    const content = createImageInsertContent("image");
    const baseElements = (content.elements ?? []).map((el) => ({ ...el, data: url })) as SlideElement[];
    // Preserve the source image's native aspect ratio instead of forcing the
    // default 666x397 box (which crops non-matching images via fit:cover).
    // Load the dimensions, then size the box to fit within a 800x600 bound
    // while keeping the original ratio, and switch to fit:contain so nothing
    // gets cropped.
    loadImageSize(url).then(
      (size) => {
        const fit = fitWithin(size, 800, 600);
        const elements = baseElements.map((el) =>
          el.type === "image"
            ? { ...el, size: { width: fit.width, height: fit.height }, fit: "contain" as const }
            : el,
        );
        runInsert(elements);
      },
      () => {
        runInsert(baseElements);
      },
    );
  };

  const handleInsertIcon = (iconUrl: string) => {
    runInsert([createIconInsertElement(iconUrl)]);
  };

  // Library elements are decoration the author placed deliberately, so they go
  // in marked decorative — that keeps ai-layout-fill from treating them as a
  // fillable image slot and swapping them out when a template is generated.
  // Natural size comes from the manifest, recorded at upload time.
  const handleInsertCustomElement = (item: {
    src: string;
    width: number;
    height: number;
  }) => {
    runInsert([buildCustomElementImage(item) as unknown as SlideElement]);
  };

  const handleBackgroundApply = (ui: Record<string, unknown>) => {
    const style = readBackgroundStyle(ui as RawUi);
    setRecentBackgrounds((prev) => {
      const key = backgroundStyleKey(style);
      return [style, ...prev.filter((s) => backgroundStyleKey(s) !== key)].slice(0, 8);
    });
    onInsert(ui);
  };

  const handleApplyColorToBackground = (color: string) => {
    handleBackgroundApply(
      applyBackgroundStyle(activeUi as RawUi, { type: "solid", from: color, to: color }),
    );
  };

  const activeTab = tabs.find((t) => t.id === openTab) ?? null;

  return (
    <div
      className={cn("flex h-full shrink-0", resizing && "select-none")}
      data-inline-edit-ignore="true"
    >
      {activeTab && (
        <div
          ref={panelRef}
          style={{ width: resizing ? liveWidthRef.current : panelWidth }}
          className="relative flex h-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]"
        >
          <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border)] p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-[var(--text-primary)]">{activeTab.label}</h2>
              <button
                onClick={() => setOpenTab(null)}
                className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <X size={16} />
              </button>
            </div>
            {activeTab.searchPlaceholder && (
              <SearchField
                placeholder={activeTab.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {openTab === "template-engine" && templatePanel}
            {openTab === "templates" && (
              <TemplatesTab
                search={search}
                panelWidth={panelWidth}
                onApplyLayout={onInsert}
                onApplyAllLayouts={onApplyAllLayouts}
              />
            )}
            {openTab === "elements" && (
              <ElementsTab
                search={search}
                recentKeys={recentElementKeys}
                onInsertElements={handleElementInsert}
                onInsertIcon={handleInsertIcon}
                onInsertCustomElement={handleInsertCustomElement}
                onInsertContent={runInsert}
                uploads={uploads}
                onUploaded={(asset) => setUploads((prev) => [asset, ...prev].slice(0, 24))}
                onInsertImage={handleInsertUploadedImage}
              />
            )}
            {openTab === "text" && <TextTab search={search} onInsertElements={runInsert} />}
            {openTab === "palette" && (
              <ColorPalettePanel
                onApplyColorToSelection={onApplyColorToSelection}
                onApplyColorToBackground={handleApplyColorToBackground}
                onInsertComponents={runInsertComponents}
              />
            )}
            {openTab === "background" && (
              <div className="pb-2">
                {recentBackgrounds.length > 0 && (
                  <>
                    <PanelLabel>Recently used</PanelLabel>
                    <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
                      {recentBackgrounds.map((style, i) => (
                        <button
                          key={`${backgroundStyleKey(style)}-${i}`}
                          title={style.type}
                          onClick={() =>
                            handleBackgroundApply(applyBackgroundStyle(activeUi as RawUi, style))
                          }
                          className="h-9 w-9 shrink-0 rounded-lg ring-1 ring-[var(--border-strong)] transition-transform hover:scale-105"
                          style={backgroundSwatchStyle(style)}
                        />
                      ))}
                    </div>
                  </>
                )}
                <BackgroundPanel activeUi={activeUi} onApply={handleBackgroundApply} />
              </div>
            )}
            {openTab === "animation" && (
              <AnimationPanel
                elementSelection={elementSelection}
                activeUi={activeUi}
                onCommitUi={onInsert}
                onPreviewAnimation={onPreviewAnimation}
                previewActive={animationPreviewActive}
              />
            )}
            {openTab === "transition" && (
              <TransitionPanel
                value={activeTransition ?? "none"}
                onSelect={(t) => onSelectTransition?.(t)}
                elementSelection={elementSelection}
                activeUi={activeUi}
              />
            )}
          </div>

          {/* Straddles the panel's inner border so there is a real target to
              grab without stealing clicks from the content. Double-click puts
              it back to the default width. */}
          <div
            onPointerDown={startResize}
            onDoubleClick={resetPanelWidth}
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize — double-click to reset"
            className={cn(
              "absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize transition-colors",
              resizing
                ? "bg-[var(--accent)]/60"
                : "hover:bg-[var(--accent)]/40",
            )}
          />
        </div>
      )}

      {/* order-first keeps the rail against the window edge with the flyout
          opening inward, without moving a hundred lines of panel markup. */}
      <div
        id="onboarding-insert-rail"
        className="order-first flex h-full w-[68px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-panel)] p-1.5"
      >
        {tabs.map((tab) => (
          <RailTabButton
            key={tab.id}
            icon={<tab.icon size={18} />}
            label={tab.label}
            active={openTab === tab.id}
            onClick={() => selectTab(tab.id)}
          />
        ))}
      </div>
    </div>
  );
}
