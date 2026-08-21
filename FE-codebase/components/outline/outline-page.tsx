"use client";

// The /outline page — the step between the homepage prompt and the editor.
// Streams a markdown outline from /tools/aippt_outline, renders it as an
// editable accordion (Canva-style: collapsed cards show a truncated title,
// expanded cards edit heading/description/bullets in place), lets the user
// pin a theme, then hands the edited markdown to /editor-react as ?prompt=.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createDeck, streamAipptOutline } from "@/lib/api";
import { useSessionStore } from "@/store/session.store";
import { useTemplateThemes } from "@/components/editor-react/theme-picker";
import { LazyLayoutThumbnail } from "@/components/editor-react/lazy-layout-thumbnail";
import { OutlineChat } from "./outline-chat";
import { Button } from "@/components/shared/button";
import {
  SourceDocAttach,
  useSourceDocs,
} from "@/components/shared/source-doc-attach";
import { buildSourceDigest, withSourceDocument } from "@/lib/source-docs/digest";
import { SOURCE_PARAM, parseSourceIds } from "@/lib/source-docs/store";
import {
  DEFAULT_PAGE_COUNT_ID,
  PAGE_COUNTS,
  PAGE_COUNT_PARAM,
  isPageCountId,
  pageCountFor,
  pageCountLabel as labelForPageCount,
  type PageCountId,
} from "@/lib/page-counts";
import {
  parseOutline,
  serializeOutline,
  type Outline,
  type OutlinePage as OutlinePageModel,
} from "./outline-markdown";

const LANGUAGES = ["Bahasa Indonesia", "English", "Español", "中文", "日本語"];

let customPageSeq = 0;

export function OutlinePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useSessionStore((s) => s.token);
  const sessionReady = useSessionStore((s) => s.ready);

  const initialPrompt = searchParams.get("prompt") ?? "";
  const [prompt, setPrompt] = useState(initialPrompt);
  const [language, setLanguage] = useState(
    searchParams.get("lang") ?? "Bahasa Indonesia",
  );
  // Seeded from the homepage's pill (?pages=), so the first outline already
  // comes back at the length the user picked instead of at the default.
  const [pageCountId, setPageCountId] = useState<PageCountId>(() => {
    const fromUrl = searchParams.get(PAGE_COUNT_PARAM);
    return isPageCountId(fromUrl) ? fromUrl : DEFAULT_PAGE_COUNT_ID;
  });
  const [themeId, setThemeId] = useState<string | null>(null);

  const [outline, setOutline] = useState<Outline>({ title: "", pages: [] });
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Text fragments the user selected inside outline fields — shown as context
  // chips in the chat and sent with the next message.
  const [selectedTexts, setSelectedTexts] = useState<string[]>([]);

  // Documents attached on the homepage, restored from ?src=. Their prose is
  // what the outline is written from; their figures/tables are placed later,
  // during deck generation.
  const [initialSourceIds] = useState(() =>
    parseSourceIds(searchParams.get(SOURCE_PARAM)),
  );
  const sourceDocs = useSourceDocs(initialSourceIds);
  const sourceDocsRef = useRef(sourceDocs.docs);
  sourceDocsRef.current = sourceDocs.docs;

  const handleTextSelected = (text: string) => {
    setSelectedTexts((cur) =>
      cur.includes(text) || cur.length >= 5 ? cur : [...cur, text],
    );
  };

  // Raw streamed markdown accumulates here; `outline` is always a parse of it.
  const rawRef = useRef("");
  const startedRef = useRef(false);

  const { themes, loading: themesLoading } = useTemplateThemes();

  const startOutline = useCallback(async () => {
    if (!token || !prompt.trim()) return;
    rawRef.current = "";
    setOutline({ title: "", pages: [] });
    setExpandedId(null);
    setStreamError(null);
    setStreaming(true);
    try {
      const slideCount = pageCountFor(pageCountId);
      // Read through a ref, not a dependency: startOutline is also called from
      // the retry button and the "Generate ulang" control, and rebuilding the
      // callback whenever a document is attached would re-fire the auto-start
      // effect that keys off it.
      const digest = sourceDocsRef.current
        .map((doc) => buildSourceDigest(doc))
        .filter(Boolean)
        .join("\n\n");
      const res = await streamAipptOutline(token, {
        content: withSourceDocument(prompt.trim(), digest),
        language,
        model: searchParams.get("gen") ?? undefined,
        slideCount,
      });
      if (!(res instanceof Response)) {
        setStreamError(res.message || "Gagal membuat outline");
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setStreamError("Stream tidak tersedia");
        return;
      }
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rawRef.current += decoder.decode(value, { stream: true });
        setOutline(parseOutline(rawRef.current));
      }
      if (!rawRef.current.trim()) setStreamError("Outline kosong — coba generate ulang");
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : "Gagal membuat outline");
    } finally {
      setStreaming(false);
    }
  }, [token, prompt, language, pageCountId, searchParams]);

  // Auto-start once the session is ready. The ref guard mirrors the editor's
  // autoGenerateRan — React StrictMode double-invokes effects in dev.
  useEffect(() => {
    if (!sessionReady || !token || startedRef.current) return;
    // Attached documents load from IndexedDB asynchronously. Starting before
    // they arrive would write the outline from the topic string alone and
    // silently ignore the document the user waited to have parsed.
    if (sourceDocs.loading) return;
    if (!initialPrompt.trim()) {
      router.replace("/");
      return;
    }
    startedRef.current = true;
    void startOutline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, token, sourceDocs.loading]);

  /* ---------------------------- outline editing ---------------------------- */

  const updatePage = (id: string, patch: Partial<OutlinePageModel>) => {
    setOutline((o) => ({
      ...o,
      pages: o.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  };

  const updateBullet = (id: string, index: number, value: string) => {
    setOutline((o) => ({
      ...o,
      pages: o.pages.map((p) =>
        p.id === id
          ? { ...p, bullets: p.bullets.map((b, i) => (i === index ? value : b)) }
          : p,
      ),
    }));
  };

  const addBullet = (id: string, afterIndex: number) => {
    setOutline((o) => ({
      ...o,
      pages: o.pages.map((p) =>
        p.id === id
          ? {
              ...p,
              bullets: [
                ...p.bullets.slice(0, afterIndex + 1),
                "",
                ...p.bullets.slice(afterIndex + 1),
              ],
            }
          : p,
      ),
    }));
  };

  const removeBullet = (id: string, index: number) => {
    setOutline((o) => ({
      ...o,
      pages: o.pages.map((p) =>
        p.id === id
          ? { ...p, bullets: p.bullets.filter((_, i) => i !== index) }
          : p,
      ),
    }));
  };

  const removePage = (id: string) => {
    setOutline((o) => ({ ...o, pages: o.pages.filter((p) => p.id !== id) }));
    setExpandedId((cur) => (cur === id ? null : cur));
  };

  const addPage = () => {
    const id = `page-custom-${Date.now()}-${customPageSeq++}`;
    setOutline((o) => ({
      ...o,
      pages: [...o.pages, { id, heading: "", description: "", bullets: [] }],
    }));
    setExpandedId(id);
  };

  /** The chat's revision landing spot: replaces the target page's content.
   *  No-op when the page was deleted while the reply was streaming. */
  const applyRevision = (
    pageId: string,
    revision: { heading: string; description: string; bullets: string[] },
  ) => {
    setOutline((o) => {
      if (!o.pages.some((p) => p.id === pageId)) return o;
      return {
        ...o,
        pages: o.pages.map((p) =>
          p.id === pageId
            ? {
                ...p,
                heading: revision.heading,
                description: revision.description,
                bullets: revision.bullets,
              }
            : p,
        ),
      };
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOutline((o) => {
      const from = o.pages.findIndex((p) => p.id === active.id);
      const to = o.pages.findIndex((p) => p.id === over.id);
      if (from < 0 || to < 0) return o;
      return { ...o, pages: arrayMove(o.pages, from, to) };
    });
  };

  /* ------------------------------ generate ------------------------------ */

  const handleGenerate = async () => {
    if (!token || generating) return;
    const pages = outline.pages.filter((p) => p.heading.trim());
    if (pages.length === 0) return;
    setGenerating(true);
    try {
      const finalOutline = { ...outline, pages };
      const title = finalOutline.title || prompt.trim().slice(0, 60);
      const deck = await createDeck(token, { title: title.slice(0, 60) });
      const qs = new URLSearchParams({
        prompt: serializeOutline(finalOutline),
        lang: language,
      });
      if (themeId) qs.set("theme", themeId);
      // Carry the attached documents into the editor — deck generation needs
      // them again, both for the prose and to resolve figure/table ids.
      if (sourceDocs.ids) qs.set(SOURCE_PARAM, sourceDocs.ids);
      // Forward the homepage's provider/review/image choices untouched.
      for (const key of ["gen", "verify", "repair", "review", "images"]) {
        const v = searchParams.get(key);
        if (v) qs.set(key, v);
      }
      router.push(`/editor-react/${deck.id}?${qs.toString()}`);
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : "Gagal membuat deck");
      setGenerating(false);
    }
  };

  const pageCountLabel = labelForPageCount(pageCountId);
  const canGenerate =
    !streaming && !generating && outline.pages.some((p) => p.heading.trim());

  // The slide the chat talks about — the currently expanded accordion card.
  const expandedIndex = outline.pages.findIndex((p) => p.id === expandedId);
  const chatTarget =
    expandedIndex >= 0
      ? {
          pageId: outline.pages[expandedIndex].id,
          index: expandedIndex,
          heading: outline.pages[expandedIndex].heading,
          description: outline.pages[expandedIndex].description,
          bullets: outline.pages[expandedIndex].bullets,
        }
      : null;

  /* -------------------------------- render ------------------------------- */

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Header — prompt summary + generation options */}
      <header className="shrink-0 border-b border-[var(--border)] px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-white"
            title="Kembali"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <button
            onClick={() => setPromptOpen((o) => !o)}
            className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-2 text-left transition-colors hover:border-[var(--border-strong)]"
          >
            <span className="truncate text-sm font-medium">
              {prompt || "Untitled"}
            </span>
            {promptOpen ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            )}
          </button>

          <PillDropdown
            label={pageCountLabel}
            options={PAGE_COUNTS.map((c) => ({ id: c.id, label: c.label }))}
            selected={pageCountId}
            onSelect={(id) => setPageCountId(id as PageCountId)}
            disabled={streaming}
          />
          <PillDropdown
            label={language}
            options={LANGUAGES.map((l) => ({ id: l, label: l }))}
            selected={language}
            onSelect={setLanguage}
            disabled={streaming}
          />
          <SourceDocAttach
            docs={sourceDocs.docs}
            onAdd={sourceDocs.add}
            onRemove={sourceDocs.remove}
            disabled={streaming || generating}
            size="xs"
          />
        </div>

        {promptOpen && (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={streaming}
              rows={2}
              className="w-full resize-none rounded-md bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              placeholder="Tulis topik presentasi…"
            />
            <div className="mt-2 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void startOutline()}
                disabled={streaming || !prompt.trim()}
              >
                {streaming ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Generate ulang Outline
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* Body — outline list (left) + AI chat (center) + theme picker (right) */}
      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 flex-1">
          <div className="w-[26rem] shrink-0 overflow-y-auto px-6 py-5">
            <h1 className="mb-4 text-sm font-semibold">Presentation outline</h1>

          {streamError && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {streamError}
              <button
                onClick={() => void startOutline()}
                className="ml-3 underline hover:text-red-200"
              >
                Coba lagi
              </button>
            </div>
          )}

          {streaming && outline.pages.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Menyusun outline…
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={outline.pages.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-2.5">
                {outline.pages.map((page) => (
                  <SortableOutlineCard
                    key={page.id}
                    page={page}
                    expanded={page.id === expandedId}
                    disabled={streaming}
                    onToggle={() =>
                      setExpandedId((cur) => (cur === page.id ? null : page.id))
                    }
                    onUpdate={(patch) => updatePage(page.id, patch)}
                    onUpdateBullet={(i, v) => updateBullet(page.id, i, v)}
                    onAddBullet={(i) => addBullet(page.id, i)}
                    onRemoveBullet={(i) => removeBullet(page.id, i)}
                    onRemove={() => removePage(page.id)}
                    onTextSelected={handleTextSelected}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {!streaming && outline.pages.length > 0 && (
            <button
              onClick={addPage}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] py-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-white"
            >
              <Plus className="h-4 w-4" /> Add Page
            </button>
          )}
          </div>

          {/* Center — AI chat for revising the previewed slide */}
          <div className="min-w-0 flex-1 border-l border-[var(--border)] p-4">
            <OutlineChat
              token={token}
              language={language}
              model={searchParams.get("gen") ?? undefined}
              topic={prompt}
              outlineTitle={outline.title}
              target={chatTarget}
              selectedTexts={selectedTexts}
              onRemoveSelectedText={(i) =>
                setSelectedTexts((cur) => cur.filter((_, idx) => idx !== i))
              }
              onClearSelectedTexts={() => setSelectedTexts([])}
              onApplyRevision={applyRevision}
            />
          </div>
        </main>

        {/* Sidebar — theme picker + generate */}
        <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]">
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[var(--text-secondary)]">
                Select Theme
              </h2>
              <button
                onClick={() => router.push("/template-list")}
                className="text-xs text-[var(--accent-light)] hover:underline"
              >
                More Theme
              </button>
            </div>

            {themesLoading ? (
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat theme…
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {themes.map((theme) => {
                  const active = theme.id === themeId;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setThemeId(active ? null : theme.id)}
                      title={theme.description || theme.name}
                      className={cn(
                        "group overflow-hidden rounded-lg border text-left transition-colors",
                        active
                          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                          : "border-[var(--border)] hover:border-[var(--border-strong)]",
                      )}
                    >
                      <div className="relative aspect-video w-full overflow-hidden bg-[var(--bg-elevated)]">
                        {theme.layouts[0] ? (
                          // Live render of the theme's cover layout — the
                          // static thumbnail.png files don't exist in storage,
                          // so <img> 404s. Same pattern as /template-list.
                          <LazyLayoutThumbnail
                            layout={theme.layouts[0] as Record<string, unknown>}
                            width={123}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-[var(--text-muted)]">
                            {theme.name}
                          </div>
                        )}
                        {active && (
                          <div className="absolute right-1 top-1 rounded-full bg-[var(--accent)] p-0.5">
                            <Check className="h-3 w-3 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="truncate px-2 py-1.5 text-[11px] text-[var(--text-secondary)] group-hover:text-white">
                        {theme.name}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
              {themeId
                ? "Theme terpilih akan dipakai untuk semua slide."
                : "Tanpa pilihan, AI memilih theme yang paling cocok dengan topik."}
            </p>
          </div>

          <div className="shrink-0 border-t border-[var(--border)] p-4">
            <Button
              className="w-full"
              size="md"
              onClick={() => void handleGenerate()}
              disabled={!canGenerate}
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {generating ? "Membuat deck…" : "Generate Presentation"}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------- subcomponents ------------------------------- */

function PillDropdown({
  label,
  options,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        variant="subtle"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {label} <ChevronDown className="h-3 w-3" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] py-1 shadow-xl">
            {options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-[var(--bg-elevated)] hover:text-white"
              >
                <span>{opt.label}</span>
                {selected === opt.id && (
                  <Check className="h-3.5 w-3.5 text-[var(--accent-light)]" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SortableOutlineCard({
  page,
  expanded,
  disabled,
  onToggle,
  onUpdate,
  onUpdateBullet,
  onAddBullet,
  onRemoveBullet,
  onRemove,
  onTextSelected,
}: {
  page: OutlinePageModel;
  expanded: boolean;
  disabled: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<OutlinePageModel>) => void;
  onUpdateBullet: (index: number, value: string) => void;
  onAddBullet: (afterIndex: number) => void;
  onRemoveBullet: (index: number) => void;
  onRemove: () => void;
  onTextSelected: (text: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id, disabled });

  // Text selected inside any of this card's fields becomes a chat-context
  // chip ("add context to chat" — automatic on mouseup/keyup selection).
  const captureSelection = (el: HTMLInputElement | HTMLTextAreaElement) => {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (end - start < 3) return;
    const text = el.value.substring(start, end).trim();
    if (text.length >= 3) onTextSelected(text);
  };
  const selectionHandlers = {
    onMouseUp: (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      captureSelection(e.currentTarget),
    onKeyUp: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      captureSelection(e.currentTarget),
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className={cn(
        "group relative rounded-xl border bg-[var(--bg-panel)] transition-colors",
        expanded
          ? "border-[var(--border-strong)]"
          : "border-[var(--border)] hover:border-[var(--border-strong)]",
      )}
    >
      {/* Grip — drag handle, visible on hover */}
      <button
        {...attributes}
        {...listeners}
        disabled={disabled}
        className="absolute -left-1 top-1/2 -translate-y-1/2 cursor-grab rounded p-1 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-white group-hover:opacity-100 active:cursor-grabbing"
        title="Drag untuk reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Collapsed header — always visible, click toggles */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span
          className={cn(
            "min-w-0 flex-1 text-sm",
            expanded ? "font-semibold" : "truncate font-medium",
          )}
        >
          {page.heading || (
            <span className="text-[var(--text-muted)]">Slide tanpa judul…</span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <input
            value={page.heading}
            onChange={(e) => onUpdate({ heading: e.target.value })}
            {...selectionHandlers}
            disabled={disabled}
            placeholder="Judul slide"
            className="mb-2 w-full rounded-md border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm font-medium outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
          />
          <textarea
            value={page.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            {...selectionHandlers}
            disabled={disabled}
            placeholder="Deskripsi singkat slide (1 kalimat)"
            rows={2}
            className="mb-3 w-full resize-none rounded-md border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
          />

          <ul className="flex flex-col gap-1.5">
            {page.bullets.map((bullet, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-[var(--text-muted)]" />
                <input
                  value={bullet}
                  onChange={(e) => onUpdateBullet(i, e.target.value)}
                  {...selectionHandlers}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onAddBullet(i);
                    } else if (
                      e.key === "Backspace" &&
                      bullet === "" &&
                      page.bullets.length > 0
                    ) {
                      e.preventDefault();
                      onRemoveBullet(i);
                    }
                  }}
                  disabled={disabled}
                  placeholder="Poin utama…"
                  className="w-full rounded-md bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-[var(--text-muted)] focus:bg-[var(--bg-surface)]"
                />
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={() => onAddBullet(page.bullets.length - 1)}
              disabled={disabled}
              className="flex items-center gap-1 text-xs text-[var(--text-muted)] transition-colors hover:text-white"
            >
              <Plus className="h-3 w-3" /> Tambah poin
            </button>
            <button
              onClick={onRemove}
              disabled={disabled}
              className="flex items-center gap-1 text-xs text-[var(--text-muted)] transition-colors hover:text-red-400"
            >
              <Trash2 className="h-3 w-3" /> Hapus slide
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
