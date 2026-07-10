"""Outline generation service.

Flow:
  ctx.params.prompt + slide_count + language
  → DeepInfra chat_json
  → { title, slides: [{ title, bullets[], layout }] }
  → save_result(type=outline) + publish done via SSE
"""
import logging

from services import llm_client
from services.pubsub import publish
from core.db.repository import save_result

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a presentation outline generator. Given a topic/prompt, create a structured slide outline.
Always respond as a JSON object with this exact shape:
{
  "title": "<presentation title>",
  "slides": [
    {
      "title": "<slide title>",
      "bullets": ["<key point 1>", "<key point 2>", "<key point 3>"],
      "layout": "cover" | "section" | "bullets" | "two-column" | "image-text"
    }
  ]
}
Rules:
- First slide MUST be layout "cover" (title slide).
- Last slide should be a closing/thank-you slide.
- Use layout "bullets" for most content slides.
- Each content slide should have 3-5 bullet points, each concise (max 12 words).
- Write ALL content in the user's specified language.
- Make titles engaging and specific, not generic."""

VALID_LAYOUTS = {"cover", "section", "bullets", "two-column", "image-text"}


def process(ctx: dict):
    params = ctx["params"]
    prompt = params.get("prompt", "")
    slide_count = int(params.get("slideCount", params.get("slide_count", 8)))
    language = params.get("language", "Bahasa Indonesia")
    title_hint = params.get("title", "")

    logger.info("[outline_service] prompt=%r slides=%d lang=%s", prompt[:80], slide_count, language)

    user_msg = (
        f"Topic: {prompt}\n"
        f"Number of slides: {slide_count}\n"
        f"Language: {language}\n"
    )
    if title_hint:
        user_msg += f"Suggested title (optional, you may improve it): {title_hint}\n"
    user_msg += "\nGenerate the outline now."

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    raw = llm_client.chat_json(messages, temperature=0.7)

    # Normalize/sanitize the output
    outline = _normalize(raw, slide_count, prompt)

    save_result(ctx["request_id"], ctx["job_id"], "outline", outline)
    publish(ctx["job_id"], {"type": "done", "result": outline, "resultType": "outline"})
    logger.info("[outline_service] selesai | job_id=%s slides=%d", ctx["job_id"], len(outline.get("slides", [])))


def _normalize(raw: dict, slide_count: int, prompt: str) -> dict:
    title = raw.get("title") or prompt[:60] or "Untitled Presentation"
    slides_raw = raw.get("slides") or raw.get("deck") or []

    slides = []
    for i, s in enumerate(slides_raw):
        layout = s.get("layout", "bullets")
        if layout not in VALID_LAYOUTS:
            layout = "bullets"
        bullets = s.get("bullets") or s.get("points") or []
        if isinstance(bullets, str):
            bullets = [bullets]
        slides.append({
            "title": s.get("title") or f"Slide {i + 1}",
            "bullets": [str(b) for b in bullets][:6],
            "layout": layout,
        })

    # Ensure first slide is cover
    if slides and slides[0]["layout"] != "cover":
        slides[0]["layout"] = "cover"

    if not slides:
        slides = [{"title": title, "bullets": [], "layout": "cover"}]

    return {"title": title, "slides": slides}
