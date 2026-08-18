// Structured model for the /outline page, plus parse/serialize against the
// markdown contract the worker's outline_service produces:
//
//   # <Presentation Title>
//   ## <Slide title>
//   <one plain-text description sentence>
//   - <key point>
//   - <key point>
//
// The page edits the STRUCTURED model (heading/description/bullets), and the
// markdown is re-serialized only once — when the user clicks "Generate
// Presentation" and the outline travels to the editor as ?prompt=.

export interface OutlinePage {
  id: string;
  heading: string;
  description: string;
  bullets: string[];
}

export interface Outline {
  title: string;
  pages: OutlinePage[];
}

/** Strips common markdown emphasis the model might add anyway (**bold**,
 *  *italic*, `code`) — the editor's deck generator writes its own copy, so
 *  outline text stays plain. */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
}

/** Parses outline markdown into the structured model. Tolerant by design —
 *  it runs on EVERY streamed chunk (so the input is usually truncated
 *  mid-line) and on model output that may drift from the contract:
 *   - text before the first ## is ignored (except the # title),
 *   - the first non-bullet line under a ## becomes the description,
 *     further plain lines are folded into it,
 *   - stray ### subsections become bullets with their title prefixed.
 * Page ids are index-based: stable across re-parses of a growing stream, so
 * React keys and the dnd list don't churn while chunks land. */
export function parseOutline(markdown: string): Outline {
  const outline: Outline = { title: "", pages: [] };
  let current: OutlinePage | null = null;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("## ")) {
      current = {
        id: `page-${outline.pages.length}`,
        heading: stripEmphasis(line.slice(3)),
        description: "",
        bullets: [],
      };
      outline.pages.push(current);
      continue;
    }
    if (line.startsWith("# ")) {
      if (!outline.title) outline.title = stripEmphasis(line.slice(2));
      continue;
    }
    if (!current) continue; // preamble before the first slide

    if (line.startsWith("### ")) {
      current.bullets.push(stripEmphasis(line.slice(4)));
      continue;
    }
    const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      current.bullets.push(stripEmphasis(bulletMatch[1]));
      continue;
    }
    // Plain line inside a slide → description (first one wins, the rest fold in)
    current.description = current.description
      ? `${current.description} ${stripEmphasis(line)}`
      : stripEmphasis(line);
  }

  return outline;
}

/** Serializes back to the worker's markdown contract — this exact text is
 *  what the deck generator receives as its outline. */
export function serializeOutline(outline: Outline): string {
  const parts: string[] = [`# ${outline.title || "Untitled Presentation"}`];
  for (const page of outline.pages) {
    parts.push(`\n## ${page.heading}`);
    if (page.description.trim()) parts.push(page.description.trim());
    for (const bullet of page.bullets) {
      if (bullet.trim()) parts.push(`- ${bullet.trim()}`);
    }
  }
  return parts.join("\n");
}
