import assert from "node:assert/strict";
import test from "node:test";

import { streamHtmlDeck } from "./html-slides-stream.ts";

function responseFor(lines) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

async function withStream(lines, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseFor(lines);
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("rejects a stream that closes before the server's done event", async () => {
  await withStream(
    [
      { type: "slide", index: 0, ui: {}, heading: "One", summary: "" },
      { type: "slide", index: 1, ui: {}, heading: "Two", summary: "" },
    ],
    async () => {
      await assert.rejects(
        () => streamHtmlDeck({ topic: "test" }, () => {}),
        /ended before the server confirmed completion/i,
      );
    },
  );
});

test("rejects a completed stream whose received slide count differs from done.count", async () => {
  await withStream(
    [
      { type: "slide", index: 0, ui: {}, heading: "One", summary: "" },
      { type: "slide", index: 1, ui: {}, heading: "Two", summary: "" },
      { type: "done", title: "Test", count: 5 },
    ],
    async () => {
      await assert.rejects(
        () => streamHtmlDeck({ topic: "test" }, () => {}),
        /received 2 of 5 slides/i,
      );
    },
  );
});

test("returns the received count only after a matching done event", async () => {
  await withStream(
    [
      { type: "slide", index: 0, ui: {}, heading: "One", summary: "" },
      { type: "slide", index: 1, ui: {}, heading: "Two", summary: "" },
      { type: "done", title: "Test", count: 2 },
    ],
    async () => {
      assert.equal(await streamHtmlDeck({ topic: "test" }, () => {}), 2);
    },
  );
});

test("rejects a done count that falls short of the caller's requested deck size", async () => {
  await withStream(
    [
      { type: "slide", index: 0, ui: {}, heading: "One", summary: "" },
      { type: "slide", index: 1, ui: {}, heading: "Two", summary: "" },
      { type: "done", title: "Test", count: 2 },
    ],
    async () => {
      await assert.rejects(
        () => streamHtmlDeck({ topic: "test", slideCount: 5 }, () => {}),
        /expected 5 slides but the server completed 2/i,
      );
    },
  );
});

test("forwards the selected image source, model, and session to HTML generation", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (_url, init) => {
    captured = init;
    return responseFor([{ type: "done", title: "Test", count: 0 }]);
  };
  try {
    await streamHtmlDeck(
      {
        topic: "test",
        imageSource: "ai",
        imageModel: "runware-premium",
        sessionToken: "session-123",
      },
      () => {},
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(captured.headers["x-session-token"], "session-123");
  assert.deepEqual(JSON.parse(captured.body), {
    topic: "test",
    imageSource: "ai",
    imageModel: "runware-premium",
  });
});
