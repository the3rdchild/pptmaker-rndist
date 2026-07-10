"""Agentic assistant service (function calling).

Flow:
  ctx.params.message + deck payload
  → DeepInfra chat_tools with defined tools
  → execute tool calls against the deck
  → loop until model stops calling tools (or max 5 iterations)
  → save_result(type=agent) + upsert deck + publish done via SSE

Tools the AI can call:
  - set_font(font_name, target)
  - set_theme(background, accent_color, font_color)
  - update_text(slide_index, element_index, new_text)
  - add_slide(title, bullets, layout)
  - delete_slide(slide_index)
  - reorder_slide(from_index, to_index)
"""
import logging
import copy
import json
import re

from services import llm_client
from services.layouts import build_slide, DEFAULT_THEME
from services.pubsub import publish
from core.db.repository import save_result, upsert_deck

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an AI presentation editing assistant. You help users modify their presentation by calling tools.
You can see the current deck structure. When the user asks for a change, call the appropriate tool(s).
After executing tools, briefly confirm what you changed (1-2 sentences).

The deck is a JSON object with: title, slides[]. Each slide has: elements[] (text/shape/image).
For text elements, the content is HTML. To change text, provide plain text — it will be converted."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "set_font",
            "description": "Change the font family across the presentation or a specific slide.",
            "parameters": {
                "type": "object",
                "properties": {
                    "font_name": {"type": "string", "description": "CSS font-family, e.g. 'Poppins', 'Arial', 'Times New Roman'"},
                    "slide_index": {"type": "integer", "description": "0-based slide index. Omit for all slides."},
                },
                "required": ["font_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_theme",
            "description": "Change the deck's background color and/or accent color.",
            "parameters": {
                "type": "object",
                "properties": {
                    "background": {"type": "string", "description": "Hex color for slide backgrounds, e.g. '#0f172a'"},
                    "accent_color": {"type": "string", "description": "Hex color for accent elements, e.g. '#3b82f6'"},
                    "font_color": {"type": "string", "description": "Hex color for text, e.g. '#f1f5f9'"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_text",
            "description": "Replace the text content of a specific element on a slide.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slide_index": {"type": "integer", "description": "0-based slide index"},
                    "element_index": {"type": "integer", "description": "0-based element index within the slide"},
                    "new_text": {"type": "string", "description": "The new text content (plain text)"},
                },
                "required": ["slide_index", "element_index", "new_text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_slide",
            "description": "Add a new slide at the end of the presentation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                    "layout": {"type": "string", "enum": ["cover", "section", "bullets", "two-column", "image-text"]},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_slide",
            "description": "Delete a slide by index.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slide_index": {"type": "integer", "description": "0-based index of slide to delete"},
                },
                "required": ["slide_index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reorder_slide",
            "description": "Move a slide from one position to another.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_index": {"type": "integer"},
                    "to_index": {"type": "integer"},
                },
                "required": ["from_index", "to_index"],
            },
        },
    },
]


def process(ctx: dict):
    params = ctx["params"]
    message = params.get("message", "")
    deck_id = ctx.get("deck_id") or params.get("deckId")
    deck_payload = params.get("deck") or {}

    # Deep-copy so we mutate freely
    deck = copy.deepcopy(deck_payload)
    if not deck.get("slides"):
        deck["slides"] = []

    # Build a compact summary of the deck for the AI
    summary = _summarize_deck(deck)
    actions = []

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Here is my current deck:\n{summary}\n\nMy request: {message}"},
    ]

    # Agent loop (max 5 tool-call rounds)
    for iteration in range(5):
        assistant_msg = llm_client.chat_tools(messages, TOOLS, temperature=0.4)

        # No tool calls → final response
        if not assistant_msg.tool_calls:
            final_text = assistant_msg.content or "Done."
            break

        # Append assistant message (with tool_calls) to history
        messages.append({
            "role": "assistant",
            "content": assistant_msg.content,
            "tool_calls": [{"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in assistant_msg.tool_calls],
        })

        # Execute each tool call
        for tc in assistant_msg.tool_calls:
            fname = tc.function.name
            try:
                args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                args = {}

            result = _execute_tool(deck, fname, args)
            actions.append({"tool": fname, "args": args, "result": result})
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)})
            logger.info("[agent_service] tool=%s args=%s", fname, args)
    else:
        final_text = "I've made the requested changes."

    # Publish result
    save_result(ctx["request_id"], ctx["job_id"], "agent", {
        "deck": deck,
        "actions": actions,
        "summary": final_text,
        "deckId": deck_id,
    })

    # Update deck row
    if deck_id and ctx.get("session_id"):
        upsert_deck(deck_id, ctx["session_id"], deck.get("title", "Untitled"), deck)

    publish(ctx["job_id"], {
        "type": "done",
        "result": {"deck": deck, "actions": actions, "summary": final_text, "deckId": deck_id},
        "resultType": "agent",
    })
    logger.info("[agent_service] selesai | job_id=%s actions=%d", ctx["job_id"], len(actions))


def _summarize_deck(deck: dict) -> str:
    slides = deck.get("slides", [])
    lines = [f'Title: {deck.get("title", "Untitled")} ({len(slides)} slides)']
    for i, s in enumerate(slides):
        els = s.get("elements", [])
        text_els = [e for e in els if e.get("type") == "text"]
        titles = []
        for te in text_els[:2]:
            plain = re.sub(r'<[^>]+>', '', te.get("content", ""))[:60]
            titles.append(plain)
        lines.append(f'  Slide {i}: {len(els)} elements — {"; ".join(titles)}')
    return "\n".join(lines)


def _execute_tool(deck: dict, name: str, args: dict) -> dict:
    if name == "set_font":
        return _set_font(deck, args)
    elif name == "set_theme":
        return _set_theme(deck, args)
    elif name == "update_text":
        return _update_text(deck, args)
    elif name == "add_slide":
        return _add_slide(deck, args)
    elif name == "delete_slide":
        return _delete_slide(deck, args)
    elif name == "reorder_slide":
        return _reorder_slide(deck, args)
    return {"error": f"unknown tool {name}"}


def _set_font(deck, args):
    font = args.get("font_name", "")
    slide_idx = args.get("slide_index")
    count = 0
    slides = deck.get("slides", [])
    indices = [slide_idx] if slide_idx is not None else range(len(slides))
    for i in indices:
        if i < 0 or i >= len(slides):
            continue
        for el in slides[i].get("elements", []):
            if el.get("type") == "text":
                el["defaultFontName"] = font
                count += 1
            elif el.get("type") == "shape" and el.get("text"):
                el["text"]["defaultFontName"] = font
                count += 1
    return {"changed_elements": count}


def _set_theme(deck, args):
    bg = args.get("background")
    accent = args.get("accent_color")
    font_color = args.get("font_color")
    count = 0
    for s in deck.get("slides", []):
        if bg:
            s["background"] = {"type": "solid", "color": bg}
            count += 1
        for el in s.get("elements", []):
            if el.get("type") == "shape" and accent:
                el["fill"] = accent
            elif el.get("type") == "text" and font_color:
                el["defaultColor"] = font_color
    return {"changed_slides": count, "background": bg, "accent": accent, "font_color": font_color}


def _update_text(deck, args):
    si = args.get("slide_index", -1)
    ei = args.get("element_index", -1)
    new_text = args.get("new_text", "")
    slides = deck.get("slides", [])
    if 0 <= si < len(slides):
        els = slides[si].get("elements", [])
        if 0 <= ei < len(els):
            el = els[ei]
            if el.get("type") == "text":
                fontsize = "18px"
                # try to extract existing font size
                m = re.search(r'font-size:(\d+)px', el.get("content", ""))
                if m:
                    fontsize = m.group(0)
                color = el.get("defaultColor", "#ffffff")
                el["content"] = f'<p style="{fontsize};color:{color};">{new_text}</p>'
                return {"updated": True}
    return {"updated": False, "error": "element not found"}


def _add_slide(deck, args):
    slide = build_slide(args, deck.get("theme", DEFAULT_THEME))
    deck.setdefault("slides", []).append(slide)
    return {"added": True, "slide_id": slide["id"]}


def _delete_slide(deck, args):
    si = args.get("slide_index", -1)
    slides = deck.get("slides", [])
    if 0 <= si < len(slides):
        slides.pop(si)
        return {"deleted": True}
    return {"deleted": False}


def _reorder_slide(deck, args):
    fi = args.get("from_index", -1)
    ti = args.get("to_index", -1)
    slides = deck.get("slides", [])
    if 0 <= fi < len(slides) and 0 <= ti < len(slides):
        s = slides.pop(fi)
        slides.insert(ti, s)
        return {"moved": True}
    return {"moved": False}
