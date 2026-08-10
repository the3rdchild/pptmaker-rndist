"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileUp,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";

import type { TemplateSelectionPayload } from "@/components/slide-editor/surface/TemplateV2KonvaSlide";
import type { RawElement } from "@/components/slide-editor/model/core";
import {
  SLIDE_ROLES,
  SLOT_FILL_CONDITIONS,
  SLOT_ROLES,
  type LayoutMeta,
  type SlideRole,
  type SlotFillCondition,
  type SlotMeta,
  type SlotRole,
} from "@/components/slide-editor/templates/slot-meta";
import {
  exportSlideAsLayout,
  makeLayoutId,
  type ExportWarning,
} from "@/components/slide-editor/templates/template-v2-export";
import type { TemplateTheme } from "@/lib/templates/themes";
import {
  buildElementOutline,
  sameAddress,
} from "@/components/template-engine/element-outline";
import {
  collectLabelTargets,
  applyAutoLabelResult,
} from "@/components/template-engine/auto-label-apply";
import { captureSlidePng } from "@/components/editor-react/slide-capture";
import type { AutoLabelResult } from "@/lib/templates/auto-label";
import type { AutoLabelThemeResult } from "@/lib/templates/auto-label-theme";
import { isImageFrameElement } from "@/components/editor-react/image-frames";
import {
  TEMPLATE_V2_SELECT_ELEMENT_EVENT,
  type TemplateV2SelectElementDetail,
} from "@/components/slide-editor/events/events";
import {
  importPptxAsTemplatePages,
  type TemplateImportProgress,
} from "@/components/slide-editor/importing/pptx-template-pages";
import { ThemePaletteEditor } from "@/components/template-engine/theme-palette-editor";
import { SaveToLibraryDialog } from "@/components/editor-react/save-to-library-dialog";
import type { PastedImage } from "@/components/editor-react/paste-image";

type Rec = Record<string, unknown>;

/** Per-slide authoring state the panel owns. Layout-level fields are held here
 *  rather than written straight into the ui because committing the ui on every
 *  keystroke would resync the Konva surface and drop the author's selection. */
type LayoutDraft = {
  id: string;
  name: string;
  description: string;
  meta: LayoutMeta;
};

function isRecord(value: unknown): value is Rec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The three things being edited here apply at different scopes, and mixing
 *  them in one column made it unclear what a given field would affect. */
type Scope = "theme" | "page" | "element";

const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: "theme", label: "Theme", hint: "Palette, typography and guidance for the whole theme" },
  { id: "page", label: "Page", hint: "This layout: its role, topics and item counts" },
  { id: "element", label: "Element", hint: "Elements on this page and the one selected" },
];

function draftFromUi(ui: Rec | null, index: number): LayoutDraft {
  const id = typeof ui?.id === "string" ? ui.id : "";
  const description = typeof ui?.description === "string" ? ui.description : "";
  const meta = isRecord(ui?.meta) ? (ui.meta as LayoutMeta) : {};
  // An imported page carries a suggested name (the source file and slide
  // number) but no id — it is a new layout until the author saves it.
  const suggestedName = typeof ui?.name === "string" ? ui.name : "";
  return {
    id,
    name: id || suggestedName || `layout_${index + 1}`,
    description,
    meta,
  };
}

export function TemplateEnginePanel({
  themes,
  themeId,
  onThemeChange,
  activeIndex,
  activeUi,
  pageUis,
  selection,
  onSaved,
  onPagesPersisted,
  onAddBlank,
  onImportPages,
  onThemeCreated,
  onThemeDeleted,
  onLayoutDeleted,
  onThemeUpdated,
  onApplyPageUi,
  originThemeId,
}: {
  themes: TemplateTheme[];
  themeId: string;
  onThemeChange: (themeId: string) => void;
  activeIndex: number;
  activeUi: Rec | null;
  /** Every page on the canvas, in order — what the Theme scope's save writes. */
  pageUis: (Rec | null)[];
  selection: TemplateSelectionPayload | null;
  onSaved: (layoutId: string) => void;
  /** Writes the identity a save assigned back onto the pages themselves. This
   *  panel is unmounted every time its flyout closes, so anything it remembers
   *  about what a page was saved as is gone by the next save. */
  onPagesPersisted: (
    pages: {
      index: number;
      id: string;
      description: string;
      meta: LayoutMeta;
    }[],
  ) => void;
  onAddBlank: () => void;
  onImportPages: (pages: Rec[]) => void;
  onThemeCreated: (themeId: string) => void;
  onThemeDeleted: (themeId: string) => void;
  onLayoutDeleted: (layoutId: string) => void;
  onThemeUpdated: () => void;
  /** Replaces one page's whole ui (auto-label writes element names/slots and
   *  layout meta in one shot). The parent dispatches updateSlideUi. */
  onApplyPageUi: (index: number, ui: Rec) => void;
  /** The theme the canvas was hydrated from (`?theme=` on the engine URL), or
   *  null for a blank canvas. Only when this matches the save target do the
   *  pages on the canvas stand for the WHOLE theme — which is what makes it
   *  safe for the Theme scope's save to delete layouts the author removed. */
  originThemeId: string | null;
}) {
  const [scope, setScope] = useState<Scope>("page");
  const [drafts, setDrafts] = useState<Record<string, LayoutDraft>>({});
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<ExportWarning[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importProgress, setImportProgress] =
    useState<TemplateImportProgress | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-label (AI fills slot name/role/condition/budgets + layout meta).
  // done/total drives the progress bar; total is 1 for page/element scope.
  const [labelProgress, setLabelProgress] = useState<{ done: number; total: number } | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labelNote, setLabelNote] = useState<string | null>(null);
  const [themeLabelBusy, setThemeLabelBusy] = useState(false);
  /** Pages the theme-scope auto-label should touch. null = every page (the
   *  default); an explicit list means "only these". Reset whenever the page
   *  set changes so a stale index never labels the wrong page. */
  const [labelPages, setLabelPages] = useState<number[] | null>(null);
  useEffect(() => {
    setLabelPages(null);
  }, [pageUis.length]);

  // Keyed by slide AND the layout loaded into it: applying an existing template
  // over the current slide has to re-seed the fields from that layout, or the
  // author would be editing one template's metadata while looking at another.
  const draftKey = `${activeIndex}::${String(activeUi?.id ?? "")}`;

  /** Keys whose ui changed because a save just stamped it, not because the
   *  author moved to another page — those must not clear the save result the
   *  same click produced. */
  const selfWrittenKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    setDrafts((current) =>
      current[draftKey]
        ? current
        : { ...current, [draftKey]: draftFromUi(activeUi, activeIndex) },
    );
    if (selfWrittenKeys.current.delete(draftKey)) return;
    setSaveMessage(null);
    setWarnings([]);
    setSaveError(null);
  }, [activeIndex, activeUi, draftKey]);

  const draft = drafts[draftKey] ?? draftFromUi(activeUi, activeIndex);

  const updateDraft = useCallback(
    (patch: Partial<LayoutDraft>) => {
      setDrafts((current) => ({
        ...current,
        [draftKey]: { ...(current[draftKey] ?? draft), ...patch },
      }));
      setSaveMessage(null);
    },
    [draft, draftKey],
  );

  const updateMeta = useCallback(
    (patch: Partial<LayoutMeta>) => {
      updateDraft({ meta: { ...draft.meta, ...patch } });
    },
    [draft.meta, updateDraft],
  );

  const existingIds = useMemo(
    () =>
      themes
        .find((theme) => theme.id === themeId)
        ?.layouts.map((layout) => String(layout.id ?? ""))
        .filter(Boolean) ?? [],
    [themeId, themes],
  );

  /** Themes are addressed by folder id but the author named them — showing the
   *  id in the save controls reads as a different theme entirely once a theme
   *  has been renamed (id `cassual-2`, name `Cassual`). */
  const themeLabel = useMemo(
    () => themes.find((theme) => theme.id === themeId)?.name || themeId,
    [themeId, themes],
  );

  const activeThemeLayoutCount = existingIds.length;
  /** Only an id that actually exists in this theme can be deleted — a draft
   *  name the author is still typing is not a saved layout. */
  const canDeleteLayout = Boolean(draft.id) && existingIds.includes(draft.id);

  const handleSave = useCallback(async () => {
    if (!activeUi) return;
    setSaving(true);
    setSaveError(null);

    const layoutId = draft.id || makeLayoutId(draft.name, existingIds);
    const { layout, warnings: exportWarnings } = exportSlideAsLayout(activeUi, {
      theme: themeId,
      id: layoutId,
      name: draft.name,
      description: draft.description,
      meta: draft.meta,
      existingIds,
    });

    setWarnings(exportWarnings);
    if (exportWarnings.some((warning) => warning.level === "error")) {
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/template-engine/layouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId, layout }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Save failed");
      updateDraft({ id: layout.id });
      selfWrittenKeys.current.add(`${activeIndex}::${layout.id}`);
      onPagesPersisted([
        {
          index: activeIndex,
          id: layout.id,
          description: draft.description,
          meta: draft.meta,
        },
      ]);
      setSaveMessage(`Saved as ${layout.id}`);
      onSaved(layout.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    activeIndex,
    activeUi,
    draft,
    existingIds,
    onPagesPersisted,
    onSaved,
    themeId,
    updateDraft,
  ]);

  /** Saves every page on the canvas into the theme in one go.
   *
   *  This is the Theme scope's save: the author is working on the theme as a
   *  whole there, and after importing a deck it is the difference between one
   *  click and stepping through ten pages. Each page still becomes its own
   *  layout under its own name — the only thing being batched is the saving.
   *  A page that fails to export (an empty one, say) is skipped and named in
   *  the warnings rather than aborting the pages after it. */
  const handleSaveAll = useCallback(async () => {
    if (pageUis.length === 0) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    // Ids are allocated as we go so two same-named pages in one batch can't
    // collide on the id derived from that name.
    const allocatedIds = [...existingIds];
    const collected: ExportWarning[] = [];
    const draftPatches: Record<string, LayoutDraft> = {};
    const persisted: {
      index: number;
      id: string;
      description: string;
      meta: LayoutMeta;
    }[] = [];
    let saved = 0;
    let skipped = 0;
    let failed = 0;

    for (let index = 0; index < pageUis.length; index++) {
      const ui = pageUis[index];
      if (!ui) continue;

      const key = `${index}::${String(ui.id ?? "")}`;
      const pageDraft = drafts[key] ?? draftFromUi(ui, index);
      const label = pageDraft.name || `Page ${index + 1}`;
      const { layout, warnings: exportWarnings } = exportSlideAsLayout(ui, {
        theme: themeId,
        id: pageDraft.id || makeLayoutId(pageDraft.name, allocatedIds),
        name: pageDraft.name,
        description: pageDraft.description,
        meta: pageDraft.meta,
        existingIds: allocatedIds,
      });
      collected.push(
        ...exportWarnings.map((warning) => ({
          ...warning,
          message: `${label}: ${warning.message}`,
        })),
      );
      if (exportWarnings.some((warning) => warning.level === "error")) {
        skipped += 1;
        continue;
      }

      try {
        const res = await fetch("/api/template-engine/layouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeId, layout }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Save failed");
        allocatedIds.push(layout.id);
        draftPatches[key] = { ...pageDraft, id: layout.id };
        persisted.push({
          index,
          id: layout.id,
          description: pageDraft.description,
          meta: pageDraft.meta,
        });
        if (index === activeIndex) {
          selfWrittenKeys.current.add(`${activeIndex}::${layout.id}`);
        }
        saved += 1;
      } catch (error) {
        failed += 1;
        collected.push({
          level: "error",
          message: `${label}: ${error instanceof Error ? error.message : "Save failed"}`,
        });
      }
    }

    // Recording the assigned ids means a second run overwrites those layouts
    // instead of saving a second copy of every page under a fresh id.
    if (Object.keys(draftPatches).length > 0) {
      setDrafts((current) => ({ ...current, ...draftPatches }));
    }
    if (persisted.length > 0) onPagesPersisted(persisted);

    // Removing a page from the canvas and saving the theme has to remove the
    // layout too — the save loop above only ever upserts, and rebuildThemeBundle
    // merges by id, so a deleted page used to survive in both layouts/ and the
    // bundle and reappear in /template-list.
    //
    // Two guards, because this deletes files. The canvas only stands for the
    // whole theme when it was hydrated from THIS theme, so a blank canvas that
    // merely has a theme selected can't wipe it. And a run with failures or
    // skips has an incomplete saved set, where every unsaved page would look
    // like a deletion.
    const pruned: string[] = [];
    const canPrune = originThemeId === themeId && failed === 0 && skipped === 0;
    if (canPrune) {
      const keep = new Set(persisted.map((page) => page.id));
      const orphans = existingIds.filter((id) => !keep.has(id));
      for (const layoutId of orphans) {
        try {
          const res = await fetch(
            `/api/template-engine/layouts?themeId=${encodeURIComponent(themeId)}&layoutId=${encodeURIComponent(layoutId)}`,
            { method: "DELETE" },
          );
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error ?? "Delete failed");
          }
          pruned.push(layoutId);
          onLayoutDeleted(layoutId);
        } catch (error) {
          collected.push({
            level: "error",
            message: `Removing ${layoutId}: ${error instanceof Error ? error.message : "Delete failed"}`,
          });
        }
      }
    }

    setWarnings(collected);
    if (failed > 0) setSaveError(`${failed} page${failed === 1 ? "" : "s"} could not be saved.`);
    if (saved > 0) {
      const notes = [`Saved ${saved} of ${pageUis.length} pages to ${themeLabel}`];
      if (skipped > 0) notes.push(`${skipped} skipped`);
      if (pruned.length > 0) {
        notes.push(`${pruned.length} removed layout${pruned.length === 1 ? "" : "s"} deleted`);
      }
      setSaveMessage(`${notes.join(" · ")}.`);
      onSaved(allocatedIds[allocatedIds.length - 1] ?? "");
    }
    setSaving(false);
  }, [
    activeIndex,
    drafts,
    existingIds,
    onLayoutDeleted,
    onPagesPersisted,
    onSaved,
    originThemeId,
    pageUis,
    themeId,
    themeLabel,
  ]);

  /** Auto-label: asks Kimi to author slot metadata (name/role/fill_condition/
   *  budgets) plus the layout meta, then writes it back onto the canvas. The
   *  scope decides the blast radius — theme: every page, page: this page,
   *  element: only the selected element. Labels land on the canvas as unsaved
   *  edits; the author still reviews and hits Save. */
  const handleAutoLabel = useCallback(async () => {
    setLabelError(null);
    setLabelNote(null);

    const postLabel = async (payload: Rec): Promise<AutoLabelResult> => {
      const res = await fetch("/api/template-engine/auto-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Auto-label failed");
      return body as AutoLabelResult;
    };

    const theme = themes.find((t) => t.id === themeId);
    const themePayload = {
      id: themeId,
      name: theme?.name ?? themeId,
      description: theme?.description ?? "",
    };

    // ── Element scope: only the selected element ──
    if (scope === "element") {
      if (!selection?.element || !selection.patch || !selection.selection) {
        setLabelError("Select an element on the canvas first.");
        return;
      }
      const target = collectLabelTargets(activeUi).find((t) =>
        sameAddress(t.address, selection.selection),
      );
      if (!target) {
        setLabelError("The selected element is not a fillable slot (text, chart or image container).");
        return;
      }
      setLabelProgress({ done: 0, total: 1 });
      try {
        const result = await postLabel({
          theme: themePayload,
          layout: {
            id: String(activeUi?.id ?? ""),
            description: String(activeUi?.description ?? ""),
            meta: isRecord(activeUi?.meta) ? activeUi.meta : null,
          },
          elements: [{ ...target.input, i: 0 }],
          image: activeUi ? await captureSlidePng(activeUi) : null,
        });
        const labelled = result.elements.find((entry) => entry.i === 0);
        if (!labelled) throw new Error("The model returned nothing for this element.");
        selection.patch((current) => {
          const next = { ...(current as Rec) };
          if (labelled.name) next.name = labelled.name;
          if (labelled.slot) next.slot = labelled.slot;
          return next as RawElement;
        });
        setLabelNote(`Labelled ${labelled.name ?? "element"}. Review, then save.`);
      } catch (error) {
        setLabelError(error instanceof Error ? error.message : "Auto-label failed");
      } finally {
        setLabelProgress(null);
      }
      return;
    }

    // ── Page / theme scope ──
    const pageIndexes =
      scope === "theme"
        ? (labelPages ?? pageUis.map((_, index) => index))
        : [activeIndex];
    if (pageIndexes.length === 0) {
      if (scope === "theme") setLabelError("Select at least one page to label.");
      return;
    }

    setLabelProgress({ done: 0, total: pageIndexes.length });
    let labelled = 0;
    try {
      for (const index of pageIndexes) {
        const ui = pageUis[index];
        const targets = ui ? collectLabelTargets(ui) : [];
        if (!ui || targets.length === 0) {
          setLabelProgress({ done: ++labelled, total: pageIndexes.length });
          continue;
        }
        const result = await postLabel({
          theme: themePayload,
          layout: {
            id: String(ui.id ?? ""),
            description: String(ui.description ?? ""),
            meta: isRecord(ui.meta) ? ui.meta : null,
          },
          elements: targets.map((t) => t.input),
          image: await captureSlidePng(ui),
        });
        const nextUi = applyAutoLabelResult(ui, targets, result);
        onApplyPageUi(index, nextUi);
        // Keep the panel's draft map in sync — handleSaveAll reads name,
        // description and meta from drafts first, and a stale draft would
        // overwrite the AI's labels.
        if (result.layout_meta || result.layout_name || result.layout_description) {
          const key = `${index}::${String(nextUi.id ?? "")}`;
          setDrafts((current) => {
            const base = current[key] ?? draftFromUi(nextUi, index);
            return {
              ...current,
              [key]: {
                ...base,
                ...(result.layout_name ? { name: result.layout_name } : {}),
                ...(result.layout_description
                  ? { description: result.layout_description }
                  : {}),
                ...(result.layout_meta
                  ? { meta: { ...base.meta, ...result.layout_meta } }
                  : {}),
              },
            };
          });
        }
        labelled += 1;
        setLabelProgress({ done: labelled, total: pageIndexes.length });
      }
      setLabelNote(
        scope === "theme"
          ? `Labelled ${pageIndexes.length} page${pageIndexes.length === 1 ? "" : "s"}. Review, then save.`
          : "Labelled this page. Review, then save.",
      );
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "Auto-label failed");
    } finally {
      setLabelProgress(null);
    }
  }, [activeIndex, activeUi, labelPages, onApplyPageUi, pageUis, scope, selection, themeId, themes]);

  /** Theme-level auto-label: authors the theme's description + AI guidance
   *  (when_to_use / avoid_when / tone / keywords) from the whole layout family
   *  at once, then PATCHes theme.json straight away — theme metadata has no
   *  canvas draft to stage in, unlike page labels. The result is what the
   *  theme-choice step reads when it picks a theme for a deck topic. */
  const handleAutoLabelTheme = useCallback(async () => {
    setLabelError(null);
    setLabelNote(null);
    const theme = themes.find((t) => t.id === themeId);
    if (!theme) return;
    setThemeLabelBusy(true);
    try {
      const layouts = theme.layouts.map((layout) => {
        const meta = isRecord(layout.meta) ? layout.meta : null;
        return {
          id: String(layout.id ?? ""),
          name: typeof layout.name === "string" ? layout.name : null,
          description:
            typeof layout.description === "string" ? layout.description : null,
          slide_role: typeof meta?.slide_role === "string" ? meta.slide_role : null,
          topics: Array.isArray(meta?.topics)
            ? meta.topics.filter((t): t is string => typeof t === "string")
            : [],
        };
      });
      // A few rendered pages as visual ground truth — the theme's character is
      // what the guidance should describe, and metadata alone can't show it.
      // Only when the canvas actually shows THIS theme; pages from another
      // theme would teach the model the wrong identity.
      const images: string[] = [];
      if (originThemeId === themeId) {
        for (const ui of pageUis.slice(0, 3)) {
          if (!ui) continue;
          const png = await captureSlidePng(ui);
          if (png) images.push(png);
        }
      }
      const res = await fetch("/api/template-engine/auto-label-theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: {
            id: theme.id,
            name: theme.name,
            description: theme.description,
            ai: theme.ai ?? null,
          },
          layouts,
          images,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Auto-label failed");
      const result = body as AutoLabelThemeResult;

      const patch: Rec = {
        ai: {
          ...(theme.ai ?? {}),
          ...(result.when_to_use ? { when_to_use: result.when_to_use } : {}),
          ...(result.avoid_when ? { avoid_when: result.avoid_when } : {}),
          ...(result.tone.length > 0 ? { tone: result.tone } : {}),
          ...(result.keywords.length > 0 ? { keywords: result.keywords } : {}),
        },
      };
      if (result.description) patch.description = result.description;

      const saveRes = await fetch("/api/template-engine/themes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: theme.id, patch }),
      });
      const saveBody = await saveRes.json().catch(() => null);
      if (!saveRes.ok) {
        throw new Error(saveBody?.error ?? "Could not save the theme metadata");
      }
      onThemeUpdated();
      setLabelNote(`Theme guidance labelled and saved to ${theme.name}.`);
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "Auto-label failed");
    } finally {
      setThemeLabelBusy(false);
    }
  }, [onThemeUpdated, originThemeId, pageUis, themeId, themes]);

  /** Flips one page in the theme-scope label selection. Selecting every page
   *  collapses back to null (= "all") so the button keeps reading as before. */
  const toggleLabelPage = useCallback(
    (index: number) => {
      setLabelPages((current) => {
        const base = current ?? pageUis.map((_, i) => i);
        const next = base.includes(index)
          ? base.filter((i) => i !== index)
          : [...base, index].sort((a, b) => a - b);
        return next.length === pageUis.length ? null : next;
      });
    },
    [pageUis],
  );

  /** Turns a .pptx into pages on the canvas. Every slide lands as an unsaved
   *  layout so the author can label its slots and save the ones worth keeping —
   *  importing is a starting point for authoring, not a bulk publish. */
  const handleImportPptx = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".pptx")) {
        setImportError("Pick a .pptx file.");
        return;
      }

      setImportError(null);
      setImportNote(null);
      setImportProgress({ stage: "parsing", done: 0, total: 0 });
      try {
        const result = await importPptxAsTemplatePages(
          file,
          themeId,
          setImportProgress,
        );
        if (result.pages.length === 0) {
          setImportError("That file has no slides.");
          return;
        }
        onImportPages(result.pages);

        const notes = [
          `${result.pages.length} page${result.pages.length === 1 ? "" : "s"} added`,
          `${result.assetCount} image${result.assetCount === 1 ? "" : "s"} stored in ${themeId}/static/imported`,
        ];
        if (result.reusedAssetCount > 0) {
          notes.push(`${result.reusedAssetCount} already on disk`);
        }
        if (result.failedAssetCount > 0) {
          notes.push(`${result.failedAssetCount} could not be stored and stayed inline`);
        }
        if (result.skippedShapeCount > 0) {
          notes.push(`${result.skippedShapeCount} chart/table shape${result.skippedShapeCount === 1 ? "" : "s"} skipped`);
        }
        setImportNote(`${notes.join(" · ")}.`);
      } catch (error) {
        setImportError(
          error instanceof Error ? error.message : "Could not import that file",
        );
      } finally {
        setImportProgress(null);
      }
    },
    [onImportPages, themeId],
  );

  const pageCount = pageUis.filter(Boolean).length;
  const savesWholeTheme = scope === "theme";
  const importing = importProgress !== null;
  const importLabel =
    importProgress?.stage === "assets" && importProgress.total > 0
      ? `Storing images ${importProgress.done}/${importProgress.total}`
      : importProgress
        ? "Reading .pptx"
        : "Import .pptx as pages";

  return (
    // Mounted inside the rail's flyout, which supplies the title bar and the
    // close button — hence no header and no width of its own.
    <aside className="flex min-h-full w-full flex-col">
      {/* Three scopes, three tabs. Stacked, they made one long column where
          theme-wide settings and a single element's label sat at the same
          visual level despite applying to completely different things. */}
      <div className="flex shrink-0 gap-1 border-b border-[var(--border)] p-2">
        {SCOPES.map((option) => (
          <button
            key={option.id}
            onClick={() => setScope(option.id)}
            title={option.hint}
            className={
              scope === option.id
                ? "flex-1 rounded-md bg-[var(--accent)] px-2 py-1.5 text-[11px] font-medium text-white"
                : "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      {scope === "theme" && (
        <>
      <Section title="Theme">
        <select
          value={themeId}
          onChange={(event) => onThemeChange(event.target.value)}
          className={inputClass}
        >
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name} ({theme.layouts.length})
            </option>
          ))}
        </select>
        <RenameThemeForm
          theme={themes.find((theme) => theme.id === themeId) ?? null}
          onRenamed={onThemeUpdated}
        />
        <NewThemeForm
          existingIds={themes.map((theme) => theme.id)}
          onCreated={onThemeCreated}
        />
        {themes.length > 1 && (
          <ConfirmDelete
            label="Delete this theme"
            confirmLabel={`Delete ${themeId} and all ${activeThemeLayoutCount} of its layouts`}
            onConfirm={async () => {
              const res = await fetch(
                `/api/template-engine/themes?themeId=${encodeURIComponent(themeId)}`,
                { method: "DELETE" },
              );
              const body = await res.json();
              if (!res.ok) throw new Error(body?.error ?? "Delete failed");
              onThemeDeleted(themeId);
            }}
          />
        )}
      </Section>

      <Section title="Palette & guidance">
        {/* Theme-level counterpart of the per-page auto-label: authors the
            description + AI guidance the theme-choice step matches topics
            against. Saves straight to theme.json. */}
        <button
          onClick={handleAutoLabelTheme}
          disabled={themeLabelBusy || labelProgress !== null || saving || importing}
          title="Author this theme's description and AI guidance (when to use, when to avoid, tone, keywords) with AI, from the whole layout family."
          className={`${secondaryButtonClass} mb-2 w-full`}
        >
          {themeLabelBusy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Sparkles size={13} />
          )}
          <span className="truncate">
            {themeLabelBusy
              ? "Labelling theme guidance…"
              : "Auto-label theme guidance (AI)"}
          </span>
        </button>
        <ThemePaletteEditor
          theme={themes.find((t) => t.id === themeId) ?? null}
          onSaved={onThemeUpdated}
        />
      </Section>
        </>
      )}

      {scope === "page" && (
        <>
      <Section title="This layout">
        <p className="text-[10px] leading-snug text-[var(--text-muted)]">
          {draft.id
            ? `Editing ${draft.id} — saving overwrites it. Change the name to save a copy instead.`
            : "New layout. Open an existing one from the Templates panel to edit it instead."}
        </p>
        <Field label="Name">
          <input
            value={draft.name}
            onChange={(event) => updateDraft({ name: event.target.value })}
            placeholder="split_cover_layout"
            className={inputClass}
          />
        </Field>
        <Field
          label="Description"
          hint="Shown to the model when it picks a layout — describe the composition, not the sample text."
        >
          <textarea
            value={draft.description}
            onChange={(event) => updateDraft({ description: event.target.value })}
            rows={3}
            placeholder="A two-column cover with a left text block and a full-height image panel on the right."
            className={inputClass}
          />
        </Field>
        <Field label="Slide role">
          <select
            value={draft.meta.slide_role ?? ""}
            onChange={(event) =>
              updateMeta({
                slide_role: (event.target.value || null) as SlideRole | null,
              })
            }
            className={inputClass}
          >
            <option value="">— none —</option>
            {SLIDE_ROLES.map((role) => (
              <option key={role.id} value={role.id} title={role.hint}>
                {role.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Topics" hint="Comma separated.">
          <input
            value={(draft.meta.topics ?? []).join(", ")}
            onChange={(event) =>
              updateMeta({
                topics: event.target.value
                  .split(",")
                  .map((topic) => topic.trim())
                  .filter(Boolean),
              })
            }
            placeholder="product launch, roadmap"
            className={inputClass}
          />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Min items">
            <NumberInput
              value={draft.meta.min_items}
              onChange={(value) => updateMeta({ min_items: value })}
            />
          </Field>
          <Field label="Ideal">
            <NumberInput
              value={draft.meta.ideal_items}
              onChange={(value) => updateMeta({ ideal_items: value })}
            />
          </Field>
          <Field label="Max items">
            <NumberInput
              value={draft.meta.max_items}
              onChange={(value) => updateMeta({ max_items: value })}
            />
          </Field>
        </div>
        <Field label="Notes for the model">
          <textarea
            value={draft.meta.notes ?? ""}
            onChange={(event) => updateMeta({ notes: event.target.value })}
            rows={2}
            placeholder="Use only when there is a real hero image."
            className={inputClass}
          />
        </Field>
        {canDeleteLayout && (
          <ConfirmDelete
            label="Delete this layout"
            confirmLabel={`Delete ${draft.id} from ${themeLabel}`}
            onConfirm={async () => {
              const res = await fetch(
                `/api/template-engine/layouts?themeId=${encodeURIComponent(themeId)}&layoutId=${encodeURIComponent(draft.id)}`,
                { method: "DELETE" },
              );
              const body = await res.json();
              if (!res.ok) throw new Error(body?.error ?? "Delete failed");
              // The slide stays on the canvas — only the stored template is
              // gone, so clearing the id turns it back into an unsaved draft.
              updateDraft({ id: "" });
              onLayoutDeleted(draft.id);
            }}
          />
        )}
      </Section>
        </>
      )}

      {scope === "element" && (
        <>
          <ElementOutlineSection
            activeUi={activeUi}
            slideIndex={activeIndex}
            selection={selection}
          />
          <SlotSection selection={selection} />
        </>
      )}

      <div className="mt-auto shrink-0 border-t border-[var(--border)] p-3">
        {warnings.length > 0 && (
          <ul className="mb-2 space-y-1">
            {warnings.map((warning, index) => (
              <li
                key={index}
                className={
                  warning.level === "error"
                    ? "flex gap-1.5 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300"
                    : "flex gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300"
                }
              >
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        )}
        {saveError && (
          <p className="mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
            {saveError}
          </p>
        )}
        {saveMessage && !saveError && (
          <p className="mb-2 flex gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-300">
            <Check size={12} className="mt-0.5 shrink-0" />
            <span>{saveMessage}</span>
          </p>
        )}
        {importError && (
          <p className="mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
            {importError}
          </p>
        )}
        {importNote && !importError && (
          <p className="mb-2 flex gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-300">
            <Check size={12} className="mt-0.5 shrink-0" />
            <span>{importNote}</span>
          </p>
        )}
        <div className="mb-2 grid grid-cols-2 gap-2">
          <button
            onClick={onAddBlank}
            disabled={importing}
            className={secondaryButtonClass}
          >
            <Plus size={13} />
            New blank
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pptx"
            className="hidden"
            onChange={(event) => {
              void handleImportPptx(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title={`Add every slide of a .pptx as a page. Its images are uploaded to templates/${themeId}/static/imported/.`}
            className={secondaryButtonClass}
          >
            {importing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <FileUp size={13} />
            )}
            <span className="truncate">{importing ? importLabel : "Import .pptx"}</span>
          </button>
        </div>
        {/* Page picker for the theme scope — label a subset (e.g. 1, 3, 4)
            instead of always the whole canvas. null selection = all pages. */}
        {scope === "theme" && pageUis.length > 1 && (
          <div className="mb-2 rounded-md border border-[var(--border)] px-2 py-1.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                Pages to label
                {labelPages
                  ? ` (${labelPages.length}/${pageUis.length})`
                  : ` (all ${pageUis.length})`}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setLabelPages(null)}
                  className="text-[10px] text-[var(--accent)] hover:underline"
                >
                  All
                </button>
                <button
                  onClick={() => setLabelPages([])}
                  className="text-[10px] text-[var(--text-muted)] hover:underline"
                >
                  None
                </button>
              </div>
            </div>
            <div className="max-h-36 space-y-0.5 overflow-y-auto">
              {pageUis.map((ui, index) => {
                const key = `${index}::${String(ui?.id ?? "")}`;
                const name = (drafts[key] ?? draftFromUi(ui, index)).name;
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                  >
                    <input
                      type="checkbox"
                      checked={!labelPages || labelPages.includes(index)}
                      onChange={() => toggleLabelPage(index)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="shrink-0 text-[var(--text-muted)]">{index + 1}.</span>
                    <span className="truncate">{name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {/* Auto-label fills slot name/role/fill_condition/budgets + layout meta
            via AI. Blast radius follows the scope tab: theme = the pages
            selected above, page = this page, element = the selected element
            only. */}
        <button
          onClick={handleAutoLabel}
          disabled={
            labelProgress !== null ||
            saving ||
            importing ||
            (scope === "theme" && labelPages !== null && labelPages.length === 0)
          }
          title={
            scope === "theme"
              ? "Auto-label slots on the selected pages with AI."
              : scope === "page"
                ? "Auto-label this page's slots and layout meta with AI."
                : "Auto-label only the selected element with AI."
          }
          className={`${secondaryButtonClass} mb-2 w-full`}
        >
          {labelProgress ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Sparkles size={13} />
          )}
          <span className="truncate">
            {labelProgress
              ? `Labelling ${labelProgress.done}/${labelProgress.total}…`
              : scope === "theme"
                ? labelPages
                  ? `Auto-label ${labelPages.length} selected page${labelPages.length === 1 ? "" : "s"} (AI)`
                  : "Auto-label all pages (AI)"
                : scope === "page"
                  ? "Auto-label this page (AI)"
                  : "Auto-label selected element (AI)"}
          </span>
        </button>
        {labelProgress && (
          <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
              style={{
                width: `${Math.round((labelProgress.done / Math.max(1, labelProgress.total)) * 100)}%`,
              }}
            />
          </div>
        )}
        {labelError && (
          <p className="mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
            {labelError}
          </p>
        )}
        {labelNote && !labelError && (
          <p className="mb-2 flex gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-300">
            <Check size={12} className="mt-0.5 shrink-0" />
            <span>{labelNote}</span>
          </p>
        )}
        {/* The save follows the scope: on Theme the author is working on the
            whole theme, so it writes every page; on Page and Element they are
            working on one layout, so it writes only that one. */}
        <button
          onClick={savesWholeTheme ? handleSaveAll : handleSave}
          disabled={saving || (savesWholeTheme ? pageCount === 0 : !activeUi)}
          title={
            savesWholeTheme
              ? `Save all ${pageCount} pages on the canvas into ${themeLabel}, each as its own layout.` +
                (originThemeId === themeId
                  ? " Layouts you removed from the canvas are deleted from the theme."
                  : "")
              : `Save only this page into ${themeLabel}.`
          }
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Save size={13} />
          )}
          {savesWholeTheme
            ? `Save all ${pageCount} page${pageCount === 1 ? "" : "s"} to ${themeLabel}`
            : `Save this page to ${themeLabel}`}
        </button>
      </div>
    </aside>
  );
}

/** Two-step delete. Deleting removes files from the repo working tree and the
 *  editor has no undo for it, so the destructive label is only shown after an
 *  explicit first click and states exactly what will go. */
function ConfirmDelete({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!armed) {
    return (
      <button
        onClick={() => {
          setArmed(true);
          setError(null);
        }}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-300"
      >
        <Trash2 size={12} />
        {label}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-red-500/30 bg-red-500/5 p-2">
      <p className="text-[10px] leading-snug text-red-300">{confirmLabel}</p>
      {error && <p className="text-[10px] text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
              setArmed(false);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Delete failed");
            } finally {
              setBusy(false);
            }
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-500/80 px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          Delete
        </button>
        <button
          onClick={() => {
            setArmed(false);
            setError(null);
          }}
          className="rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Theme ids become key prefixes under templates/ and are validated
 *  server-side against the same shape — mirror it here so a bad name is caught
 *  while typing instead of on submit. */
function toThemeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 49);
}

/** Renames the theme's display name — the storage id (templates/<id>/)
 *  stays put, since that id is what every layout's stored asset paths and a
 *  saved deck's theme tag are keyed on; changing it would be a much bigger
 *  operation than what "rename" asks for here. */
function RenameThemeForm({
  theme,
  onRenamed,
}: {
  theme: TemplateTheme | null;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(theme?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(theme?.name ?? "");
    setError(null);
  }, [theme?.id, theme?.name]);

  const trimmed = name.trim();
  const dirty = Boolean(theme) && trimmed.length > 0 && trimmed !== theme?.name;

  const submit = async () => {
    if (!theme || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/template-engine/themes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: theme.id, patch: { name: trimmed } }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Rename failed");
      onRenamed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  };

  if (!theme) return null;

  return (
    <div className="mt-2 space-y-1">
      <Field
        label="Theme name"
        hint="Shown in the picker and on /template-list — the folder id stays the same."
      >
        <div className="flex gap-1.5">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            className={inputClass}
          />
          <button
            onClick={submit}
            disabled={!dirty || busy}
            title="Rename this theme"
            className="flex shrink-0 items-center justify-center gap-1 rounded-md bg-[var(--accent)] px-2.5 text-[11px] font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : "Save"}
          </button>
        </div>
      </Field>
      {error && <p className="text-[10px] text-red-300">{error}</p>}
    </div>
  );
}

function NewThemeForm({
  existingIds,
  onCreated,
}: {
  existingIds: string[];
  onCreated: (themeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveId = idTouched ? id : toThemeId(name);
  const duplicate = existingIds.includes(effectiveId);
  const valid = Boolean(name.trim()) && Boolean(effectiveId) && !duplicate;

  const reset = () => {
    setOpen(false);
    setName("");
    setId("");
    setIdTouched(false);
    setDescription("");
    setError(null);
  };

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/template-engine/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: effectiveId,
          name: name.trim(),
          description: description.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Could not create the theme");
      onCreated(effectiveId);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the theme");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
      >
        <Plus size={12} />
        New theme
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2">
      <Field label="Theme name">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Business Formal"
          className={inputClass}
        />
      </Field>
      <Field label="Folder id" hint="templates/<id>/ — lowercase, no spaces.">
        <input
          value={effectiveId}
          onChange={(event) => {
            setIdTouched(true);
            setId(toThemeId(event.target.value));
          }}
          placeholder="business-formal"
          className={inputClass}
        />
      </Field>
      <Field label="Description" hint="What this theme is for — the model reads it.">
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          className={inputClass}
        />
      </Field>
      {duplicate && (
        <p className="text-[10px] text-amber-300">
          A theme with the id &quot;{effectiveId}&quot; already exists.
        </p>
      )}
      {error && <p className="text-[10px] text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!valid || busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          Create
        </button>
        <button
          onClick={reset}
          className="rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Every element in the layout, clickable. Small or overlapped elements are
 *  effectively unreachable on the canvas, and those are exactly the ones that
 *  end up unlabelled. */
function ElementOutlineSection({
  activeUi,
  slideIndex,
  selection,
}: {
  activeUi: Rec | null;
  slideIndex: number;
  selection: TemplateSelectionPayload | null;
}) {
  const entries = useMemo(() => buildElementOutline(activeUi), [activeUi]);
  const selected = selection?.selection ?? null;

  if (entries.length === 0) {
    return (
      <Section title="Elements">
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          Nothing on this slide yet.
        </p>
      </Section>
    );
  }

  const unlabelled = entries.filter((entry) =>
    entry.frame
      ? !entry.name
      : entry.fillable && (!entry.name || !entry.slot?.role),
  ).length;

  return (
    <Section title={`Elements (${entries.length})`}>
      {unlabelled > 0 && (
        <p className="text-[10px] text-amber-300">
          {unlabelled} fillable slot{unlabelled === 1 ? "" : "s"} still need a
          name and role.
        </p>
      )}
      <ul className="max-h-[320px] space-y-px overflow-y-auto">
        {entries.map((entry) => {
          const isSelected = sameAddress(selected, entry);
          // A multi-element component selected on canvas has no single element
          // to point at, so mark everything it holds instead of nothing.
          const inSelectedComponent =
            !selected &&
            selection != null &&
            entry.componentIndex === selection.componentIndex;
          const needsLabel = entry.frame
            ? !entry.name
            : entry.fillable && (!entry.name || !entry.slot?.role);
          return (
            <li key={`${entry.componentIndex}:${entry.elementPath.join(".")}`}>
              <button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent<TemplateV2SelectElementDetail>(
                      TEMPLATE_V2_SELECT_ELEMENT_EVENT,
                      {
                        detail: {
                          slideIndex,
                          componentIndex: entry.componentIndex,
                          elementPath: entry.elementPath,
                        },
                      },
                    ),
                  )
                }
                style={{ paddingLeft: 6 + entry.depth * 12 }}
                className={
                  isSelected
                    ? "flex w-full items-center gap-1.5 rounded-md bg-[var(--accent-soft)] py-1 pr-2 text-left text-[11px] text-[var(--accent-light)]"
                    : inSelectedComponent
                      ? "flex w-full items-center gap-1.5 rounded-md bg-[var(--bg-elevated)] py-1 pr-2 text-left text-[11px] text-[var(--text-primary)]"
                      : "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                }
              >
                <span className="w-[52px] shrink-0 truncate text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                  {entry.frame ? "frame" : entry.type}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.decorative && (
                  <span
                    title="Decorative — never filled by the generator"
                    className="shrink-0 text-[9px] text-[var(--text-muted)]"
                  >
                    dec
                  </span>
                )}
                {entry.slot?.role && (
                  <span className="shrink-0 text-[9px] text-[var(--accent-light)]">
                    {entry.slot.role}
                  </span>
                )}
                {needsLabel && (
                  <span
                    title="Fillable but unlabelled"
                    className="shrink-0 text-[10px] text-amber-400"
                  >
                    ●
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Files the selected image into the reusable library.
 *
 *  This used to live only in the toast that follows a paste, which auto-closes
 *  after a few seconds — an action that needs a decision had a deadline. Here
 *  it stays put, and it also covers images that arrived any other way. */
function SaveImageToLibrary({
  src,
  width,
  height,
  suggestedLabel,
}: {
  src: string;
  width: number;
  height: number;
  suggestedLabel: string;
}) {
  const [image, setImage] = useState<PastedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      // The library stores bytes, so a referenced image has to be fetched and
      // inlined first; a pasted one is already a data URL.
      const dataUrl = src.startsWith("data:") ? src : await toDataUrl(src);
      setImage({ dataUrl, width, height });
    } catch {
      setError("Could not read this image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={open}
        disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
        Save to My elements
      </button>
      {error && <p className="text-[10px] text-red-300">{error}</p>}
      {image && (
        <SaveToLibraryDialog
          image={image}
          onClose={() => setImage(null)}
          onSaved={() => setImage(null)}
          defaultLabel={suggestedLabel}
        />
      )}
    </>
  );
}

async function toDataUrl(src: string): Promise<string> {
  const response = await fetch(src);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
}

function SlotSection({ selection }: { selection: TemplateSelectionPayload | null }) {
  if (!selection) {
    return (
      <Section title="Selected slot">
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          Select an element on the canvas to label it. Labels tell the generator
          what belongs in the slot and when to leave it out.
        </p>
      </Section>
    );
  }

  if (!selection.element || !selection.patch) {
    return (
      <Section title="Selected slot">
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          This component holds several elements — pick one from the list above
          to label it.
        </p>
      </Section>
    );
  }

  const element = selection.element as Rec;
  const applyPatch = selection.patch;
  const slot: SlotMeta = isRecord(element.slot) ? (element.slot as SlotMeta) : {};
  const type = typeof element.type === "string" ? element.type : "element";
  const isTextual = type === "text" || type === "text-list";
  // Image containers are internal shapes, not media images: no library save,
  // no decorative toggle, no text role — and the generator always fills them.
  const isFrame = isImageFrameElement(element);

  const patchSlot = (patch: Partial<SlotMeta>) => {
    applyPatch((current) => {
      const currentSlot = isRecord((current as Rec).slot)
        ? ((current as Rec).slot as SlotMeta)
        : {};
      const nextSlot = { ...currentSlot, ...patch };
      // Drop emptied keys so untouched templates stay clean in the diff.
      for (const key of Object.keys(nextSlot) as (keyof SlotMeta)[]) {
        const value = nextSlot[key];
        if (value === null || value === undefined || value === "") {
          delete nextSlot[key];
        }
      }
      return {
        ...(current as Rec),
        slot: Object.keys(nextSlot).length > 0 ? nextSlot : undefined,
      } as RawElement;
    });
  };

  const patchElement = (patch: Rec) => {
    applyPatch((current) => ({ ...(current as Rec), ...patch }) as RawElement);
  };

  return (
    <Section title={`Selected slot — ${isFrame ? "frame" : type}`}>
      {type === "image" && !isFrame && typeof element.data === "string" && (
        <SaveImageToLibrary
          src={element.data}
          width={isRecord(element.size) ? Number(element.size.width) || 200 : 200}
          height={isRecord(element.size) ? Number(element.size.height) || 200 : 200}
          suggestedLabel={
            typeof element.name === "string" ? element.name : "Element"
          }
        />
      )}

      <Field
        label="Slot name"
        hint="How the generator addresses this slot. Unnamed slots can't be targeted."
      >
        <input
          value={typeof element.name === "string" ? element.name : ""}
          onChange={(event) => patchElement({ name: event.target.value })}
          placeholder="primary_heading"
          className={inputClass}
        />
      </Field>

      {isFrame ? (
        <p className="py-1 text-[10px] leading-snug text-[var(--text-muted)]">
          Image container — the generator always fills it with a generated
          photo. The hint below doubles as the photo prompt.
        </p>
      ) : (
        <label className="flex items-center gap-2 py-1 text-[11px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={element.decorative === true}
            onChange={(event) => patchElement({ decorative: event.target.checked })}
          />
          Decorative — never filled by the generator
        </label>
      )}

      {(isFrame || element.decorative !== true) && (
        <>
          {!isFrame && (
            <Field label="Role">
            <select
              value={slot.role ?? ""}
              onChange={(event) =>
                patchSlot({ role: (event.target.value || null) as SlotRole | null })
              }
              className={inputClass}
            >
              <option value="">— none —</option>
              {SLOT_ROLES.map((role) => (
                <option key={role.id} value={role.id} title={role.hint}>
                  {role.label}
                </option>
              ))}
            </select>
            </Field>
          )}

          <Field label="Fill condition">
            <select
              value={slot.fill_condition ?? ""}
              onChange={(event) =>
                patchSlot({
                  fill_condition: (event.target.value ||
                    null) as SlotFillCondition | null,
                })
              }
              className={inputClass}
            >
              <option value="">— always —</option>
              {SLOT_FILL_CONDITIONS.map((condition) => (
                <option key={condition.id} value={condition.id} title={condition.hint}>
                  {condition.label}
                </option>
              ))}
            </select>
          </Field>

          <label className="flex items-center gap-2 py-1 text-[11px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={slot.prune_if_unfilled === true}
              onChange={(event) =>
                patchSlot({ prune_if_unfilled: event.target.checked })
              }
            />
            Remove the element when the condition isn&apos;t met
          </label>

          {isTextual && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Max words">
                <NumberInput
                  value={slot.max_words}
                  onChange={(value) => patchSlot({ max_words: value })}
                />
              </Field>
              <Field label="Max lines">
                <NumberInput
                  value={slot.max_lines}
                  onChange={(value) => patchSlot({ max_lines: value })}
                />
              </Field>
              <Field label="Ideal words" hint="Looks best at this length">
                <NumberInput
                  value={slot.ideal_words}
                  onChange={(value) => patchSlot({ ideal_words: value })}
                />
              </Field>
              <Field label="Ideal lines">
                <NumberInput
                  value={slot.ideal_lines}
                  onChange={(value) => patchSlot({ ideal_lines: value })}
                />
              </Field>
              <Field label="Max chars">
                <NumberInput
                  value={
                    typeof element.max_length === "number"
                      ? element.max_length
                      : null
                  }
                  onChange={(value) => patchElement({ max_length: value })}
                />
              </Field>
              <Field label="Min chars">
                <NumberInput
                  value={
                    typeof element.min_length === "number"
                      ? element.min_length
                      : null
                  }
                  onChange={(value) => patchElement({ min_length: value })}
                />
              </Field>
            </div>
          )}

          <Field
            label={isFrame ? "Photo to generate" : "Hint for the model"}
            hint={
              isFrame
                ? "Used verbatim as the image-generation prompt."
                : undefined
            }
          >
            <textarea
              value={slot.hint ?? ""}
              onChange={(event) => patchSlot({ hint: event.target.value })}
              rows={2}
              placeholder={
                isFrame
                  ? "Smiling barista pouring latte art, warm morning light."
                  : "One benefit, phrased as a verb phrase."
              }
              className={inputClass}
            />
          </Field>
        </>
      )}
    </Section>
  );
}

const inputClass =
  "w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";

const secondaryButtonClass =
  "flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:opacity-50";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="shrink-0 space-y-2 border-b border-[var(--border)] p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-[var(--text-secondary)]">{label}</span>
      {children}
      {hint && (
        <span className="block text-[10px] leading-snug text-[var(--text-muted)]">
          {hint}
        </span>
      )}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
}: {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
}) {
  return (
    <input
      type="number"
      min={1}
      value={value ?? ""}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(raw === "" ? null : Math.max(1, Number(raw)));
      }}
      className={inputClass}
    />
  );
}
