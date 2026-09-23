// Client side of the HTML generation route: turns its NDJSON stream into
// callbacks. Kept out of the editor component so the parsing has one home and
// the component only decides what to do with each event.

export type HtmlSlideEvent =
  | { type: "status"; message: string }
  | { type: "outline"; title: string; slides: string[]; provider: string }
  | { type: "theme"; name: string; description: string; source: "ai" | "fallback"; reason?: string }
  | { type: "slide"; index: number; ui: Record<string, unknown>; heading: string; summary: string }
  | { type: "warning"; slide: number; message: string }
  | { type: "done"; title: string; count: number }
  | { type: "error"; message: string };

export interface HtmlDeckRequest {
  topic: string;
  slideCount?: number;
  theme?: string;
  provider?: string;
  imageSource?: "ai" | "stock";
  imageModel?: string;
  sessionToken?: string;
  signal?: AbortSignal;
}

/** Streams a deck from the HTML pipeline, handing each event to `onEvent` as
 *  it arrives. Resolves only after the server explicitly confirms every
 *  slide it promised; a dropped response must not look like a ready deck.
 *  Throws on an `error` line so the caller's existing failure UI applies. */
export async function streamHtmlDeck(
  { topic, slideCount, theme, provider, imageSource, imageModel, sessionToken, signal }: HtmlDeckRequest,
  onEvent: (event: HtmlSlideEvent) => void,
): Promise<number> {
  const response = await fetch("/api/html-slides/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { "x-session-token": sessionToken } : {}),
    },
    body: JSON.stringify({
      topic,
      ...(slideCount == null ? {} : { slideCount }),
      ...(theme == null ? {} : { theme }),
      ...(provider == null ? {} : { provider }),
      ...(imageSource == null ? {} : { imageSource }),
      ...(imageModel == null ? {} : { imageModel }),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      detail.slice(0, 300) || `HTML generation failed (${response.status}).`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let slides = 0;
  let announcedCount: number | null = null;
  let doneCount: number | null = null;

  const handle = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: HtmlSlideEvent;
    try {
      event = JSON.parse(trimmed) as HtmlSlideEvent;
    } catch {
      return; // a half-written line; the next chunk completes it
    }
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "slide") slides += 1;
    if (event.type === "outline") announcedCount = event.slides.length;
    if (event.type === "done") {
      doneCount = Number.isInteger(event.count) && event.count >= 0 ? event.count : -1;
    }
    onEvent(event);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Slide lines carry a whole layout, so they can be large — split on
    // newlines only, never assume one chunk is one line.
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      handle(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  handle(buffer);

  if (doneCount === null) {
    throw new Error("HTML generation stream ended before the server confirmed completion.");
  }
  if (doneCount !== slides) {
    throw new Error(`HTML generation received ${slides} of ${doneCount} slides before completion.`);
  }
  const expectedCount = slideCount ?? announcedCount;
  if (expectedCount !== null && doneCount !== expectedCount) {
    throw new Error(`HTML generation expected ${expectedCount} slides but the server completed ${doneCount}.`);
  }

  return slides;
}
