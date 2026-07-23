"""
Text-LLM client (OpenAI-compatible). Provider is chosen by LLM_PROVIDER
("deepinfra" default, or "openai") — see core/configs/env.py. Image
generation (image_client.py) is unaffected; it always uses DeepInfra.

Endpoint: {LLM_BASE_URL}/chat/completions
Supports:
  - chat(messages) → text
  - chat_json(messages, schema_hint) → parsed JSON dict
  - chat_tools(messages, tools) → assistant message with optional tool_calls
"""
import json
import logging

from openai import OpenAI
from core.configs.env import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_PROVIDER

logger = logging.getLogger(__name__)
logger.info("[llm_client] provider=%s model=%s", LLM_PROVIDER, LLM_MODEL)

_client = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)


def chat_stream(
    messages: list[dict],
    *,
    model: str | None = None,
    temperature: float = 0.7,
):
    """Streaming chat completion → yields text chunks as they arrive."""
    stream = _client.chat.completions.create(
        model=model or LLM_MODEL,
        messages=messages,
        temperature=temperature,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


def chat(
    messages: list[dict],
    *,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
) -> str:
    """Plain chat completion → returns assistant text."""
    resp = _client.chat.completions.create(
        model=model or LLM_MODEL,
        messages=messages,
        temperature=temperature,
        **({"max_tokens": max_tokens} if max_tokens else {}),
    )
    return resp.choices[0].message.content or ""


def chat_json(
    messages: list[dict],
    *,
    model: str | None = None,
    temperature: float = 0.7,
) -> dict:
    """
    Chat completion yang HARUS balik JSON.
    Pakai response_format json_object + instruksi eksplisit di prompt.
    Returns parsed dict.
    """
    resp = _client.chat.completions.create(
        model=model or LLM_MODEL,
        messages=messages,
        temperature=temperature,
        response_format={"type": "json_object"},
    )
    content = resp.choices[0].message.content or "{}"
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Fallback: coba ekstrak JSON dari teks (model kadang bungkus di ```json)
        logger.warning("[llm] response bukan JSON murni, coba ekstrak: %s", content[:200])
        return _extract_json(content)


def chat_tools(
    messages: list[dict],
    tools: list[dict],
    *,
    model: str | None = None,
    temperature: float = 0.5,
):
    """
    Chat completion dengan function/tool calling.
    Returns the assistant message object (memiliki .tool_calls kalau model
    memutuskan manggil tool).
    """
    resp = _client.chat.completions.create(
        model=model or LLM_MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto",
        temperature=temperature,
    )
    return resp.choices[0].message


def _extract_json(text: str) -> dict:
    """Best-effort ekstrak JSON object dari teks yang dibungkus code fence dll."""
    import re
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    return {}
