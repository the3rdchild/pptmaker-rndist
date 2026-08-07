// Authoring metadata attached to template elements and layouts.
//
// Template V2 already carried a thin version of this (`name`, `max_length`,
// `min_length`, `decorative`) — enough for the old fill-the-blanks pass, but
// not enough for a model to decide WHAT belongs in a slot or whether the slot
// should exist at all for a given deck. Everything here is authored in the
// template engine and travels with the template, and is the payload the
// generator hands the model.

/** What kind of content a text slot expects. Drives both the model's prose
 *  and the fallback behaviour when a slot can't be filled. */
export type SlotRole =
  | "eyebrow"
  | "headline"
  | "subheadline"
  | "body"
  | "bullet"
  | "quote"
  | "attribution"
  | "stat-value"
  | "stat-label"
  | "caption"
  | "cta"
  | "label"
  | "person-name"
  | "person-role"
  | "date"
  | "source"
  | "step-number"
  | "page-number"
  | "chart";

export const SLOT_ROLES: { id: SlotRole; label: string; hint: string }[] = [
  { id: "eyebrow", label: "Eyebrow", hint: "Small label above the headline (section, category)" },
  { id: "headline", label: "Headline", hint: "The slide's main statement" },
  { id: "subheadline", label: "Subheadline", hint: "Supporting line under the headline" },
  { id: "body", label: "Body copy", hint: "Explanatory prose" },
  { id: "bullet", label: "Bullet", hint: "One item in a list" },
  { id: "quote", label: "Quote", hint: "Verbatim quotation — only if a real one exists" },
  { id: "attribution", label: "Attribution", hint: "Who said the quote" },
  { id: "stat-value", label: "Stat value", hint: "A number or figure, e.g. 42% or $1.2M" },
  { id: "stat-label", label: "Stat label", hint: "What the adjacent number measures" },
  { id: "caption", label: "Caption", hint: "Short text describing an image or chart" },
  { id: "cta", label: "Call to action", hint: "What the audience should do next" },
  { id: "label", label: "Label", hint: "Short UI-like label, e.g. a column header" },
  { id: "person-name", label: "Person name", hint: "A person's name" },
  { id: "person-role", label: "Person role", hint: "A person's title or role" },
  { id: "date", label: "Date", hint: "A date or period" },
  { id: "source", label: "Source", hint: "Citation for a figure or claim" },
  { id: "step-number", label: "Step number", hint: "Ordinal in a process, e.g. 01" },
  { id: "page-number", label: "Page number", hint: "Slide's ordinal in the deck — auto-filled by the generator, never written by the model" },
  { id: "chart", label: "Chart data", hint: "Chart element — the generator fills categories + series values from the topic" },
];

/** When a slot should be filled. Anything other than `always` means the
 *  generator may legitimately leave it out — and, if `prune_if_unfilled`,
 *  remove the element instead of leaving placeholder text on the slide. */
export type SlotFillCondition =
  | "always"
  | "optional"
  | "if-numeric-data"
  | "if-quote-available"
  | "if-source-known"
  | "if-person-known"
  | "if-date-known"
  | "if-image-available"
  | "if-items-gte-3"
  | "if-items-gte-5";

export const SLOT_FILL_CONDITIONS: {
  id: SlotFillCondition;
  label: string;
  hint: string;
}[] = [
  { id: "always", label: "Always", hint: "Every deck must supply this" },
  { id: "optional", label: "Optional", hint: "Fill when there is something worth saying" },
  { id: "if-numeric-data", label: "If numeric data", hint: "Only when the source content has real figures" },
  { id: "if-quote-available", label: "If quote available", hint: "Only when a genuine quotation exists — never invent one" },
  { id: "if-source-known", label: "If source known", hint: "Only when a citation is actually known" },
  { id: "if-person-known", label: "If person known", hint: "Only when a named person exists" },
  { id: "if-date-known", label: "If date known", hint: "Only when a real date or period exists" },
  { id: "if-image-available", label: "If image available", hint: "Only when an image can be sourced" },
  { id: "if-items-gte-3", label: "If ≥3 items", hint: "Only when the slide has at least 3 points" },
  { id: "if-items-gte-5", label: "If ≥5 items", hint: "Only when the slide has at least 5 points" },
];

export type SlotMeta = {
  role?: SlotRole | null;
  /** Free-text guidance from the template author, passed to the model verbatim. */
  hint?: string | null;
  fill_condition?: SlotFillCondition | null;
  /** Remove the element entirely when the condition isn't met, instead of
   *  leaving the template's placeholder text visible. */
  prune_if_unfilled?: boolean | null;
  /** Word/line budgets. Models honour these far better than character counts,
   *  which is why they sit alongside Template V2's existing max_length. */
  max_words?: number | null;
  max_lines?: number | null;
  /** The length that looks BEST in the box — a body box authored for a long
   *  paragraph reads broken when it's filled with three words. The generator
   *  should aim near the ideal and never just "stay under the max". */
  ideal_words?: number | null;
  ideal_lines?: number | null;
};

/** What a whole layout is for. The generator picks a theme first, then picks
 *  layouts within it by this role. */
export type SlideRole =
  | "cover"
  | "agenda"
  | "section"
  | "content"
  | "comparison"
  | "quote"
  | "metrics"
  | "chart"
  | "table"
  | "timeline"
  | "process"
  | "team"
  | "gallery"
  | "closing";

export const SLIDE_ROLES: { id: SlideRole; label: string; hint: string }[] = [
  { id: "cover", label: "Cover", hint: "Opening slide — deck title" },
  { id: "agenda", label: "Agenda", hint: "Table of contents / index" },
  { id: "section", label: "Section break", hint: "Transition between chapters" },
  { id: "content", label: "Content", hint: "General body slide" },
  { id: "comparison", label: "Comparison", hint: "Two or more things side by side" },
  { id: "quote", label: "Quote", hint: "Pull quote or testimonial" },
  { id: "metrics", label: "Metrics", hint: "Numeric highlights / KPI tiles" },
  { id: "chart", label: "Chart", hint: "Built around a chart" },
  { id: "table", label: "Table", hint: "Built around a table" },
  { id: "timeline", label: "Timeline", hint: "Events across time" },
  { id: "process", label: "Process", hint: "Ordered steps" },
  { id: "team", label: "Team", hint: "People grid" },
  { id: "gallery", label: "Gallery", hint: "Image-led" },
  { id: "closing", label: "Closing", hint: "Thank you / next steps" },
];

export type LayoutMeta = {
  slide_role?: SlideRole | null;
  /** Subjects this layout suits, e.g. ["product launch", "roadmap"]. */
  topics?: string[] | null;
  /** How many repeatable items (cards, bullets, columns) the layout holds. */
  min_items?: number | null;
  max_items?: number | null;
  ideal_items?: number | null;
  /** Free-text authoring notes handed to the model. */
  notes?: string | null;
};

const SLOT_ROLE_IDS = new Set<string>(SLOT_ROLES.map((r) => r.id));
const SLOT_CONDITION_IDS = new Set<string>(SLOT_FILL_CONDITIONS.map((c) => c.id));
const SLIDE_ROLE_IDS = new Set<string>(SLIDE_ROLES.map((r) => r.id));

function readString(value: unknown, max = 400): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function readPositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), 10_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parses authoring metadata off a raw template element. Returns null when
 *  nothing meaningful was authored, so untouched elements stay byte-identical
 *  through a round trip. */
export function parseSlotMeta(raw: unknown): SlotMeta | null {
  if (!isRecord(raw)) return null;

  const role = readString(raw.role, 40);
  const condition = readString(raw.fill_condition, 40);
  const meta: SlotMeta = {};

  if (role && SLOT_ROLE_IDS.has(role)) meta.role = role as SlotRole;
  const hint = readString(raw.hint, 400);
  if (hint) meta.hint = hint;
  if (condition && SLOT_CONDITION_IDS.has(condition)) {
    meta.fill_condition = condition as SlotFillCondition;
  }
  if (typeof raw.prune_if_unfilled === "boolean") {
    meta.prune_if_unfilled = raw.prune_if_unfilled;
  }
  const maxWords = readPositiveInt(raw.max_words);
  if (maxWords != null) meta.max_words = maxWords;
  const maxLines = readPositiveInt(raw.max_lines);
  if (maxLines != null) meta.max_lines = maxLines;
  const idealWords = readPositiveInt(raw.ideal_words);
  if (idealWords != null) meta.ideal_words = idealWords;
  const idealLines = readPositiveInt(raw.ideal_lines);
  if (idealLines != null) meta.ideal_lines = idealLines;

  return Object.keys(meta).length > 0 ? meta : null;
}

export function parseLayoutMeta(raw: unknown): LayoutMeta | null {
  if (!isRecord(raw)) return null;

  const meta: LayoutMeta = {};
  const slideRole = readString(raw.slide_role, 40);
  if (slideRole && SLIDE_ROLE_IDS.has(slideRole)) {
    meta.slide_role = slideRole as SlideRole;
  }
  if (Array.isArray(raw.topics)) {
    const topics = raw.topics
      .map((topic) => readString(topic, 60))
      .filter((topic): topic is string => Boolean(topic))
      .slice(0, 20);
    if (topics.length > 0) meta.topics = topics;
  }
  const minItems = readPositiveInt(raw.min_items);
  if (minItems != null) meta.min_items = minItems;
  const maxItems = readPositiveInt(raw.max_items);
  if (maxItems != null) meta.max_items = maxItems;
  const idealItems = readPositiveInt(raw.ideal_items);
  if (idealItems != null) meta.ideal_items = idealItems;
  const notes = readString(raw.notes, 600);
  if (notes) meta.notes = notes;

  return Object.keys(meta).length > 0 ? meta : null;
}
