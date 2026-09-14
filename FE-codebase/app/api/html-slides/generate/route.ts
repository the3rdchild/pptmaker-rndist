// HTML generation mode, server side.
//
// The pipeline drives headless Chrome, so it cannot run in the browser — this
// route is the only reason it exists. It streams NDJSON so the editor can mount
// slide 1 while slide 4 is still rendering, matching how the template mode's
// worker stream already behaves.
//
// Line shapes:
//   {"type":"status","message":"..."}
//   {"type":"outline","title":"...","slides":["..."]}
//   {"type":"slide","index":0,"ui":{...},"heading":"..."}
//   {"type":"warning","slide":1,"message":"..."}
//   {"type":"done","title":"...","count":5}
//   {"type":"error","message":"..."}

import { NextRequest } from "next/server";
import { generateDeck } from "@/lib/html-slides/deck-pipeline.js";
import { DEFAULT_HTML_THEME_ID, normalizeHtmlThemeId } from "@/lib/generation-mode";
import { readHtmlTheme } from "@/lib/html-themes/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Rendering five slides in Chrome after five LLM calls runs past the default.
export const maxDuration = 300;

type Body = {
  topic?: unknown;
  slideCount?: unknown;
  theme?: unknown;
  provider?: unknown;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) {
    return Response.json({ error: "topic is required" }, { status: 400 });
  }

  const requestedThemeId = body.theme == null ? DEFAULT_HTML_THEME_ID : normalizeHtmlThemeId(body.theme);
  if (!requestedThemeId) {
    return Response.json({ error: "theme must be a valid HTML theme id" }, { status: 400 });
  }
  const theme = await readHtmlTheme(requestedThemeId);
  if (!theme) {
    return Response.json({ error: `HTML theme "${requestedThemeId}" was not found. Seed or choose a saved theme first.` }, { status: 400 });
  }
  const slideCount =
    typeof body.slideCount === "number" && body.slideCount >= 1 && body.slideCount <= 20
      ? Math.round(body.slideCount)
      : 5;
  const provider = typeof body.provider === "string" ? body.provider : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const deck = await generateDeck({
          topic,
          slideCount,
          theme,
          provider,
          onEvent: send,
        });
        send({ type: "done", title: deck.title, count: deck.slides.length });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "HTML generation failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
