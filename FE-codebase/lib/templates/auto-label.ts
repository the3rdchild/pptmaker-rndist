// Auto-label: asks Kimi to author template slot metadata (name, role,
// fill_condition, budgets, layout meta) for a page's text elements.
//
// Lives in lib/ (not in the API route) so the prompt build + response
// sanitize can be exercised directly with bun, without a running Next server.
// The route (app/api/template-engine/auto-label/route.ts) is a thin wrapper.

import {
	SLOT_FILL_CONDITIONS,
	SLOT_ROLES,
	SLIDE_ROLES,
	parseLayoutMeta,
	parseSlotMeta,
	type LayoutMeta,
	type SlotMeta,
} from "@/components/slide-editor/templates/slot-meta";

type Rec = Record<string, unknown>;

export interface AutoLabelElementInput {
	/** Client-side handle — the model echoes it back so the client can match
	 *  results to elements without trusting invented addresses. */
	i: number;
	type: string;
	current_name: string | null;
	sample_text: string | null;
	font_size: number | null;
	box: { x: number; y: number; width: number; height: number } | null;
	current_slot: SlotMeta | null;
	/** Client-measured with the real line-layout engine — the model should
	 *  trust these over its own pixel estimate. */
	measured_max_words?: number | null;
	measured_max_lines?: number | null;
}

export interface AutoLabelRequest {
	theme: { id: string; name: string; description: string };
	layout: { id: string; description: string; meta: LayoutMeta | null };
	elements: AutoLabelElementInput[];
	/** Rendered PNG of the page (data URL) — the model's visual ground truth. */
	image?: string | null;
}

export interface AutoLabelElementResult {
	i: number;
	name?: string;
	slot?: SlotMeta;
}

export interface AutoLabelResult {
	/** Human-readable page name ("Split Cover", "Three Stat Cards") — persisted
	 *  onto the layout so the manifest and the author UI can show it. */
	layout_name: string | null;
	/** One-sentence composition summary — the deck generator reads this when it
	 *  picks a layout, alongside the slot list. */
	layout_description: string | null;
	layout_meta: LayoutMeta | null;
	elements: AutoLabelElementResult[];
}

const KIMI_BASE_URL = () =>
	process.env.KIMI_BASE_URL ?? "https://api.kimi.com/coding/v1";
const KIMI_MODEL = () => process.env.KIMI_MODEL ?? "kimi-k2.6";

/** sk-kimi-* keys are Kimi Code subscription keys: they are only accepted on
 *  api.kimi.com/coding, and that endpoint only authorizes requests carrying a
 *  recognized coding-agent User-Agent. */
const KIMI_USER_AGENT = "claude-code/0.1.0";

function roleDocs(): string {
	return SLOT_ROLES.map((r) => `- ${r.id}: ${r.hint}`).join("\n");
}

function conditionDocs(): string {
	return SLOT_FILL_CONDITIONS.map((c) => `- ${c.id}: ${c.hint}`).join("\n");
}

function slideRoleDocs(): string {
	return SLIDE_ROLES.map((r) => `- ${r.id}: ${r.hint}`).join("\n");
}

export function buildAutoLabelMessages(input: AutoLabelRequest): {
	role: "system" | "user";
	content: unknown;
}[] {
	const system = `You are a presentation-template metadata author. A template engine stores hand-designed slide layouts whose TEXT, CHART and IMAGE CONTAINER elements need authoring metadata so an AI deck generator can later fill them correctly. You are given one layout's elements (text: with sample text, font size, box, and CLIENT-MEASURED budgets; chart: with its type and data shape; image containers: photos clipped into a shape, with their box) and you invent good metadata for each.

You also receive a RENDERED IMAGE of the layout. Treat it as the primary truth for visual hierarchy: which element is the headline, which blocks are repeated cards, which text sits on colored chips or over photos (those must stay short), and whether two boxes overlap.

For EVERY element in the input, return:
- name: snake_case slot name describing its PURPOSE (e.g. "deck_title", "card_body", "stat_value"). Elements that repeat the same role in a card grid SHOULD share one name — the generator fills repeated names in order.
- role: exactly one of the allowed slot roles below.
- hint: one short sentence telling the future generator what belongs here (English, imperative).
- fill_condition: exactly one of the allowed conditions below. Use "always" ONLY for content any deck can supply (headlines, body, bullets). Use the if-* conditions for facts that may not exist (quotes, people, dates, sources, numbers) — the generator MUST NOT invent those.
- prune_if_unfilled: true when leaving this element visible-but-unfilled would look broken (conditional chrome like "Presented by", dates, citations). For "always" slots, omit it.
- max_words / max_lines: start from the element's measured_max_words / measured_max_lines (computed with the real font metrics — trust them). You may TIGHTEN them when the image shows the text must stay shorter (small chip, overlay on photo, overlapping box), but NEVER exceed the measured values.
- ideal_words / ideal_lines: the length that looks BEST in this box, judged from the image and the sample text. A body box authored for a paragraph must get a paragraph-sized ideal; a badge gets 1-2 words. Never above the max.

Also return the page-level identity and layout_meta for the layout as a whole:
- layout_name: short human-readable Title Case name for this page (e.g. "Split Cover", "Three Stat Cards"). Describe the COMPOSITION, not the sample text. 2-5 words.
- layout_description: one sentence describing the composition and when to pick it — the deck generator reads this when choosing a layout. Describe structure ("Full-bleed photo on the left, title stack on the right"), never the sample content.
- layout_meta:
  - slide_role: one of the allowed slide roles below.
  - topics: 2-6 subjects this layout suits.
  - min_items/max_items/ideal_items: for layouts with repeated cards/bullets — how many the grid holds. Omit for single-message layouts (cover/closing/quote).
  - notes: one or two sentences for the future generator (when to pick this layout, what to watch out for).

CHART ELEMENTS (type "chart"): these are filled with DATA by the generator, not prose. For them:
- role MUST be "chart".
- hint: one sentence on what data belongs here (e.g. "Quarterly revenue trend for the topic.").
- fill_condition: usually "if-numeric-data" — charts must not carry invented figures when the topic has none.
- prune_if_unfilled: true when an empty chart frame would look broken on the slide.
- OMIT max_words/max_lines — they don't apply.

IMAGE CONTAINERS (type "image"): photos clipped into a shape — the generator fills them with a GENERATED PHOTO, never text. For them:
- name: snake_case name describing the photo's PURPOSE (e.g. "hero_photo", "team_portrait", "card_photo"). Repeated cards SHOULD share one name.
- hint: one sentence describing the photo that belongs here (subject, orientation, mood — e.g. "Wide landscape shot of misty mountains at sunrise."). This text doubles as the photo-generation prompt, so make it visual.
- fill_condition: "always" — a frame left on its placeholder looks broken. Use "if-image-available" only for shots that are genuinely optional.
- OMIT role, max_words/max_lines and prune_if_unfilled — they don't apply.

ALLOWED SLOT ROLES:
${roleDocs()}

ALLOWED FILL CONDITIONS:
${conditionDocs()}

ALLOWED SLIDE ROLES:
${slideRoleDocs()}

OUTPUT: raw JSON ONLY (no markdown fences, no commentary), exactly this shape:
{"layout_name":"...","layout_description":"...","layout_meta":{"slide_role":"...","topics":["..."],"min_items":2,"max_items":4,"ideal_items":3,"notes":"..."},"elements":[{"i":0,"name":"...","role":"...","hint":"...","fill_condition":"...","prune_if_unfilled":true,"max_words":5,"max_lines":1,"ideal_words":3,"ideal_lines":1}]}
Every input element MUST appear exactly once in "elements", keyed by its "i".`;

	const payload = JSON.stringify(
		{
			theme: input.theme,
			layout: input.layout,
			elements: input.elements.map((el) => ({
				i: el.i,
				type: el.type,
				current_name: el.current_name,
				sample_text: el.sample_text,
				font_size: el.font_size,
				box: el.box,
				current_slot: el.current_slot,
				measured_max_words: el.measured_max_words ?? null,
				measured_max_lines: el.measured_max_lines ?? null,
			})),
		},
		null,
		0,
	);

	// With a page image, the user message becomes a multimodal content array —
	// the model reads the layout visually instead of inferring from boxes alone.
	const userContent: unknown = input.image
		? [
				{ type: "image_url", image_url: { url: input.image } },
				{ type: "text", text: payload },
			]
		: payload;

	return [
		{ role: "system", content: system },
		{ role: "user", content: userContent },
	];
}

/** Extracts the first balanced {...} JSON object from model output that may
 *  carry reasoning prose or code fences around it. */
function extractJson(text: string): Rec | null {
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

const VALID_ROLES = new Set(SLOT_ROLES.map((r) => r.id));
const VALID_CONDITIONS = new Set(SLOT_FILL_CONDITIONS.map((c) => c.id));

/** Drops anything the model invented that the authoring schema doesn't know —
 *  unknown roles/conditions, bogus indexes, negative budgets. Whatever survives
 *  is safe to write straight into the template. */
export function sanitizeAutoLabelResult(raw: Rec): AutoLabelResult {
	const layoutMeta = parseLayoutMeta(raw.layout_meta ?? null);

	const layoutName =
		typeof raw.layout_name === "string" && raw.layout_name.trim()
			? raw.layout_name.trim().slice(0, 80)
			: null;
	const layoutDescription =
		typeof raw.layout_description === "string" && raw.layout_description.trim()
			? raw.layout_description.trim().slice(0, 300)
			: null;

	const out: AutoLabelElementResult[] = [];
	const rawElements = Array.isArray(raw.elements) ? raw.elements : [];
	for (const entry of rawElements) {
		if (!entry || typeof entry !== "object") continue;
		const rec = entry as Rec;
		const i = typeof rec.i === "number" ? rec.i : Number(rec.i);
		if (!Number.isInteger(i) || i < 0) continue;

		const name =
			typeof rec.name === "string" && rec.name.trim()
				? rec.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
				: undefined;

		const slot: SlotMeta = {};
		if (typeof rec.role === "string" && VALID_ROLES.has(rec.role as never)) {
			slot.role = rec.role as SlotMeta["role"];
		}
		if (typeof rec.hint === "string" && rec.hint.trim()) slot.hint = rec.hint.trim().slice(0, 400);
		if (typeof rec.fill_condition === "string" && VALID_CONDITIONS.has(rec.fill_condition as never)) {
			slot.fill_condition = rec.fill_condition as SlotMeta["fill_condition"];
		}
		if (rec.prune_if_unfilled === true) slot.prune_if_unfilled = true;
		const maxWords = Number(rec.max_words);
		if (Number.isFinite(maxWords) && maxWords > 0) slot.max_words = Math.min(Math.round(maxWords), 500);
		const maxLines = Number(rec.max_lines);
		if (Number.isFinite(maxLines) && maxLines > 0) slot.max_lines = Math.min(Math.round(maxLines), 50);
		const idealWords = Number(rec.ideal_words);
		if (Number.isFinite(idealWords) && idealWords > 0) {
			// An ideal above the max is a contradiction — clamp it under.
			slot.ideal_words = Math.min(Math.round(idealWords), slot.max_words ?? 500);
		}
		const idealLines = Number(rec.ideal_lines);
		if (Number.isFinite(idealLines) && idealLines > 0) {
			slot.ideal_lines = Math.min(Math.round(idealLines), slot.max_lines ?? 50);
		}

		out.push({
			i,
			...(name ? { name } : {}),
			...(Object.keys(slot).length > 0 ? { slot } : {}),
		});
	}

	return { layout_name: layoutName, layout_description: layoutDescription, layout_meta: layoutMeta, elements: out };
}

/** One round-trip to Kimi. Throws on HTTP/parse failure — the route maps that
 *  to a 502 the panel can show. */
export async function callKimiAutoLabel(input: AutoLabelRequest): Promise<AutoLabelResult> {
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
			messages: buildAutoLabelMessages(input),
			// Reasoning models burn most of the budget thinking; labeling needs
			// enough headroom for the JSON itself. kimi-k2.6 rejects any
			// temperature other than 1, so it is simply not sent.
			max_tokens: 16000,
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

	const parsed = extractJson(content);
	if (!parsed) throw new Error("Kimi response was not valid JSON");
	return sanitizeAutoLabelResult(parsed);
}
