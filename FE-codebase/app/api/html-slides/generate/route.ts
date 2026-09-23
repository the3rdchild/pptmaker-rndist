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
//   {"type":"theme","name":"...","description":"...","source":"ai"|"fallback","reason"?:"..."}
//   {"type":"slide","index":0,"ui":{...},"heading":"...","transition"?:"morph"}
//   {"type":"warning","slide":1,"message":"..."}
//   {"type":"done","title":"...","count":5}
//   {"type":"error","message":"..."}

import { NextRequest } from "next/server";
import { generateDeck } from "@/lib/html-slides/deck-pipeline.js";
import { normalizeHtmlThemeId } from "@/lib/generation-mode";
import { listHtmlThemeRegistry, readHtmlTheme } from "@/lib/html-themes/server/store";
import { createPhotoResolver } from "@/lib/html-slides/photo-resolver";
import { generateImage } from "@/lib/api";
import { resolveImageModelId } from "@/lib/image-models";
import {
  searchStockImagesWithFallback,
  trackUnsplashDownload,
} from "@/lib/stock-image-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Rendering five slides in Chrome after five LLM calls runs past the default.
export const maxDuration = 300;

type Body = {
  topic?: unknown;
  slideCount?: unknown;
  theme?: unknown;
  provider?: unknown;
  imageSource?: unknown;
  imageModel?: unknown;
  transitions?: unknown;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) {
    return Response.json({ error: "topic is required" }, { status: 400 });
  }

  // No theme means the user picked none on /outline: the model designs one
  // for this outline, with the registry default standing by if it fails.
  let theme: Awaited<ReturnType<typeof readHtmlTheme>> = null;
  if (body.theme != null) {
    const requestedThemeId = normalizeHtmlThemeId(body.theme);
    if (!requestedThemeId) {
      return Response.json({ error: "theme must be a valid HTML theme id" }, { status: 400 });
    }
    theme = await readHtmlTheme(requestedThemeId);
    if (!theme) {
      return Response.json({ error: `HTML theme "${requestedThemeId}" was not found. Seed or choose a saved theme first.` }, { status: 400 });
    }
  }
  const loadFallbackTheme = async () => {
    const { defaultThemeId } = await listHtmlThemeRegistry();
    return defaultThemeId ? readHtmlTheme(defaultThemeId) : null;
  };
  const slideCount =
    typeof body.slideCount === "number" && body.slideCount >= 1 && body.slideCount <= 20
      ? Math.round(body.slideCount)
      : 5;
  const provider = typeof body.provider === "string" ? body.provider : undefined;
  const transitions = body.transitions === true;
  const imageSource = body.imageSource === "stock" ? "stock" : "ai";
  const imageModel = resolveImageModelId(
    typeof body.imageModel === "string" ? body.imageModel : undefined,
  );
  const sessionToken = request.headers.get("x-session-token") ?? "";
  if (imageSource === "ai" && !sessionToken) {
    return Response.json({ error: "x-session-token is required for AI images" }, { status: 401 });
  }
  const resolvePhoto = createPhotoResolver({
    imageSource,
    sessionToken,
    imageModel,
    generateAi: generateImage,
    searchStock: searchStockImagesWithFallback,
    trackStockDownload: async (downloadLocation) => {
      await trackUnsplashDownload(downloadLocation);
    },
  });

  // A reader that leaves (tab closed, navigation) must stop the LLM calls and
  // Chrome renders too, not just the bytes — otherwise the deck keeps being
  // paid for with nobody left to receive it.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        if (abort.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const deck = await generateDeck({
          topic,
          slideCount,
          theme,
          loadFallbackTheme,
          provider,
          resolvePhoto,
          onEvent: send,
          signal: abort.signal,
          transitions,
        });
        send({ type: "done", title: deck.title, count: deck.slides.length });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "HTML generation failed.",
        });
      } finally {
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
