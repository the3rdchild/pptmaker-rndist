// Theme-level auto-label: asks Kimi to author the theme's model-facing
// identity — description + AI guidance (when_to_use / avoid_when / tone /
// keywords) — by looking at ALL of the theme's layouts at once, optionally
// with a few rendered page images as visual ground truth.
//
// The result is written to theme.json (PATCH /api/template-engine/themes) and
// is what the theme-choice step (/api/ai/choose-theme) reads when it picks a
// theme for a deck topic. Palette stays out of scope on purpose: it is design
// data the generator never sees, and it is owned by ThemePaletteEditor.
//
// Lives in lib/ (not in the API route) so the prompt build + sanitize can be
// exercised directly with bun, without a running Next server.

import { callKimiChat, extractJson, type KimiMessage } from "@/lib/templates/kimi";

type Rec = Record<string, unknown>;

export interface AutoLabelThemeLayoutInput {
	id: string;
	name: string | null;
	description: string | null;
	slide_role: string | null;
	topics: string[];
}

export interface AutoLabelThemeRequest {
	theme: {
		id: string;
		name: string;
		description: string;
		ai: {
			when_to_use?: string | null;
			avoid_when?: string | null;
			tone?: string[] | null;
			keywords?: string[] | null;
		} | null;
	};
	layouts: AutoLabelThemeLayoutInput[];
	/** Rendered PNGs of a few pages (data URLs) — the model's ground truth for
	 *  the theme's visual character. Keep it to a handful; they dominate the
	 *  token cost. */
	images?: string[];
}

export interface AutoLabelThemeResult {
	description: string | null;
	when_to_use: string | null;
	avoid_when: string | null;
	tone: string[];
	keywords: string[];
}

export function buildAutoLabelThemeMessages(
	input: AutoLabelThemeRequest,
): KimiMessage[] {
	const system = `You are a presentation-template metadata author. A template engine stores hand-designed THEMES, each a family of slide layouts sharing one visual identity. You are given one theme's current metadata and the summary of every layout it contains (plus, when attached, rendered images of a few pages — treat those as the primary truth for the theme's visual character).

Author the theme-level metadata that two readers depend on:
1. the THEME CHOICE model, which matches a user's deck topic to the right theme using ONLY this metadata (when_to_use / avoid_when / keywords / tone), and
2. the human author browsing the theme picker (name, description).

Return:
- description: 1-2 sentences — what the theme looks and feels like, and who it is for. Mention the visual style (colors, density, mood), not individual layouts.
- when_to_use: one sentence naming the topics, industries and occasions this theme fits (be concrete: "pitch decks, quarterly business reviews, fintech products" — not "professional topics").
- avoid_when: one sentence naming where it would look wrong (e.g. a playful theme must say formal/corporate/legal).
- tone: 2-5 lowercase adjectives for the copy register the deck generator should write in (e.g. "confident", "playful", "minimal").
- keywords: 6-14 short topic tags used for text matching, lowercase, 1-2 words each. Include BOTH English and Indonesian variants when a concept is commonly prompted in Indonesian (e.g. "business" AND "bisnis", "education" AND "pendidikan").

Existing values are provided as context: keep what is good, sharpen what is vague, replace what is wrong. Never mention sample text content from layouts — describe the design system, not the placeholder copy.

OUTPUT: raw JSON ONLY (no markdown fences, no commentary), exactly this shape:
{"description":"...","when_to_use":"...","avoid_when":"...","tone":["..."],"keywords":["..."]}`;

	const payload = JSON.stringify(
		{
			theme: input.theme,
			layouts: input.layouts,
		},
		null,
		0,
	);

	const images = (input.images ?? []).filter(
		(image) => typeof image === "string" && image.startsWith("data:"),
	);
	const userContent: unknown =
		images.length > 0
			? [
					...images.map((image) => ({
						type: "image_url",
						image_url: { url: image },
					})),
					{ type: "text", text: payload },
				]
			: payload;

	return [
		{ role: "system", content: system },
		{ role: "user", content: userContent },
	];
}

function readText(value: unknown, max: number): string | null {
	return typeof value === "string" && value.trim()
		? value.trim().slice(0, max)
		: null;
}

function readTagList(value: unknown, maxItems: number, maxLength: number): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string" || !item.trim()) continue;
		out.push(item.trim().toLowerCase().slice(0, maxLength));
		if (out.length >= maxItems) break;
	}
	return out;
}

/** Drops anything the model invented beyond the authoring schema, and caps
 *  every string so a rambling response can't bloat theme.json. Whatever
 *  survives is safe to merge into the theme's existing metadata. */
export function sanitizeAutoLabelThemeResult(raw: Rec): AutoLabelThemeResult {
	return {
		description: readText(raw.description, 400),
		when_to_use: readText(raw.when_to_use, 300),
		avoid_when: readText(raw.avoid_when, 300),
		tone: readTagList(raw.tone, 6, 24),
		keywords: readTagList(raw.keywords, 16, 32),
	};
}

/** One round trip to Kimi. Throws on HTTP/parse failure — the route maps that
 *  to a 502 the panel can show. */
export async function callKimiAutoLabelTheme(
	input: AutoLabelThemeRequest,
): Promise<AutoLabelThemeResult> {
	const content = await callKimiChat(buildAutoLabelThemeMessages(input), 8000);
	const parsed = extractJson(content);
	if (!parsed) throw new Error("Kimi response was not valid JSON");
	return sanitizeAutoLabelThemeResult(parsed);
}
