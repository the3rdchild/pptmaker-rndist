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
import { createGenerationTrace } from "@/lib/html-slides/generation-trace.js";
import { createGenerationCost, recordGenerationCost, withGenerationCost } from "@/lib/generation-cost.js";
import { reviewSlideVisual } from "@/lib/ai-visual-review";
import { callProvider } from "@/lib/ai-providers";
import {
  searchStockImagesWithFallback,
  trackUnsplashDownload,
} from "@/lib/stock-image-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Layout retries, photo resolution and visual repair can exceed five minutes.
// Allow the bounded pipeline to finish on hosts that honor this runtime budget.
export const maxDuration = 900;

type Body = {
  deckId?: unknown;
  topic?: unknown;
  slideCount?: unknown;
  theme?: unknown;
  provider?: unknown;
  imageSource?: unknown;
  imageModel?: unknown;
  transitions?: unknown;
  withReview?: unknown;
  verifyProvider?: unknown;
  repairProvider?: unknown;
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
  const withReview = body.withReview === true;
  const verifyProvider = typeof body.verifyProvider === "string" ? body.verifyProvider : undefined;
  const repairProvider = typeof body.repairProvider === "string" ? body.repairProvider : undefined;
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
    generateAi: (token, prompt, options) => generateImage(token, prompt, {
      ...options,
      onCost: (costUsd) => recordGenerationCost(costUsd),
    }),
    searchStock: searchStockImagesWithFallback,
    trackStockDownload: async (downloadLocation) => {
      await trackUnsplashDownload(downloadLocation);
    },
  });

  // A reader that leaves (tab closed, navigation) must stop the LLM calls and
  // Chrome renders too, not just the bytes — otherwise the deck keeps being
  // paid for with nobody left to receive it.
  const abort = new AbortController();
  const onAbort = () => abort.abort(request.signal.reason);
  request.signal.addEventListener("abort", onAbort, { once: true });
  if (request.signal.aborted) onAbort();

  const encoder = new TextEncoder();
  const generationId = crypto.randomUUID();
  const deckId = typeof body.deckId === "string" ? body.deckId.slice(0, 128) : null;
  const trace = createGenerationTrace({ generationId, deckId, signal: abort.signal, secrets: [sessionToken] });
  const cost = createGenerationCost();
  let completedSlides = 0;
  console.info("[html-slides][generate]", JSON.stringify(trace.record({
    generationId, phase: "start", slideCount, provider, theme: theme?.id ?? "freestyle", imageSource, transitions, withReview,
  })));
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (abort.signal.aborted) return;
        if (event.type === "slide") completedSlides += 1;
        // Keep stage/error evidence without writing full layouts, prompts or
        // image URLs into the server log.
        const { ui: _ui, ...summary } = event;
        const diagnostic = trace.record({ completedSlides, ...summary });
        const clientEvent = trace.eventForClient(event);
        if (event.type === "slide") trace.writeArtifact(`slide-${Number(event.index) + 1}.json`, JSON.stringify(clientEvent));
        console.info("[html-slides][generate]", JSON.stringify(diagnostic));
        controller.enqueue(encoder.encode(`${JSON.stringify(clientEvent)}\n`));
      };
      try {
        const deck = await withGenerationCost(cost, () => trace.run(async () => {
          const result = await generateDeck({
          topic,
          slideCount,
          theme,
          loadFallbackTheme,
          provider,
          resolvePhoto,
          onEvent: send,
          outDir: trace.directory,
          signal: abort.signal,
          transitions,
          ...(withReview ? {
            reviewSlide: (input: Parameters<typeof reviewSlideVisual>[0]) => reviewSlideVisual({ ...input, providerId: verifyProvider }),
            repairSlide: ({ prompt, signal }: { prompt: string; signal?: AbortSignal }) => callProvider(repairProvider, [{ role: "user", content: prompt }], { maxTokens: 12000, signal }),
          } : {}),
          });
          trace.writeArtifact("deck.json", JSON.stringify(result));
          return result;
        }));
        send({ type: "done", title: deck.title, count: deck.slides.length, costUsd: cost.totalUsd() });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "HTML generation failed.",
        });
      } finally {
        request.signal.removeEventListener("abort", onAbort);
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
      "x-generation-id": generationId,
    },
  });
}
