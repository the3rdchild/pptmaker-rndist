// POST /api/fonts/substitute — picks a visually similar Google Font from the
// curated shortlist for each unresolved .pptx font name. Server-side because
// the AI provider keys are server-only, and because the validation that every
// model-chosen name actually is one of the offered options belongs next to
// the call. Falls back to a neutral default rather than ever blocking import.

import { NextResponse } from "next/server";

import { callProvider, extractJson } from "@/lib/ai-providers";
import {
  DEFAULT_FONT_SUBSTITUTE,
  SUBSTITUTE_FONT_FAMILIES,
  SUBSTITUTE_FONTS,
} from "@/lib/fonts/substitute-shortlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FONTS_PER_REQUEST = 64;
type Rec = Record<string, unknown>;

function buildMessages(fonts: string[]) {
  const options = SUBSTITUTE_FONTS.map(
    (f) => `${f.family} (${f.category})`,
  ).join(", ");
  const user = `For each font name in the JSON object below, choose the SINGLE most visually similar font from this list of options, judging by category, weight, era, and overall feel:

Options: ${options}

Return ONLY a JSON object mapping each requested name to exactly one option name (verbatim, including spaces and capitalization). Do not include any other text.

${JSON.stringify(Object.fromEntries(fonts.map((f) => [f, ""])), null, 0)}`;
  return [
    {
      role: "system" as const,
      content:
        "You map arbitrary font names to visually similar Google Fonts. You output strict JSON only — no prose, no code fence. Every value MUST be one of the listed options, copied verbatim.",
    },
    { role: "user" as const, content: user },
  ];
}

/** Strips the model's answer to a clean original→substitute map, dropping any
 *  entry whose value is not an exact, case-sensitive match for one of the
 *  shortlisted families. The model occasionally invents a name or restyles
 *  casing; those are rejected rather than written into the deck. */
function sanitizeSubstitutions(
  parsed: unknown,
  requested: string[],
): Record<string, string> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const source = parsed as Rec;
  const out: Record<string, string> = {};
  for (const original of requested) {
    const value = source[original];
    if (
      typeof value === "string" &&
      SUBSTITUTE_FONT_FAMILIES.has(value) &&
      value !== original
    ) {
      out[original] = value;
    }
  }
  return out;
}

export async function POST(request: Request) {
  let body: { fonts?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fontsRaw = Array.isArray(body.fonts) ? body.fonts : [];
  const fonts = fontsRaw
    .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
    .map((f) => f.trim())
    .slice(0, MAX_FONTS_PER_REQUEST);

  if (fonts.length === 0) {
    return NextResponse.json({ substitutions: {} });
  }

  try {
    const content = await callProvider(
      null,
      buildMessages(fonts),
      { maxTokens: 2000 },
    );
    const parsed = extractJson<Rec>(content);
    const substitutions = parsed
      ? sanitizeSubstitutions(parsed, fonts)
      : {};
    return NextResponse.json({ substitutions });
  } catch (error) {
    // Never block import over a substitution failure. The caller fills in the
    // neutral default for any unresolved name on its own; here we just return
    // what we have (possibly nothing) so the import proceeds.
    console.error("font substitution failed", error);
    return NextResponse.json(
      { substitutions: {}, degraded: true },
      { status: 200 },
    );
  }
}
