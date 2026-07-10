"""Single slide generation service (from editor AI modal).

Flow:
  ctx.params.prompt + layout_hint + theme
  → DeepInfra chat_json → semantic slide data
  → layouts.build_slide → single PPTist Slide
  → save_result(type=slide) + publish done via SSE
"""
import logging

from services import llm_client
from services.layouts import build_slide, DEFAULT_THEME, _accent
from services.pubsub import publish
from core.db.repository import save_result

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a single-slide generator for a presentation editor.
Given a user's description, produce ONE slide as JSON:
{
  "title": "<slide title>",
  "bullets": ["<point 1>", "<point 2>", "<point 3>"],
  "layout": "cover" | "section" | "bullets" | "two-column" | "image-text"
}

Rules:
- 3-5 bullet points max, each under 15 words.
- Choose the layout that best fits the content.
- Write in the user's language.
- If the user asks for a title slide, use layout "cover" with no bullets."""


def process(ctx: dict):
    params = ctx["params"]
    prompt = params.get("prompt", "")
    layout_hint = params.get("layoutHint") or params.get("layout_hint", "")
    language = "Bahasa Indonesia"
    theme = params.get("theme") or DEFAULT_THEME

    logger.info("[slide_service] prompt=%r hint=%s", prompt[:80], layout_hint)

    user_msg = f"Language: {language}\n"
    if layout_hint:
        user_msg += f"Preferred layout: {layout_hint}\n"
    user_msg += f"\nRequest: {prompt}\n\nGenerate one slide."

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    raw = llm_client.chat_json(messages, temperature=0.7)

    # Build PPTist slide
    slide = build_slide(raw, theme)

    save_result(ctx["request_id"], ctx["job_id"], "slide", {"slide": slide})
    publish(ctx["job_id"], {
        "type": "done",
        "result": {"slide": slide},
        "resultType": "slide",
    })
    logger.info("[slide_service] selesai | job_id=%s elements=%d",
        ctx["job_id"], len(slide.get("elements", [])))
