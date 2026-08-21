"""Deck generation service — emits a JSONL slide stream.

Two contracts, chosen by whether the request carries a theme `manifest`:

1. MANIFEST-DRIVEN (current). Params include `manifest`: {theme, layouts[]}
   where each layout has id/slide_role/description/items/notes and `slots`
   (name, role, hint, fill_condition, max_words, max_lines). The model picks
   layout ids and writes copy per NAMED slot, STREAMED PER ELEMENT so the
   client can mount the empty layout the instant it's chosen and fill each
   slot live as the tokens arrive:

     {"type":"slide_start","layout_id":"..."}
     {"type":"fill","name":"...","text":"..."}
     {"type":"fill","name":"...","chart":{...}}
     {"type":"slide_end"}

   FE-codebase/components/editor-react/ai-slot-fill.ts applies the fills by
   slot name and enforces the authored budgets/fill conditions client-side.
   The client still accepts the old one-line-per-slide form
   ({"type":"slide","layout_id":"...","fills":[...]}) for backwards compat.

2. LEGACY (fallback, no manifest). The old fixed 5-type AIPPTSlide union,
   mapped mechanically by editor-react/ai-layout-fill.ts.
"""
import json
import logging
import re

from services import llm_client
from services.pubsub import publish

logger = logging.getLogger(__name__)

LEGACY_SYSTEM_PROMPT = """You are a presentation slide generator. Given a markdown outline, produce slides as JSONL (one JSON object per line).

Each line must be one of these types:
- Cover slide: {"type":"cover","data":{"title":"<title>","text":"<subtitle>"}}
- Table of contents: {"type":"contents","data":{"items":["<section1>","<section2>",...]}}
- Section transition: {"type":"transition","data":{"title":"<section>","text":"<brief intro>"}}
- Content slide: {"type":"content","data":{"title":"<slide title>","items":[{"title":"<bullet heading>","text":"<explanation>"}]}}
- End slide: {"type":"end"}

Rules:
- NEVER emit any theme/color line — slide colors come from the template the
  slide is mapped into, not from you. Your output is TEXT CONTENT ONLY.
- Start with a cover slide, then a contents slide listing all sections.
- Before each section's content slides, emit a transition slide.
- Content slides should have 2-4 items each.
- End with {"type":"end"}.
- Write in the specified language.
- Each JSON object must be on its OWN LINE (JSONL format).
- Do NOT wrap in markdown code fences. Output raw JSONL."""

MANIFEST_SYSTEM_PROMPT = """You are the copywriter for a hand-designed presentation template. You do NOT design slides — the template already did. You choose which authored layouts to use and write ONLY the text that goes into their named slots.

You are given a THEME MANIFEST: a list of layouts, plus optional theme_name /
theme_description / theme_tone describing the theme's identity. Each layout has:
- id, optional human-readable name, slide_role (cover/agenda/section/content/closing/...), description
- optional items {min,max,ideal} — how many repeatable cards/bullets it holds
- optional notes from the template author
- slots: named text fields. Each has role, optional hint, fill_condition, and
  hard budgets max_words / max_lines.

Output: JSONL — one JSON object per line. A slide is emitted as a SEQUENCE of lines, in deck order:
{"type":"slide_start","layout_id":"<layout id from the manifest>"}
{"type":"fill","name":"<slot name>","text":"<your copy>"}
... one fill line per slot ...
{"type":"slide_end"}

The client renders each line the moment it arrives: slide_start mounts the empty layout, every fill line types one element in live. So emit the lines of a slide in reading order (headline first, body after) and never buffer a whole slide — stream it element by element.

RULES — violations break the deck:
1. STRUCTURE: first slide uses a "cover" layout; then an "agenda" layout if one exists; a "section" layout before each chapter; 2-5 "content" (or comparison/timeline/process/team/gallery) slides; last slide uses a "closing" layout. Never reuse the same layout id for two slides in a row.
   SLIDE COUNT: when the request states "Slides: N", emit EXACTLY N slides — the user reviewed and approved an outline of exactly that many pages, and every "## " heading in it is a page they expect to see. Do not merge two outline pages into one slide, do not drop the last one, do not add an extra. Only when no count is stated do you choose: aim for 6-9 slides TOTAL, cover and closing included — a tight, dense deck, not a long thin one.
2. SLOTS: fill ONLY slots that exist in the chosen layout, addressed by their EXACT name. If a name appears multiple times in that layout, provide one fill line per occurrence, in order.
3. NO EMPTY SLOTS: choose a layout ONLY when the topic gives you enough material to fill EVERY "always" slot in it — an empty required slot is a broken slide. If you can't fill a layout completely, pick a simpler one; never start a slide you can't finish. Fewer fully-filled slides ALWAYS beat many half-empty ones.
4. BUDGETS: max_words is a HARD ceiling per slot — count your words and never exceed it. But don't just stay under the max: when a slot states ideal_words, AIM for it. A body box authored for a long paragraph looks broken when it gets three words; a headline box looks broken when it gets twenty. Land within a few words of the ideal whenever the material allows.
5. FILL CONDITIONS:
   - "always" — you MUST provide a fill for this slot.
   - any other condition ("optional", "if-quote-available", "if-numeric-data", "if-person-known", "if-date-known", "if-source-known", ...) — provide a fill ONLY when the condition is genuinely met by the topic. NEVER invent quotes, people, dates, statistics, or sources. When the condition isn't met, OMIT the fill line entirely.
6. ITEM COUNTS: for layouts with items {min,max}, fill exactly that many repeated card/bullet slots (the slot names repeat per card — provide one fill line per card, e.g. 3 fill lines named "card_title" for a 3-card layout). Can't write at least min strong items for the topic? Don't use the layout at all.
7. CHARTS: slots with "kind":"chart" are filled with DATA, not prose. Instead of "text", give the fill line a "chart" object:
   {"type":"fill","name":"<slot name>","chart":{"title":"<chart title>","categories":["<label>",...],"series":[{"name":"<series name>","values":[<number>,...]}],"x_axis_title":"...","y_axis_title":"...","source":"..."}}
   - categories and every series' values array MUST have equal length, and match the slot's stated chart shape (chart.categories / chart.series) when given.
   - 4-8 categories is the readable range; 1-3 series.
   - Use REAL figures when the topic supplies them; otherwise plausible, clearly reasonable estimates — never absurd precision (write 42, not 41.8673).
   - "source" is optional — only when a real source is known.
8. VOICE: write in the requested language. Each slot's role and hint tells you the register (a "label" is 1-3 words, a "cta" is an action, a "stat-value" is a bare figure). When the manifest states a theme_tone, write the whole deck in that register.
9. QUOTES: never put a raw double-quote character (") inside your copy — it breaks the JSON. Use “ ” or ' instead.
10. FORMAT: raw JSONL, one object per line, no markdown fences, no commentary. Every slide MUST be closed with {"type":"slide_end"} before the next slide_start.
11. SOURCE DOCUMENT: when the request carries one, it is the ONLY authority on facts. Write the copy from ITS content, ITS terminology and ITS findings — never substitute general knowledge for what it says, and never contradict it. If the document does not support a claim, leave the claim out.
12. DOCUMENT ASSETS: a source document arrives with an inventory of REAL figures and tables lifted out of it, each with an id (fig-1, fig-2, tbl-1, ...). Put one on a slide by filling an IMAGE slot with an asset instead of text:
    {"type":"fill","name":"<image slot name>","asset":"fig-3"}
    - Only the ids listed in the inventory exist. NEVER invent one, never guess a number past the end of the list, and never reuse an id you already placed on an earlier slide.
    - Only IMAGE slots take assets (a slot whose "kind" is "image"). Text slots take text; chart slots take chart data.
    - Place the asset whose caption genuinely matches what the slide says. A figure on the wrong slide is worse than no figure — when nothing fits, omit the asset line and let the slide use a generated photo instead.
    - One asset per image slot, at most two per slide.
    - When the document's figures and tables carry the argument (architecture, results, comparisons), PREFER layouts that have an image slot: a table of results belongs on a slide able to show it."""


def _compact_manifest(manifest: dict) -> dict:
    """Strip the manifest down to what the model needs — layouts with slot
    budgets. Palette/fonts/constraints are design data, not copywriting input."""
    layouts = manifest.get("layouts") if isinstance(manifest, dict) else None
    if not isinstance(layouts, list):
        return {}
    compact = []
    for layout in layouts:
        if not isinstance(layout, dict):
            continue
        entry = {
            "id": layout.get("id"),
            "name": layout.get("name"),
            "slide_role": layout.get("slide_role"),
            "description": layout.get("description"),
            "items": layout.get("items"),
            "notes": layout.get("notes"),
            "slots": [
                {
                    k: v
                    for k, v in {
                        "name": s.get("name"),
                        "kind": s.get("kind"),
                        "role": s.get("role"),
                        "hint": s.get("hint"),
                        "fill_condition": s.get("fill_condition"),
                        "max_words": s.get("max_words"),
                        "max_lines": s.get("max_lines"),
                        "ideal_words": s.get("ideal_words"),
                        "ideal_lines": s.get("ideal_lines"),
                        "chart": s.get("chart"),
                    }.items()
                    if v is not None
                }
                for s in (layout.get("slots") or [])
                if isinstance(s, dict) and s.get("name")
            ],
        }
        compact.append({k: v for k, v in entry.items() if v not in (None, [], "")})
    compact_root = {"theme": manifest.get("id") or manifest.get("theme"), "layouts": compact}
    # Theme identity — the tone/name/description steer the copy's register;
    # palette and constraints stay out (design data, not copywriting input).
    for key in ("name", "description", "tone"):
        value = manifest.get(key)
        if value:
            compact_root[f"theme_{key}"] = value
    return compact_root


def _escape_inner_quotes(s: str) -> str:
    """LLM slip umum: tanda kutip mentah di dalam nilai string
    ("text":"Dia berkata "halo" lalu"). Scan state-machine: sebuah `"` dianggap
    penutup struktural hanya kalau karakter signifikan berikutnya adalah
    : , } atau ] — selain itu dia kutipan dalam-teks dan di-escape."""
    out: list[str] = []
    in_str = False
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if in_str and ch == "\\":
            out.append(s[i:i + 2])
            i += 2
            continue
        if ch == '"':
            if not in_str:
                in_str = True
                out.append(ch)
            else:
                j = i + 1
                while j < n and s[j] in " \t":
                    j += 1
                nxt = s[j] if j < n else ""
                if nxt in ":,}]":
                    in_str = False
                    out.append(ch)
                else:
                    out.append('\\"')
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _sanitize_line(clean: str, job_id: str) -> str | None:
    """Only well-formed JSONL reaches the client — one model slip must not
    silently kill the whole slide client-side. Repairs, in order:
    1. doubled quotes around a quoted phrase ("text":""Air ..."") → typographic
    2. raw inner quotes inside string values → escaped
    Unrepairable lines are skipped and logged (full text, for diagnosis)."""
    try:
        json.loads(clean)
        return clean
    except json.JSONDecodeError:
        pass
    fixed = re.sub(r'":""', '": "“', clean)
    fixed = re.sub(r'""([}\],])', r'”"\1', fixed)
    try:
        json.loads(fixed)
        logger.info("[deck_service] baris JSON direpair (doubled quotes) | job_id=%s", job_id)
        return fixed
    except json.JSONDecodeError:
        pass
    try:
        json.loads(_escape_inner_quotes(clean))
        logger.info("[deck_service] baris JSON direpair (inner quotes) | job_id=%s", job_id)
        return _escape_inner_quotes(clean)
    except json.JSONDecodeError:
        logger.warning("[deck_service] skip baris JSON invalid: %s | job_id=%s", clean, job_id)
        return None


def process(ctx: dict):
    params = ctx["params"]
    outline = params.get("outline") or params.get("content") or ""
    language = params.get("language", "English")
    provider = params.get("model") or params.get("llm_provider")
    manifest = params.get("manifest")
    compact = _compact_manifest(manifest) if isinstance(manifest, dict) else {}
    # Trimmed prose + figure/table inventory of the document the user attached.
    # Assembled client-side (the browser holds the actual image bytes, which
    # never leave it) and passed through untouched, same as the manifest.
    source = params.get("source") or ""
    # Pages the approved outline has. Unlike the outline job's same-named hint
    # this is a hard target: the user already saw and edited those pages, so a
    # deck with fewer is a deck missing content they signed off on.
    slide_count = int(params.get("slideCount") or params.get("slide_count") or 0)

    use_manifest = bool(compact.get("layouts"))
    logger.info(
        "[deck_service] job_id=%s lang=%s provider=%r mode=%s layouts=%d slides=%s",
        ctx["job_id"], language, provider,
        "manifest" if use_manifest else "legacy", len(compact.get("layouts", [])),
        slide_count or "auto",
    )
    if source:
        logger.info("[deck_service] source document attached | chars=%d | job_id=%s", len(source), ctx["job_id"])

    # The document goes AFTER the manifest: the manifest is instruction (what a
    # slide can hold), the document is material (what goes in it), and the
    # closing "generate now" sentence has to stay the last thing the model reads.
    source_block = source + "\n\n" if source else ""
    count_block = f"Slides: {slide_count}\n" if slide_count else ""

    if use_manifest:
        system_prompt = MANIFEST_SYSTEM_PROMPT
        user_msg = (
            f"Language: {language}\n"
            f"{count_block}\n"
            f"Topic: {outline}\n\n"
            f"THEME MANIFEST:\n{json.dumps(compact, ensure_ascii=False)}\n\n"
            f"{source_block}"
            "Choose the layouts and write the slot copy now."
        )
    else:
        system_prompt = LEGACY_SYSTEM_PROMPT
        user_msg = (
            f"Language: {language}\n{count_block}\nOutline:\n{outline}\n\n"
            f"{source_block}"
            "Generate the JSONL slides now."
        )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_msg},
    ]

    # Buffer partial lines (stream may split a JSON across chunks)
    line_buffer = ""
    first_line_logged = False

    def log_first_line(clean: str) -> None:
        nonlocal first_line_logged
        if first_line_logged:
            return
        first_line_logged = True
        logger.info("[deck_service] first_line=%r | job_id=%s", clean, ctx["job_id"])

    for chunk in llm_client.chat_stream(messages, provider=provider, temperature=0.5):
        line_buffer += chunk

        while "\n" in line_buffer:
            line, line_buffer = line_buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            clean = line.replace("```jsonl", "").replace("```json", "").replace("```", "").strip()
            if clean.startswith("{"):
                log_first_line(clean)
                sanitized = _sanitize_line(clean, ctx["job_id"])
                if sanitized:
                    publish(ctx["job_id"], {"type": "chunk", "text": sanitized})

    # Flush remaining buffer
    if line_buffer.strip():
        clean = line_buffer.strip().replace("```jsonl", "").replace("```json", "").replace("```", "").strip()
        if clean.startswith("{"):
            log_first_line(clean)
            sanitized = _sanitize_line(clean, ctx["job_id"])
            if sanitized:
                publish(ctx["job_id"], {"type": "chunk", "text": sanitized})

    publish(ctx["job_id"], {"type": "done"})
    logger.info("[deck_service] done | job_id=%s", ctx["job_id"])
