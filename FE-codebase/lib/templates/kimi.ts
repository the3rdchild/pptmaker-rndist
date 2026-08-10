// Thin wrapper over the unified provider layer (lib/ai-providers.ts). Kept as
// its own module because choose-theme/auto-label-theme import callKimiChat and
// the KimiMessage type from here; the implementation now routes through
// callProvider so the same call sites can switch providers via an optional
// providerId arg (the homepage selector, once wired in C.3).

import {
  callProvider,
  extractJson as extractJsonUnified,
  type ChatMessage,
  DEFAULT_VISION_PROVIDER,
} from "@/lib/ai-providers";

type Rec = Record<string, unknown>;

/** Backwards-compatible alias for the unified ChatMessage type. */
export type KimiMessage = ChatMessage;

/** One round trip to the resolved provider (Kimi by default for historical
 *  behavior). Throws on HTTP failure or an empty response — the route maps
 *  that to a 502 the caller can show. */
export async function callKimiChat(
  messages: KimiMessage[],
  maxTokens: number,
  providerId: string | null = DEFAULT_VISION_PROVIDER,
): Promise<string> {
  return callProvider(providerId, messages, { maxTokens });
}

/** Object-only ({...}) JSON extraction, typed as Rec for the existing callers
 *  (choose-theme, auto-label-theme) that expect a single object. The unified
 *  layer's extractJson is generic + array-aware; this narrows it back. */
export function extractJson(text: string): Rec | null {
  return extractJsonUnified<Rec>(text);
}
