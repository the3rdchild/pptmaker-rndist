"use client";

// AI chat panel for the /outline page. The chat always knows which slide the
// user is previewing (the expanded accordion card) and can receive selected
// outline text as context chips. When the model revises the slide it answers
// with a ```slide fenced block; the bubble then shows a preview + an Apply
// button that writes the revision into that page — never auto-applied.

import { useEffect, useRef, useState } from "react";
import {
  Check,
  FileText,
  Loader2,
  SendHorizonal,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { streamOutlineChat } from "@/lib/api";
import {
  parseSlideRevisionBlock,
  stripRevisionBlock,
} from "./outline-markdown";

export interface SlideRevision {
  heading: string;
  description: string;
  bullets: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Parsed from a ```slide block once the stream finished. */
  revision?: SlideRevision | null;
  /** The page the revision targets (captured at send time). */
  targetPageId?: string;
  targetLabel?: string;
  applied?: boolean;
}

export interface OutlineChatTarget {
  pageId: string;
  index: number;
  heading: string;
  description: string;
  bullets: string[];
}

let seq = 0;

export function OutlineChat({
  token,
  language,
  model,
  topic,
  outlineTitle,
  target,
  selectedTexts,
  onRemoveSelectedText,
  onClearSelectedTexts,
  onApplyRevision,
}: {
  token: string | null;
  language: string;
  model?: string;
  topic: string;
  outlineTitle: string;
  target: OutlineChatTarget | null;
  selectedTexts: string[];
  onRemoveSelectedText: (index: number) => void;
  onClearSelectedTexts: () => void;
  onApplyRevision: (pageId: string, revision: SlideRevision) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || !token || sending) return;
    setInput("");
    setSending(true);

    const userMsg: ChatMessage = { id: `m-${seq++}`, role: "user", text };
    const assistantId = `m-${seq++}`;
    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: "assistant", text: "" },
    ]);

    try {
      const res = await streamOutlineChat(token, {
        message: text,
        language,
        model,
        history: messages.slice(-10).map((m) => ({ role: m.role, content: m.text })),
        context: {
          topic,
          outlineTitle,
          slideIndex: target?.index,
          slide: target
            ? {
                heading: target.heading,
                description: target.description,
                bullets: target.bullets,
              }
            : undefined,
          selectedTexts,
        },
      });
      if (!(res instanceof Response) || !res.body) {
        throw new Error(
          res && typeof res === "object" && "message" in res
            ? String((res as { message?: unknown }).message)
            : "Request failed",
        );
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        const snapshot = full;
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId ? { ...msg, text: snapshot } : msg,
          ),
        );
      }
      const revision = parseSlideRevisionBlock(full);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                text: full,
                revision,
                targetPageId: revision ? target?.pageId : undefined,
                targetLabel: revision
                  ? `Slide ${(target?.index ?? 0) + 1}`
                  : undefined,
              }
            : msg,
        ),
      );
      // Selected text was consumed by this turn — clear the chips.
      onClearSelectedTexts();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Request failed";
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId ? { ...msg, text: `⚠ ${message}` } : msg,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--accent-light)]" />
        <h2 className="text-sm font-semibold">AI Assistant</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-3">
        {messages.length === 0 && (
          <p className="mt-6 text-center text-xs leading-relaxed text-[var(--text-muted)]">
            Minta revisi slide yang sedang kamu buka,
            <br />
            mis. “buat poinnya lebih ringkas” atau
            <br />
            “ganti judulnya jadi lebih menarik”.
          </p>
        )}
        <div className="flex flex-col gap-2.5">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                msg.role === "user"
                  ? "self-end bg-[var(--accent)] text-white"
                  : "self-start bg-[var(--bg-elevated)] text-[var(--text-primary)]",
              )}
            >
              {msg.text ? stripRevisionBlock(msg.text) : ""}
              {msg.role === "assistant" && !msg.text && (
                <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
              )}
              {msg.revision && (
                <div className="mt-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-light)]">
                    Revisi {msg.targetLabel}
                  </div>
                  <div className="text-sm font-medium">{msg.revision.heading}</div>
                  {msg.revision.description && (
                    <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      {msg.revision.description}
                    </div>
                  )}
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {msg.revision.bullets.map((b, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-[var(--text-secondary)]">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--text-muted)]" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => {
                      if (!msg.targetPageId || !msg.revision) return;
                      onApplyRevision(msg.targetPageId, msg.revision);
                      setMessages((m) =>
                        m.map((x) => (x.id === msg.id ? { ...x, applied: true } : x)),
                      );
                    }}
                    disabled={msg.applied}
                    className={cn(
                      "mt-2 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      msg.applied
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
                    )}
                  >
                    <Check className="h-3 w-3" />
                    {msg.applied ? "Diterapkan" : "Terapkan ke slide"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Context chips: previewed slide (auto) + selected outline text */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {target && (
          <span className="flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] text-[var(--accent-light)]">
            <FileText className="h-3 w-3" />
            Slide {target.index + 1}: {target.heading || "tanpa judul"}
          </span>
        )}
        {selectedTexts.map((text, i) => (
          <span
            key={`${i}-${text.slice(0, 12)}`}
            className="flex max-w-56 items-center gap-1 rounded-full bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
            title={text}
          >
            <span className="truncate">“{text}”</span>
            <button
              onClick={() => onRemoveSelectedText(i)}
              className="shrink-0 text-[var(--text-muted)] hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {/* Input */}
      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={!token || sending}
          rows={2}
          placeholder={
            target
              ? "Tulis instruksi revisi untuk slide ini…"
              : "Buka satu slide dulu, lalu tulis instruksi revisi…"
          }
          className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2 text-sm outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
        />
        <button
          onClick={() => void send()}
          disabled={!token || sending || !input.trim()}
          className="rounded-xl bg-[var(--accent)] p-2.5 text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SendHorizonal className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
