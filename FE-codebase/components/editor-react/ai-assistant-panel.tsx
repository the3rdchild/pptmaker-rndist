"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, FileText, Loader2, Send, Trash2, User, X, Zap } from "lucide-react";
import { TEMPLATE_V2_SURFACE_SELECTED_EVENT } from "@/components/slide-editor/events/events";
import { useSessionStore } from "@/store/session.store";
import { streamAgent, type AgentAction } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SlideData } from "@/store/presentationGeneration";

type ChatMessage =
  | { role: "user"; kind: "text"; text: string }
  | { role: "assistant"; kind: "text"; text: string }
  | { role: "assistant"; kind: "action"; tool: string; argsSummary: string; text: string }
  | { role: "assistant"; kind: "error"; text: string };

const SUGGESTIONS = [
  "Ganti semua font jadi Poppins",
  "Ubah warna background jadi gelap",
  "Hapus slide terakhir",
];

interface ProviderOption {
  id: string;
  label: string;
  vision: boolean;
}

// Remembers the model picked in the switcher across sessions, the same way the
// homepage picker and the template engine's auto-label selector do.
const PROVIDER_STORAGE_KEY = "ppt_chat_provider";

// The chat itself runs on the worker, but the list of models comes from the
// Next.js route because that's the only side the browser can reach. Both
// layers key off the same API-key env var names (OPENAI_API_KEY, ZHIPU_API_KEY,
// …) and share one provider-id namespace, so the ids listed here are the ids
// the worker understands. If an env ever drifts, the worker's resolve_provider
// falls back to its default rather than failing the request.
function useChatProviders() {
  const [options, setOptions] = useState<ProviderOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/providers")
      .then((r) => r.json())
      .then((data: { text?: ProviderOption[] }) => {
        if (!cancelled && Array.isArray(data?.text)) setOptions(data.text);
      })
      .catch(() => {
        // Selector just stays on "Default" — the worker picks its own model.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return options;
}

/** Compact model switcher for the chat. "Default" clears the choice and lets
 *  the worker's LLM_PROVIDER decide, matching the homepage dropdowns. */
function ModelSwitcher({
  options,
  selected,
  onSelect,
  disabled,
}: {
  options: ProviderOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === selected);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title="Model"
        className="flex max-w-[150px] items-center gap-1 rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
      >
        <span className="truncate">{current?.label ?? "Default model"}</span>
        <ChevronDown className="h-2.5 w-2.5 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] py-1 shadow-xl">
            <button
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
            >
              <span>Default</span>
              {selected === null && <Check className="h-3 w-3 shrink-0 text-[var(--accent-light)]" />}
            </button>
            {options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
              >
                <span className="truncate">{opt.label}</span>
                {selected === opt.id && <Check className="h-3 w-3 shrink-0 text-[var(--accent-light)]" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function extractText(runs: unknown): string {
  if (!Array.isArray(runs)) return "";
  return runs
    .map((r) => (typeof r === "object" && r !== null ? String((r as Record<string, unknown>).text ?? "") : ""))
    .join("");
}

function describeElement(el: Record<string, unknown>): string {
  const type = el.type;
  switch (type) {
    case "text": {
      const text = extractText(el.runs).slice(0, 100);
      return text ? `text: "${text}"` : "text (empty)";
    }
    case "text-list": {
      const items = Array.isArray(el.items) ? el.items : [];
      const labels = items
        .map((it) => {
          if (typeof it === "object" && it !== null) {
            const t = extractText((it as Record<string, unknown>).runs);
            return t ? `"${t.slice(0, 50)}"` : null;
          }
          return null;
        })
        .filter(Boolean);
      return `text-list: [${labels.join(", ")}]`;
    }
    case "rectangle":
    case "rect":
      return `rectangle (${el.fill ? "filled" : "outline"})`;
    case "ellipse":
      return "ellipse";
    case "image":
      return "image";
    case "chart":
      return `chart (${typeof el.chart_type === "string" ? el.chart_type : "bar"})`;
    case "table":
      return "table";
    case "line":
      return "line";
    case "svg":
      return "svg/icon";
    default:
      return String(type ?? "unknown");
  }
}

// Last N chat turns, flattened into plain {role, content} pairs the worker
// forwards straight into the LLM's messages array — without this the model
// has no memory of its own clarifying questions or what the user just
// answered, and re-asks the same question forever.
const MAX_HISTORY_MESSAGES = 12;

function buildHistory(messages: ChatMessage[]): { role: "user" | "assistant"; content: string }[] {
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (m.kind === "error") continue;
    if (m.role === "user") {
      turns.push({ role: "user", content: m.text });
    } else if (m.kind === "text") {
      turns.push({ role: "assistant", content: m.text });
    } else if (m.kind === "action") {
      turns.push({ role: "assistant", content: `[called ${m.tool}(${m.argsSummary})] ${m.text}` });
    }
  }
  return turns.slice(-MAX_HISTORY_MESSAGES);
}

function buildDeckSummary(slides: SlideData[], activeIndex: number) {
  return {
    activeSlideIndex: activeIndex,
    slideCount: slides.length,
    slides: slides.map((s, index) => {
      const ui = (s.ui ?? {}) as Record<string, unknown>;
      const components = Array.isArray(ui.components) ? (ui.components as Record<string, unknown>[]) : [];
      const elementDescs: string[] = [];
      let title: string | undefined;

      for (const c of components) {
        const els = Array.isArray(c.elements) ? (c.elements as Record<string, unknown>[]) : [];
        for (const el of els) {
          const desc = describeElement(el);
          elementDescs.push(desc);
          // First text element = title candidate
          if (!title && el.type === "text") {
            title = extractText(el.runs).slice(0, 80) || undefined;
          }
        }
      }

      return {
        index,
        isActive: index === activeIndex,
        title,
        elementCount: elementDescs.length,
        elements: elementDescs,
      };
    }),
  };
}

function summarizeArgs(args: Record<string, unknown>) {
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
}

export interface AIAssistantPanelProps {
  slides: SlideData[];
  activeIndex: number;
  onAction: (action: AgentAction) => Promise<string>;
  onClose: () => void;
}

export default function AIAssistantPanel({ slides, activeIndex, onAction, onClose }: AIAssistantPanelProps) {
  const token = useSessionStore((s) => s.token);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // null = let the worker use its configured default (LLM_PROVIDER).
  const providerOptions = useChatProviders();
  const [provider, setProvider] = useState<string | null>(null);
  useEffect(() => {
    setProvider(localStorage.getItem(PROVIDER_STORAGE_KEY));
  }, []);
  const chooseProvider = (id: string | null) => {
    setProvider(id);
    if (id) localStorage.setItem(PROVIDER_STORAGE_KEY, id);
    else localStorage.removeItem(PROVIDER_STORAGE_KEY);
  };

  // Track selected element via editor's custom event
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const sel = detail?.selection;
      if (!sel) {
        setSelectedLabel(null);
        return;
      }
      if (sel.kind === "element") {
        const name = sel.elementName || sel.elementType || "element";
        setSelectedLabel(String(name));
      } else if (sel.kind === "component") {
        setSelectedLabel(sel.componentLabel || sel.componentId || "component");
      } else {
        setSelectedLabel(null);
      }
    };
    window.addEventListener(TEMPLATE_V2_SURFACE_SELECTED_EVENT, handler);
    return () => window.removeEventListener(TEMPLATE_V2_SURFACE_SELECTED_EVENT, handler);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || !token || busy) return;
    const history = buildHistory(messages);
    setInput("");
    setMessages((m) => [...m, { role: "user", kind: "text", text: msg }]);
    setBusy(true);

    let rawRes: Awaited<ReturnType<typeof streamAgent>>;
    try {
      rawRes = await streamAgent(token, {
        message: msg,
        model: provider ?? undefined,
        deckSummary: buildDeckSummary(slides, activeIndex),
        history,
      });
    } catch {
      setBusy(false);
      setMessages((m) => [...m, { role: "assistant", kind: "error", text: "Sorry, I couldn't reach the server. Please try again." }]);
      return;
    }
    if (!(rawRes instanceof Response)) {
      const errRes = rawRes as { state: -1; message: string };
      setBusy(false);
      setMessages((m) => [...m, { role: "assistant", kind: "error", text: errRes.message || "Sorry, something went wrong." }]);
      return;
    }
    const res: Response = rawRes;
    if (!res.body) {
      setBusy(false);
      setMessages((m) => [...m, { role: "assistant", kind: "error", text: "Empty response from server." }]);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";

    // Only ever mutates the deck AFTER a line parses successfully — a
    // malformed/failed line just shows an error bubble, never touches slides.
    const processLine = async (line: string) => {
      try {
        const action = JSON.parse(line.trim()) as AgentAction;
        if (action.tool === "_reply") {
          setMessages((m) => [...m, { role: "assistant", kind: "text", text: String(action.args.text || "") }]);
          return;
        }
        const resultText = await onAction(action);
        setMessages((m) => [
          ...m,
          { role: "assistant", kind: "action", tool: action.tool, argsSummary: summarizeArgs(action.args), text: resultText },
        ]);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        setMessages((m) => [...m, { role: "assistant", kind: "error", text: "Sorry, I couldn't process that response." }]);
      }
    };

    const readLoop = async () => {
      const { done, value } = await reader.read();
      if (done) {
        if (buf.trim()) await processLine(buf);
        setBusy(false);
        return;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) await processLine(line);
      }
      await readLoop();
    };
    await readLoop();
  };

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-light)] shadow-[var(--shadow-soft)]">
            <Bot className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-medium text-[var(--text-primary)]">
            AI Assistant
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setMessages([])}
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            title="Clear chat"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Context indicator + model switcher */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-4 py-1.5">
        <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-light)]">
          Slide {activeIndex + 1}
        </span>
        {selectedLabel && (
          <span className="flex max-w-[110px] items-center gap-1 truncate rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
            <FileText className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{selectedLabel}</span>
          </span>
        )}
        <div className="ml-auto">
          <ModelSwitcher
            options={providerOptions}
            selected={provider}
            onSelect={chooseProvider}
            disabled={busy}
          />
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
              <Bot className="h-5 w-5 text-[var(--accent-light)]" />
            </div>
            <p className="mb-1 text-sm font-medium text-[var(--text-primary)]">
              Ask me to edit your presentation
            </p>
            <p className="mb-4 text-xs text-[var(--text-muted)]">
              I can restyle, rewrite, and reorganize slides.
            </p>
            <div className="w-full space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-2 text-left text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/60 hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-light)]">
                    <Bot className="h-3 w-3 text-white" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[220px] rounded-2xl px-3 py-2 text-xs leading-relaxed",
                    m.role === "user"
                      ? "rounded-br-md bg-[var(--accent)] text-white"
                      : m.kind === "error"
                        ? "rounded-bl-md border border-red-500/20 bg-red-500/10 text-red-300"
                        : "rounded-bl-md bg-[var(--bg-surface)] text-[var(--text-primary)]",
                  )}
                >
                  {m.kind === "action" ? (
                    <>
                      <div className="mb-1 flex items-center gap-1 rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent-light)]">
                        <Zap className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">
                          {m.tool}({m.argsSummary})
                        </span>
                      </div>
                      {m.text}
                    </>
                  ) : (
                    m.text
                  )}
                </div>
                {m.role === "user" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)]">
                    <User className="h-3 w-3 text-[var(--text-secondary)]" />
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-light)]">
                  <Bot className="h-3 w-3 text-white" />
                </div>
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-[var(--bg-surface)] px-3 py-2">
                  <Loader2 className="h-3 w-3 animate-spin text-[var(--accent-light)]" />
                  <span className="text-xs text-[var(--text-muted)]">Thinking…</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-base)] py-1.5 pl-3 pr-1.5 transition-colors focus-within:border-[var(--accent)]/60">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder="Ask anything…"
            className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
            disabled={busy}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || busy}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-lg transition-colors",
              input.trim() && !busy
                ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                : "text-[var(--text-muted)]"
            )}
          >
            <Send className="h-3 w-3" />
          </button>
        </div>
      </div>
    </aside>
  );
}
