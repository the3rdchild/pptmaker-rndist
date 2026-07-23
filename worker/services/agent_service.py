"""Agent service — natural-language deck editing via LLM tool-calling.

The LLM never authors slide layout/content directly. It only decides WHICH
action to take and supplies the semantic content (e.g. a font name, or the
text for a new slide) — every action is a thin, deterministic operation that
the client applies via its EXISTING functions (applyFontToAllSlides,
applyPresetTheme, useAIPPT()'s template mapping, store mutations). This
worker is stateless/advisory: it never touches a server-side copy of the
deck, so a bad LLM response can never corrupt the user's presentation — it
just fails to produce a usable action.

Single-turn: one user message -> either a tool call (or several) or a plain
reply. No multi-step agentic loop in v1 (kept simple on purpose).
"""
import json
import logging

from services import llm_client
from services.pubsub import publish

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an assistant embedded in a presentation editor. The user is looking \
at an existing slide deck and gives you natural-language edit requests.

You do NOT write slide layouts, HTML, or raw content placement yourself. You only decide which \
tool to call and supply the semantic content (text, a font name, a color). All visual/layout \
decisions are handled deterministically by the application after your tool call.

If the request doesn't match any tool, or you need clarification, just reply with plain text \
instead of calling a tool.

You will be given a deck summary that includes: the active slide index (activeSlideIndex), and \
for each slide its index, whether it's the active one (isActive), title, element count, and a \
list of element descriptions (e.g. text: "...", chart: bar, table, image, rectangle, etc.).

IMPORTANT context rules:
- When the user says "this slide", "the current slide", or refers to the slide they're viewing, \
use the activeSlideIndex from the summary.
- When the user references a slide by content (e.g. "the slide about pricing"), match it against \
the titles and element descriptions in the summary to find the right slide_index.
- Use slide_index as a 0-based index into the slides array."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "set_font",
            "description": "Change the font family used across all slides in the deck.",
            "parameters": {
                "type": "object",
                "properties": {
                    "font_name": {"type": "string", "description": "e.g. 'Poppins', 'Roboto'"},
                },
                "required": ["font_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_theme",
            "description": "Apply a color theme (background, accent, font color) to all slides.",
            "parameters": {
                "type": "object",
                "properties": {
                    "background": {"type": "string", "description": "Hex color, e.g. '#1a1b2e'"},
                    "accent_color": {"type": "string", "description": "Hex color for theme/accent"},
                    "font_color": {"type": "string", "description": "Hex color for text"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_slide",
            "description": (
                "Add one new content slide at the end of the deck. Supply only the text content "
                "(title + bullet items) — layout, font-fit, and template styling are applied "
                "automatically to match the rest of the deck."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "text": {"type": "string"},
                            },
                            "required": ["title", "text"],
                        },
                    },
                },
                "required": ["title", "items"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_text",
            "description": "Replace the title or body text of a specific existing slide.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slide_index": {"type": "integer", "description": "0-based index"},
                    "target": {"type": "string", "enum": ["title", "content"]},
                    "new_text": {"type": "string"},
                },
                "required": ["slide_index", "target", "new_text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_slide",
            "description": "Delete a slide by its 0-based index.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slide_index": {"type": "integer"},
                },
                "required": ["slide_index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reorder_slide",
            "description": "Move a slide from one position to another (both 0-based).",
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
    {
        "type": "function",
        "function": {
            "name": "create_deck",
            "description": (
                "Generate an entirely new deck from a topic. This triggers the existing "
                "outline+template generation pipeline — you do not author slides yourself."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "insert_formula",
            "description": "Insert a math/LaTeX formula onto an existing slide.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slide_index": {"type": "integer", "description": "0-based index"},
                    "latex": {
                        "type": "string",
                        "description": "TeX source, e.g. 'E = mc^2' or 'x = \\\\frac{-b \\\\pm \\\\sqrt{b^2-4ac}}{2a}'.",
                    },
                },
                "required": ["slide_index", "latex"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "insert_shape",
            "description": "Insert a basic shape onto an existing slide.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slide_index": {"type": "integer", "description": "0-based index"},
                    "shape": {
                        "type": "string",
                        "enum": [
                            "rectangle",
                            "square",
                            "rounded-rectangle",
                            "pill",
                            "ellipse",
                            "circle",
                            "line",
                        ],
                    },
                },
                "required": ["slide_index", "shape"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "insert_icon",
            "description": (
                "Insert an icon onto an existing slide, picked by searching the icon "
                "library for a keyword (e.g. 'rocket', 'chart', 'lightbulb')."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "slide_index": {"type": "integer", "description": "0-based index"},
                    "query": {"type": "string", "description": "Search keyword, e.g. 'rocket'."},
                },
                "required": ["slide_index", "query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_background",
            "description": "Set a slide's background to a solid color or a gradient.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slide_index": {"type": "integer", "description": "0-based index — ignored if apply_to_all is true."},
                    "apply_to_all": {"type": "boolean", "description": "Apply to every slide in the deck."},
                    "style": {"type": "string", "enum": ["solid", "linear", "radial"]},
                    "color": {"type": "string", "description": "Hex color, e.g. '#1a1b2e'."},
                    "color_to": {"type": "string", "description": "Second hex color for a gradient (ignored for solid)."},
                    "angle": {"type": "integer", "description": "Linear gradient angle in degrees (0=left-to-right, 90=top-to-bottom)."},
                },
                "required": ["style", "color"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "regenerate_slide",
            "description": (
                "Replace one existing slide's content and hero image based on a new "
                "instruction (e.g. 'edit slide ini jadi tentang ...'). Picks a new template "
                "layout and fills it — layout/positions/colors are handled deterministically "
                "by the client, you only supply the new text content and an image prompt."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "slide_index": {"type": "integer", "description": "0-based index"},
                    "title": {"type": "string"},
                    "items": {
                        "type": "array",
                        "description": "2-4 bullet points for the new slide content.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "text": {"type": "string"},
                            },
                            "required": ["title", "text"],
                        },
                    },
                    "image_prompt": {
                        "type": "string",
                        "description": "Short visual description for the slide's hero photo.",
                    },
                },
                "required": ["slide_index", "title", "items", "image_prompt"],
            },
        },
    },
]


def process(ctx: dict):
    params = ctx["params"]
    user_message = params.get("message", "")
    deck_summary = params.get("deckSummary")

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Current deck: {json.dumps(deck_summary)}\n\nUser request: {user_message}",
        },
    ]

    logger.info("[agent_service] job_id=%s message=%r", ctx["job_id"], user_message[:120])

    resp_message = llm_client.chat_tools(messages, TOOLS, temperature=0.3)

    tool_calls = getattr(resp_message, "tool_calls", None) or []
    for call in tool_calls:
        try:
            args = json.loads(call.function.arguments)
        except (json.JSONDecodeError, AttributeError):
            args = {}
        action = {"tool": call.function.name, "args": args}
        publish(ctx["job_id"], {"type": "chunk", "text": json.dumps(action)})
        logger.info("[agent_service] action | job_id=%s tool=%s", ctx["job_id"], call.function.name)

    if not tool_calls and getattr(resp_message, "content", None):
        reply = {"tool": "_reply", "args": {"text": resp_message.content}}
        publish(ctx["job_id"], {"type": "chunk", "text": json.dumps(reply)})

    publish(ctx["job_id"], {"type": "done"})
    logger.info("[agent_service] done | job_id=%s", ctx["job_id"])
