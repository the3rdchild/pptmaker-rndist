"use client";

import { useState } from "react";
import {
  BarChart3,
  LayoutTemplate,
  PaintBucket,
  Palette,
  Shapes,
  Sigma,
  Sparkles,
  Table as TableIcon,
  Tag,
  Type,
  Video,
  X,
} from "lucide-react";
import { PanelLabel, RailTabButton, SearchField } from "@/components/editor-react/ui";
import BackgroundPanel, {
  applyBackgroundStyle,
} from "@/components/editor-react/background-panel";
import ColorPalettePanel from "@/components/editor-react/color-palette-panel";
import {
  ChartTab,
  ElementsTab,
  FormulaTab,
  MediaTab,
  PlaceholderTab,
  TableTab,
  TemplatesTab,
  TextTab,
  type UploadedAsset,
} from "@/components/editor-react/insert-panel-content";
import type { ElementCatalogEntry } from "@/components/editor-react/element-catalog";
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
}

type TabId =
  | "template-engine"
  | "templates"
  | "elements"
  | "text"
  | "chart"
  | "table"
  | "formula"
  | "media"
  | "magic-media"
  | "palette"
  | "background";

const TABS: {
  id: TabId;
  label: string;
  icon: typeof LayoutTemplate;
  searchPlaceholder?: string;
}[] = [
  { id: "template-engine", label: "Template", icon: Tag },
  { id: "templates", label: "Templates", icon: LayoutTemplate, searchPlaceholder: "Search templates" },
  { id: "elements", label: "Elements", icon: Shapes, searchPlaceholder: "Search elements" },
  { id: "text", label: "Text", icon: Type, searchPlaceholder: "Search text styles" },
  { id: "chart", label: "Chart", icon: BarChart3, searchPlaceholder: "Search charts" },
  { id: "table", label: "Table", icon: TableIcon },
  { id: "formula", label: "Formula", icon: Sigma, searchPlaceholder: "Search formulas" },
  { id: "media", label: "Media", icon: Video, searchPlaceholder: "Upload or paste a URL" },
  { id: "palette", label: "Palette", icon: Palette },
  { id: "magic-media", label: "Magic Media", icon: Sparkles },
  { id: "background", label: "Background", icon: PaintBucket },
];

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

  if (!activeUi) return null;

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
    const fit = fitWithin({ width: item.width, height: item.height }, 480, 360);
    runInsert([
      {
        type: "image",
        position: {
          x: Math.round((EDITOR_STAGE_WIDTH - fit.width) / 2),
          y: Math.round((EDITOR_STAGE_HEIGHT - fit.height) / 2),
        },
        size: fit,
        data: item.src,
        fit: "contain",
        decorative: true,
      } as SlideElement,
    ]);
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
    <div className="flex h-full shrink-0" data-inline-edit-ignore="true">
      {activeTab && (
        <div className="flex h-full w-[560px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]">
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
              />
            )}
            {openTab === "text" && <TextTab search={search} onInsertElements={runInsert} />}
            {openTab === "chart" && <ChartTab search={search} onInsertElements={runInsert} />}
            {openTab === "table" && <TableTab onInsertElements={runInsert} />}
            {openTab === "formula" && (
              <FormulaTab search={search} onInsertElements={runInsert} />
            )}
            {openTab === "media" && (
              <MediaTab
                search={search}
                onInsertElements={runInsert}
                uploads={uploads}
                onUploaded={(asset) => setUploads((prev) => [asset, ...prev].slice(0, 24))}
                onInsertImage={handleInsertUploadedImage}
              />
            )}
            {openTab === "palette" && (
              <ColorPalettePanel
                onApplyColorToSelection={onApplyColorToSelection}
                onApplyColorToBackground={handleApplyColorToBackground}
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
            {openTab === "magic-media" && (
              <PlaceholderTab
                icon={<Sparkles size={20} />}
                title="Magic Media"
                description="Generate images and video with AI, right inside the editor. Coming soon."
              />
            )}
          </div>
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
