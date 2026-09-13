// Unified text-AI provider layer for frontend/server AI calls (theme choice,
// visual review verify/repair, auto-label). CommandCode serves the GPT tiers
// through its OpenAI-compatible chat endpoint; DeepInfra remains available as
// the independent fallback/provider option.
//
// A provider is a preset (id → config). Provider availability is env-aware:
// `availableProviders` only returns presets whose API key env var is set, so
// the homepage selector never offers a provider the server can't call. Any
// endpoint quirks live next to the credentials, mirroring the worker config.
//
// Two endpoint shapes are supported, chosen per preset via `api`:
// /chat/completions (all current presets) and /responses (kept supported for
// future presets). callProvider hides
// the difference, so every call site — auto-label, visual-review verify and
// repair, theme choice, prompt enhance, font substitution — gets both for
// free and keeps passing plain chat-style messages.

type Rec = Record<string, unknown>;

export interface ProviderPreset {
  id: string;
  label: string;
  /** env var name holding the API key — used to detect availability. */
  envKey: string;
  base_url: string;
  model: string;
  /** Supports image_url multimodal input (vision). When false, the preset is
   *  hidden from selectors that filter { vision: true }. */
  vision?: boolean;
  /** Extra HTTP headers required by a provider. */
  headers?: Record<string, string>;
  /** Drop `temperature` from the request body. */
  omit_temperature?: boolean;
  /** Send extra_body thinking=disabled when a provider supports it. */
  disable_thinking?: boolean;
  /** Optional per-preset overrides for base_url/model via env, mirroring the
   *  worker. Falls back to the authored defaults when unset. */
  base_url_env?: string;
  model_env?: string;
  /** Which OpenAI-compatible endpoint shape to speak. "chat" (default) is
   *  /chat/completions; "responses" is /responses. */
  api?: "chat" | "responses";
  /** Reasoning effort for `api: "responses"` models. Kept low by default:
   *  reasoning tokens are billed against max_output_tokens, so a high effort
   *  can burn the whole budget before any answer text is emitted. */
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "gpt-luna",
    label: "GPT-5.6 Luna · Murah",
    envKey: "COMMANDCODE_API_KEY",
    base_url: "https://api.commandcode.ai/provider/v1",
    model: "gpt-5.6-luna",
    vision: true,
    omit_temperature: true,
    base_url_env: "COMMANDCODE_BASE_URL",
    model_env: "COMMANDCODE_LUNA_MODEL",
  },
  {
    id: "gpt-terra",
    label: "GPT-5.6 Terra · Mid (butuh Pro)",
    envKey: "COMMANDCODE_API_KEY",
    base_url: "https://api.commandcode.ai/provider/v1",
    model: "gpt-5.6-terra",
    vision: true,
    omit_temperature: true,
    base_url_env: "COMMANDCODE_BASE_URL",
    model_env: "COMMANDCODE_TERRA_MODEL",
  },
  {
    id: "gpt-sol",
    label: "GPT-5.6 Sol · Mahal",
    envKey: "COMMANDCODE_API_KEY",
    base_url: "https://api.commandcode.ai/provider/v1",
    model: "gpt-5.6-sol",
    vision: true,
    omit_temperature: true,
    base_url_env: "COMMANDCODE_BASE_URL",
    model_env: "COMMANDCODE_SOL_MODEL",
  },
  {
    id: "qwen-vl",
    label: "Qwen2.5-VL-32B (vision)",
    envKey: "DEEPINFRA_API_KEY",
    base_url: "https://api.deepinfra.com/v1/openai",
    model: "Qwen/Qwen2.5-VL-32B-Instruct",
    vision: true,
  },
  {
    id: "gemma-vl",
    label: "Gemma-4-26B (vision)",
    envKey: "DEEPINFRA_API_KEY",
    base_url: "https://api.deepinfra.com/v1/openai",
    model: "google/gemma-4-26B-A4B-it",
    vision: true,
  },
  {
    id: "llama-vl",
    label: "Llama-3.2-11B Vision",
    envKey: "DEEPINFRA_API_KEY",
    base_url: "https://api.deepinfra.com/v1/openai",
    model: "meta-llama/Llama-3.2-11B-Vision-Instruct",
    vision: true,
  },
  {
    id: "deepinfra",
    label: "DeepSeek V3.1",
    envKey: "DEEPINFRA_API_KEY",
    base_url: "https://api.deepinfra.com/v1/openai",
    model: "deepseek-ai/DeepSeek-V3.1-Terminus",
  },
];

export const DEFAULT_TEXT_PROVIDER = "gpt-luna";
export const DEFAULT_VISION_PROVIDER = "gpt-luna";

export interface ProviderConfig {
  id: string;
  apiKey: string;
  base_url: string;
  model: string;
  headers?: Record<string, string>;
  omit_temperature?: boolean;
  disable_thinking?: boolean;
  vision: boolean;
  api: "chat" | "responses";
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
}

/** Resolves a preset (with env overrides applied) to a ready-to-call config,
 *  or null if the provider's API key env var is unset (provider unavailable). */
export function getProvider(id: string | null | undefined): ProviderConfig | null {
  const preset = PROVIDER_PRESETS.find((p) => p.id === id) ?? null;
  if (!preset) return null;
  const apiKey = process.env[preset.envKey];
  if (!apiKey) return null;
  const base_url = preset.base_url_env
    ? process.env[preset.base_url_env] ?? preset.base_url
    : preset.base_url;
  const model = preset.model_env
    ? process.env[preset.model_env] ?? preset.model
    : preset.model;
  return {
    id: preset.id,
    apiKey,
    base_url,
    model,
    headers: preset.headers,
    omit_temperature: preset.omit_temperature,
    disable_thinking: preset.disable_thinking,
    vision: preset.vision ?? false,
    api: preset.api ?? "chat",
    reasoning_effort: preset.reasoning_effort,
  };
}

/** Resolves the provider, falling back to DEFAULT_TEXT_PROVIDER (or the vision
 *  default) when the id is missing/unavailable — mirrors the worker's graceful
 *  resolve_provider. Throws if even the fallback has no key configured. */
export function requireProvider(
  id: string | null | undefined,
  opts: { vision?: boolean } = {},
): ProviderConfig {
  const fallbackId = opts.vision ? DEFAULT_VISION_PROVIDER : DEFAULT_TEXT_PROVIDER;
  return (
    getProvider(id) ??
    getProvider(fallbackId) ??
    (() => {
      throw new Error(
        `No AI provider available (requested: ${id ?? "none"}, fallback: ${fallbackId}). Set an API key env var.`,
      );
    })()
  );
}

export interface AvailableProvider {
  id: string;
  label: string;
  vision: boolean;
}

/** List of providers whose API key is configured, for the homepage selector.
 *  Pass { vision: true } to restrict to vision-capable providers (the verify
 *  pass needs image support; repair/generate don't). */
export function availableProviders(
  opts: { vision?: boolean } = {},
): AvailableProvider[] {
  return PROVIDER_PRESETS.filter((p) => {
    if (opts.vision && !p.vision) return false;
    return Boolean(process.env[p.envKey]);
  }).map((p) => ({ id: p.id, label: p.label, vision: p.vision ?? false }));
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** String for text-only calls, or the OpenAI multimodal content array when
   *  images are attached. */
  content: unknown;
}

// Some upstream providers can go quiet mid-request instead of erroring. A plain fetch
// with no timeout then hangs forever — and since every caller (visual review
// verify/repair) is awaited up the chain into the generation pipeline, one
// stuck request freezes the whole "Reviewing slide N…" step with no error,
// no log, nothing to point at. This bounds every provider call so a
// non-responsive provider fails fast instead of wedging the pipeline.
const PROVIDER_TIMEOUT_MS = 60000;

// Vision calls need a much wider bound than text ones. Measured against
// DeepInfra with the auto-label prompt and a small image: qwen-vl ~11s,
// llama-vl ~35s — before the image itself is accounted for. A 60s ceiling
// left the slowest preset one hiccup away from failing on every run, which is
// exactly how auto-label behaved.
const VISION_TIMEOUT_MS = 180000;

// Reasoning models bill their hidden reasoning tokens against the SAME
// max_output_tokens budget as the visible answer. Call sites size maxTokens
// for the answer alone (enhance-prompt asks for 400), so passing it straight
// through returns status:"incomplete" with zero text — the reasoning ate the
// whole budget. This floor buys room for the reasoning pass on top of
// whatever the caller asked for; max() means a caller asking for more (
// auto-label's 16000) still wins.
const RESPONSES_MIN_OUTPUT_TOKENS = 4000;

type ContentPart = { type?: string; text?: string; image_url?: { url?: string } };

/** Chat-completions `messages` → Responses `input`. The two APIs disagree on
 *  the multimodal part names: {type:"text"} / {type:"image_url",image_url:{url}}
 *  becomes {type:"input_text"} / {type:"input_image",image_url:"<url>"} (the
 *  url is a bare string here, not an object). Assistant text uses output_text.
 *  Plain string content is accepted verbatim by both. */
function toResponsesInput(messages: ChatMessage[]): Rec[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return { role: m.role, content: m.content };
    const content = (m.content as ContentPart[]).map((part) => {
      if (part.type === "image_url") {
        return { type: "input_image", image_url: part.image_url?.url ?? "" };
      }
      return {
        type: m.role === "assistant" ? "output_text" : "input_text",
        text: part.text ?? "",
      };
    });
    return { role: m.role, content };
  });
}

/** Concatenates the text parts of a Responses payload. The output array also
 *  carries `reasoning` items with no text, which are skipped. */
function readResponsesText(data: Rec): string {
  const output = data.output as Rec[] | undefined;
  if (!Array.isArray(output)) return "";
  let text = "";
  for (const item of output) {
    if (item.type !== "message") continue;
    const parts = item.content as Rec[] | undefined;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (typeof part.text === "string") text += part.text;
    }
  }
  return text;
}

/** One round trip to the provider's chat-completions endpoint. Throws on HTTP
 *  failure, a timeout, or an empty response — the route maps that to a 502
 *  the caller can show. Per-provider quirks (UA header, omitted temperature,
 *  disabled thinking) are applied from the resolved config. */
export async function callProvider(
  providerId: string | null | undefined,
  messages: ChatMessage[],
  opts: { maxTokens: number; vision?: boolean },
): Promise<string> {
  const cfg = requireProvider(providerId, { vision: opts.vision });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    ...(cfg.headers ?? {}),
  };
  const useResponses = cfg.api === "responses";
  const body: Rec = useResponses
    ? {
        model: cfg.model,
        input: toResponsesInput(messages),
        // /responses rejects `max_tokens` outright ("Unknown parameter").
        max_output_tokens: Math.max(opts.maxTokens, RESPONSES_MIN_OUTPUT_TOKENS),
        ...(cfg.reasoning_effort ? { reasoning: { effort: cfg.reasoning_effort } } : {}),
      }
    : {
        model: cfg.model,
        messages,
        max_tokens: opts.maxTokens,
      };
  if (!cfg.omit_temperature) body.temperature = 1;
  if (cfg.disable_thinking) body.thinking = { type: "disabled" };

  const endpoint = useResponses ? "responses" : "chat/completions";
  // Responses/reasoning models can think before they answer, so a text call
  // outlives the 60s bound sized for one-shot chat models.
  const timeoutMs = opts.vision || useResponses ? VISION_TIMEOUT_MS : PROVIDER_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${cfg.base_url}/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${cfg.id} timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${cfg.id} API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Rec;
  let content: unknown;
  if (useResponses) {
    content = readResponsesText(data);
    // A truncated reasoning pass returns HTTP 200 with an empty message and
    // status:"incomplete" — name the real cause instead of "empty response".
    if (typeof content === "string" && !content.trim() && data.status === "incomplete") {
      const reason = (data.incomplete_details as Rec | undefined)?.reason ?? "unknown";
      throw new Error(`${cfg.id} returned no text (incomplete: ${String(reason)})`);
    }
  } else {
    const choices = data.choices as Rec[] | undefined;
    content = choices?.[0] && (choices[0].message as Rec | undefined)?.content;
  }
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${cfg.id} returned an empty response`);
  }
  return content;
}

/** Extracts the first balanced {...} or [...] JSON value from model output
 *  that may carry reasoning prose or code fences around it. Array-aware so it
 *  serves every caller (verify returns {issues:[...]}, repair returns
 *  {fills:[...]}). */
export function extractJson<T>(text: string): T | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
