// Visual review loop for generated slides (Kimi vision).
//
// verify: a rendered slide PNG + what the generator intended → a list of
//         concrete, fixable issues (overflow, awkward truncation, empty boxes,
//         wrong language, ...). Decorative/positional problems are explicitly
//         out of scope — the repair pass can only change TEXT and CHART DATA.
// repair: the current fills + the issues → corrected fills for ONLY the slots
//         that need to change. The client applies them as targeted writes.

type Rec = Record<string, unknown>;

export interface SlotDescriptor {
	name: string;
	role?: string;
	max_words?: number;
	ideal_words?: number;
}

export interface ReviewIssue {
	slot: string;
	problem: string;
}

export interface VerifyInput {
	image: string; // data URL PNG
	topic: string;
	language: string;
	slots: SlotDescriptor[];
	fills: { name: string; text?: string }[];
}

export interface RepairInput {
	language: string;
	slots: SlotDescriptor[];
	fills: { name: string; text?: string }[];
	issues: ReviewIssue[];
}

const KIMI_BASE_URL = () => process.env.KIMI_BASE_URL ?? "https://api.kimi.com/coding/v1";
const KIMI_MODEL = () => process.env.KIMI_MODEL ?? "kimi-k2.6";
const KIMI_USER_AGENT = "claude-code/0.1.0";

async function kimiChat(messages: { role: string; content: unknown }[]): Promise<string> {
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
			max_tokens: 12000,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Kimi API ${res.status}: ${text.slice(0, 200)}`);
	}
	const data = (await res.json()) as Rec;
	const content = (data.choices as Rec[] | undefined)?.[0];
	const message = content && (content.message as Rec | undefined)?.content;
	if (typeof message !== "string" || !message.trim()) throw new Error("Kimi returned an empty response");
	return message;
}

/** Extracts the first balanced {...} or [...] JSON value from model output. */
function extractJson<T>(text: string): T | null {
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

const VERIFY_SYSTEM = `You are a meticulous slide-design reviewer. You receive a RENDERED slide image, the deck's topic, and the exact text the generator placed into each named slot.

Report ONLY problems the generator can fix by rewriting slot text:
- text visibly overflowing its box or clipped
- text truncated with "…" mid-thought
- a large text box holding a comically short fragment (or vice versa: a cramped chip overstuffed)
- leftover placeholder/sample text (lorem, "Your Name", "2024", ...)
- duplicated text across two slots on the same slide
- wrong language (the slide must be in the requested language)
- an empty visible text box
- chart labels/values that are nonsensical for the topic

Do NOT report: colors, fonts, positions, spacing, image choices, layout taste — those are the template author's, and nothing can change them here.

Respect each slot's stated budget (max_words/ideal_words): flag text that exceeds max_words, or that is far under ideal_words when the box clearly expects more.

OUTPUT: raw JSON ONLY, no fences, no commentary:
{"issues":[{"slot":"<slot name>","problem":"<one concrete sentence>"}]}
An empty issues array means the slide passed.`;

export async function reviewSlideVisual(input: VerifyInput): Promise<ReviewIssue[]> {
	const userPayload = JSON.stringify({
		topic: input.topic,
		language: input.language,
		slots: input.slots,
		fills: input.fills,
	});
	const content = await kimiChat([
		{ role: "system", content: VERIFY_SYSTEM },
		{
			role: "user",
			content: [
				{ type: "image_url", image_url: { url: input.image } },
				{ type: "text", text: userPayload },
			],
		},
	]);
	const parsed = extractJson<{ issues?: unknown }>(content);
	const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
	return issues
		.filter((i): i is Rec => Boolean(i) && typeof i === "object")
		.map((i) => ({
			slot: typeof i.slot === "string" ? i.slot : "",
			problem: typeof i.problem === "string" ? i.problem : "",
		}))
		.filter((i) => i.slot && i.problem)
		.slice(0, 12);
}

const REPAIR_SYSTEM = `You are fixing presentation slide copy. You receive a slide's current slot fills, each slot's budget, and a reviewer'S issues. Return corrected fills for ONLY the slots named in the issues — every other slot stays as-is (do not include it).

Rules:
- Respect each slot's max_words strictly; aim for ideal_words when stated.
- Write in the requested language.
- No placeholder text, no duplicated text across slots, no raw double quotes inside the copy.

OUTPUT: raw JSON ONLY: {"fills":[{"name":"<slot>","text":"<corrected copy>"}]}`;

export async function repairSlotFills(input: RepairInput): Promise<{ name: string; text: string }[]> {
	const content = await kimiChat([
		{ role: "system", content: REPAIR_SYSTEM },
		{
			role: "user",
			content: JSON.stringify({
				language: input.language,
				slots: input.slots,
				fills: input.fills,
				issues: input.issues,
			}),
		},
	]);
	const parsed = extractJson<{ fills?: unknown }>(content);
	const fills = Array.isArray(parsed?.fills) ? parsed.fills : [];
	return fills
		.filter((f): f is Rec => Boolean(f) && typeof f === "object")
		.map((f) => ({
			name: typeof f.name === "string" ? f.name : "",
			text: typeof f.text === "string" ? f.text : "",
		}))
		.filter((f) => f.name && f.text.trim())
		.slice(0, 20);
}
