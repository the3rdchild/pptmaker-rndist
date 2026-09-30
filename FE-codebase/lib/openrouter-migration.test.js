import assert from "node:assert/strict";
import test from "node:test";

import { availableProviders, callProvider, requireProvider } from "./ai-providers.ts";
import { chat, firstConfiguredProvider } from "./html-slides/llm-client.js";

test("OpenRouter exposes four models and routes legacy and vision choices safely", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "local-test";
  try {
    assert.deepEqual(availableProviders().map(({ id }) => id), [
      "openrouter-gpt-sol", "openrouter-deepseek-flash", "openrouter-gemini-flash", "openrouter-claude-sonnet",
    ]);
    assert.equal(firstConfiguredProvider(), "openrouter-gpt-sol");
    assert.equal(firstConfiguredProvider("codebuddy"), "openrouter-gpt-sol");
    assert.equal(requireProvider("codebuddy").model, "openai/gpt-6-sol");
    assert.equal(requireProvider("openrouter-deepseek-flash", { vision: true }).model, "google/gemini-3-flash-preview");
    assert.equal(requireProvider("openrouter-claude-sonnet").model, "anthropic/claude-sonnet-5.5");
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("both frontend AI clients send OpenRouter chat completions without CodeBuddy streaming", async () => {
  const previous = { key: process.env.OPENROUTER_API_KEY, base: process.env.OPENROUTER_BASE_URL };
  process.env.OPENROUTER_API_KEY = "local-test";
  process.env.OPENROUTER_BASE_URL = "https://local.test/api/v1";
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }), { status: 200 });
  };
  try {
    assert.equal(await callProvider("openrouter-gpt-sol", [{ role: "user", content: "OK" }], { maxTokens: 128 }), "OK");
    assert.equal((await chat({ provider: "openrouter-deepseek-flash", prompt: "OK" })).text, "OK");
    assert.equal((await chat({ provider: "openrouter-claude-sonnet", prompt: "OK" })).text, "OK");
    assert.deepEqual(requests.map(({ body }) => body.model), ["openai/gpt-6-sol", "deepseek/deepseek-v4-flash-0731", "anthropic/claude-sonnet-5.5"]);
    assert.deepEqual(requests[2].body.reasoning, { effort: "low" });
    assert.ok(requests.every(({ url, body }) => url.endsWith("/chat/completions") && !body.stream));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["OPENROUTER_API_KEY", previous.key], ["OPENROUTER_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
