from types import SimpleNamespace as Obj

from services import llm_client


def chunk(*, content=None, tool_calls=None, finish_reason=None):
    delta = Obj(content=content, tool_calls=tool_calls or [])
    return Obj(choices=[Obj(delta=delta, finish_reason=finish_reason)])


def test_codebuddy_chat_adds_system_and_collects_stream(monkeypatch):
    requests = []

    def create(**kwargs):
        requests.append(kwargs)
        return iter([chunk(content="Hello "), chunk(content="world", finish_reason="stop")])

    client = Obj(chat=Obj(completions=Obj(create=create)))
    monkeypatch.setattr(llm_client, "_client_for", lambda provider: (client, "hy3"))
    result = llm_client.chat([{"role": "user", "content": "Say hello"}], provider="codebuddy")

    assert result == "Hello world"
    assert requests[0]["stream"] is True
    assert requests[0]["messages"][0]["role"] == "system"
    assert requests[0]["messages"][1]["content"] == "Say hello"


def test_codebuddy_tool_calls_accumulate_arguments_across_chunks(monkeypatch):
    def create(**kwargs):
        return iter([
            chunk(tool_calls=[Obj(index=0, id="call_1", function=Obj(name="search", arguments='{"q":'))]),
            chunk(tool_calls=[Obj(index=0, id=None, function=Obj(name=None, arguments='"slides"}'))], finish_reason="tool_calls"),
        ])

    client = Obj(chat=Obj(completions=Obj(create=create)))
    monkeypatch.setattr(llm_client, "_client_for", lambda provider: (client, "hy3"))
    result = llm_client.chat_tools([{"role": "user", "content": "Find slides"}], [{"type": "function", "function": {"name": "search"}}], provider="codebuddy")

    assert result.tool_calls[0].id == "call_1"
    assert result.tool_calls[0].function.name == "search"
    assert result.tool_calls[0].function.arguments == '{"q":"slides"}'


def test_codebuddy_sol_uses_the_verified_model_for_worker_chat(monkeypatch):
    requests = []

    def create(**kwargs):
        requests.append(kwargs)
        return iter([chunk(content="OK", finish_reason="stop")])

    client = Obj(chat=Obj(completions=Obj(create=create)))
    monkeypatch.setattr(llm_client, "_client_for", lambda provider: (client, llm_client.resolve_provider(provider)[1]["model"]))
    config = llm_client.PROVIDER_CONFIGS.get("codebuddy-sol", {"api_key": "local-regression-test", "base_url": "https://www.codebuddy.ai/v2", "model": "hy3"})
    monkeypatch.setitem(llm_client.PROVIDER_CONFIGS, "codebuddy-sol", config)
    monkeypatch.setitem(config, "api_key", "local-regression-test")
    assert llm_client.chat([{"role": "user", "content": "OK"}], provider="codebuddy-sol") == "OK"
    assert requests[0]["model"] == "gpt-5.6-sol"
    assert requests[0]["stream"] is True
    assert requests[0]["messages"][0]["role"] == "system"


def test_default_codebuddy_worker_chat_streams_when_provider_is_omitted(monkeypatch):
    requests = []

    def create(**kwargs):
        requests.append(kwargs)
        return iter([chunk(content="OK", finish_reason="stop")])

    client = Obj(chat=Obj(completions=Obj(create=create)))
    monkeypatch.setattr(llm_client, "_client_for", lambda provider: (client, "hy3"))
    monkeypatch.setitem(llm_client.PROVIDER_CONFIGS["codebuddy"], "api_key", "local-regression-test")
    assert llm_client.chat([{"role": "user", "content": "OK"}]) == "OK"
    assert requests[0]["stream"] is True
    assert requests[0]["messages"][0]["role"] == "system"
