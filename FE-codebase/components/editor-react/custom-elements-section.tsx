"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { CUSTOM_ELEMENT_DRAG_MIME } from "@/components/editor-react/element-catalog";

export type CustomElementItem = {
  id: string;
  label: string;
  src: string;
  width: number;
  height: number;
};

export type CustomElementCategory = {
  id: string;
  label: string;
  items: CustomElementItem[];
};

/** Reads a File as a base64 data URL and measures it, so the upload carries
 *  the element's natural size and inserting it later needs no image load. */
function readUpload(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const image = new window.Image();
      image.onload = () =>
        resolve({
          dataUrl,
          width: image.naturalWidth || image.width || 200,
          height: image.naturalHeight || image.height || 200,
        });
      // SVGs without intrinsic dimensions still upload fine — the store falls
      // back to a square, and the author can resize on canvas.
      image.onerror = () => resolve({ dataUrl, width: 200, height: 200 });
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function labelFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

export function CustomElementsSection({
  search,
  onInsertElement,
}: {
  search: string;
  onInsertElement: (item: CustomElementItem) => void;
}) {
  const [categories, setCategories] = useState<CustomElementCategory[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/elements");
      const body = await res.json();
      const next: CustomElementCategory[] = Array.isArray(body?.categories)
        ? body.categories
        : [];
      setCategories(next);
      setActiveId((current) =>
        current && next.some((category) => category.id === current)
          ? current
          : next[0]?.id ?? null,
      );
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadTarget = newCategory.trim() || activeId;

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (!uploadTarget) {
        setError("Name a category first — elements are filed under one.");
        return;
      }
      setUploading(true);
      setError(null);
      try {
        for (const file of Array.from(files)) {
          const { dataUrl, width, height } = await readUpload(file);
          const res = await fetch("/api/elements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              categoryId: uploadTarget,
              categoryLabel: newCategory.trim() || undefined,
              label: labelFromFilename(file.name),
              dataUrl,
              width,
              height,
            }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error ?? `Upload failed: ${file.name}`);
        }
        setNewCategory("");
        await refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Upload failed");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [newCategory, refresh, uploadTarget],
  );

  const handleDelete = useCallback(
    async (categoryId: string, itemId: string) => {
      try {
        const res = await fetch(
          `/api/elements?categoryId=${encodeURIComponent(categoryId)}&itemId=${encodeURIComponent(itemId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body?.error ?? "Delete failed");
        }
        await refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Delete failed");
      }
    },
    [refresh],
  );

  const active = categories.find((category) => category.id === activeId) ?? null;
  const visible = (active?.items ?? []).filter(
    (item) => !search || item.label.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          My elements
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Upload SVG or PNG elements"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Upload size={11} />
          )}
          Upload
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <div className="flex flex-wrap gap-1.5 px-2.5 pb-1.5">
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => setActiveId(category.id)}
            className={
              category.id === activeId
                ? "rounded-full bg-[var(--accent)] px-2.5 py-1 text-[10px] font-medium text-white"
                : "rounded-full bg-[var(--bg-elevated)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            }
          >
            {category.label}
            <span className="ml-1 opacity-60">{category.items.length}</span>
          </button>
        ))}
        <input
          value={newCategory}
          onChange={(event) => setNewCategory(event.target.value)}
          placeholder={categories.length ? "+ new category" : "name a category"}
          title="Type a name, then Upload — the category is created with the first file"
          className="w-[110px] rounded-full border border-dashed border-[var(--border-strong)] bg-transparent px-2.5 py-1 text-[10px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
        />
      </div>

      {error && (
        <p className="mx-2.5 mb-1.5 rounded-md bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
          {error}
        </p>
      )}

      {categories.length === 0 ? (
        <p className="px-3 pb-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
          Nothing uploaded yet. Name a category, then Upload — SVG or PNG. Files
          are saved to shared storage and stay available in every deck.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-2.5 px-2.5 pb-2">
          {visible.map((item) => (
            <div
              key={item.id}
              className="group relative cursor-grab active:cursor-grabbing"
              // Same as the built-in catalog cards: drag one onto the canvas to
              // drop it where the cursor is, click to insert at the default
              // position. The payload carries the item, since an upload has no
              // catalog key for the drop side to look up.
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  CUSTOM_ELEMENT_DRAG_MIME,
                  JSON.stringify({
                    src: item.src,
                    width: item.width,
                    height: item.height,
                  }),
                );
                e.dataTransfer.effectAllowed = "copy";
                // The default ghost snapshots the whole card — dark tile,
                // border, and the delete badge that hover puts in the corner.
                // Dragging the <img> on its own keeps the artwork's own
                // transparency, so what follows the cursor is the element
                // rather than a screenshot of the panel.
                const preview = e.currentTarget.querySelector("img");
                if (preview) {
                  const rect = preview.getBoundingClientRect();
                  e.dataTransfer.setDragImage(
                    preview,
                    rect.width / 2,
                    rect.height / 2,
                  );
                }
              }}
            >
              <button
                onClick={() => onInsertElement(item)}
                title={item.label}
                className="flex aspect-square w-full items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-1.5 transition-colors hover:border-[var(--accent)]"
              >
                {/* draggable={false}: an <img> is a native drag source, and its
                    own drag (of the image URL) pre-empts the card's before the
                    canvas ever sees our payload. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.src}
                  alt={item.label}
                  draggable={false}
                  className="max-h-full max-w-full object-contain"
                />
              </button>
              <button
                onClick={() => void handleDelete(active!.id, item.id)}
                title={`Delete ${item.label}`}
                className="absolute -right-1 -top-1 hidden rounded-full bg-red-500/90 p-0.5 text-white group-hover:block"
              >
                <Trash2 size={9} />
              </button>
            </div>
          ))}
          {visible.length === 0 && (
            <p className="col-span-4 px-0.5 py-1 text-[10px] text-[var(--text-muted)]">
              No elements match.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
