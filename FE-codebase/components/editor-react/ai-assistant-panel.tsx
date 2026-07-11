"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Trash2, User, X, Zap } from "lucide-react";
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

function buildDeckSummary(slides: SlideData[]) {
  return {
    slideCount: slides.length,
    slides: slides.map((s, index) => {
      const ui = (s.ui ?? {}) as Record<string, unknown>;
      const components = Array.isArray(ui.components) ? ui.components : [];
      let elementCount = 0;
      let title: string | undefined;
      for (const c of components) {
        const els = Array.isArray((c as Record<string, unknown>)?.elements)
          ? ((c as Record<string, unknown>).elements as unknown[])
          : [];
        elementCount += els.length;
        if (!title) {
          const headline = els.find(
            (e) =>
              typeof e === "object" &&
              e !== null &&
              (e as Record<string, unknown>).type === "text" &&
              typeof (e as Record<string, unknown>).name === "string" &&
              ((e as Record<string, unknown>).name as string).toLowerCase().includes("headline"),
          ) as Record<string, unknown> | undefined;
          const runs = headline?.runs;
          if (Array.isArray(runs) && runs[0] && typeof (runs[0] as Record<string, unknown>).text === "string") {
            title = ((runs[0] as Record<string, unknown>).text as string).slice(0, 60);
          }
        }
      }
      return { index, title, elementCount };
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
  onAction: (action: AgentAction) => Promise<string>;
  onClose: () => void;
}

export default function AIAssistantPanel({ slides, onAction, onClose }: AIAssistantPanelProps) {
  const token = useSessionStore((s) => s.token);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || !token || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", kind: "text", text: msg }]);
    setBusy(true);

    let rawRes: Awaited<ReturnType<typeof streamAgent>>;
    try {
      rawRes = await streamAgent(token, { message: msg, deckSummary: buildDeckSummary(slides) });
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
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-[#1e1e30] bg-[#13131f]">
      <div className="flex items-center justify-between border-b border-[#1e1e30] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#6c5ce7]">
            <Bot className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-medium text-white">AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMessages([])}
            className="rounded p-1 text-zinc-500 hover:bg-[#2d2e42] hover:text-white"
            title="Clear chat"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-[#2d2e42] hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="mb-3 text-sm text-zinc-500">Ask me to edit your presentation</p>
            <div className="w-full space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full rounded-lg border border-[#2d2e42] bg-[#1a1b2e] px-3 py-2 text-left text-xs text-zinc-400 transition-colors hover:border-[#6c5ce7]/50 hover:text-white"
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
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#6c5ce7]">
                    <Bot className="h-3 w-3 text-white" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[220px] rounded-lg px-3 py-2 text-xs",
                    m.role === "user"
                      ? "bg-[#6c5ce7] text-white"
                      : m.kind === "error"
                        ? "bg-red-500/10 text-red-400"
                        : "bg-[#1a1b2e] text-zinc-200",
                  )}
                >
                  {m.kind === "action" ? (
                    <>
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-mono text-[#a29bfe]">
                        <Zap className="h-2.5 w-2.5" />
                        {m.tool}({m.argsSummary})
                      </div>
                      {m.text}
                    </>
                  ) : (
                    m.text
                  )}
                </div>
                {m.role === "user" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2d2e42]">
                    <User className="h-3 w-3 text-zinc-400" />
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#6c5ce7]">
                  <Bot className="h-3 w-3 text-white" />
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-[#1a1b2e] px-3 py-2">
                  <Loader2 className="h-3 w-3 animate-spin text-[#a29bfe]" />
                  <span className="text-xs text-zinc-500">Thinking...</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-[#1e1e30] p-3">
        <div className="flex items-center gap-2 rounded-lg border border-[#2d2e42] bg-[#0f0f1e] px-3 py-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder="Ask Anything..."
            className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
            disabled={busy}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || busy}
            className="rounded p-1 text-[#a29bfe] hover:bg-[#2d2e42] disabled:opacity-30"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
