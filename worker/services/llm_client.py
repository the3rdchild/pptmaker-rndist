"""
Text-LLM client (OpenAI-compatible). Providers are registered in
core/configs/env.py's PROVIDER_CONFIGS ("deepinfra" default, plus "openai"
and "zhipu"). The global default comes from LLM_PROVIDER; any call can
override it per-request via the `provider` kwarg (job params carry it from
the homepage model picker). Image generation (image_client.py) is
unaffected; it always uses DeepInfra.

Endpoint: {base_url}/chat/completions, or {base_url}/responses for providers
configured with api="responses" (the gpt-*-codex models, which the chat
completions endpoint refuses). Callers pass chat-style messages either way.
Supports:
  - chat(messages) → text
  - chat_json(messages, schema_hint) → parsed JSON dict
  - chat_tools(messages, tools) → assistant message with optional tool_calls
"""
import json
import logging
from dataclasses import dataclass

from openai import OpenAI
from core.configs.env import LLM_PROVIDER, PROVIDER_CONFIGS

logger = logging.getLogger(__name__)
logger.info("[llm_client] default provider=%s", LLM_PROVIDER)

_clients: dict[str, OpenAI] = {}


def resolve_provider(provider: str | None) -> tuple[str, dict]:
    """
    Resolve a provider name to (name, config_dict) where config_dict has keys:
    api_key, base_url, model, and optional headers / omit_temperature /
    disable_thinking. Unknown or unconfigured names fall back to the global
    LLM_PROVIDER default, so a stale/typo'd request param degrades gracefully
    instead of crashing the job.
    """
    name = (provider or LLM_PROVIDER).strip().lower()
    cfg = PROVIDER_CONFIGS.get(name)
    if not cfg or not cfg.get("api_key"):
        if name != LLM_PROVIDER:
            logger.warning(
                "[llm_client] provider %r unknown/tanpa API key — fallback ke %r",
                name, LLM_PROVIDER,
            )
        fallback_cfg = PROVIDER_CONFIGS.get(LLM_PROVIDER)
        name = LLM_PROVIDER if (fallback_cfg and fallback_cfg.get("api_key")) else "deepinfra"
        cfg = PROVIDER_CONFIGS[name]
    return name, cfg


def _client_for(provider: str | None) -> tuple[OpenAI, str]:
    """(client, default_model) for the given provider, clients cached."""
    name, cfg = resolve_provider(provider)
    client = _clients.get(name)
    if client is None:
        client = OpenAI(
            api_key=cfg["api_key"],
            base_url=cfg["base_url"],
            default_headers=cfg.get("headers"),
        )
        _clients[name] = client
    return client, cfg["model"]


def _extra_body(provider: str | None) -> dict:
    """Provider-specific request extras, sourced from PROVIDER_CONFIGS flags
    (disable_thinking) so adding a reasoning model is a config edit, not a
    code change here."""
    name, cfg = resolve_provider(provider)
    if cfg.get("disable_thinking"):
        return {"extra_body": {"thinking": {"type": "disabled"}}}
    return {}


def _temperature_kwarg(provider: str | None, temperature: float) -> dict:
    """Some providers (kimi-k2.6) reject any temperature other than 1, so the
    request omits the field entirely when the provider opts out via config."""
    name, cfg = resolve_provider(provider)
    if cfg.get("omit_temperature"):
        return {}
    return {"temperature": temperature}


# ── Responses API (gpt-*-codex) ───────────────────────────────────────────
#
# Codex models are served on /responses only — /chat/completions answers 404
# "Use the v1/responses endpoint instead". The endpoint differs from chat
# completions in every part that matters here, so each call shape below picks
# its branch off `api` in PROVIDER_CONFIGS:
#   - messages -> input, with input_text/input_image content parts
#   - max_tokens -> max_output_tokens ("Unknown parameter: 'max_tokens'")
#   - temperature unsupported at ANY value except the implicit default
#   - tools are flat ({"type","name","parameters"}), not nested under "function"
#   - the reply is an output[] list, mixing reasoning and message items
#
# Reasoning tokens are billed against max_output_tokens, so a budget sized for
# the answer alone comes back empty with status="incomplete". This floor buys
# room for the reasoning pass on top of what the caller asked for.
RESPONSES_MIN_OUTPUT_TOKENS = 4000


def _uses_responses(provider: str | None) -> bool:
    _name, cfg = resolve_provider(provider)
    return cfg.get("api") == "responses"


def _reasoning_kwarg(provider: str | None) -> dict:
    _name, cfg = resolve_provider(provider)
    effort = cfg.get("reasoning_effort")
    return {"reasoning": {"effort": effort}} if effort else {}


def _max_output_tokens_kwarg(max_tokens: int | None) -> dict:
    """Omitted entirely when the caller didn't ask for a cap — deck generation
    streams long JSON and is better served by the model's own default than by
    a floor that could truncate it."""
    if not max_tokens:
        return {}
    return {"max_output_tokens": max(max_tokens, RESPONSES_MIN_OUTPUT_TOKENS)}


def _to_responses_input(messages: list[dict]) -> list[dict]:
    """Chat `messages` -> Responses `input`. Plain string content passes
    through; multimodal part lists get renamed to the Responses vocabulary
    ({"type":"image_url","image_url":{"url":u}} -> {"type":"input_image",
    "image_url":u}, note the bare string url)."""
    out: list[dict] = []
    for m in messages:
        content = m.get("content")
        role = m.get("role", "user")
        if not isinstance(content, list):
            out.append({"role": role, "content": content})
            continue
        parts = []
        for p in content:
            if not isinstance(p, dict):
                continue
            if p.get("type") == "image_url":
                url = p.get("image_url")
                url = url.get("url", "") if isinstance(url, dict) else (url or "")
                parts.append({"type": "input_image", "image_url": url})
            else:
                parts.append({
                    "type": "output_text" if role == "assistant" else "input_text",
                    "text": p.get("text", ""),
                })
        out.append({"role": role, "content": parts})
    return out


def _responses_text(resp) -> str:
    """Visible answer text out of a Responses reply. The SDK's output_text
    convenience property already skips reasoning items; the manual walk is the
    fallback for older SDKs."""
    text = getattr(resp, "output_text", None)
    if text:
        return text
    chunks = []
    for item in getattr(resp, "output", None) or []:
        if getattr(item, "type", None) != "message":
            continue
        for part in getattr(item, "content", None) or []:
            piece = getattr(part, "text", None)
            if piece:
                chunks.append(piece)
    return "".join(chunks)


# chat_tools' callers (agent_service) read the chat-completions message shape:
# `.tool_calls[].function.name/.arguments` and `.content`. The Responses API
# instead returns flat `function_call` items in `output[]`, so the reply is
# adapted back into that shape — the branch stays inside this module and no
# call site has to know which endpoint answered.
@dataclass
class _ToolFunction:
    name: str
    arguments: str


@dataclass
class _ToolCall:
    id: str
    function: _ToolFunction
    type: str = "function"


@dataclass
class _ToolMessage:
    content: str | None
    tool_calls: list[_ToolCall]


def _to_responses_tools(tools: list[dict]) -> list[dict]:
    """Chat tool schema -> Responses tool schema (flattened: the name,
    description and parameters sit on the tool itself, not under "function")."""
    flat = []
    for t in tools:
        fn = t.get("function", t)
        flat.append({
            "type": "function",
            "name": fn.get("name"),
            "description": fn.get("description"),
            "parameters": fn.get("parameters"),
        })
    return flat


def _from_responses_tool_reply(resp) -> _ToolMessage:
    calls = []
    for item in getattr(resp, "output", None) or []:
        if getattr(item, "type", None) != "function_call":
            continue
        calls.append(_ToolCall(
            id=getattr(item, "call_id", "") or getattr(item, "id", ""),
            function=_ToolFunction(
                name=getattr(item, "name", "") or "",
                arguments=getattr(item, "arguments", "") or "{}",
            ),
        ))
    return _ToolMessage(content=_responses_text(resp) or None, tool_calls=calls)


def chat_stream(
    messages: list[dict],
    *,
    model: str | None = None,
    provider: str | None = None,
    temperature: float = 0.7,
):
    """Streaming chat completion → yields text chunks as they arrive."""
    client, default_model = _client_for(provider)
    if _uses_responses(provider):
        stream = client.responses.create(
            model=model or default_model,
            input=_to_responses_input(messages),
            stream=True,
            **_reasoning_kwarg(provider),
        )
        for event in stream:
            # Reasoning summary events carry deltas too — only the visible
            # answer stream is forwarded to the client.
            if getattr(event, "type", None) == "response.output_text.delta":
                delta = getattr(event, "delta", None)
                if delta:
                    yield delta
        return
    stream = client.chat.completions.create(
        model=model or default_model,
        messages=messages,
        stream=True,
        **_temperature_kwarg(provider, temperature),
        **_extra_body(provider),
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


def chat(
    messages: list[dict],
    *,
    model: str | None = None,
    provider: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
) -> str:
    """Plain chat completion → returns assistant text."""
    client, default_model = _client_for(provider)
    if _uses_responses(provider):
        resp = client.responses.create(
            model=model or default_model,
            input=_to_responses_input(messages),
            **_max_output_tokens_kwarg(max_tokens),
            **_reasoning_kwarg(provider),
        )
        return _responses_text(resp)
    resp = client.chat.completions.create(
        model=model or default_model,
        messages=messages,
        **_temperature_kwarg(provider, temperature),
        **({"max_tokens": max_tokens} if max_tokens else {}),
        **_extra_body(provider),
    )
    return resp.choices[0].message.content or ""


def chat_json(
    messages: list[dict],
    *,
    model: str | None = None,
    provider: str | None = None,
    temperature: float = 0.7,
) -> dict:
    """
    Chat completion yang HARUS balik JSON.
    Pakai response_format json_object + instruksi eksplisit di prompt.
    Returns parsed dict.
    """
    client, default_model = _client_for(provider)
    if _uses_responses(provider):
        # json_object format is rejected ("input messages must contain the
        # word 'json'") unless the prompt itself asks for JSON. Every caller
        # here does, but the check keeps a future prompt edit from 400-ing —
        # without the format the model still complies, and _extract_json
        # below cleans up any fence it wraps the object in.
        payload = _to_responses_input(messages)
        wants_json = "json" in json.dumps(payload, default=str).lower()
        resp = client.responses.create(
            model=model or default_model,
            input=payload,
            **({"text": {"format": {"type": "json_object"}}} if wants_json else {}),
            **_reasoning_kwarg(provider),
        )
        content = _responses_text(resp) or "{}"
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            logger.warning("[llm] response bukan JSON murni, coba ekstrak: %s", content[:200])
            return _extract_json(content)
    resp = client.chat.completions.create(
        model=model or default_model,
        messages=messages,
        response_format={"type": "json_object"},
        **_temperature_kwarg(provider, temperature),
        **_extra_body(provider),
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
    provider: str | None = None,
    temperature: float = 0.5,
):
    """
    Chat completion dengan function/tool calling.
    Returns the assistant message object (memiliki .tool_calls kalau model
    memutuskan manggil tool).
    """
    client, default_model = _client_for(provider)
    if _uses_responses(provider):
        resp = client.responses.create(
            model=model or default_model,
            input=_to_responses_input(messages),
            tools=_to_responses_tools(tools),
            tool_choice="auto",
            **_reasoning_kwarg(provider),
        )
        return _from_responses_tool_reply(resp)
    resp = client.chat.completions.create(
        model=model or default_model,
        messages=messages,
        tools=tools,
        tool_choice="auto",
        **_temperature_kwarg(provider, temperature),
        **_extra_body(provider),
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
