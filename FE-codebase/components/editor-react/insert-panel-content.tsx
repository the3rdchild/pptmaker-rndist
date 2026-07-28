"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  BarChart3,
  CircleDot,
  Heading1,
  Heading2,
  ImagePlus,
  LayoutGrid,
  Layers,
  LineChart,
  List,
  ListOrdered,
  Loader2,
  Music,
  PieChart,
  Quote,
  Sigma,
  Table as TableIcon,
  Type,
  Video,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/components/ui/sonner";
import { EmptyState, GridCard, PanelLabel } from "@/components/editor-react/ui";
import {
  ELEMENT_CATALOG,
  ELEMENT_CATEGORY_LABELS,
  elementCategoryOrder,
  renderCatalogIcon,
  type ElementCatalogEntry,
} from "@/components/editor-react/element-catalog";
import {
  createChartInsertElements,
  createCustomFormulaInsertElements,
  createFormulaInsertElements,
  createMediaInsertElements,
  createTableInsertElements,
  createTextInsertElements,
} from "@/components/slide-editor/insert/insert-elements";
import {
  latexToSvg,
  sizedColoredSvg,
} from "@/components/slide-editor/formula/latex-to-svg";
import { svgToDataUri } from "@/components/slide-editor/surface/exportAssets";
import { resolveBackendAssetSource } from "@/utils/api";
import {
  ALL_THEMES,
  ThemeFilterBar,
  useTemplateThemes,
} from "@/components/editor-react/theme-picker";
import { ImagesApi } from "@/app/(presentation-generator)/services/api/images";
import {
  loadIconCategories,
  PresentationGenerationApi,
  type IconCategory,
} from "@/app/(presentation-generator)/services/api/presentation-generation";
import type { SlideElement } from "@/components/slide-editor/types";

const ThumbnailSlide = dynamic(
  () =>
    import("@/components/slide-editor/surface/TemplateV2KonvaSlide").then(
      (m) => m.TemplateV2KonvaSlide
    ),
  { ssr: false }
);

function matches(label: string, search: string) {
  return !search || label.toLowerCase().includes(search.toLowerCase());
}

/* ------------------------------- Templates ------------------------------ */

type Layout = Record<string, unknown>;

export function TemplatesTab({
  search,
  onApplyLayout,
  onApplyAllLayouts,
}: {
  search: string;
  onApplyLayout: (layout: Layout) => void;
  /** Adds every layout of the selected theme as its own slide. */
  onApplyAllLayouts?: (layouts: Layout[], themeName: string) => void;
}) {
  const { themes, loading, activeThemeId, setActiveThemeId, visibleLayouts } =
    useTemplateThemes();
  const activeTheme = themes.find((theme) => theme.id === activeThemeId) ?? null;

  // Layouts arrive from the theme registry already asset-resolved against
  // their own theme folder, so no per-render normalization is needed here.
  const filtered = visibleLayouts.filter((layout) =>
    matches(String(layout.description ?? layout.id ?? ""), search)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-3">
      <PanelLabel>
        {activeThemeId === ALL_THEMES
          ? "All templates"
          : themes.find((t) => t.id === activeThemeId)?.name ?? "Templates"}
      </PanelLabel>
      <ThemeFilterBar
        themes={themes}
        activeThemeId={activeThemeId}
        onChange={setActiveThemeId}
      />
      {onApplyAllLayouts && activeTheme && activeTheme.layouts.length > 0 && (
        <button
          onClick={() => onApplyAllLayouts(activeTheme.layouts, activeTheme.name)}
          title={`Add all ${activeTheme.layouts.length} ${activeTheme.name} layouts as slides`}
          className="mx-2.5 mb-2 flex w-[calc(100%-1.25rem)] items-center justify-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-surface)]"
        >
          <Layers size={13} />
          Apply all {activeTheme.layouts.length} pages
        </button>
      )}
      <div className="grid grid-cols-2 gap-3 px-2.5 py-1.5">
        {filtered.map((layout, i) => {
          const scale = 0.19;
          return (
            <button
              key={`${layout.id ?? i}`}
              onClick={() => onApplyLayout(layout)}
              className="group relative overflow-hidden rounded-lg bg-white ring-1 ring-[var(--border-strong)] transition-shadow hover:shadow-[var(--shadow-accent-glow)] hover:ring-[var(--accent)]"
              style={{ width: "100%", aspectRatio: "16 / 9" }}
              title={String(layout.description ?? `Layout ${i + 1}`).slice(0, 80)}
            >
              <div
                className="pointer-events-none origin-top-left"
                style={{ width: 1280, height: 720, transform: `scale(${scale})` }}
              >
                <ThumbnailSlide
                  layout={layout as never}
                  isEditMode={false}
                  slideIndex={0}
                />
              </div>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex h-6 items-center justify-center bg-gradient-to-t from-black/70 to-transparent text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                Use template
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------- Elements ------------------------------- */

function IconsSection({
  search,
  onInsertIcon,
}: {
  search: string;
  onInsertIcon: (iconUrl: string) => void;
}) {
  const [categories, setCategories] = useState<IconCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [icons, setIcons] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 400);

  useEffect(() => {
    void loadIconCategories().then(setCategories);
  }, []);

  useEffect(() => {
    const query = debouncedSearch.trim();
    if (!query && !selectedCategory) {
      setIcons([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    PresentationGenerationApi.searchIcons({
      query,
      limit: 24,
      icon_weight: "regular",
      category: selectedCategory,
    })
      .then((data) => {
        if (!cancelled) setIcons(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setIcons([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, selectedCategory]);

  return (
    <div>
      <PanelLabel>Icons</PanelLabel>
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
          {categories.map((category) => {
            const isSelected = selectedCategory === category.id;
            return (
              <button
                key={category.id}
                onClick={() =>
                  setSelectedCategory((current) => (current === category.id ? null : category.id))
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  isSelected
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-light)]"
                    : "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                )}
              >
                {category.label}
              </button>
            );
          })}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-6 text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : icons.length > 0 ? (
        <div className="grid grid-cols-6 gap-2 px-2.5 pb-2">
          {icons.map((iconSrc, i) => (
            <button
              key={`${iconSrc}-${i}`}
              onClick={() => onInsertIcon(iconSrc)}
              title="Insert icon"
              className="flex h-9 w-9 items-center justify-center rounded-md p-1.5 transition-colors hover:bg-[var(--bg-elevated)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={iconSrc}
                alt=""
                draggable={false}
                className="h-full w-full object-contain"
                style={{ filter: "brightness(0) invert(1)" }}
              />
            </button>
          ))}
        </div>
      ) : (
        <p className="px-2.5 pb-2 text-[11px] text-[var(--text-muted)]">
          {search || selectedCategory ? "No icons found." : "Search or pick a category to browse icons."}
        </p>
      )}
    </div>
  );
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function ElementsTab({
  search,
  recentKeys,
  onInsertElements,
  onInsertIcon,
}: {
  search: string;
  recentKeys: string[];
  onInsertElements: (entry: ElementCatalogEntry) => void;
  onInsertIcon: (iconUrl: string) => void;
}) {
  const catalogByKey = new Map(ELEMENT_CATALOG.map((entry) => [entry.key, entry]));
  const recent = recentKeys
    .map((key) => catalogByKey.get(key))
    .filter((entry): entry is ElementCatalogEntry => Boolean(entry));

  const categories = elementCategoryOrder()
    .map((category) => ({
      category,
      entries: ELEMENT_CATALOG.filter(
        (entry) => entry.category === category && matches(entry.label, search)
      ),
    }))
    .filter((group) => group.entries.length > 0);

  return (
    <div className="p-1.5">
      <IconsSection search={search} onInsertIcon={onInsertIcon} />
      {recent.length > 0 && !search && (
        <>
          <PanelLabel>Recently used</PanelLabel>
          <div className="grid grid-cols-4 gap-2.5 px-2.5 pb-2">
            {recent.map((entry) => (
              <GridCard
                key={`recent-${entry.key}`}
                label={entry.label}
                onClick={() => onInsertElements(entry)}
              >
                {renderCatalogIcon(entry)}
              </GridCard>
            ))}
          </div>
        </>
      )}
      {categories.map(({ category, entries }) => (
        <div key={category}>
          <PanelLabel>{ELEMENT_CATEGORY_LABELS[category]}</PanelLabel>
          <div className="grid grid-cols-4 gap-2.5 px-2.5 pb-2">
            {entries.map((entry) => (
              <GridCard
                key={entry.key}
                label={entry.label}
                onClick={() => onInsertElements(entry)}
              >
                {renderCatalogIcon(entry)}
              </GridCard>
            ))}
          </div>
        </div>
      ))}
      {categories.length === 0 && (
        <EmptyState
          icon={<LayoutGrid size={20} />}
          title="No shapes found"
          description={`Nothing matches "${search}".`}
        />
      )}
    </div>
  );
}

/* ---------------------------------- Text --------------------------------- */

const TEXT_STYLES: {
  kind: string;
  label: string;
  icon: typeof Heading1;
  preview: string;
  className: string;
}[] = [
  { kind: "title-block", label: "Add a heading", icon: Heading1, preview: "Heading", className: "text-lg font-bold" },
  { kind: "subtitle", label: "Add a subheading", icon: Heading2, preview: "Subheading", className: "text-sm font-semibold" },
  { kind: "body-text", label: "Add body text", icon: Type, preview: "Body text", className: "text-xs" },
  { kind: "quote", label: "Add a quote", icon: Quote, preview: "“Quote”", className: "text-xs italic" },
  { kind: "bullet-list", label: "Bullet list", icon: List, preview: "• List", className: "text-xs" },
  { kind: "numbered-list", label: "Numbered list", icon: ListOrdered, preview: "1. List", className: "text-xs" },
];

export function TextTab({
  search,
  onInsertElements,
}: {
  search: string;
  onInsertElements: (elements: SlideElement[]) => void;
}) {
  const filtered = TEXT_STYLES.filter((style) => matches(style.label, search));

  return (
    <div className="p-2.5">
      <button
        onClick={() => onInsertElements(createTextInsertElements("body-text"))}
        className="mb-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
      >
        <Type size={15} />
        Add a text box
      </button>

      <button
        disabled
        title="Coming soon"
        className="mb-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-strong)] text-sm font-medium text-[var(--text-muted)]"
      >
        <Wand2 size={15} />
        Magic Write
        <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
          Soon
        </span>
      </button>

      <PanelLabel>Default text styles</PanelLabel>
      <div className="space-y-1.5 px-2.5">
        {filtered.map((style) => (
          <button
            key={style.kind}
            onClick={() => onInsertElements(createTextInsertElements(style.kind))}
            className="flex w-full items-center gap-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-2.5 text-left transition-colors hover:border-[var(--accent)]/50 hover:bg-[var(--accent-soft)]"
          >
            <style.icon size={14} className="shrink-0 text-[var(--text-muted)]" />
            <span className={cn("truncate text-[var(--text-primary)]", style.className)}>
              {style.preview}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="px-1 py-4 text-center text-xs text-[var(--text-muted)]">
            No text styles match &quot;{search}&quot;.
          </p>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- Chart --------------------------------- */

const CHART_KINDS: { kind: string; label: string; icon: typeof BarChart3 }[] = [
  { kind: "bar", label: "Bar", icon: BarChart3 },
  { kind: "line", label: "Line", icon: LineChart },
  { kind: "pie", label: "Pie", icon: PieChart },
  { kind: "donut", label: "Donut", icon: CircleDot },
  { kind: "area", label: "Area", icon: LineChart },
  { kind: "radar", label: "Radar", icon: CircleDot },
];

export function ChartTab({
  search,
  onInsertElements,
}: {
  search: string;
  onInsertElements: (elements: SlideElement[]) => void;
}) {
  const filtered = CHART_KINDS.filter((c) => matches(c.label, search));
  return (
    <div className="p-1.5">
      <PanelLabel>Chart</PanelLabel>
      <div className="grid grid-cols-3 gap-2.5 px-2.5 pb-2">
        {filtered.map((chart) => (
          <GridCard
            key={chart.kind}
            label={chart.label}
            onClick={() => onInsertElements(createChartInsertElements(chart.kind))}
          >
            <chart.icon size={22} />
          </GridCard>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- Table --------------------------------- */

export function TableTab({
  onInsertElements,
}: {
  onInsertElements: (elements: SlideElement[]) => void;
}) {
  return (
    <div className="p-2.5">
      <PanelLabel>Table</PanelLabel>
      <div className="px-2.5">
        <GridCard
          label="Simple table"
          aspect="wide"
          className="w-32"
          onClick={() => onInsertElements(createTableInsertElements("simple-table"))}
        >
          <TableIcon size={26} />
        </GridCard>
      </div>
    </div>
  );
}

/* -------------------------------- Formula -------------------------------- */

const FORMULA_KINDS: { kind: string; label: string }[] = [
  { kind: "quadratic-formula", label: "Quadratic Formula" },
  { kind: "pythagorean-theorem", label: "Pythagorean Theorem" },
  { kind: "mass-energy", label: "Mass-Energy" },
  { kind: "integral", label: "Integral" },
  { kind: "summation", label: "Summation" },
  { kind: "euler-identity", label: "Euler's Identity" },
];

function FormulaPasteBox({
  onInsertElements,
}: {
  onInsertElements: (elements: SlideElement[]) => void;
}) {
  const [latex, setLatex] = useState("");
  const trimmed = latex.trim();
  const parsed = useMemo(
    () => (trimmed ? latexToSvg(trimmed) : null),
    [trimmed],
  );
  const previewSrc = useMemo(() => {
    if (!parsed) return null;
    return svgToDataUri(
      sizedColoredSvg(parsed.svg, parsed.width, parsed.height, "#101323"),
    );
  }, [parsed]);

  const handleInsert = () => {
    if (!trimmed) return;
    onInsertElements(createCustomFormulaInsertElements(trimmed));
    setLatex("");
  };

  return (
    <div className="mb-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2.5">
      <label className="mb-1.5 block text-[11px] font-medium text-[var(--text-muted)]">
        Paste LaTeX code
      </label>
      <textarea
        value={latex}
        onChange={(event) => setLatex(event.target.value)}
        placeholder={"e.g. x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"}
        rows={2}
        className="w-full resize-none rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
      {trimmed ? (
        <div className="mt-2 flex min-h-[44px] items-center justify-center rounded-md bg-white px-2 py-1.5">
          {previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewSrc}
              alt="Formula preview"
              className="max-h-10 max-w-full object-contain"
            />
          ) : (
            <span className="text-[11px] text-red-500">
              Couldn&apos;t parse this LaTeX
            </span>
          )}
        </div>
      ) : null}
      <button
        onClick={handleInsert}
        disabled={!parsed}
        className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Sigma size={13} />
        Insert formula
      </button>
    </div>
  );
}

export function FormulaTab({
  search,
  onInsertElements,
}: {
  search: string;
  onInsertElements: (elements: SlideElement[]) => void;
}) {
  const filtered = FORMULA_KINDS.filter((formula) => matches(formula.label, search));
  return (
    <div className="p-1.5">
      <div className="px-2.5">
        <FormulaPasteBox onInsertElements={onInsertElements} />
      </div>
      <PanelLabel>Formula</PanelLabel>
      <div className="grid grid-cols-2 gap-2.5 px-2.5 pb-2">
        {filtered.map((formula) => (
          <GridCard
            key={formula.kind}
            label={formula.label}
            aspect="wide"
            onClick={() =>
              onInsertElements(createFormulaInsertElements(formula.kind))
            }
          >
            <Sigma size={22} />
          </GridCard>
        ))}
      </div>
    </div>
  );
}

export function MediaTab({
  search,
  onInsertElements,
  uploads,
  onUploaded,
  onInsertImage,
}: {
  search: string;
  onInsertElements: (elements: SlideElement[]) => void;
  uploads: UploadedAsset[];
  onUploaded: (asset: UploadedAsset) => void;
  onInsertImage: (url: string) => void;
}) {
  const [mediaType, setMediaType] = useState<"video" | "audio">("video");
  const [src, setSrc] = useState("");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const trimmed = src.trim();

  const filteredUploads = uploads.filter((asset) =>
    matches(asset.name, search),
  );

  const handleInsert = () => {
    if (!trimmed) return;
    onInsertElements(
      createMediaInsertElements(
        mediaType,
        trimmed,
        caption.trim() || undefined,
      ),
    );
    setSrc("");
    setCaption("");
  };

  // Media files can be large; cap at 15MB so the base64-embedded deck JSON
  // doesn't balloon (base64 inflates by ~33%). Hosted URLs (the paste path)
  // have no such limit.
  const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    const isAudio = file.type.startsWith("audio/");
    if (!isVideo && !isAudio) {
      notify.warning("Unsupported file", "Please choose a video or audio file.");
      return;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      notify.warning(
        "File too large",
        `Media must be under ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))}MB to embed in the deck. Use a hosted URL for larger files.`,
      );
      return;
    }
    try {
      setUploading(true);
      const dataUrl = await readFileAsDataUrl(file);
      onInsertElements(
        createMediaInsertElements(
          isVideo ? "video" : "audio",
          dataUrl,
          file.name,
        ),
      );
    } catch {
      notify.error("Upload failed", "Could not read that media file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-1.5">
      <div className="px-2.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,audio/*"
          className="hidden"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (!file.type.startsWith("image/")) {
              notify.warning("Unsupported file", "Please choose an image file.");
              return;
            }
            if (file.size > 5 * 1024 * 1024) {
              notify.warning("File too large", "Images must be under 5MB.");
              return;
            }
            try {
              setImageUploading(true);
              const uploaded = await ImagesApi.uploadImage(file);
              const url = resolveBackendAssetSource(uploaded);
              if (!url) throw new Error("Upload did not return an image URL.");
              onUploaded({ url, name: file.name });
              onInsertImage(url);
            } catch {
              notify.error("Upload failed", "Could not read that image file.");
            } finally {
              setImageUploading(false);
            }
          }}
        />
        <div className="mb-2 flex gap-1.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex h-20 flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-strong)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-light)] disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Video size={18} />
            )}
            <span className="text-[11px] font-medium">
              {uploading ? "Embedding…" : "Video / audio"}
            </span>
          </button>
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={imageUploading}
            className="flex h-20 flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-strong)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-light)] disabled:opacity-60"
          >
            {imageUploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <ImagePlus size={18} />
            )}
            <span className="text-[11px] font-medium">
              {imageUploading ? "Uploading…" : "Image"}
            </span>
          </button>
        </div>

        <div className="mb-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2.5">
          <div className="mb-2 flex gap-1.5">
            {(["video", "audio"] as const).map((kind) => (
              <button
                key={kind}
                onClick={() => setMediaType(kind)}
                className={cn(
                  "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors",
                  mediaType === kind
                    ? "bg-[var(--accent)] text-white"
                    : "border border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                )}
              >
                {kind === "video" ? <Video size={13} /> : <Music size={13} />}
                {kind === "video" ? "Video" : "Audio"}
              </button>
            ))}
          </div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text-muted)]">
            Or paste a media URL
          </label>
          <input
            value={src}
            onChange={(event) => setSrc(event.target.value)}
            placeholder="https://… hosted mp4/mp3 link"
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <label className="mb-1.5 mt-2 block text-[11px] font-medium text-[var(--text-muted)]">
            Caption (optional)
          </label>
          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Shown beneath the player"
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={handleInsert}
            disabled={!trimmed}
            className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mediaType === "video" ? <Video size={13} /> : <Music size={13} />}
            Insert {mediaType}
          </button>
        </div>
      </div>
      <PanelLabel>Quick add</PanelLabel>
      <div className="grid grid-cols-2 gap-2.5 px-2.5 pb-2">
        <GridCard
          label="Video"
          aspect="wide"
          onClick={() =>
            onInsertElements(
              createMediaInsertElements("video", "https://example.com/clip.mp4"),
            )
          }
        >
          <Video size={22} />
        </GridCard>
        <GridCard
          label="Audio"
          aspect="wide"
          onClick={() =>
            onInsertElements(
              createMediaInsertElements("audio", "https://example.com/track.mp3"),
            )
          }
        >
          <Music size={22} />
        </GridCard>
      </div>
      {filteredUploads.length > 0 ? (
        <>
          <PanelLabel>Recently uploaded images</PanelLabel>
          <div className="grid grid-cols-3 gap-2.5 px-2.5 pb-2">
            {filteredUploads.map((asset, i) => (
              <GridCard
                key={`${asset.url}-${i}`}
                label={asset.name}
                onClick={() => onInsertImage(asset.url)}
              >
                <img
                  src={asset.url}
                  alt={asset.name}
                  className="h-full w-full object-cover"
                />
              </GridCard>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------- Uploads -------------------------------- */

export type UploadedAsset = { url: string; name: string };

/* ------------------------------- Placeholder ------------------------------ */

export function PlaceholderTab({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return <EmptyState icon={icon} title={title} description={description} />;
}
