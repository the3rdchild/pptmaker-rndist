// The outline's per-slide transition line: how the deck moves INTO the slide
// and, for morph, what carries across from the slide before it.
//
//   Transition: morph — judul cover mengecil ke pojok kiri atas
//
// The worker's outline_service writes this line (and normalises it); the
// /outline page edits it and the HTML pipeline reads it. Plain JS so both the
// Next app and the Node pipeline share one parser.

/** @typedef {"none"|"morph"|"fade-black"|"fade-white"|"slide-left"|"slide-right"} TransitionId */

/** Same ids as the editor's SlideTransition, morph first because it is the
 *  one the planner is asked to favour. @type {readonly TransitionId[]} */
export const TRANSITION_IDS = ["morph", "fade-black", "fade-white", "slide-left", "slide-right", "none"];

/** Words a model writes when it means one of the ids. */
const ALIASES = {
  fade: "fade-black",
  dissolve: "fade-black",
  slide: "slide-left",
  push: "slide-left",
  "magic-move": "morph",
  cut: "none",
};

const LINE = /^(?:transition|transisi)\s*:\s*(.*)$/i;
const ID_THEN_NOTE = /^([a-z][a-z-]*?)(?:\s*[—–:]\s*|\s+-\s+|\s+|$)(.*)$/i;

/** @param {string} raw @returns {TransitionId | null} */
export function normalizeTransitionId(raw) {
  const id = String(raw ?? "").trim().toLowerCase();
  const resolved = ALIASES[id] ?? id;
  return TRANSITION_IDS.includes(resolved) ? resolved : null;
}

/** True for a `Transition:` line, whether or not its id is valid — so a
 *  malformed line is never mistaken for slide copy. @param {string} line */
export function isTransitionLine(line) {
  return LINE.test(String(line ?? "").trim());
}

/**
 * @param {string} line
 * @returns {{ transition: TransitionId, note: string } | null} null when the
 *   line is not a transition line or names no known transition.
 */
export function parseTransitionLine(line) {
  const match = String(line ?? "").trim().match(LINE);
  if (!match) return null;
  const parts = match[1].trim().match(ID_THEN_NOTE);
  if (!parts) return null;
  const transition = normalizeTransitionId(parts[1]);
  if (!transition) return null;
  return { transition, note: parts[2].trim() };
}

/** @param {{ transition: TransitionId, note?: string }} value */
export function formatTransitionLine({ transition, note }) {
  const text = String(note ?? "").replace(/\s+/g, " ").trim();
  return `Transition: ${transition}${text ? ` — ${text}` : ""}`;
}
