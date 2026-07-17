"use client";

import { useState } from "react";
import {
  BarChart3,
  LayoutTemplate,
  PaintBucket,
  Palette,
  Shapes,
  Sparkles,
  Table as TableIcon,
  Type,
  Upload as UploadIcon,
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
  PlaceholderTab,
  TableTab,
  TemplatesTab,
  TextTab,
  UploadsTab,
  type UploadedAsset,
} from "@/components/editor-react/insert-panel-content";
import type { ElementCatalogEntry } from "@/components/editor-react/element-catalog";
import { appendInsertedContent } from "@/components/slide-editor/model/inserted-content";
import { createImageInsertContent } from "@/components/slide-editor/insert/insert-elements";
import {
  readBackgroundStyle,
  type BackgroundStyle,
} from "@/components/slide-editor/surface/SlideBackground";
import type { RawUi } from "@/components/slide-editor/model/core";
import type { SlideElement } from "@/components/slide-editor/types";
import type { TemplateV2InsertComponent } from "@/components/slide-editor/events/events";

type InsertHandler = (ui: Record<string, unknown>) => void;

export interface InsertToolbarProps {
  activeUi: Record<string, unknown> | null;
  onInsert: InsertHandler;
  onApplyColorToSelection: (color: string) => void;
}

type TabId =
  | "templates"
  | "elements"
  | "text"
  | "chart"
  | "table"
  | "uploads"
  | "magic-media"
  | "palette"
  | "background";

const TABS: {
  id: TabId;
  label: string;
  icon: typeof LayoutTemplate;
  searchPlaceholder?: string;
}[] = [
  { id: "templates", label: "Templates", icon: LayoutTemplate, searchPlaceholder: "Search templates" },
  { id: "elements", label: "Elements", icon: Shapes, searchPlaceholder: "Search elements" },
  { id: "text", label: "Text", icon: Type, searchPlaceholder: "Search text styles" },
  { id: "chart", label: "Chart", icon: BarChart3, searchPlaceholder: "Search charts" },
  { id: "table", label: "Table", icon: TableIcon },
  { id: "palette", label: "Palette", icon: Palette },
  { id: "uploads", label: "Uploads", icon: UploadIcon, searchPlaceholder: "Search uploads" },
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
}: InsertToolbarProps) {
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
    const elements = (content.elements ?? []).map((el) => ({ ...el, data: url }));
    runInsert(elements as SlideElement[]);
  };

  const handleBackgroundApply = (ui: Record<string, unknown>) => {
    const style = readBackgroundStyle(ui as RawUi);
    setRecentBackgrounds((prev) => {
      const key = backgroundStyleKey(style);
      return [style, ...prev.filter((s) => backgroundStyleKey(s) !== key)].slice(0, 8);
    });
    onInsert(ui);
  };

  const activeTab = TABS.find((t) => t.id === openTab) ?? null;

  return (
    <div className="flex h-full shrink-0" data-inline-edit-ignore="true">
      {activeTab && (
        <div className="flex h-full w-[560px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]">
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
            {openTab === "templates" && (
              <TemplatesTab search={search} onApplyLayout={onInsert} />
            )}
            {openTab === "elements" && (
              <ElementsTab
                search={search}
                recentKeys={recentElementKeys}
                onInsertElements={handleElementInsert}
              />
            )}
            {openTab === "text" && <TextTab search={search} onInsertElements={runInsert} />}
            {openTab === "chart" && <ChartTab search={search} onInsertElements={runInsert} />}
            {openTab === "table" && <TableTab onInsertElements={runInsert} />}
            {openTab === "palette" && (
              <ColorPalettePanel
                onApplyColorToSelection={onApplyColorToSelection}
              />
            )}
            {openTab === "uploads" && (
              <UploadsTab
                search={search}
                uploads={uploads}
                onUploaded={(asset) => setUploads((prev) => [asset, ...prev].slice(0, 24))}
                onInsertImage={handleInsertUploadedImage}
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

      <div className="flex h-full w-[68px] shrink-0 flex-col gap-0.5 overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-panel)] p-1.5">
        {TABS.map((tab) => (
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
