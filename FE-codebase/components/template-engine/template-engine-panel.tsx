"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileUp,
  Loader2,
  Plus,
  Save,
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
  onAddBlank,
  onImportPages,
  onThemeCreated,
  onThemeDeleted,
  onLayoutDeleted,
  onThemeUpdated,
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
  onAddBlank: () => void;
  onImportPages: (pages: Rec[]) => void;
  onThemeCreated: (themeId: string) => void;
  onThemeDeleted: (themeId: string) => void;
  onLayoutDeleted: (layoutId: string) => void;
  onThemeUpdated: () => void;
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

  // Keyed by slide AND the layout loaded into it: applying an existing template
  // over the current slide has to re-seed the fields from that layout, or the
  // author would be editing one template's metadata while looking at another.
  const draftKey = `${activeIndex}::${String(activeUi?.id ?? "")}`;

  useEffect(() => {
    setDrafts((current) =>
      current[draftKey]
        ? current
        : { ...current, [draftKey]: draftFromUi(activeUi, activeIndex) },
    );
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
      setSaveMessage(`Saved as ${layout.id}`);
      onSaved(layout.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [activeUi, draft, existingIds, onSaved, themeId, updateDraft]);

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
    setWarnings(collected);
    if (failed > 0) setSaveError(`${failed} page${failed === 1 ? "" : "s"} could not be saved.`);
    if (saved > 0) {
      const notes = [`Saved ${saved} of ${pageUis.length} pages to ${themeId}`];
      if (skipped > 0) notes.push(`${skipped} skipped`);
      setSaveMessage(`${notes.join(" · ")}.`);
      onSaved(allocatedIds[allocatedIds.length - 1] ?? "");
    }
    setSaving(false);
  }, [drafts, existingIds, onSaved, pageUis, themeId]);

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
            confirmLabel={`Delete ${draft.id} from ${themeId}`}
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
            title={`Add every slide of a .pptx as a page. Its images are written into public/templates/${themeId}/static/imported/.`}
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
        {/* The save follows the scope: on Theme the author is working on the
            whole theme, so it writes every page; on Page and Element they are
            working on one layout, so it writes only that one. */}
        <button
          onClick={savesWholeTheme ? handleSaveAll : handleSave}
          disabled={saving || (savesWholeTheme ? pageCount === 0 : !activeUi)}
          title={
            savesWholeTheme
              ? `Save all ${pageCount} pages on the canvas into ${themeId}, each as its own layout.`
              : `Save only this page into ${themeId}.`
          }
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Save size={13} />
          )}
          {savesWholeTheme
            ? `Save all ${pageCount} page${pageCount === 1 ? "" : "s"} to ${themeId}`
            : `Save this page to ${themeId}`}
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

/** Theme ids become folder names under public/templates and are validated
 *  server-side against the same shape — mirror it here so a bad name is caught
 *  while typing instead of on submit. */
function toThemeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 49);
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
      <Field label="Folder id" hint="public/templates/<id>/ — lowercase, no spaces.">
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

  const unlabelled = entries.filter(
    (entry) => entry.fillable && (!entry.name || !entry.slot?.role),
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
          const needsLabel = entry.fillable && (!entry.name || !entry.slot?.role);
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
                  {entry.type}
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
    <Section title={`Selected slot — ${type}`}>
      {type === "image" && typeof element.data === "string" && (
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

      <label className="flex items-center gap-2 py-1 text-[11px] text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={element.decorative === true}
          onChange={(event) => patchElement({ decorative: event.target.checked })}
        />
        Decorative — never filled by the generator
      </label>

      {element.decorative !== true && (
        <>
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

          <Field label="Hint for the model">
            <textarea
              value={slot.hint ?? ""}
              onChange={(event) => patchSlot({ hint: event.target.value })}
              rows={2}
              placeholder="One benefit, phrased as a verb phrase."
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
