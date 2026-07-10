"""Full deck generation service.

Flow:
  ctx.params.outline (approved by user)
  → DeepInfra: enrich each slide's content based on text_density
  → layouts.build_slide for each → full PPTist deck
  → save_result(type=deck) + upsert deck row + publish done via SSE
"""
import logging

from services import llm_client
from services.layouts import build_slide, DEFAULT_THEME, CANVAS_W, CANVAS_H
from services.pubsub import publish
from core.db.repository import save_result, upsert_deck
import uuid

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a presentation content writer. Given an outline (title + bullet points per slide),
expand each slide's content to be richer and more engaging. Preserve the structure and slide count.

Respond as JSON:
{
  "title": "<deck title>",
  "slides": [
    {
      "title": "<slide title>",
      "bullets": ["<expanded point 1>", ...],
      "layout": "<same as input>",
      "subtitle": "<optional, for cover slide>"
    }
  ]
}

Guidelines:
- Expand bullets to be full sentences with specifics, data, or examples.
- Keep each bullet under 20 words.
- For 'cover' layout, add a compelling subtitle.
- Write in the user's language.
- Keep the same number of slides and same layouts."""


def process(ctx: dict):
	params = ctx["params"]
	outline = params.get("outline") or params.get("deck") or {}
	text_density = params.get("textDensity", params.get("text_density", "concise"))
	language = params.get("language", "Bahasa Indonesia")
	title_hint = params.get("title") or outline.get("title", "Untitled Presentation")
	session_id = ctx["session_id"]
	deck_id = ctx.get("deck_id") or uuid.uuid4().hex

	logger.info("[deck_service] outline slides=%d density=%s", len(outline.get("slides", [])), text_density)

	# Ask LLM to enrich the outline
	messages = [
		{"role": "system", "content": SYSTEM_PROMPT},
		{"role": "user", "content": (
			f"Language: {language}\n"
			f"Content density: {text_density}\n\n"
			f"Outline to expand:\n{outline}"
		)},
	]

	try:
		enriched = llm_client.chat_json(messages, temperature=0.6)
	except Exception as e:
		logger.warning("[deck_service] LLM enrichment failed, using raw outline: %s", e)
		enriched = outline

	# Normalize
	enriched_slides = enriched.get("slides", outline.get("slides", []))
	deck_title = enriched.get("title", title_hint)

	# Build PPTist slides via layouts
	pptist_slides = []
	for sd in enriched_slides:
		slide = build_slide(sd, DEFAULT_THEME)
		pptist_slides.append(slide)

	# Full deck payload (matches Presentation type on FE)
	deck_payload = {
		"title": deck_title,
		"width": CANVAS_W,
		"height": CANVAS_H,
		"viewportSize": CANVAS_W,
		"viewportRatio": CANVAS_H / CANVAS_W,
		"theme": DEFAULT_THEME,
		"slides": pptist_slides,
	}

	# Save generation result
	save_result(ctx["request_id"], ctx["job_id"], "deck", {
		"deckId": deck_id,
		"deck": deck_payload,
	})

	# Upsert deck row so FE can load via GET /decks/:id
	upsert_deck(
		deck_id=deck_id,
		session_id=session_id,
		title=deck_title,
		payload=deck_payload,
	)

	# Publish done via SSE
	publish(ctx["job_id"], {
		"type": "done",
		"result": {"deckId": deck_id, "deck": deck_payload},
		"resultType": "deck",
	})
	logger.info("[deck_service] selesai | job_id=%s deck_id=%s slides=%d",
		ctx["job_id"], deck_id, len(pptist_slides))
