// OpenAI-compatible chat client for the HTML pipeline.
//
// Reads provider config from process.env first — that is where Next puts
// .env.local, so the API route needs nothing else — and falls back to reading
// the worker's .env directly when run from the CLI outside Next.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordGenerationDiagnostic } from "./generation-trace.js";
import { recordGenerationCost } from "../generation-cost.js";

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
// key genuinely has to be configured.
const PROVIDERS = {
  "openrouter-gpt-sol": {
    model: "openai/gpt-6-sol",
    reasoning: "low",
    omitTemperature: true,
  },
  "openrouter-deepseek-flash": {
    model: "deepseek/deepseek-v4-flash-0731",
  },
  "openrouter-gemini-flash": {
    model: "google/gemini-3-flash-preview",
  },
  "openrouter-claude-sonnet": {
    model: "anthropic/claude-sonnet-5.5",
    omitTemperature: true,
    reasoning: "low",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export function providerConfig(name) {
  const spec = PROVIDERS[name];
  if (!spec) throw new Error(`Unknown provider "${name}". Known: ${PROVIDER_IDS.join(", ")}`);
  const apiKey = read("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  return {
    apiKey,
    baseUrl: read("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1",
    model: spec.model,
    reasoning: spec.reasoning,
    omitTemperature: spec.omitTemperature ?? false,
  };
}

/** The first provider that actually has a key, so the route can run without
 *  the caller having to know which ones are configured. */
export function firstConfiguredProvider(preferred) {
  if (!read("OPENROUTER_API_KEY")) throw new Error("No LLM provider configured — set OPENROUTER_API_KEY");
  return preferred && PROVIDERS[preferred] ? preferred : "openrouter-gpt-sol";
}

// A provider that goes quiet would otherwise hold the whole deck hostage: the
// pipeline awaits every slide, so one hung call means the stream never ends.
// Sized for reasoning models, which think before the first token.
const CHAT_TIMEOUT_MS = 180_000;

export async function chat({ provider, prompt, maxTokens = 4000, temperature = 0.7, signal }) {
  signal?.throwIfAborted();
  const { apiKey, baseUrl, model, reasoning, omitTemperature } = providerConfig(provider);
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
        ...(!omitTemperature ? { temperature } : {}),
        max_tokens: maxTokens,
        usage: { include: true },
        ...(reasoning ? { reasoning: { effort: reasoning } } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${provider} ${response.status}: ${body.slice(0, 500)}`);
    }
    const data = await response.json();
    recordGenerationCost(data?.usage ?? null);
    signal?.throwIfAborted();
    const text = data?.choices?.[0]?.message?.content ?? "";
    const reply = { text, model: data?.model ?? model, ms: Date.now() - started, usage: data?.usage ?? null, finishReason: data?.choices?.[0]?.finish_reason ?? null };
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
