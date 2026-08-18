"""Outline chat service — conversational revision of one outline slide.

Used by the /outline page's AI chat panel. Unlike agent_service (which decides
tool calls against a finished deck), this one talks about a SLIDE-TO-BE: the
client sends the slide the user is currently previewing plus any text they
selected from the outline, and the model either just replies, or — when asked
to revise — rewrites the WHOLE target slide inside a ```slide fenced block
that the client can apply in place.

Streamed as raw text chunks (same contract as outline_service).
"""
import logging

from services import llm_client
from services.pubsub import publish

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an assistant inside a presentation-outline editor. The user is \
reviewing an AI-generated outline BEFORE the slides are built, and is chatting with you to \
improve one slide at a time.

You are given:
- the deck topic and outline title,
- the slide the user is currently previewing (its number, title, description and bullet points),
- optionally, text fragments the user selected from the outline and added as context.

Rules:
- Answer questions, give suggestions, and discuss in plain text — concise and conversational.
- ONLY when the user asks you to change, rewrite, improve, shorten, expand, or otherwise revise \
the slide's content, output the FULL revised slide in one fenced block, exactly like this:

```slide
<Slide title>
<One-sentence description>
- <bullet point>
- <bullet point>
```

- The ```slide block must contain the COMPLETE slide (title line, one description line, then \
bullets) — never a partial diff. You may add a one-sentence note before the block; nothing after it.
- Never invent facts (statistics, dates, quotes, names) the user didn't provide or ask for explicitly.
- Write in the requested language.
"""

MAX_HISTORY = 10


def _build_context_block(context: dict) -> str:
    lines = []
    topic = context.get("topic")
    if topic:
        lines.append(f"Deck topic: {topic}")
    title = context.get("outlineTitle")
    if title:
        lines.append(f"Outline title: {title}")

    slide = context.get("slide") or {}
    if slide.get("heading"):
        idx = context.get("slideIndex")
        label = f"slide {idx + 1}" if isinstance(idx, int) else "this slide"
        lines.append(f"\nThe user is currently previewing {label}:")
        lines.append(f"Title: {slide.get('heading')}")
        if slide.get("description"):
            lines.append(f"Description: {slide['description']}")
        for bullet in slide.get("bullets") or []:
            if str(bullet).strip():
                lines.append(f"- {bullet}")

    selected = [s for s in (context.get("selectedTexts") or []) if str(s).strip()]
    if selected:
        lines.append("\nText the user selected from the outline:")
        for s in selected:
            lines.append(f"> {s}")

    return "\n".join(lines)


def process(ctx: dict):
    params = ctx["params"]
    message = params.get("message", "")
    language = params.get("language", "Bahasa Indonesia")
    history = params.get("history") or []
    context = params.get("context") or {}
    provider = params.get("model") or params.get("llm_provider")

    logger.info(
        "[outline_chat] len=%d history=%d provider=%r | job_id=%s",
        len(message), len(history), provider, ctx["job_id"],
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": _build_context_block(context)},
    ]
    for turn in history[-MAX_HISTORY:]:
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content})
    messages.append({
        "role": "user",
        "content": f"{message}\n\n(Reply language: {language})",
    })

    if params.get("stream_mode") == "raw":
        full = ""
        for chunk in llm_client.chat_stream(messages, provider=provider, temperature=0.6):
            full += chunk
            publish(ctx["job_id"], {"type": "chunk", "text": chunk})
        publish(ctx["job_id"], {"type": "done"})
        logger.info("[outline_chat] raw stream done | job_id=%s len=%d", ctx["job_id"], len(full))
    else:
        text = llm_client.chat(messages, provider=provider, temperature=0.6)
        from core.db.repository import save_result
        save_result(ctx["request_id"], ctx["job_id"], "outline_chat", {"text": text})
        publish(ctx["job_id"], {"type": "done", "result": {"text": text}, "resultType": "outline_chat"})
        logger.info("[outline_chat] json done | job_id=%s", ctx["job_id"])


# Kept importable for tests: parses the ```slide fenced block out of a reply.
def parse_revision_block(text: str):
    """Returns {heading, description, bullets} when the reply carries a
    ```slide block, else None."""
    import re
    m = re.search(r"```slide\s*\n(.*?)```", text, re.DOTALL)
    if not m:
        return None
    lines = [l.rstrip() for l in m.group(1).strip().split("\n") if l.strip()]
    if not lines:
        return None
    heading = lines[0].strip()
    description = ""
    bullets = []
    for line in lines[1:]:
        stripped = line.strip()
        if stripped.startswith(("- ", "* ", "• ")):
            bullets.append(stripped[2:].strip())
        elif not description:
            description = stripped
        else:
            bullets.append(stripped)
    return {"heading": heading, "description": description, "bullets": bullets}
