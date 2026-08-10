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
