"""Outline generation service.

Two modes:
  - stream_mode='raw' (used by the /tools/aippt_outline SSE route): publish
    markdown text chunks as they're generated.
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
## <Slide 1 title>
<one short sentence describing what this slide covers>
- <key point>
- <key point>
## <Slide 2 title>
<one short sentence describing what this slide covers>
- <key point>
- <key point>

Rules:
- Start with a # main title.
- Use ## for slides (aim for 5-8 slides).
- Put EXACTLY ONE plain-text description sentence directly under each ## slide title — no heading, no bullet, just one sentence.
- Use - bullet points for key talking points under each slide.
- Each slide should have 3-5 bullet points.
- Do NOT use ### subsections.
- Write ALL content in the specified language.
- Be specific and engaging, not generic.

When a SOURCE DOCUMENT is supplied, it replaces your own knowledge as the material:
- Build the outline from the document's actual sections, terms and findings. Do not pad it with general background it does not contain, and never contradict it.
- Follow the document's own argument order unless a clearly better presentation order exists.
- The document lists its figures and tables as [FIGURE fig-N] / [TABLE tbl-N] markers. Do NOT copy those markers into the outline — they are placed later, when the slides are built. Instead, let them tell you which sections carry the visual evidence, and give those sections their own slide."""


def process(ctx: dict):
    params = ctx["params"]
    prompt = params.get("prompt") or params.get("content", "")
    slide_count = int(params.get("slideCount") or params.get("slide_count") or 0)
    language = params.get("language", "Bahasa Indonesia")
    stream_mode = params.get("stream_mode")
    provider = params.get("model") or params.get("llm_provider")

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
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    if stream_mode == "raw":
        # Stream markdown as raw text chunks (consumed by /tools/aippt_outline)
        full_text = ""
        for chunk in llm_client.chat_stream(messages, provider=provider, temperature=0.7):
            full_text += chunk
            publish(ctx["job_id"], {"type": "chunk", "text": chunk})

        publish(ctx["job_id"], {"type": "done"})
        logger.info("[outline_service] raw stream done | job_id=%s len=%d", ctx["job_id"], len(full_text))
    else:
        text = llm_client.chat(messages, provider=provider, temperature=0.7)
        outline = {"title": text.split("\n")[0].replace("#", "").strip() or prompt[:60], "markdown": text}
        save_result(ctx["request_id"], ctx["job_id"], "outline", outline)
        publish(ctx["job_id"], {"type": "done", "result": outline, "resultType": "outline"})
        logger.info("[outline_service] json done | job_id=%s", ctx["job_id"])
