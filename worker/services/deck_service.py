"""Deck generation service — emits AIPPTSlide JSONL stream.

FE-codebase/components/editor-react/map-slide.ts reads the stream line-by-line
and maps each AIPPTSlide to a pre-baked Template V2 layout.

AIPPTSlide contract (matching FE-codebase/components/editor-react/map-slide.ts):
  {"type":"cover","data":{"title":"...","text":"..."}}
  {"type":"contents","data":{"items":["...","..."]}}
  {"type":"transition","data":{"title":"...","text":"..."}}
  {"type":"content","data":{"title":"...","items":[{"title":"...","text":"..."}]}}
  {"type":"end"}
"""
import logging

from services import llm_client
from services.pubsub import publish

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a presentation slide generator. Given a markdown outline, produce slides as JSONL (one JSON object per line).

Each line must be one of these types:
- Cover slide: {"type":"cover","data":{"title":"<title>","text":"<subtitle>"}}
- Table of contents: {"type":"contents","data":{"items":["<section1>","<section2>",...]}}
- Section transition: {"type":"transition","data":{"title":"<section>","text":"<brief intro>"}}
- Content slide: {"type":"content","data":{"title":"<slide title>","items":[{"title":"<bullet heading>","text":"<explanation>"}]}}
- End slide: {"type":"end"}

Rules:
- ALWAYS start with a cover slide, then a contents slide listing all sections.
- Before each section's content slides, emit a transition slide.
- Content slides should have 2-4 items each.
- End with {"type":"end"}.
- Write in the specified language.
- Each JSON object must be on its OWN LINE (JSONL format).
- Do NOT wrap in markdown code fences. Output raw JSONL."""


def process(ctx: dict):
    params = ctx["params"]
    outline = params.get("outline") or params.get("content") or ""
    language = params.get("language", "English")

    logger.info("[deck_service] job_id=%s lang=%s", ctx["job_id"], language)

    user_msg = f"Language: {language}\n\nOutline:\n{outline}\n\nGenerate the JSONL slides now."
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    # Buffer partial lines (stream may split a JSON across chunks)
    line_buffer = ""

    for chunk in llm_client.chat_stream(messages, temperature=0.5):
        line_buffer += chunk

        while "\n" in line_buffer:
            line, line_buffer = line_buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            clean = line.replace("```jsonl", "").replace("```json", "").replace("```", "").strip()
            if clean.startswith("{"):
                publish(ctx["job_id"], {"type": "chunk", "text": clean})

    # Flush remaining buffer
    if line_buffer.strip():
        clean = line_buffer.strip().replace("```jsonl", "").replace("```json", "").replace("```", "").strip()
        if clean.startswith("{"):
            publish(ctx["job_id"], {"type": "chunk", "text": clean})

    publish(ctx["job_id"], {"type": "done"})
    logger.info("[deck_service] done | job_id=%s", ctx["job_id"])
