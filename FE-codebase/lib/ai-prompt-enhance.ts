// Prompt enhancement — a too-simple user prompt ("ppt tentang kopi") gives the
// deck generator almost nothing to work with, so the slides come out thin and
// generic. This rewrites such a prompt into a rich generation brief BEFORE
// theme choice / deck generation, so the model has audience, angle, structure
// and concrete subtopics to draw copy from. Text-only call — no vision needed.

import { callProvider } from "@/lib/ai-providers";

const SYSTEM_PROMPT = `You expand a user's terse presentation request into a rich generation brief for a slide-deck copywriter.

Given the raw request, output ONE paragraph (max 120 words) covering:
- the subject and a clear, interesting angle on it
- the target audience and the deck's purpose (inform / pitch / teach / report)
- the key points and sections the deck should cover, as concrete subtopics
- the tone and register
- the KINDS of examples, comparisons, or data that would strengthen it

Rules:
- Write in the SAME language as the user's request (or the requested language when one is given).
- Do NOT fabricate specific facts, figures, quotes, or sources — name the kind of material to include, not invented numbers.
- Do NOT restate these instructions, add headings, bullets, or commentary — output ONLY the brief itself.
- Keep the user's original intent and subject exactly; enrich it, never redirect it.`;

/** Rewrites a short deck prompt into a detailed generation brief. Throws on
 *  provider failure — the caller decides whether to fall back to the raw
 *  prompt (enhancement is a bonus, never a blocker). */
export async function enhanceDeckPrompt(
  topic: string,
  language?: string,
  provider?: string | null,
): Promise<string> {
  const out = await callProvider(
    provider,
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${language ? `Language: ${language}\n` : ""}Request: ${topic}`,
      },
    ],
    { maxTokens: 400 },
  );
  // Guard rails: the brief must be real text, not an empty/restated echo.
  const brief = out.trim().replace(/^["']|["']$/g, "");
  if (brief.length < 20) throw new Error("Enhancement returned an empty brief");
  return brief;
}
