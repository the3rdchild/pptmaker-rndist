// OpenAI-compatible chat client for the HTML pipeline.
//
// Reads provider config from process.env first — that is where Next puts
// .env.local, so the API route needs nothing else — and falls back to reading
// the worker's .env directly when run from the CLI outside Next.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordGenerationDiagnostic } from "./generation-trace.js";
import { readCodeBuddyStream } from "../codebuddy-stream.js";

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
  codebuddy: {
    key: "CODEBUDDY_API_KEY",
    base: ["CODEBUDDY_BASE_URL", "https://www.codebuddy.ai/v2"],
    model: ["CODEBUDDY_MODEL", "hy3"],
    codebuddy: true,
  },
  "codebuddy-luna": {
    key: "CODEBUDDY_API_KEY",
    base: ["CODEBUDDY_BASE_URL", "https://www.codebuddy.ai/v2"],
    model: ["CODEBUDDY_LUNA_MODEL", "gpt-5.6-luna"],
    codebuddy: true,
  },
  "codebuddy-terra": {
    key: "CODEBUDDY_API_KEY",
    base: ["CODEBUDDY_BASE_URL", "https://www.codebuddy.ai/v2"],
    model: ["CODEBUDDY_TERRA_MODEL", "gpt-5.6-terra"],
    codebuddy: true,
  },
  "codebuddy-sol": {
    key: "CODEBUDDY_API_KEY",
    base: ["CODEBUDDY_BASE_URL", "https://www.codebuddy.ai/v2"],
    model: ["CODEBUDDY_SOL_MODEL", "gpt-5.6-sol"],
    codebuddy: true,
  },
  deepinfra: {
    key: "DEEPINFRA_API_KEY",
    base: ["DEEPINFRA_BASE_URL", "https://api.deepinfra.com/v1/openai"],
    model: ["DEEPINFRA_MODEL", "deepseek-ai/DeepSeek-V3.1-Terminus"],
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
    codebuddy: spec.codebuddy ?? false,
  };
}

/** The first provider that actually has a key, so the route can run without
 *  the caller having to know which ones are configured. */
export function firstConfiguredProvider(preferred) {
  const order = preferred ? [preferred, ...PROVIDER_IDS] : ["codebuddy-sol", ...PROVIDER_IDS];
  for (const name of order) {
    if (PROVIDERS[name] && read(PROVIDERS[name].key)) return name;
  }
  throw new Error(`No LLM provider configured — set one of: ${PROVIDER_IDS.map((p) => PROVIDERS[p].key).join(", ")}`);
}

// A provider that goes quiet would otherwise hold the whole deck hostage: the
// pipeline awaits every slide, so one hung call means the stream never ends.
// Sized for reasoning models, which think before the first token.
const CHAT_TIMEOUT_MS = 180_000;

export async function chat({ provider, prompt, maxTokens = 4000, temperature = 0.7, signal }) {
  signal?.throwIfAborted();
  const { apiKey, baseUrl, model, codebuddy } = providerConfig(provider);
  const started = Date.now();
  const timeout = AbortSignal.timeout(CHAT_TIMEOUT_MS);
  recordGenerationDiagnostic({ type: "provider", phase: "start", provider, model, maxTokens }, [apiKey]);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        ...(provider === "deepinfra" ? { temperature } : {}),
        max_tokens: maxTokens,
        ...(codebuddy ? { stream: true, stream_options: { include_usage: true } } : {}),
        messages: codebuddy
          ? [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: prompt }]
          : [{ role: "user", content: prompt }],
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${provider} ${response.status}: ${body.slice(0, 500)}`);
    }
    const data = codebuddy ? await readCodeBuddyStream(response) : await response.json();
    signal?.throwIfAborted();
    const text = codebuddy ? data.text : data?.choices?.[0]?.message?.content ?? "";
    const reply = { text, model: data?.model ?? model, ms: Date.now() - started, usage: data?.usage ?? null, finishReason: codebuddy ? data.finishReason : data?.choices?.[0]?.finish_reason ?? null };
    recordGenerationDiagnostic({ type: "provider", phase: "complete", provider, model: reply.model, maxTokens, durationMs: reply.ms, usage: reply.usage, finishReason: reply.finishReason, rawOutput: text });
    return reply;
  } catch (cause) {
    // The caller's cancellation wins if the provider timeout fires at the same
    // time, and response-body timeouts are classified just like fetch timeouts.
    const error = signal?.aborted ? signal.reason : timeout.aborted ? new Error(`${provider} timed out after ${CHAT_TIMEOUT_MS / 1000}s`) : cause;
    recordGenerationDiagnostic({ type: "provider", phase: signal?.aborted ? "cancelled" : "error", provider, model, maxTokens, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** A syntactically complete prefix can still be missing content after a token
 * limit. Reject it before parsing, and let the bounded caller retry budget grow. */
export function requireCompleteReply(reply) {
  if (reply.finishReason !== "length") return;
  const error = new Error("The provider reached the output token limit before finishing the reply.");
  error.code = "OUTPUT_TRUNCATED";
  const completion = reply.usage?.completion_tokens;
  const reasoning = reply.usage?.completion_tokens_details?.reasoning_tokens;
  error.reasoningOnly = !String(reply.text ?? "").trim()
    && typeof completion === "number" && completion > 0
    && typeof reasoning === "number" && reasoning >= completion * 0.98;
  throw error;
}
