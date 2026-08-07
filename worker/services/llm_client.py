"""
Text-LLM client (OpenAI-compatible). Providers are registered in
core/configs/env.py's PROVIDER_CONFIGS ("deepinfra" default, plus "openai"
and "zhipu"). The global default comes from LLM_PROVIDER; any call can
override it per-request via the `provider` kwarg (job params carry it from
the homepage model picker). Image generation (image_client.py) is
unaffected; it always uses DeepInfra.

Endpoint: {base_url}/chat/completions
Supports:
  - chat(messages) → text
  - chat_json(messages, schema_hint) → parsed JSON dict
  - chat_tools(messages, tools) → assistant message with optional tool_calls
"""
import json
import logging

from openai import OpenAI
from core.configs.env import LLM_PROVIDER, PROVIDER_CONFIGS

logger = logging.getLogger(__name__)
logger.info("[llm_client] default provider=%s", LLM_PROVIDER)

_clients: dict[str, OpenAI] = {}


def resolve_provider(provider: str | None) -> tuple[str, str, str, str]:
    """
    Resolve a provider name to (name, api_key, base_url, default_model).
    Unknown or unconfigured names fall back to the global LLM_PROVIDER
    default, so a stale/typo'd request param degrades gracefully instead of
    crashing the job.
    """
    name = (provider or LLM_PROVIDER).strip().lower()
    cfg = PROVIDER_CONFIGS.get(name)
    if not cfg or not cfg[0]:
        if name != LLM_PROVIDER:
            logger.warning(
                "[llm_client] provider %r unknown/tanpa API key — fallback ke %r",
                name, LLM_PROVIDER,
            )
        name = LLM_PROVIDER if PROVIDER_CONFIGS.get(LLM_PROVIDER, ("", "", ""))[0] else "deepinfra"
        cfg = PROVIDER_CONFIGS[name]
    key, base_url, model = cfg
    return name, key, base_url, model


def _client_for(provider: str | None) -> tuple[OpenAI, str]:
    """(client, default_model) for the given provider, clients cached."""
    name, key, base_url, model = resolve_provider(provider)
    client = _clients.get(name)
    if client is None:
        client = OpenAI(api_key=key, base_url=base_url)
        _clients[name] = client
    return client, model




def _thinking_off(provider: str | None) -> dict:
    """extra_body yang mematikan mode reasoning untuk provider reasoning-model
    (Zhipu GLM-4.5). Reasoning bikin time-to-first-token bisa >3 menit pada
    prompt besar (manifest 26 layout) — melampaui idle timeout stream API.
    Provider lain mengabaikan extra_body ini, jadi aman diterapkan selektif."""
    name = (provider or LLM_PROVIDER).strip().lower()
    if name == "zhipu":
        return {"extra_body": {"thinking": {"type": "disabled"}}}
    return {}

def chat_stream(
    messages: list[dict],
    *,
    model: str | None = None,
    provider: str | None = None,
    temperature: float = 0.7,
):
    """Streaming chat completion → yields text chunks as they arrive."""
    client, default_model = _client_for(provider)
    stream = client.chat.completions.create(
        model=model or default_model,
        messages=messages,
        temperature=temperature,
        stream=True,
        **_thinking_off(provider),
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
    resp = client.chat.completions.create(
        model=model or default_model,
        messages=messages,
        temperature=temperature,
        **({"max_tokens": max_tokens} if max_tokens else {}),
        **_thinking_off(provider),
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
    resp = client.chat.completions.create(
        model=model or default_model,
        messages=messages,
        temperature=temperature,
        response_format={"type": "json_object"},
        **_thinking_off(provider),
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
    resp = client.chat.completions.create(
        model=model or default_model,
        messages=messages,
        tools=tools,
        tool_choice="auto",
        temperature=temperature,
        **_thinking_off(provider),
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
