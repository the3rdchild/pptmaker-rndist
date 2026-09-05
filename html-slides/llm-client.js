// OpenAI-compatible chat client for the HTML pipeline, reading provider config
// out of worker/.env so this spike uses the same keys the worker already has.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, "..", "worker", ".env");

let cachedEnv = null;
function env() {
  if (cachedEnv) return cachedEnv;
  const out = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim();
  }
  cachedEnv = out;
  return out;
}

const PROVIDERS = {
  deepinfra: { key: "DEEPINFRA_API_KEY", base: "DEEPINFRA_BASE_URL", model: "DEEPINFRA_MODEL" },
  zhipu: { key: "ZHIPU_API_KEY", base: "ZHIPU_BASE_URL", model: "ZHIPU_MODEL" },
  openai: { key: "OPENAI_API_KEY", base: "OPENAI_BASE_URL", model: "OPENAI_MODEL" },
  kimi: { key: "KIMI_API_KEY", base: "KIMI_BASE_URL", model: "KIMI_MODEL" },
};

export function providerConfig(name) {
  const spec = PROVIDERS[name];
  if (!spec) throw new Error(`Unknown provider "${name}". Known: ${Object.keys(PROVIDERS).join(", ")}`);
  const e = env();
  const apiKey = e[spec.key];
  if (!apiKey) throw new Error(`${spec.key} is not set in worker/.env`);
  return { apiKey, baseUrl: e[spec.base], model: e[spec.model] };
}

export async function chat({ provider, prompt, maxTokens = 4000, temperature = 0.7 }) {
  const { apiKey, baseUrl, model } = providerConfig(provider);
  const started = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${provider} ${response.status}: ${body.slice(0, 500)}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { text, model, ms: Date.now() - started, usage: data?.usage ?? null };
}
