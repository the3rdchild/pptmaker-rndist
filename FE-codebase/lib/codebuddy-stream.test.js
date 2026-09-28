import assert from "node:assert/strict";
import test from "node:test";

import { readCodeBuddyStream } from "./codebuddy-stream.js";

test("collects CodeBuddy SSE events split across CRLF chunk boundaries", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\r',
    '\n\r',
    '\ndata: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\r\n\r\n',
    'data: [DONE]\r\n\r\n',
  ];
  const response = new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }));
  const reply = await readCodeBuddyStream(response);
  assert.equal(reply.text, "Hello world");
  assert.equal(reply.finishReason, "stop");
});
