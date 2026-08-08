// Shared Kimi chat-completions round trip for the template metadata
// endpoints (auto-label-theme, choose-theme). The feature modules keep their
// own prompts and sanitizers; this is only the HTTP call plus the JSON
// extraction every one of them needs.
//
// auto-label.ts has its own inline copy of this — left untouched because its
// comment documents it as bun-exercisable in isolation.

type Rec = Record<string, unknown>;

const KIMI_BASE_URL = () =>
	process.env.KIMI_BASE_URL ?? "https://api.kimi.com/coding/v1";
const KIMI_MODEL = () => process.env.KIMI_MODEL ?? "kimi-k2.6";

/** sk-kimi-* keys are Kimi Code subscription keys: they are only accepted on
 *  api.kimi.com/coding, and that endpoint only authorizes requests carrying a
 *  recognized coding-agent User-Agent. */
const KIMI_USER_AGENT = "claude-code/0.1.0";

export type KimiMessage = {
	role: "system" | "user";
	/** String for text-only calls, or the multimodal content array when images
	 *  are attached. */
	content: unknown;
};

/** One round trip to Kimi. Throws on HTTP failure or an empty response — the
 *  route maps that to a 502 the caller can show. */
export async function callKimiChat(
	messages: KimiMessage[],
	maxTokens: number,
): Promise<string> {
	const apiKey = process.env.KIMI_API_KEY;
	if (!apiKey) throw new Error("KIMI_API_KEY is not configured");

	const res = await fetch(`${KIMI_BASE_URL()}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			"User-Agent": KIMI_USER_AGENT,
		},
		body: JSON.stringify({
			model: KIMI_MODEL(),
			messages,
			// kimi-k2.6 rejects any temperature other than 1, so it is not sent.
			max_tokens: maxTokens,
		}),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Kimi API ${res.status}: ${text.slice(0, 200)}`);
	}

	const data = (await res.json()) as Rec;
	const choices = data.choices as Rec[] | undefined;
	const content = choices?.[0] && (choices[0].message as Rec | undefined)?.content;
	if (typeof content !== "string" || !content.trim()) {
		throw new Error("Kimi returned an empty response");
	}
	return content;
}

/** Extracts the first balanced {...} JSON object from model output that may
 *  carry reasoning prose or code fences around it. */
export function extractJson(text: string): Rec | null {
	const start = text.indexOf("{");
	if (start < 0) return null;
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
		if (ch === "{") depth++;
		if (ch === "}") {
			depth--;
			if (depth === 0) {
				try {
					return JSON.parse(text.slice(start, i + 1)) as Rec;
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}
