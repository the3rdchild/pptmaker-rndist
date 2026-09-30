// Where the deck's plan comes from.
//
// Two sources, and the difference matters: when the user came through the
// /outline page they already reviewed and edited a page list, and the deck must
// be exactly those pages in that order. Only a bare topic — the chat's
// "create_deck", say — earns an outline call of its own.

import { isTransitionLine, normalizeTransitionId, parseTransitionLine } from "../outline-transition.js";
import { HTML_THEME_ROLES, METRIC_EVIDENCE } from "../html-themes/schema.js";
import { chat } from "./llm-client.js";
import { buildOutlinePrompt } from "./slide-prompt.js";

const ROLE_BY_POSITION = (index, total) => {
  if (index === 0) return "cover";
  if (index === total - 1) return "closing";
  return "content";
};

function roleFromApprovedPage(page, index, total) {
  if (index === 0 || index === total - 1) return ROLE_BY_POSITION(index, total);
  const heading = page.heading.toLowerCase();
  const text = [heading, page.description, ...page.bullets].join(" ").toLowerCase();
  if (/\b(?:vs\.?|versus|dibandingkan?|perbandingan|sebelum dan sesudah|before and after)\b/i.test(text)) return "comparison";
  if (/\b(?:langkah|tahap|tahapan|alur|proses|roadmap|workflow|cara kerja)\b/i.test(heading)) return "process";
  if (METRIC_EVIDENCE.test(text)) return "stat";
  if (/\b3\s*[- ]?d\b|three-dimensional/i.test(page.imageBrief)) return "visual";
  return "content";
}

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
      current = { heading: line.slice(3).trim(), description: "", imageBrief: "", bullets: [], transition: null, transitionNote: "" };
      pages.push(current);
    } else if (line.startsWith("# ")) {
      if (!title) title = line.slice(2).trim();
    } else if (/^(?:visual|gambar|image)\s*:/i.test(line) && current) {
      current.imageBrief = line.replace(/^(?:visual|gambar|image)\s*:\s*/i, "").trim();
    } else if (isTransitionLine(line) && current) {
      const parsed = parseTransitionLine(line);
      if (parsed) {
        current.transition = parsed.transition;
        current.transitionNote = parsed.note;
      }
    } else if (line.startsWith("- ") && current) {
      current.bullets.push(line.slice(2).trim());
    } else if (current) {
      current.description = current.description ? `${current.description} ${line}` : line;
    }
  }

  return {
    title: title || pages[0]?.heading || "Presentation",
    slides: pages.map((page, index) => ({
      role: roleFromApprovedPage(page, index, pages.length),
      heading: page.heading,
      brief: [page.description, ...page.bullets.map((b) => `- ${b}`)].filter(Boolean).join("\n") || page.heading,
      visual: page.imageBrief || [page.heading, page.description].filter(Boolean).join(" — "),
      ...(page.transition ? { transition: page.transition, transitionNote: page.transitionNote } : {}),
    })),
  };
}

export function normalizeOutline(raw) {
  const slides = Array.isArray(raw?.slides) ? raw.slides : [];
  return {
    title: typeof raw?.title === "string" && raw.title.trim() ? raw.title.trim() : "Presentation",
    slides: slides.map((slide, index) => {
      const heading = typeof slide?.heading === "string" && slide.heading.trim()
        ? slide.heading.trim()
        : `Slide ${index + 1}`;
      const brief = typeof slide?.brief === "string" && slide.brief.trim()
        ? slide.brief.trim()
        : heading;
      const visual = typeof slide?.visual === "string" && slide.visual.trim()
        ? slide.visual.trim()
        : `${heading} — ${brief}`;
      const transition = normalizeTransitionId(slide?.transition);
      return {
        ...slide,
        role: slide?.role === "stat" && !METRIC_EVIDENCE.test(`${heading} ${brief}`)
          ? "content"
          : HTML_THEME_ROLES.includes(slide?.role) ? slide.role : ROLE_BY_POSITION(index, slides.length),
        heading,
        brief,
        visual,
        transition: transition ?? undefined,
        transitionNote: typeof slide?.transitionNote === "string" ? slide.transitionNote.trim() : "",
      };
    }),
  };
}

function parseOutlineReply(text) {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(`Outline reply was not JSON: ${cleaned.slice(0, 300)}`);
  return normalizeOutline(JSON.parse(cleaned.slice(start, end + 1)));
}

export async function buildOutline({ topic, slideCount, provider, signal, transitions = false }) {
  if (looksLikeOutline(topic)) {
    return { outline: outlineFromMarkdown(topic), fromApprovedOutline: true };
  }
  const prompt = buildOutlinePrompt(topic, slideCount, { transitions });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await chat({
      provider,
      prompt: attempt === 0 ? prompt : `${prompt}\n\nBalas JSON lengkap dan valid saja. Jangan berhenti sebelum kurung penutup terakhir.`,
      maxTokens: attempt === 0 ? 3500 : 6000,
      temperature: attempt === 0 ? 0.8 : 0.4,
      signal,
    });
    try {
      return { outline: parseOutlineReply(reply.text), fromApprovedOutline: false };
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  throw new Error("Outline generation failed after two attempts.");
}
