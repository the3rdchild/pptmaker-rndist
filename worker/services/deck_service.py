"""Deck generation service.

Two modes:
  - stream_mode='raw' (PPTist integration): emit AIPPTSlide JSONL chunks,
    PPTist maps them to template slides client-side.
  - default: build full PPTist deck via layouts.py (our Next.js mode).

AIPPTSlide contract (matching editor/src/types/AIPPT.ts):
  {"type":"cover","data":{"title":"...","text":"..."}}
  {"type":"contents","data":{"items":["...","..."]}}
  {"type":"transition","data":{"title":"...","text":"..."}}
  {"type":"content","data":{"title":"...","items":[{"title":"...","text":"..."}]}}
  {"type":"end"}
"""
import json
import logging
import uuid

from services import llm_client
from services.layouts import build_slide, DEFAULT_THEME, CANVAS_W, CANVAS_H
from services.pubsub import publish
from core.db.repository import save_result, upsert_deck

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

SYSTEM_PROMPT_FALLBACK = """Generate a presentation as JSONL. Output one JSON object per line matching these types:
{"type":"cover","data":{"title":"...","text":"..."}}
{"type":"contents","data":{"items":["...","..."]}}
{"type":"transition","data":{"title":"...","text":"..."}}
{"type":"content","data":{"title":"...","items":[{"title":"...","text":"..."}]}}
{"type":"end"}
Start with cover, then contents, then content slides grouped by sections with transitions, end with {"type":"end"}. Write in {lang}. Raw JSONL, no code fences."""


def process(ctx: dict):
    params = ctx["params"]
    stream_mode = params.get("stream_mode")
    language = params.get("language", "Bahasa Indonesia")

    if stream_mode == "raw":
        _process_raw(ctx, params, language)
    else:
        _process_json(ctx, params, language)


def _process_raw(ctx: dict, params: dict, language: str):
    """PPTist mode: stream AIPPTSlide JSONL chunks."""
    outline = params.get("outline") or params.get("content") or ""

    user_msg = f"Language: {language}\n\nOutline:\n{outline}\n\nGenerate the JSONL slides now."
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    logger.info("[deck_service] raw stream | job_id=%s", ctx["job_id"])

    # Buffer to accumulate partial lines (stream may split a JSON across chunks)
    line_buffer = ""

    for chunk in llm_client.chat_stream(messages, temperature=0.5):
        line_buffer += chunk

        # Process complete lines (delimited by \n)
        while "\n" in line_buffer:
            line, line_buffer = line_buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            # Strip markdown code fences if present
            clean = line.replace("```jsonl", "").replace("```json", "").replace("```", "").strip()
            if clean and clean.startswith("{"):
                # Publish each complete JSONL line as a chunk
                publish(ctx["job_id"], {"type": "chunk", "text": clean})

    # Process any remaining buffered text
    if line_buffer.strip():
        clean = line_buffer.strip().replace("```jsonl", "").replace("```json", "").replace("```", "").strip()
        if clean.startswith("{"):
            publish(ctx["job_id"], {"type": "chunk", "text": clean})

    publish(ctx["job_id"], {"type": "done"})
    logger.info("[deck_service] raw stream done | job_id=%s", ctx["job_id"])


def _process_json(ctx: dict, params: dict, language: str):
    """Our Next.js mode: build full PPTist deck via layouts.py."""
    outline = params.get("outline") or {}
    text_density = params.get("textDensity", params.get("text_density", "concise"))
    title_hint = params.get("title") or outline.get("title", "Untitled Presentation")
    session_id = ctx["session_id"]
    deck_id = ctx.get("deck_id") or str(uuid.uuid4())

    logger.info("[deck_service] json mode | outline slides=%d", len(outline.get("slides", [])))

    messages = [
        {"role": "system", "content": "You are a presentation content writer. Expand the outline into richer content. Respond as JSON."},
        {"role": "user", "content": f"Language: {language}\nDensity: {text_density}\n\nOutline:\n{outline}"},
    ]

    try:
        enriched = llm_client.chat_json(messages, temperature=0.6)
    except Exception as e:
        logger.warning("[deck_service] LLM failed: %s", e)
        enriched = outline

    enriched_slides = enriched.get("slides", outline.get("slides", []))
    deck_title = enriched.get("title", title_hint)

    pptist_slides = []
    for sd in enriched_slides:
        slide = build_slide(sd, DEFAULT_THEME)
        pptist_slides.append(slide)

    deck_payload = {
        "title": deck_title,
        "width": CANVAS_W,
        "height": CANVAS_H,
        "viewportSize": CANVAS_W,
        "viewportRatio": CANVAS_H / CANVAS_W,
        "theme": DEFAULT_THEME,
        "slides": pptist_slides,
    }

    save_result(ctx["request_id"], ctx["job_id"], "deck", {"deckId": deck_id, "deck": deck_payload})
    upsert_deck(deck_id, session_id, deck_title, deck_payload)

    publish(ctx["job_id"], {
        "type": "done",
        "result": {"deckId": deck_id, "deck": deck_payload},
        "resultType": "deck",
    })
    logger.info("[deck_service] json done | job_id=%s deck_id=%s", ctx["job_id"], deck_id)
