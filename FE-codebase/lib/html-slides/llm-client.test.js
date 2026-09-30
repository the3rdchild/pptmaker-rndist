import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { chat, firstConfiguredProvider, requireCompleteReply } from "./llm-client.js";
import { createGenerationTrace, withGenerationStage } from "./generation-trace.js";
import { createGenerationCost, withGenerationCost } from "../generation-cost.js";

test("defaults HTML generation to OpenRouter Sol and ignores a saved CodeBuddy choice", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "local-regression-test";
  try {
    assert.equal(firstConfiguredProvider(), "openrouter-gpt-sol");
    assert.equal(firstConfiguredProvider("codebuddy"), "openrouter-gpt-sol");
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("identifies a truncated reply spent entirely on hidden reasoning", () => {
  assert.throws(() => requireCompleteReply({
    finishReason: "length", text: "",
    usage: { completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 4000 } },
  }), (error) => error.code === "OUTPUT_TRUNCATED" && error.reasoningOnly === true);
  assert.throws(() => requireCompleteReply({
    finishReason: "length", text: "<section>partial",
    usage: { completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 1500 } },
  }), (error) => error.code === "OUTPUT_TRUNCATED" && error.reasoningOnly === false);
});

test("OpenRouter HTML generation records truncation diagnostics and sends nonstreaming JSON", async () => {
  const usage = { prompt_tokens: 120, completion_tokens: 4000, total_tokens: 4120, cost: 0.0234, completion_tokens_details: { reasoning_tokens: 2800 } };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(request.url, "/chat/completions");
    assert.equal(body.model, "openai/gpt-6-sol");
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(body.stream, undefined);
    assert.deepEqual(body.usage, { include: true });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ model: "actual-provider-model", choices: [{ message: { content: "<section>unfinished" }, finish_reason: "length" }], usage }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.OPENROUTER_API_KEY, base: process.env.OPENROUTER_BASE_URL };
  process.env.OPENROUTER_API_KEY = "local-regression-test";
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const trace = createGenerationTrace({ generationId: `test-provider-${randomUUID()}` });
    const cost = createGenerationCost();
    const reply = await withGenerationCost(cost, () => trace.run(() => withGenerationStage({ stage: "slide-layout", slide: 3, attempt: 1 }, () => chat({ provider: "openrouter-gpt-sol", prompt: "Make a slide" }))));
    assert.equal(cost.totalUsd(), 0.0234);
    assert.equal(reply.finishReason, "length");
    assert.equal(reply.model, "actual-provider-model");
    assert.deepEqual(reply.usage, usage);
    const events = readFileSync(join(trace.directory, "events.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
    const completed = events.find((event) => event.type === "provider" && event.phase === "complete");
    assert.equal(completed.slide, 3);
    assert.equal(completed.attempt, 1);
    assert.equal(readFileSync(join(trace.directory, completed.rawOutputFile), "utf8"), "<section>unfinished");
  } finally {
    for (const [name, value] of [["OPENROUTER_API_KEY", previous.key], ["OPENROUTER_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
