// Where the deck's plan comes from.
//
// Two sources, and the difference matters: when the user came through the
// /outline page they already reviewed and edited a page list, and the deck must
// be exactly those pages in that order. Only a bare topic — the chat's
// "create_deck", say — earns an outline call of its own.

import { chat } from "./llm-client.js";
import { buildOutlinePrompt } from "./slide-prompt.js";

const ROLE_BY_POSITION = (index, total) => {
  if (index === 0) return "cover";
  if (index === total - 1) return "closing";
  return "content";
};

/** True when the text is an approved outline rather than a free-text prompt. */
export function looksLikeOutline(text) {
  return /^##\s+\S/m.test(text ?? "");
}

/** Parses the outline markdown the /outline page serializes:
 *    # Title / ## Heading / description line / - bullet */
export function outlineFromMarkdown(markdown) {
  const pages = [];
  let title = "";
  let current = null;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      current = { heading: line.slice(3).trim(), description: "", bullets: [] };
      pages.push(current);
    } else if (line.startsWith("# ")) {
      if (!title) title = line.slice(2).trim();
    } else if (line.startsWith("- ") && current) {
      current.bullets.push(line.slice(2).trim());
    } else if (current) {
      current.description = current.description ? `${current.description} ${line}` : line;
    }
  }

  return {
    title: title || pages[0]?.heading || "Presentation",
    slides: pages.map((page, index) => ({
      role: ROLE_BY_POSITION(index, pages.length),
      heading: page.heading,
      brief: [page.description, ...page.bullets.map((b) => `- ${b}`)].filter(Boolean).join("\n") || page.heading,
      // The approved outline says what a page is about, never how it should
      // look, so the slide model is told to choose the treatment itself.
      visual: "bebas — pilih perlakuan visual yang paling pas untuk isi ini, dan jangan sama dengan slide lain",
    })),
  };
}

function parseOutlineReply(text) {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(`Outline reply was not JSON: ${cleaned.slice(0, 300)}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function buildOutline({ topic, slideCount, provider }) {
  if (looksLikeOutline(topic)) {
    return { outline: outlineFromMarkdown(topic), fromApprovedOutline: true };
  }
  const reply = await chat({
    provider,
    prompt: buildOutlinePrompt(topic, slideCount),
    maxTokens: 1800,
    temperature: 0.8,
  });
  return { outline: parseOutlineReply(reply.text), fromApprovedOutline: false };
}
