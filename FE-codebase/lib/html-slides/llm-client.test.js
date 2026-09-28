import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { chat } from "./llm-client.js";
import { createGenerationTrace, withGenerationStage } from "./generation-trace.js";

test("preserves the provider finish reason and reasoning usage for truncation diagnostics", async () => {
  const usage = { prompt_tokens: 120, completion_tokens: 4000, total_tokens: 4120, completion_tokens_details: { reasoning_tokens: 2800 } };
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ model: "actual-provider-model", choices: [{ message: { content: "<section>unfinished" }, finish_reason: "length" }], usage }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.DEEPINFRA_API_KEY, base: process.env.DEEPINFRA_BASE_URL };
  process.env.DEEPINFRA_API_KEY = "local-regression-test";
  process.env.DEEPINFRA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const trace = createGenerationTrace({ generationId: `test-provider-${randomUUID()}` });
    const reply = await trace.run(() => withGenerationStage({ stage: "slide-layout", slide: 3, attempt: 1 }, () => chat({ provider: "deepinfra", prompt: "Make a slide" })));
    assert.equal(reply.finishReason, "length");
    assert.equal(reply.model, "actual-provider-model");
    assert.deepEqual(reply.usage, usage);
    assert.equal(reply.text, "<section>unfinished");
    const events = readFileSync(join(trace.directory, "events.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
    const completed = events.find((event) => event.type === "provider" && event.phase === "complete");
    assert.ok(completed, "the actual provider reply must be persisted");
    assert.equal(completed.finishReason, "length");
    assert.deepEqual(completed.usage, usage);
    assert.equal(completed.slide, 3);
    assert.equal(completed.attempt, 1);
    assert.ok(completed.durationMs >= 0);
    assert.equal(readFileSync(join(trace.directory, completed.rawOutputFile), "utf8"), "<section>unfinished");
  } finally {
    for (const [name, value] of [["DEEPINFRA_API_KEY", previous.key], ["DEEPINFRA_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CodeBuddy HTML generation sends a system message and collects SSE chunks", async () => {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.stream, true);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].content, "Make a slide");
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"model":"hy3","choices":[{"delta":{"content":"<section>"}}]}\n\n');
    response.end('data: {"choices":[{"delta":{"content":"OK</section>"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.CODEBUDDY_API_KEY, base: process.env.CODEBUDDY_BASE_URL };
  process.env.CODEBUDDY_API_KEY = "local-regression-test";
  process.env.CODEBUDDY_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const reply = await chat({ provider: "codebuddy", prompt: "Make a slide" });
    assert.equal(reply.text, "<section>OK</section>");
    assert.equal(reply.finishReason, "stop");
  } finally {
    for (const [name, value] of [["CODEBUDDY_API_KEY", previous.key], ["CODEBUDDY_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CodeBuddy GPT tiers select the matching HTML generation model", async () => {
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
    for (const provider of ["codebuddy-luna", "codebuddy-terra", "codebuddy-sol"]) {
      assert.equal((await chat({ provider, prompt: "OK", maxTokens: 128 })).text, "OK");
    }
    assert.deepEqual(requested, ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
  } finally {
    for (const [name, value] of [["CODEBUDDY_API_KEY", previous.key], ["CODEBUDDY_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
