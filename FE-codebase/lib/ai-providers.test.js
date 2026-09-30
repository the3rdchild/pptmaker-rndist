import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { availableProviders, callProvider } from "./ai-providers.ts";
import { createGenerationTrace } from "./html-slides/generation-trace.js";
import { createGenerationCost, withGenerationCost } from "./generation-cost.js";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.OPENROUTER_API_KEY, base: process.env.OPENROUTER_BASE_URL };
  process.env.OPENROUTER_API_KEY = "local-regression-test";
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try { return await run(); }
  finally {
    for (const [name, value] of [["OPENROUTER_API_KEY", previous.key], ["OPENROUTER_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("rejects a token-limited repair while retaining usage and raw reply", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "<section>Incomplete content</section>" }, finish_reason: "length" }], usage: { completion_tokens: 12000 } }));
  }, async () => {
    const trace = createGenerationTrace({ generationId: `test-repair-truncated-${randomUUID()}` });
    await assert.rejects(trace.run(() => callProvider("openrouter-gpt-sol", [{ role: "user", content: "Repair this slide" }], { maxTokens: 12000 })), /token limit/i);
    const events = readFileSync(join(trace.directory, "events.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
    const reply = events.find((event) => event.type === "provider" && event.finishReason === "length");
    assert.equal(reply.usage.completion_tokens, 12000);
    assert.equal(readFileSync(join(trace.directory, reply.rawOutputFile), "utf8"), "<section>Incomplete content</section>");
  });
});

for (const phase of ["headers", "body"]) {
  test(`cancels an OpenRouter visual request while waiting for response ${phase}`, async () => {
    const abort = new AbortController();
    await withServer((_request, response) => {
      if (phase === "body") {
        response.writeHead(200, { "content-type": "application/json" });
        response.flushHeaders();
      }
      setTimeout(() => {
        abort.abort(new DOMException("Test navigation cancelled", "AbortError"));
        setTimeout(() => response.end(JSON.stringify({ choices: [{ message: { content: '{"issues":[]}' }, finish_reason: "stop" }] })), 20);
      }, 20);
    }, async () => {
      await assert.rejects(callProvider("openrouter-gemini-flash", [{ role: "user", content: "Review this slide" }], { maxTokens: 12000, vision: true, signal: abort.signal }), (error) => error === abort.signal.reason);
    });
  });
}

test("vision selector excludes text-only DeepSeek and uses OpenRouter JSON", async () => {
  await withServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(request.url, "/chat/completions");
    assert.equal(body.model, "google/gemini-3-flash-preview");
    assert.equal(body.stream, undefined);
    assert.deepEqual(body.usage, { include: true });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { cost: 0.00042 } }));
  }, async () => {
    assert.ok(!availableProviders({ vision: true }).some(({ id }) => id === "openrouter-deepseek-flash"));
    const cost = createGenerationCost();
    assert.equal(await withGenerationCost(cost, () => callProvider("openrouter-deepseek-flash", [{ role: "user", content: "Review" }], { maxTokens: 128, vision: true })), "OK");
    assert.equal(cost.totalUsd(), 0.00042);
  });
});
