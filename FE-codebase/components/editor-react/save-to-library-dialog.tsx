"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import type { PastedImage } from "@/components/editor-react/paste-image";

type Category = { id: string; label: string; items: unknown[] };

/** Files a pasted image into the reusable element library.
 *
 *  Pasting drops the image straight onto the slide, which is what you want
 *  nine times in ten. This is the tenth: the image is a motif you will reach
 *  for again while building templates, so it belongs in the library under a
 *  category you chose rather than only in this one deck. */
export function SaveToLibraryDialog({
  image,
  onClose,
  onSaved,
}: {
  image: PastedImage;
  onClose: () => void;
  onSaved: (categoryLabel: string) => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [label, setLabel] = useState("Pasted image");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/elements")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        const list: Category[] = Array.isArray(body?.categories) ? body.categories : [];
        setCategories(list);
        setCategoryId(list[0]?.id ?? "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const target = newCategory.trim() || categoryId;

  const save = async () => {
    if (!target) {
      setError("Pick a category or name a new one.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/elements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: target,
          categoryLabel: newCategory.trim() || undefined,
          label: label.trim() || "Pasted image",
          dataUrl: image.dataUrl,
          width: image.width,
          height: image.height,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Could not save the element");
      onSaved(newCategory.trim() || target);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the element");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-[340px] space-y-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-4 shadow-[var(--shadow-panel)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          Save to My elements
        </h2>

        <div className="flex justify-center rounded-lg bg-[var(--bg-surface)] p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.dataUrl}
            alt=""
            className="max-h-24 max-w-full object-contain"
          />
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] text-[var(--text-secondary)]">Name</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className={inputClass}
          />
        </label>

        {categories.length > 0 && (
          <label className="block space-y-1">
            <span className="text-[11px] text-[var(--text-secondary)]">
              Category
            </span>
            <select
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setNewCategory("");
              }}
              className={inputClass}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label} ({category.items.length})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-[11px] text-[var(--text-secondary)]">
            {categories.length > 0 ? "…or a new category" : "Category"}
          </span>
          <input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            placeholder="abstract shapes"
            className={inputClass}
          />
        </label>

        {error && <p className="text-[11px] text-red-300">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={save}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";
