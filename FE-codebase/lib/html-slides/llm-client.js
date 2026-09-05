// OpenAI-compatible chat client for the HTML pipeline.
//
// Reads provider config from process.env first — that is where Next puts
// .env.local, so the API route needs nothing else — and falls back to reading
// the worker's .env directly when run from the CLI outside Next.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

let fileEnv = null;
function fromFiles() {
  if (fileEnv) return fileEnv;
  fileEnv = {};
  for (const path of [join(REPO_ROOT, "worker", ".env"), join(REPO_ROOT, "FE-codebase", ".env.local")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match && !fileEnv[match[1]]) fileEnv[match[1]] = match[2].trim();
    }
  }
  return fileEnv;
}

function read(name) {
  const live = process.env[name];
  if (live && live.trim()) return live.trim();
  const fallback = fromFiles()[name];
  return fallback && fallback.trim() ? fallback.trim() : "";
}

// Base URL and model are stable per provider, so they carry defaults — only the
// key genuinely has to be configured. FE .env.local, for instance, sets
// DEEPINFRA_API_KEY but none of the rest.
const PROVIDERS = {
  deepinfra: {
    key: "DEEPINFRA_API_KEY",
    base: ["DEEPINFRA_BASE_URL", "https://api.deepinfra.com/v1/openai"],
    model: ["DEEPINFRA_MODEL", "deepseek-ai/DeepSeek-V3.1-Terminus"],
  },
  zhipu: {
    key: "ZHIPU_API_KEY",
    base: ["ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4"],
    model: ["ZHIPU_MODEL", "glm-4.5-flash"],
  },
  openai: {
    key: "OPENAI_API_KEY",
    base: ["OPENAI_BASE_URL", "https://api.openai.com/v1"],
    model: ["OPENAI_MODEL", "gpt-4o"],
  },
  kimi: {
    key: "KIMI_API_KEY",
    base: ["KIMI_BASE_URL", "https://api.kimi.com/coding/v1"],
    model: ["KIMI_MODEL", "kimi-k2.6"],
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export function providerConfig(name) {
  const spec = PROVIDERS[name];
  if (!spec) throw new Error(`Unknown provider "${name}". Known: ${PROVIDER_IDS.join(", ")}`);
  const apiKey = read(spec.key);
  if (!apiKey) throw new Error(`${spec.key} is not set`);
  return {
    apiKey,
    baseUrl: read(spec.base[0]) || spec.base[1],
    model: read(spec.model[0]) || spec.model[1],
  };
}

/** The first provider that actually has a key, so the route can run without
 *  the caller having to know which ones are configured. */
export function firstConfiguredProvider(preferred) {
  const order = preferred ? [preferred, ...PROVIDER_IDS] : PROVIDER_IDS;
  for (const name of order) {
    if (PROVIDERS[name] && read(PROVIDERS[name].key)) return name;
  }
  throw new Error(`No LLM provider configured — set one of: ${PROVIDER_IDS.map((p) => PROVIDERS[p].key).join(", ")}`);
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
