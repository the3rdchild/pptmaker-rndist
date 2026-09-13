from dotenv import load_dotenv
import os

load_dotenv()

DATABASE_URL        = os.getenv("DATABASE_URL", "")
REDIS_URL           = os.getenv("REDIS_URL", "redis://localhost:6379")
QUEUE_NAME          = os.getenv("PPT_QUEUE_NAME", "PPT_QUEUE")
JOB_NAME            = os.getenv("PPT_JOB_NAME", "PROCESS_PPT")

# DeepInfra (OpenAI-compatible) — used by llm_client
DEEPINFRA_API_KEY      = os.getenv("DEEPINFRA_API_KEY", "")
DEEPINFRA_BASE_URL     = os.getenv("DEEPINFRA_BASE_URL", "https://api.deepinfra.com/v1/openai")
DEEPINFRA_MODEL        = os.getenv("DEEPINFRA_MODEL", "deepseek-ai/DeepSeek-V3.1-Terminus")

# CommandCode's OpenAI-compatible Provider API. These three presets use one
# account/key and deliberately expose price/quality tiers to the UI.
COMMANDCODE_API_KEY     = os.getenv("COMMANDCODE_API_KEY", "")
COMMANDCODE_BASE_URL    = os.getenv("COMMANDCODE_BASE_URL", "https://api.commandcode.ai/provider/v1")
COMMANDCODE_LUNA_MODEL  = os.getenv("COMMANDCODE_LUNA_MODEL", "gpt-5.6-luna")
COMMANDCODE_TERRA_MODEL = os.getenv("COMMANDCODE_TERRA_MODEL", "gpt-5.6-terra")
COMMANDCODE_SOL_MODEL   = os.getenv("COMMANDCODE_SOL_MODEL", "gpt-5.6-sol")

# Runware image generation. Requests send a safe UI alias; only these aliases
# can resolve to billable Runware AIR model ids.
RUNWARE_API_KEY         = os.getenv("RUNWARE_API_KEY", "")
RUNWARE_BASE_URL        = os.getenv("RUNWARE_BASE_URL", "https://api.runware.ai/v1")
RUNWARE_IMAGE_MODEL     = os.getenv("RUNWARE_IMAGE_MODEL", "runware-mid").strip().lower()
RUNWARE_IMAGE_MODELS    = {
    "runware-cheap": "runware:400@4",  # FLUX.2 Klein 4B
    "runware-mid": "runware:400@1",    # FLUX.2 Dev
    "runware-premium": "bfl:5@1",      # FLUX.2 Pro
}

# Which text-LLM provider llm_client.py talks to by default — any key of
# PROVIDER_CONFIGS below. Swapping providers is just this one var; all configs
# stay present so switching back doesn't need any code change. Individual jobs
# also override the provider per-request (see llm_client): the homepage model
# picker sends it as `model`, and so does the editor's chat model switcher.
LLM_PROVIDER           = os.getenv("LLM_PROVIDER", "gpt-luna").strip().lower()

# name -> config dict. The single source of truth for every text-LLM provider
# the worker can talk to. Per-provider quirks live next to the credentials so
# adding a provider is a one-place edit:
#   - headers:           extra HTTP headers required by a provider
#   - omit_temperature:  drop `temperature` from the request
#   - disable_thinking:  send extra_body thinking=disabled when supported
#   - api:               "chat" (default, /chat/completions) or "responses"
#   - reasoning_effort:  effort for api="responses" reasoning models
#
# The ids deliberately match the frontend's PROVIDER_PRESETS
# (FE-codebase/lib/ai-providers.ts) one-for-one, so the id a selector shows is
# the id every layer understands — the editor's chat switcher reads its list
# from the frontend but the call executes here.
PROVIDER_CONFIGS       = {
    "gpt-luna":  {"api_key": COMMANDCODE_API_KEY, "base_url": COMMANDCODE_BASE_URL, "model": COMMANDCODE_LUNA_MODEL, "omit_temperature": True},
    "gpt-terra": {"api_key": COMMANDCODE_API_KEY, "base_url": COMMANDCODE_BASE_URL, "model": COMMANDCODE_TERRA_MODEL, "omit_temperature": True},
    "gpt-sol":   {"api_key": COMMANDCODE_API_KEY, "base_url": COMMANDCODE_BASE_URL, "model": COMMANDCODE_SOL_MODEL, "omit_temperature": True},
    "deepinfra": {"api_key": DEEPINFRA_API_KEY, "base_url": DEEPINFRA_BASE_URL, "model": DEEPINFRA_MODEL},
    "qwen-vl":   {"api_key": DEEPINFRA_API_KEY, "base_url": DEEPINFRA_BASE_URL, "model": "Qwen/Qwen2.5-VL-32B-Instruct"},
    "gemma-vl":  {"api_key": DEEPINFRA_API_KEY, "base_url": DEEPINFRA_BASE_URL, "model": "google/gemma-4-26B-A4B-it"},
    "llama-vl":  {"api_key": DEEPINFRA_API_KEY, "base_url": DEEPINFRA_BASE_URL, "model": "meta-llama/Llama-3.2-11B-Vision-Instruct"},
}

_default_cfg = PROVIDER_CONFIGS.get(LLM_PROVIDER, PROVIDER_CONFIGS["deepinfra"])
LLM_API_KEY, LLM_BASE_URL, LLM_MODEL = _default_cfg["api_key"], _default_cfg["base_url"], _default_cfg["model"]

STREAM_CHANNEL_PREFIX  = os.getenv("STREAM_CHANNEL_PREFIX", "ppt:stream")
