// Theme choice: given a deck topic, asks Kimi to pick the single best-fitting
// theme using the theme-choice manifest (name / description / when_to_use /
// avoid_when / tone / keywords per theme — the metadata auto-label-theme
// authors). This replaces the old seed-hash assignment as the default, so a
// "ppt bisnis" prompt lands on the business theme instead of a random one.
//
// The answer is advisory: the sanitizer rejects any id that is not in the
// candidate list, and the caller falls back to the deterministic picker when
// the model returns null or the call fails.
//
// Lives in lib/ (not in the API route) so the prompt build + sanitize can be
// exercised directly with bun, without a running Next server.

import { callKimiChat, extractJson, type KimiMessage } from "@/lib/templates/kimi";

type Rec = Record<string, unknown>;

/** One candidate theme, shaped exactly like buildThemeChoiceManifest's output. */
export interface ThemeChoiceCandidate {
	id: string;
	name: string;
	description: string;
	when_to_use?: string;
	avoid_when?: string;
	tone?: string[];
	keywords?: string[];
	slide_count?: number;
	roles?: string[];
}

export interface ChooseThemeRequest {
	topic: string;
	language?: string;
	themes: ThemeChoiceCandidate[];
}

export interface ChooseThemeResult {
	/** null = no theme is a defensible fit; the caller should use its fallback. */
	theme_id: string | null;
	/** One sentence — why this theme fits the topic. Surfaced in the UI. */
	reason: string | null;
}

export function buildChooseThemeMessages(
	input: ChooseThemeRequest,
): KimiMessage[] {
	const system = `You are the theme selector for an AI presentation generator. You are given a deck topic and a list of candidate THEMES, each with:
- name, description — the theme's identity and visual character
- when_to_use — the topics and occasions the theme was designed for
- avoid_when — where the theme would look wrong
- tone, keywords — matching hints
- slide_count, roles — what the theme can express (a theme without a "closing" role can't close a deck properly)

Pick the ONE theme that best fits the topic. Judge fit by when_to_use / avoid_when FIRST — a theme whose avoid_when covers this topic is wrong even when its keywords match. Prefer a theme explicitly designed for the topic's domain over a generic one. Use slide_count and roles as a tiebreaker: a theme that can only express a few slide shapes makes a thin deck.

Return theme_id EXACTLY as listed, or null when no theme is a defensible fit (an empty or nonsensical topic, or every candidate's avoid_when applies). Never invent an id.

Also return reason: ONE short sentence in the deck's language explaining the pick for the user ("Tema ini memang dirancang untuk laporan bisnis formal.").

OUTPUT: raw JSON ONLY (no markdown fences, no commentary), exactly this shape:
{"theme_id":"<one of the listed ids, or null>","reason":"..."}`;

	const payload = JSON.stringify(
		{
			topic: input.topic,
			language: input.language ?? "English",
			themes: input.themes,
		},
		null,
		0,
	);

	return [
		{ role: "system", content: system },
		{ role: "user", content: payload },
	];
}

/** Only a real candidate id survives — the model's pick is advisory, so an
 *  invented or mistyped id must degrade to "no choice" (→ caller's fallback),
 *  never to a wrong theme. */
export function sanitizeChooseThemeResult(
	raw: Rec,
	validIds: string[],
): ChooseThemeResult {
	const valid = new Set(validIds);
	const themeId =
		typeof raw.theme_id === "string" && valid.has(raw.theme_id)
			? raw.theme_id
			: null;
	const reason =
		typeof raw.reason === "string" && raw.reason.trim()
			? raw.reason.trim().slice(0, 300)
			: null;
	return { theme_id: themeId, reason: themeId ? reason : null };
}

/** One round trip to Kimi. Throws on HTTP/parse failure — the route maps that
 *  to a 502; the client treats any failure as "no choice" and falls back. */
export async function callKimiChooseTheme(
	input: ChooseThemeRequest,
): Promise<ChooseThemeResult> {
	const content = await callKimiChat(buildChooseThemeMessages(input), 4000);
	const parsed = extractJson(content);
	if (!parsed) throw new Error("Kimi response was not valid JSON");
	return sanitizeChooseThemeResult(
		parsed,
		input.themes.map((theme) => theme.id),
	);
}
