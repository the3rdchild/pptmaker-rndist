from dotenv import load_dotenv
import os

load_dotenv()

DATABASE_URL        = os.getenv("DATABASE_URL", "")
REDIS_URL           = os.getenv("REDIS_URL", "redis://localhost:6379")
QUEUE_NAME          = os.getenv("PPT_QUEUE_NAME", "PPT_QUEUE")
JOB_NAME            = os.getenv("PPT_JOB_NAME", "PROCESS_PPT")

# OpenRouter (OpenAI-compatible) serves the text and vision model presets.
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

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
# stay present so switching models doesn't need any code change. Individual jobs
# also override the provider per-request (see llm_client): the homepage model
# picker sends it as `model`, and so does the editor's chat model switcher.
LLM_PROVIDER           = os.getenv("LLM_PROVIDER", "openrouter-gpt-sol").strip().lower()

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
    "openrouter-gpt-sol": {"api_key": OPENROUTER_API_KEY, "base_url": OPENROUTER_BASE_URL, "model": "openai/gpt-6-sol", "omit_temperature": True, "reasoning_effort": "low"},
    "openrouter-deepseek-flash": {"api_key": OPENROUTER_API_KEY, "base_url": OPENROUTER_BASE_URL, "model": "deepseek/deepseek-v4-flash-0731"},
    "openrouter-gemini-flash": {"api_key": OPENROUTER_API_KEY, "base_url": OPENROUTER_BASE_URL, "model": "google/gemini-3-flash-preview"},
    "openrouter-claude-sonnet": {"api_key": OPENROUTER_API_KEY, "base_url": OPENROUTER_BASE_URL, "model": "anthropic/claude-sonnet-4.6", "omit_temperature": True},
}

_default_cfg = PROVIDER_CONFIGS.get(LLM_PROVIDER, PROVIDER_CONFIGS["openrouter-gpt-sol"])
LLM_API_KEY, LLM_BASE_URL, LLM_MODEL = _default_cfg["api_key"], _default_cfg["base_url"], _default_cfg["model"]

STREAM_CHANNEL_PREFIX  = os.getenv("STREAM_CHANNEL_PREFIX", "ppt:stream")
