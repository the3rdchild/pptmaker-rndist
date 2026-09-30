from types import SimpleNamespace as Obj

from services import llm_client


def test_openrouter_presets_and_legacy_fallback(monkeypatch):
    expected = {
        "openrouter-gpt-sol": "openai/gpt-6-sol",
        "openrouter-deepseek-flash": "deepseek/deepseek-v4-flash-0731",
        "openrouter-gemini-flash": "google/gemini-3-flash-preview",
        "openrouter-claude-sonnet": "anthropic/claude-sonnet-5.5",
    }
    assert {name: config["model"] for name, config in llm_client.PROVIDER_CONFIGS.items()} == expected
    for config in llm_client.PROVIDER_CONFIGS.values():
        monkeypatch.setitem(config, "api_key", "local-test")
    assert llm_client.resolve_provider("codebuddy")[0] == "openrouter-gpt-sol"


def test_openrouter_chat_uses_nonstreaming_completion(monkeypatch):
    requests = []

    def create(**kwargs):
        requests.append(kwargs)
        return Obj(choices=[Obj(message=Obj(content="OK"))])

    client = Obj(chat=Obj(completions=Obj(create=create)))
    monkeypatch.setattr(llm_client, "_client_for", lambda provider: (client, "openai/gpt-6-sol"))
    assert llm_client.chat([{"role": "user", "content": "OK"}], provider="openrouter-gpt-sol") == "OK"
    assert requests[0]["model"] == "openai/gpt-6-sol"
    assert requests[0].get("stream") is None
    assert requests[0]["messages"] == [{"role": "user", "content": "OK"}]


def test_openrouter_json_accepts_code_fences_from_claude(monkeypatch):
    requests = []

    def create(**kwargs):
        requests.append(kwargs)
        return Obj(choices=[Obj(message=Obj(content='```json\n{"ok": true}\n```'))])

    client = Obj(chat=Obj(completions=Obj(create=create)))
    monkeypatch.setattr(llm_client, "_client_for", lambda provider: (client, "anthropic/claude-sonnet-5.5"))
    monkeypatch.setitem(llm_client.PROVIDER_CONFIGS["openrouter-claude-sonnet"], "api_key", "local-test")
    result = llm_client.chat_json([{"role": "user", "content": "Return JSON"}], provider="openrouter-claude-sonnet")
    assert result == {"ok": True}
    assert requests[0]["response_format"] == {"type": "json_object"}
    assert "temperature" not in requests[0]
    assert requests[0]["extra_body"] == {"usage": {"include": True}, "reasoning": {"effort": "low"}}


def test_openrouter_tool_call_keeps_standard_chat_shape(monkeypatch):
    requests = []
    tool_call = Obj(id="call_1", function=Obj(name="get_status", arguments='{"slide":1}'))

    def create(**kwargs):
        requests.append(kwargs)
        return Obj(choices=[Obj(message=Obj(content=None, tool_calls=[tool_call]))])

    client = Obj(chat=Obj(completions=Obj(create=create)))
    monkeypatch.setattr(llm_client, "_client_for", lambda provider: (client, "openai/gpt-6-sol"))
    monkeypatch.setitem(llm_client.PROVIDER_CONFIGS["openrouter-gpt-sol"], "api_key", "local-test")
    reply = llm_client.chat_tools([{"role": "user", "content": "Check slide"}], [{"type": "function", "function": {"name": "get_status"}}], provider="openrouter-gpt-sol")
    assert reply.tool_calls[0].function.name == "get_status"
    assert requests[0].get("stream") is None
    assert requests[0]["extra_body"] == {"usage": {"include": True}, "reasoning": {"effort": "low"}}


def test_stream_cost_includes_usage_and_counts_final_usage_chunk(monkeypatch):
    requests = []

    def create(**kwargs):
        requests.append(kwargs)
        return iter([
            Obj(choices=[Obj(delta=Obj(content="Slide"))], usage=None),
            Obj(choices=[], usage=Obj(cost=0.012345)),
        ])

    client = Obj(chat=Obj(completions=Obj(create=create)))
    monkeypatch.setattr(llm_client, "_client_for", lambda provider: (client, "openai/gpt-6-sol"))
    with llm_client.track_cost() as ledger:
        assert "".join(llm_client.chat_stream([{"role": "user", "content": "Deck"}])) == "Slide"
    assert ledger.total_usd == 0.012345
    assert requests[0]["stream_options"] == {"include_usage": True}
    assert requests[0]["extra_body"]["usage"] == {"include": True}


def test_missing_provider_cost_is_not_reported_as_zero(monkeypatch):
    client = Obj(chat=Obj(completions=Obj(create=lambda **kwargs: Obj(choices=[Obj(message=Obj(content="OK"))], usage=None))))
    monkeypatch.setattr(llm_client, "_client_for", lambda provider: (client, "openai/gpt-6-sol"))
    with llm_client.track_cost() as ledger:
        assert llm_client.chat([{"role": "user", "content": "OK"}]) == "OK"
    assert ledger.total_usd is None
