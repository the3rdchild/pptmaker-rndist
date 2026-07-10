"""Outline generation service.

Two modes:
  - stream_mode='raw' (PPTist integration): publish markdown text chunks,
    PPTist reads them as raw text stream.
  - default: save result as JSON, publish 'done' for our Next.js outline screen.
"""
import logging

from services import llm_client
from services.pubsub import publish
from core.db.repository import save_result

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a presentation outline generator. Given a topic, create a clear, structured outline in Markdown format.

Format:
# <Presentation Title>
## <Section 1 title>
### <Topic>
- <key point>
- <key point>
## <Section 2 title>
### <Topic>
- <key point>

Rules:
- Start with a # main title.
- Use ## for major sections (aim for 4-6 sections).
- Use ### for subsections within sections.
- Use - bullet points for key talking points under each topic.
- Each section should have 3-5 bullet points.
- Write ALL content in the specified language.
- Be specific and engaging, not generic."""


def process(ctx: dict):
    params = ctx["params"]
    prompt = params.get("prompt") or params.get("content", "")
    slide_count = int(params.get("slideCount", params.get("slide_count", 0)))
    language = params.get("language", "Bahasa Indonesia")
    stream_mode = params.get("stream_mode")

    logger.info("[outline_service] prompt=%r lang=%s stream=%s", prompt[:80], language, stream_mode)

    user_msg = f"Topic: {prompt}\nLanguage: {language}\n"
    if slide_count:
        user_msg += f"Generate approximately {slide_count} slides worth of content.\n"
    user_msg += "\nGenerate the outline now."

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    if stream_mode == "raw":
        # PPTist mode: stream markdown as raw text chunks
        full_text = ""
        for chunk in llm_client.chat_stream(messages, temperature=0.7):
            full_text += chunk
            publish(ctx["job_id"], {"type": "chunk", "text": chunk})

        publish(ctx["job_id"], {"type": "done"})
        logger.info("[outline_service] raw stream done | job_id=%s len=%d", ctx["job_id"], len(full_text))
    else:
        # Our Next.js mode: single JSON result
        text = llm_client.chat(messages, temperature=0.7)
        outline = {"title": text.split("\n")[0].replace("#", "").strip() or prompt[:60], "markdown": text}
        save_result(ctx["request_id"], ctx["job_id"], "outline", outline)
        publish(ctx["job_id"], {"type": "done", "result": outline, "resultType": "outline"})
        logger.info("[outline_service] json done | job_id=%s", ctx["job_id"])
