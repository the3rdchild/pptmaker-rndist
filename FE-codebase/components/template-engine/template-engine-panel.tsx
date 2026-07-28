"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Save, Tag } from "lucide-react";

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

function draftFromUi(ui: Rec | null, index: number): LayoutDraft {
  const id = typeof ui?.id === "string" ? ui.id : "";
  const description = typeof ui?.description === "string" ? ui.description : "";
  const meta = isRecord(ui?.meta) ? (ui.meta as LayoutMeta) : {};
  return {
    id,
    name: id || `layout_${index + 1}`,
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
  selection,
  onSaved,
  onAddBlank,
}: {
  themes: TemplateTheme[];
  themeId: string;
  onThemeChange: (themeId: string) => void;
  activeIndex: number;
  activeUi: Rec | null;
  selection: TemplateSelectionPayload | null;
  onSaved: (layoutId: string) => void;
  onAddBlank: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, LayoutDraft>>({});
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<ExportWarning[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    setSavedId(null);
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
      setSavedId(null);
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
      setSavedId(layout.id);
      onSaved(layout.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [activeUi, draft, existingIds, onSaved, themeId, updateDraft]);

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-panel)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <Tag size={14} className="text-[var(--accent-light)]" />
        <h2 className="text-xs font-medium text-[var(--text-primary)]">
          Template engine
        </h2>
      </header>

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
      </Section>

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
      </Section>

      <SlotSection selection={selection} />

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
        {savedId && !saveError && (
          <p className="mb-2 flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-300">
            <Check size={12} />
            Saved as {savedId}
          </p>
        )}
        <button
          onClick={onAddBlank}
          className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
        >
          <Plus size={13} />
          New blank layout
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !activeUi}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Save size={13} />
          )}
          Save to {themeId}
        </button>
      </div>
    </aside>
  );
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

  const element = (selection.element ?? {}) as Rec;
  const slot: SlotMeta = isRecord(element.slot) ? (element.slot as SlotMeta) : {};
  const type = typeof element.type === "string" ? element.type : "element";
  const isTextual = type === "text" || type === "text-list";

  const patchSlot = (patch: Partial<SlotMeta>) => {
    selection.patch((current) => {
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
    selection.patch((current) => ({ ...(current as Rec), ...patch }) as RawElement);
  };

  return (
    <Section title={`Selected slot — ${type}`}>
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
