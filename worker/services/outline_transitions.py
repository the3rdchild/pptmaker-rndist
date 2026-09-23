"""Per-slide transition planning for the outline (the homepage "Transisi" toggle).

When enabled, the outline model writes one line per slide, directly after its
Visual: line:

    Transition: morph — judul cover mengecil ke pojok kiri atas

meaning how the deck moves INTO that slide and, for morph, what carries across
from the slide before. The FE parses the same line (lib/outline-transition.js),
so the id list and aliases here must match it.
"""
import re

TRANSITION_IDS = ("morph", "fade-black", "fade-white", "slide-left", "slide-right", "none")

_ALIASES = {
    "fade": "fade-black",
    "dissolve": "fade-black",
    "slide": "slide-left",
    "push": "slide-left",
    "magic-move": "morph",
    "cut": "none",
}

# A slide the model left without a line still needs one; a neutral fade reads
# as deliberate where "none" would read as a missing transition.
_DEFAULT_TRANSITION = "fade-black"

_LINE_RE = re.compile(r"^(?:transition|transisi)\s*:\s*(.*)$", re.IGNORECASE)
_ID_THEN_NOTE_RE = re.compile(r"^([a-z][a-z-]*?)(?:\s*[—–:]\s*|\s+-\s+|\s+|$)(.*)$", re.IGNORECASE)
_VISUAL_RE = re.compile(r"^(?:visual|gambar|image)\s*:", re.IGNORECASE)

TRANSITIONS_PROMPT = """

Transitions are ON for this deck. Directly after each slide's Visual: line, add EXACTLY ONE line:
Transition: <id> — <note>
<id> is how the presentation moves INTO that slide, one of: morph, fade-black, fade-white, slide-left, slide-right, none.
- Slide 1 always uses: Transition: none
- Favour morph. Morph animates the elements that appear on both slides from their old position and size to their new ones, so plan consecutive slides that share a visual anchor: the cover title shrinking into the next slide's header, a hero photo sliding from full-bleed to one half, a big number becoming a labelled figure, an accent shape growing into a panel. Aim for morph on roughly half of the slides, including short chains of consecutive morph slides.
- Use fade-black for a new section or a change of mood, and slide-left / slide-right for sequential steps. Never use none after slide 1.
- Write the note in the requested language. For morph it must name the shared element(s) and say concretely how they move or resize (e.g. "judul cover mengecil ke pojok kiri atas, foto bergeser ke separuh kanan"). For other transitions, a few words on why.
- Keep the "Transition:" prefix and the id exactly as written, in English, even when the requested language is not English."""


def normalize_transition_id(raw: str) -> str | None:
    value = (raw or "").strip().lower()
    value = _ALIASES.get(value, value)
    return value if value in TRANSITION_IDS else None


def parse_transition_line(line: str) -> tuple[str, str] | None:
    """(id, note) for a valid Transition line, else None."""
    match = _LINE_RE.match((line or "").strip())
    if not match:
        return None
    parts = _ID_THEN_NOTE_RE.match(match.group(1).strip())
    if not parts:
        return None
    transition = normalize_transition_id(parts.group(1))
    if not transition:
        return None
    return transition, parts.group(2).strip()


def format_transition_line(transition: str, note: str = "") -> str:
    text = " ".join((note or "").split())
    return f"Transition: {transition}" + (f" — {text}" if text else "")


def split_transition_lines(markdown: str) -> tuple[str, dict[int, tuple[str, str]]]:
    """Removes every Transition line, returning the plan by 1-based slide number.

    Run before anything else reads the outline's structure: a transition line
    written above the description would otherwise be taken for the description.
    The first valid line of a slide wins.
    """
    plan: dict[int, tuple[str, str]] = {}
    kept: list[str] = []
    slide = 0
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            slide += 1
        if _LINE_RE.match(stripped):
            parsed = parse_transition_line(stripped)
            if parsed and slide and slide not in plan:
                plan[slide] = parsed
            continue
        kept.append(line)
    result = "\n".join(kept)
    return result + ("\n" if markdown.endswith("\n") else ""), plan


def insert_transition_lines(markdown: str, plan: dict[int, tuple[str, str]]) -> str:
    """Writes exactly one canonical Transition line per slide.

    It goes after the slide's Visual line (else after its first line of copy,
    else under the heading). Slide 1 is always "none" — nothing comes before it.
    """
    lines = markdown.splitlines()
    # 1-based slide number -> index of the line to insert after
    anchors: dict[int, int] = {}
    slide = 0
    heading = -1
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("## "):
            slide += 1
            heading = index
            anchors[slide] = index
            continue
        if not slide or not stripped:
            continue
        if _VISUAL_RE.match(stripped):
            anchors[slide] = index
        elif anchors[slide] == heading and not stripped.startswith(("-", "*", "•", "#")):
            anchors[slide] = index  # the description line

    insert_after = {}
    for number, anchor in anchors.items():
        if number == 1:
            transition, note = "none", ""
        else:
            transition, note = plan.get(number, (_DEFAULT_TRANSITION, ""))
            if transition == "none":
                transition = _DEFAULT_TRANSITION
        insert_after[anchor] = format_transition_line(transition, note)

    output = []
    for index, line in enumerate(lines):
        output.append(line)
        if index in insert_after:
            output.append(insert_after[index])
    result = "\n".join(output)
    return result + ("\n" if markdown.endswith("\n") else "")

