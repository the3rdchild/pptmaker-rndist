// Visual review loop for generated slides.
//
// verify: a rendered slide PNG + what the generator intended → a list of
//         concrete, fixable issues (overflow, awkward truncation, empty boxes,
//         wrong language, ...). Decorative/positional problems are explicitly
//         out of scope — the repair pass can only change TEXT and CHART DATA.
// repair: the current fills + the issues → corrected fills for ONLY the slots
//         that need to change. The client applies them as targeted writes.
//
// Both call the unified provider layer (lib/ai-providers.ts); the provider is
// selectable per call (homepage selector in C.3). Verify requires vision, so
// its provider must support image_url; repair is text-only.

import { callProvider, extractJson, DEFAULT_TEXT_PROVIDER } from "@/lib/ai-providers";

type Rec = Record<string, unknown>;

export interface SlotDescriptor {
  name: string;
  role?: string;
  max_words?: number;
  ideal_words?: number;
}

/** One photo slot on the slide, identified the same way the client patches
 *  it (elementName#occurrenceIndex) so a flagged issue can be routed back to
 *  the exact marker without a second lookup. `hint` is the authored/AI intent
 *  for the slot when one exists — useful context, not the ground truth (the
 *  reviewer judges the actual rendered photo it sees, not the hint). */
export interface PhotoDescriptor {
  name: string;
  hint?: string;
}

export interface ReviewIssue {
  slot: string;
  problem: string;
  /** "image" when `slot` names a PhotoDescriptor (a mismatched/too-generic
   *  photo) rather than a text slot. Defaults to "text" when absent so older
   *  callers/responses keep working. */
  kind?: "text" | "image";
  /** Only set for kind:"image" — a concrete replacement photo prompt tied to
   *  THIS slide's specific concept, so regeneration doesn't need a second
   *  LLM round-trip to figure out what to ask for. */
  suggestedPhotoPrompt?: string;
}

export interface VerifyInput {
  image: string; // data URL PNG
  topic: string;
  language: string;
  slots: SlotDescriptor[];
  fills: { name: string; text?: string }[];
  /** Photo slots on this slide, for image-relevance checking. Omit/empty to
   *  skip image review entirely (the model still won't invent slot names). */
  photos?: PhotoDescriptor[];
  providerId?: string | null;
}

export interface RepairInput {
  language: string;
  slots: SlotDescriptor[];
  fills: { name: string; text?: string }[];
  issues: ReviewIssue[];
  providerId?: string | null;
}

const VERIFY_SYSTEM = `You are a meticulous slide-design reviewer. You receive a RENDERED slide image, the deck's topic, the exact text the generator placed into each named slot, and (when present) a list of the slide's PHOTO slots.

Report problems the generator can fix by rewriting slot text:
- text visibly overflowing its box or clipped
- text truncated with "…" mid-thought
- a large text box holding a comically short fragment (or vice versa: a cramped chip overstuffed)
- leftover placeholder/sample text (lorem, "Your Name", "2024", ...)
- duplicated text across two slots on the same slide
- wrong language (the slide must be in the requested language)
- an empty visible text box
- chart labels/values that are nonsensical for the topic

Also report photo slots (kind:"image") whose picture does not genuinely fit
THIS SLIDE — judge against the slide's own title/text, not just the deck's
broad topic. Flag it when the photo is:
- unrelated or contradictory to what this specific slide is about
- so generic it could illustrate almost any slide in any deck on this topic
  (e.g. a bare "technology" stock shot — server racks, generic circuit board
  close-ups — on a slide about one specific feature or concept)
- the wrong kind of image for the claim (e.g. an abstract graphic where the
  slide clearly wants a real photo of a person/place/object, or vice versa)
A photo that is merely stylistically plain but IS on-topic for this slide is
fine — do not flag for taste, composition, or color alone.

Do NOT report: colors, fonts, positions, spacing, layout taste — those are
the template author's, and nothing can change them here.

Respect each slot's stated budget (max_words/ideal_words): flag text that exceeds max_words, or that is far under ideal_words when the box clearly expects more.

OUTPUT: raw JSON ONLY, no fences, no commentary:
{"issues":[
  {"slot":"<text slot name>","problem":"<one concrete sentence>"},
  {"slot":"<photo name from the photos list>","problem":"<why this photo doesn't fit THIS slide>","kind":"image","suggested_photo_prompt":"<a concrete photo description tied to this slide's specific concept, ready to hand a generator>"}
]}
An empty issues array means the slide passed. Never invent a slot name that wasn't given to you.`;

export async function reviewSlideVisual(input: VerifyInput): Promise<ReviewIssue[]> {
  const userPayload = JSON.stringify({
    topic: input.topic,
    language: input.language,
    slots: input.slots,
    fills: input.fills,
    ...(input.photos && input.photos.length ? { photos: input.photos } : {}),
  });
  const content = await callProvider(
    input.providerId ?? null,
    [
      { role: "system", content: VERIFY_SYSTEM },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: input.image } },
          { type: "text", text: userPayload },
        ],
      },
    ],
    { maxTokens: 12000, vision: true },
  );
  const parsed = extractJson<{ issues?: unknown }>(content);
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  return issues
    .filter((i): i is Rec => Boolean(i) && typeof i === "object")
    .map((i) => ({
      slot: typeof i.slot === "string" ? i.slot : "",
      problem: typeof i.problem === "string" ? i.problem : "",
      kind: i.kind === "image" ? ("image" as const) : ("text" as const),
      suggestedPhotoPrompt:
        typeof i.suggested_photo_prompt === "string" ? i.suggested_photo_prompt : undefined,
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
  const content = await callProvider(
    input.providerId ?? DEFAULT_TEXT_PROVIDER,
    [
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
    ],
    { maxTokens: 12000 },
  );
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
