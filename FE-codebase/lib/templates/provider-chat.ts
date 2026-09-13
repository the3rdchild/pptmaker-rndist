// Thin template-workflow wrapper over the unified provider layer.

import {
  callProvider,
  extractJson as extractJsonUnified,
  type ChatMessage,
  DEFAULT_VISION_PROVIDER,
} from "@/lib/ai-providers";

type Rec = Record<string, unknown>;

export type TemplateChatMessage = ChatMessage;

export async function callTemplateChat(
  messages: TemplateChatMessage[],
  maxTokens: number,
  providerId: string | null = DEFAULT_VISION_PROVIDER,
): Promise<string> {
  return callProvider(providerId, messages, { maxTokens });
}

export function extractJson(text: string): Rec | null {
  return extractJsonUnified<Rec>(text);
}
