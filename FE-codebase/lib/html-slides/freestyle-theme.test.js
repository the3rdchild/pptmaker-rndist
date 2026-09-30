import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";

import { buildFreestyleThemePrompt, designFreestyleTheme, themeFromDraft } from "./freestyle-theme.js";

const draft = () => ({
  name: "Tidal Ledger",
  description: "Sea-glass greens over deep ink for a coastal economics deck.",
  backgroundImageMode: "none",
  colors: {
    background: "#0B1F24", surface: "#12303A", primary: "#3FB8A5", secondary: "#8FB9B0",
    accent: "#F2C14E", text: "#F4F7F5", muted: "#B6CCC6", border: "#24505A",
  },
  typography: { headingFont: "Fraunces", bodyFont: "Inter", scale: "expressive" },
  effects: { surface: "flat", radius: "soft", shadow: "subtle", imageTreatment: "natural", grid: "none", slideNumber: "rule" },
  guidance: { artDirection: "Horizon lines split every slide.", dos: ["Anchor numbers large"], donts: ["No drop shadows on text"] },
  recipes: [
    { id: "cover", name: "Cover", roles: ["cover"], composition: "full-bleed", regions: [{ kind: "heading", placement: "left", emphasis: "primary" }], decorations: ["accent-rule"] },
    { id: "content-split", name: "Split", roles: ["content"], composition: "split-left", regions: [], decorations: [] },
  ],
});

test("retries a truncated OpenRouter theme with a larger budget", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { model, max_tokens: maxTokens } = JSON.parse(body);
    requests.push({ model, maxTokens });
    const truncated = maxTokens === 3500;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ model, choices: [{ message: { content: truncated ? "" : JSON.stringify(draft()) }, finish_reason: truncated ? "length" : "stop" }], usage: { completion_tokens: truncated ? maxTokens : 700, completion_tokens_details: { reasoning_tokens: truncated ? maxTokens : 100 } } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.OPENROUTER_API_KEY, base: process.env.OPENROUTER_BASE_URL };
  process.env.OPENROUTER_API_KEY = "local-regression-test";
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const theme = await designFreestyleTheme({ outline: { title: "Test deck", slides: [] }, provider: "openrouter-gpt-sol" });
    assert.equal(theme.id, "ai-tidal-ledger");
    assert.deepEqual(requests, [{ model: "openai/gpt-6-sol", maxTokens: 3500 }, { model: "openai/gpt-6-sol", maxTokens: 7000 }]);
  } finally {
    for (const [name, value] of [["OPENROUTER_API_KEY", previous.key], ["OPENROUTER_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("recovers a token-limited theme using larger budgets within its three attempts", async () => {
  const budgets = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { max_tokens: budget } = JSON.parse(body);
    budgets.push(budget);
    const truncated = budget < 12000;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: truncated ? '{"name": "unfinished' : JSON.stringify(draft()) }, finish_reason: truncated ? "length" : "stop" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.OPENROUTER_API_KEY, base: process.env.OPENROUTER_BASE_URL };
  process.env.OPENROUTER_API_KEY = "local-regression-test";
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const theme = await designFreestyleTheme({ outline: { title: "Test deck", slides: [] }, provider: "openrouter-deepseek-flash" });
    assert.equal(theme.id, "ai-tidal-ledger");
    assert.deepEqual(budgets, [3500, 7000, 12000]);
  } finally {
    for (const [name, value] of [["OPENROUTER_API_KEY", previous.key], ["OPENROUTER_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test("fills the fields the model is not asked for and validates the rest", () => {
  const theme = themeFromDraft(draft());
  assert.equal(theme.schemaVersion, 1);
  assert.equal(theme.id, "ai-tidal-ledger");
  assert.equal(theme.backgroundImageUrl, null);
  assert.equal(theme.recipes.length, 2);
});

test("a font outside the editor catalogue is rejected with the validator's reason", () => {
  const bad = draft();
  bad.typography.headingFont = "Comic Neue";
  assert.throws(() => themeFromDraft(bad), /headingFont/);
});

test("unreadable text is rejected so the model can be told what to fix", () => {
  const bad = draft();
  bad.colors.text = "#1A3A40";
  assert.throws(() => themeFromDraft(bad), /colors\.text .* needs at least 4\.5:1/);
});

test("a locked background is never offered — there is no asset to lock to", () => {
  const prompt = buildFreestyleThemePrompt({ title: "Deck", slides: [{ role: "cover", heading: "Hi" }] });
  assert.match(prompt, /"backgroundImageMode": "none" \| "generated"/);
  assert.doesNotMatch(prompt, /"locked"/);
});

test("repair feedback is carried into the next prompt", () => {
  const prompt = buildFreestyleThemePrompt({ title: "Deck", slides: [] }, "colors.text is too dark");
  assert.match(prompt, /REJECTED[\s\S]*colors\.text is too dark/);
});
