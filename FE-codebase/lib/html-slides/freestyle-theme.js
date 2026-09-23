// An AI-designed HTML theme, for decks whose user picked none on /outline.
//
// The model invents the whole visual system — palette, font pair, effects,
// art direction and a layout recipe per slide role — but it has to hand it
// back as a theme RECORD that passes the same parseHtmlTheme every saved theme
// passes. That keeps the two things the pipeline stands on: locked tokens (so
// independent per-slide calls still read as one deck) and a finite CSS surface
// the DOM extractor can map back. The freedom is in the choices, not in the
// contract.

import {
  BACKGROUND_IMAGE_MODES,
  DECORATIONS,
  GOOGLE_FONT_FAMILIES,
  HTML_THEME_COLOR_KEYS,
  HTML_THEME_COMPOSITIONS,
  HTML_THEME_EFFECTS,
  HTML_THEME_ROLES,
  REGION_EMPHASIS,
  REGION_KINDS,
  REGION_PLACEMENTS,
  parseHtmlTheme,
} from "../html-themes/schema.js";
import { themeContrastProblems } from "../html-themes/contrast.js";
import { chat } from "./llm-client.js";

/** A generated theme never carries a locked background image — there is no
 *  asset to lock to — so only these two modes are offered. */
const FREESTYLE_BACKGROUND_MODES = BACKGROUND_IMAGE_MODES.filter((mode) => mode !== "locked");

const MAX_REPAIRS = 2;

const list = (values) => values.map((value) => `"${value}"`).join(" | ");

export function buildFreestyleThemePrompt(outline, repairFeedback = "") {
  const slides = outline.slides
    .map((slide, index) => `${index + 1}. [${slide.role}] ${slide.heading}`)
    .join("\n");
  const effects = Object.entries(HTML_THEME_EFFECTS)
    .map(([key, values]) => `    "${key}": ${list(values)}`)
    .join(",\n");

  return `You are an art director designing the visual system for ONE presentation.
Invent a distinctive look that fits THIS topic — its subject, audience and mood.
Avoid the generic corporate look (navy + purple gradient, stock blue) unless the
topic genuinely calls for it. Commit to one clear idea and carry it through.

DECK: "${outline.title}"
SLIDES:
${slides}

Reply with ONLY one JSON object (no fences, no commentary) in exactly this shape:
{
  "name": "<2-4 word evocative theme name>",
  "description": "<one sentence: the visual idea and why it fits the topic>",
  "backgroundImageMode": ${list(FREESTYLE_BACKGROUND_MODES)},
  "colors": { ${HTML_THEME_COLOR_KEYS.map((key) => `"${key}": "#RRGGBB"`).join(", ")} },
  "typography": {
    "headingFont": <one of the fonts below>,
    "bodyFont": <one of the fonts below>,
    "scale": "compact" | "balanced" | "expressive"
  },
  "effects": {
${effects}
  },
  "guidance": {
    "artDirection": "<2-4 sentences: the motif, how space, colour and imagery are used>",
    "dos": ["<short rule>", "..."],
    "donts": ["<short rule>", "..."]
  },
  "recipes": [
    {
      "id": "<lowercase-slug>",
      "name": "<short name>",
      "roles": [<one or more of ${list(HTML_THEME_ROLES)}>],
      "composition": ${list(HTML_THEME_COMPOSITIONS)},
      "description": "<one sentence>",
      "regions": [{ "kind": ${list(REGION_KINDS)}, "placement": ${list(REGION_PLACEMENTS)}, "emphasis": ${list(REGION_EMPHASIS)} }],
      "decorations": [<zero or more of ${list(DECORATIONS)}>],
      "instructions": "<1-3 sentences of concrete layout direction for this recipe>"
    }
  ]
}

FONTS (use these exact names, nothing else):
${GOOGLE_FONT_FAMILIES.join(", ")}

RULES:
- Colours are six-digit hex. "text" must read clearly on both "background" and
  "surface" (contrast at least 4.5:1); "muted" at least 3:1 on both.
- Pair a characterful heading font with a highly readable body font.
- 6 to 9 recipes. Together they must cover the roles "cover", "content" and
  "closing", and every role used in SLIDES above. Give "content" at least two
  recipes with different compositions so consecutive slides do not repeat.
- At most 8 regions per recipe. Recipe ids are unique lowercase slugs.
- Choose "generated" background images only for an image-led, atmospheric
  topic; otherwise "none".
- dos and donts: at most 6 short items each.
${repairFeedback ? `\nYOUR PREVIOUS ANSWER WAS REJECTED — fix exactly this and keep everything else:\n${repairFeedback}\n` : ""}`;
}

function slug(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "theme";
}

function parseReply(text) {
  const cleaned = String(text ?? "").replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The reply did not contain a JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Completes the model's draft with the fields it is not asked for, then runs
 *  the full theme validation. Throws with the validator's message. */
export function themeFromDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new Error("The theme must be a JSON object.");
  }
  const theme = parseHtmlTheme({
    ...draft,
    schemaVersion: 1,
    id: `ai-${slug(draft.name)}`,
    previewUrl: null,
    backgroundImageUrl: null,
    updatedAt: null,
  });
  const problems = themeContrastProblems(theme.colors);
  if (problems.length) throw new Error(problems.join("\n"));
  return theme;
}

/**
 * Designs a validated theme for the outline. Validation errors go back to the
 * model as repair feedback; after MAX_REPAIRS the last error is thrown so the
 * caller can fall back to a saved theme.
 */
export async function designFreestyleTheme({ outline, provider, signal }) {
  let feedback = "";
  for (let attempt = 0; ; attempt += 1) {
    const reply = await chat({
      provider,
      prompt: buildFreestyleThemePrompt(outline, feedback),
      maxTokens: 3500,
      temperature: 0.9,
      signal,
    });
    try {
      return themeFromDraft(parseReply(reply.text));
    } catch (error) {
      feedback = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_REPAIRS) throw new Error(`AI theme design failed: ${feedback}`);
    }
  }
}
