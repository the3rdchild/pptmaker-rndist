import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { availableProviders, callProvider } from "./ai-providers.ts";
import { createGenerationTrace } from "./html-slides/generation-trace.js";

test("rejects a token-limited visual repair while retaining provider usage and its raw reply", async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"choices":[{"delta":{"content":"<section>Incomplete content</section>"},"finish_reason":"length"}],"usage":{"completion_tokens":12000}}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.CODEBUDDY_API_KEY, base: process.env.CODEBUDDY_BASE_URL };
  process.env.CODEBUDDY_API_KEY = "local-regression-test";
  process.env.CODEBUDDY_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const trace = createGenerationTrace({ generationId: `test-repair-truncated-${randomUUID()}` });
  try {
    await assert.rejects(trace.run(() => callProvider("codebuddy", [{ role: "user", content: "Repair this slide" }], { maxTokens: 12000 })), /token limit/i);
    const events = readFileSync(join(trace.directory, "events.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
    const reply = events.find((event) => event.type === "provider" && event.finishReason === "length");
    assert.equal(reply.usage.completion_tokens, 12000);
    assert.equal(readFileSync(join(trace.directory, reply.rawOutputFile), "utf8"), "<section>Incomplete content</section>");
  } finally {
    for (const [name, value] of [["CODEBUDDY_API_KEY", previous.key], ["CODEBUDDY_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

for (const phase of ["headers", "body"]) {
  test(`cancels a visual provider request while waiting for response ${phase}`, async () => {
    const abort = new AbortController();
    const server = createServer((request, response) => {
      if (phase === "body") {
        response.writeHead(200, { "content-type": "application/json" });
        response.flushHeaders();
      }
      setTimeout(() => {
        abort.abort(new DOMException("Test navigation cancelled", "AbortError"));
        setTimeout(() => response.end(JSON.stringify({ choices: [{ message: { content: '{"issues":[]}' }, finish_reason: "stop" }] })), 20);
      }, 20);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const previous = { key: process.env.CODEBUDDY_API_KEY, base: process.env.CODEBUDDY_BASE_URL };
    process.env.CODEBUDDY_API_KEY = "local-regression-test";
    process.env.CODEBUDDY_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    try {
      await assert.rejects(callProvider("codebuddy", [{ role: "user", content: "Review this slide" }], { maxTokens: 12000, vision: true, signal: abort.signal }), (error) => error === abort.signal.reason);
    } finally {
      for (const [name, value] of [["CODEBUDDY_API_KEY", previous.key], ["CODEBUDDY_BASE_URL", previous.base]]) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}

test("CodeBuddy receives a system message and aggregates streamed text with usage", async () => {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(request.url, "/chat/completions");
    assert.equal(body.stream, true);
    assert.equal(body.model, "hy3");
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].content, "Write a title");
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"model":"hy3","choices":[{"delta":{"content":"Hello "}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}],"usage":{"completion_tokens":2}}\n\n');
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.CODEBUDDY_API_KEY, base: process.env.CODEBUDDY_BASE_URL };
  process.env.CODEBUDDY_API_KEY = "local-regression-test";
  process.env.CODEBUDDY_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await callProvider("codebuddy", [{ role: "user", content: "Write a title" }], { maxTokens: 100 }), "Hello world");
  } finally {
    for (const [name, value] of [["CODEBUDDY_API_KEY", previous.key], ["CODEBUDDY_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CodeBuddy GPT tiers route to their model IDs and stay out of the vision picker", async () => {
  const requested = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requested.push(body.model);
    assert.equal(body.stream, true);
    assert.equal(body.messages[0].role, "system");
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.CODEBUDDY_API_KEY, base: process.env.CODEBUDDY_BASE_URL };
  process.env.CODEBUDDY_API_KEY = "local-regression-test";
  process.env.CODEBUDDY_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const ids = ["codebuddy-luna", "codebuddy-terra", "codebuddy-sol"];
    for (const id of ids) assert.equal(await callProvider(id, [{ role: "user", content: "OK" }], { maxTokens: 128 }), "OK");
    assert.deepEqual(requested, ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
    assert.ok(ids.every((id) => availableProviders().some((provider) => provider.id === id)));
    assert.ok(ids.every((id) => !availableProviders({ vision: true }).some((provider) => provider.id === id)));
  } finally {
    for (const [name, value] of [["CODEBUDDY_API_KEY", previous.key], ["CODEBUDDY_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
