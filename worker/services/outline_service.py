"""Outline generation service.

Two modes:
  - stream_mode='raw' (used by the /tools/aippt_outline SSE route): publish
    markdown text chunks as they're generated.
  - default: save result as JSON, publish 'done' for our Next.js outline screen.
"""
import logging
import re
import time

from services import llm_client
from services.outline_transitions import (
    TRANSITIONS_PROMPT,
    insert_transition_lines,
    split_transition_lines,
)
from services.pubsub import publish
from core.db.repository import save_result

logger = logging.getLogger(__name__)

VISUAL_LINE_RE = re.compile(r"^(?:visual|gambar|image)\s*:\s*(.+)$", re.IGNORECASE)
VISUAL_PREFIX_RE = re.compile(r"^(?:visual|gambar|image)\s*:", re.IGNORECASE)

SYSTEM_PROMPT = """You are a presentation outline generator. Given a topic, create a clear, structured outline in Markdown format.

Format:
# <Presentation Title>
## <Slide 1 title>
<one short sentence describing what this slide covers>
Visual: <one concrete sentence describing the image content for this slide>
- <key point>
- <key point>
## <Slide 2 title>
<one short sentence describing what this slide covers>
Visual: <one concrete sentence describing the image content for this slide>
- <key point>
- <key point>

Rules:
- Start with a # main title.
- Use ## for slides (aim for 5-8 slides).
- Put EXACTLY ONE plain-text description sentence directly under each ## slide title — no heading, no bullet, just one sentence.
- Immediately after the description, put EXACTLY ONE line starting with "Visual: ". Describe a concrete, photographable subject: who or what is visible, what they are doing, and the setting. Keep the Visual: prefix exactly as written even when the requested language is not English; write the description after it in the requested language.
- The visual line is image metadata, not slide copy. Avoid abstract concepts, logos, watermarks, typography, charts, UI screenshots, and instructions like "make it attractive".
- Use - bullet points for key talking points under each slide.
- Each slide should have 3-5 bullet points.
- Do NOT use ### subsections.
- Write ALL content in the specified language.
- Be specific and engaging, not generic.

When a SOURCE DOCUMENT is supplied, it replaces your own knowledge as the material:
- Build the outline from the document's actual sections, terms and findings. Do not pad it with general background it does not contain, and never contradict it.
- Follow the document's own argument order unless a clearly better presentation order exists.
- The document lists its figures and tables as [FIGURE fig-N] / [TABLE tbl-N] markers. Do NOT copy those markers into the outline — they are placed later, when the slides are built. Instead, let them tell you which sections carry the visual evidence, and give those sections their own slide."""


def _outline_pages(markdown: str) -> list[dict]:
    """Return slide metadata and insertion points without rewriting copy."""
    lines = markdown.splitlines()
    pages: list[dict] = []
    current = None
    for index, raw_line in enumerate(lines):
        line = raw_line.strip()
        if line.startswith("## "):
            current = {
                "slide": len(pages) + 1,
                "heading": line[3:].strip(),
                "description": "",
                "bullets": [],
                "visual": "",
                "visual_indices": [],
                "insert_after": index,
            }
            pages.append(current)
            continue
        if not current or not line:
            continue
        visual_match = VISUAL_LINE_RE.match(line)
        if VISUAL_PREFIX_RE.match(line):
            current["visual_indices"].append(index)
            if visual_match:
                current["visual"] = " ".join(visual_match.group(1).split())
        elif line.startswith(("- ", "* ", "• ")):
            current["bullets"].append(line[2:].strip())
        elif not line.startswith("#") and not current["description"]:
            current["description"] = line
            current["insert_after"] = index
    return pages


def _fallback_visual(page: dict, topic: str) -> str:
    context = page.get("description") or " ".join(page.get("bullets", [])[:2])
    return " — ".join(
        part for part in (page.get("heading", ""), context) if part
    ) or topic or "Relevant real-world scene"


def ensure_outline_visuals(
    markdown: str,
    *,
    topic: str,
    language: str,
    provider: str | None,
    repair_json=None,
) -> str:
    """AI-fill missing Visual lines while preserving the approved outline copy."""
    pages = _outline_pages(markdown)
    missing = [page for page in pages if not page["visual"]]
    needs_canonicalization = any(len(page["visual_indices"]) != 1 for page in pages)
    if not missing and not needs_canonicalization:
        return markdown
    repair_json = repair_json or llm_client.chat_json

    repair_input = "\n\n".join(
        "\n".join(
            [
                f"Slide {page['slide']}",
                f"Title: {page['heading']}",
                f"Description: {page['description']}",
                *[f"- {bullet}" for bullet in page["bullets"]],
            ]
        )
        for page in missing
    )
    repaired: dict[int, str] = {}
    if missing:
        try:
            response = repair_json(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You create image briefs for presentation slides. Return JSON only as "
                            '{"visuals":[{"slide":1,"visual":"..."}]}. For every supplied slide, '
                            "write one concrete, photographable scene showing who or what is visible, "
                            "what they are doing, and the setting. Do not include text, logos, charts, "
                            "screenshots, or abstract design instructions. Preserve the supplied slide "
                            "numbers and write each visual in the requested language."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Topic: {topic}\nLanguage: {language}\n\n"
                            f"Fill the missing image briefs:\n{repair_input}"
                        ),
                    },
                ],
                provider=provider,
                temperature=0.4,
            )
            allowed_slides = {page["slide"] for page in missing}
            for item in response.get("visuals", []) if isinstance(response, dict) else []:
                if not isinstance(item, dict):
                    continue
                slide = item.get("slide")
                visual = item.get("visual")
                if slide in allowed_slides and isinstance(visual, str) and visual.strip():
                    repaired[slide] = " ".join(visual.split())
        except Exception:
            logger.exception("[outline_service] image-brief repair failed; using contextual fallback")

    insertions = {}
    visual_indices_to_remove = set()
    for page in pages:
        if page["visual"] and len(page["visual_indices"]) == 1:
            continue
        visual = page["visual"] or repaired.get(
            page["slide"], _fallback_visual(page, topic)
        )
        visual_indices_to_remove.update(page["visual_indices"])
        insertions[page["insert_after"]] = visual

    output_lines = []
    for index, line in enumerate(markdown.splitlines()):
        if index in visual_indices_to_remove:
            continue
        output_lines.append(line)
        visual = insertions.get(index)
        if visual:
            output_lines.append(f"Visual: {visual}")
    result = "\n".join(output_lines)
    result += "\n" if markdown.endswith("\n") else ""
    final_pages = _outline_pages(result)
    if any(not page["visual"] or len(page["visual_indices"]) != 1 for page in final_pages):
        raise ValueError("Outline image-brief validation failed")
    return result


def process(ctx: dict):
    params = ctx["params"]
    prompt = params.get("prompt") or params.get("content", "")
    slide_count = int(params.get("slideCount") or params.get("slide_count") or 0)
    language = params.get("language", "Bahasa Indonesia")
    stream_mode = params.get("stream_mode")
    provider = params.get("model") or params.get("llm_provider")
    transitions = bool(params.get("transitions"))

    logger.info("[outline_service] prompt=%r lang=%s stream=%s provider=%r", prompt[:80], language, stream_mode, provider)

    # Trimmed text of the document the user attached, assembled client-side.
    # The FE already folds it into `content` when it sends the outline job, so
    # this only fires for callers that pass it as its own field.
    source = params.get("source") or ""

    user_msg = f"Topic: {prompt}\nLanguage: {language}\n"
    if slide_count:
        user_msg += f"Generate approximately {slide_count} slides worth of content.\n"
    if source:
        user_msg += f"\n{source}\n"
    user_msg += "\nGenerate the outline now."

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT + (TRANSITIONS_PROMPT if transitions else "")},
        {"role": "user", "content": user_msg},
    ]

    # Buffer the outline so every page can be validated before the UI receives
    # it. Heartbeats keep the API's raw-stream idle timer alive without leaking
    # incomplete Markdown that cannot be revised later.
    if stream_mode == "raw":
        publish(ctx["job_id"], {"type": "heartbeat", "phase": "outline"})
        chunks = []
        last_heartbeat = time.monotonic()
        for chunk in llm_client.chat_stream(messages, provider=provider, temperature=0.7):
            chunks.append(chunk)
            now = time.monotonic()
            if now - last_heartbeat >= 15:
                publish(ctx["job_id"], {"type": "heartbeat", "phase": "outline"})
                last_heartbeat = now
        text = "".join(chunks)
        publish(ctx["job_id"], {"type": "heartbeat", "phase": "visual-repair"})
    else:
        text = llm_client.chat(messages, provider=provider, temperature=0.7)
    # Transition lines come out before the visual repair reads the structure
    # (one above a description would pass for it) and go back canonical after.
    # With the toggle off they are dropped even if the model wrote some.
    text, transition_plan = split_transition_lines(text)
    text = ensure_outline_visuals(
        text,
        topic=prompt,
        language=language,
        provider=provider,
    )
    if transitions:
        text = insert_transition_lines(text, transition_plan)

    if stream_mode == "raw":
        publish(ctx["job_id"], {"type": "chunk", "text": text})
        publish(ctx["job_id"], {"type": "done"})
        logger.info("[outline_service] raw stream done | job_id=%s len=%d", ctx["job_id"], len(text))
    else:
        outline = {"title": text.split("\n")[0].replace("#", "").strip() or prompt[:60], "markdown": text}
        save_result(ctx["request_id"], ctx["job_id"], "outline", outline)
        publish(ctx["job_id"], {"type": "done", "result": outline, "resultType": "outline"})
        logger.info("[outline_service] json done | job_id=%s", ctx["job_id"])
