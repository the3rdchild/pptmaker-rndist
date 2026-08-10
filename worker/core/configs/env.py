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

# DeepInfra image generation — used by image_client (always DeepInfra, LLM_PROVIDER
# below only switches the TEXT model llm_client uses, not image generation)
DEEPINFRA_IMAGE_MODEL  = os.getenv("DEEPINFRA_IMAGE_MODEL", "black-forest-labs/FLUX-2-klein-4b")

# OpenAI (used by llm_client when LLM_PROVIDER=openai)
OPENAI_API_KEY         = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL        = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL           = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Zhipu GLM, OpenAI-compatible (used by llm_client when LLM_PROVIDER/provider=zhipu)
ZHIPU_API_KEY          = os.getenv("ZHIPU_API_KEY", "")
ZHIPU_BASE_URL         = os.getenv("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4")
ZHIPU_MODEL            = os.getenv("ZHIPU_MODEL", "glm-4.5-flash")

# Kimi (Moonshot) coding endpoint — OpenAI-compatible, but requires a
# recognized coding-agent User-Agent to authorize sk-kimi-* subscription keys,
# and rejects any temperature other than 1. Both are handled per-provider in
# llm_client via headers/omit_temperature below.
KIMI_API_KEY           = os.getenv("KIMI_API_KEY", "")
KIMI_BASE_URL          = os.getenv("KIMI_BASE_URL", "https://api.kimi.com/coding/v1")
KIMI_MODEL             = os.getenv("KIMI_MODEL", "kimi-k2.6")

# Which text-LLM provider llm_client.py talks to — "deepinfra" (default),
# "openai", "zhipu", or "kimi". Swapping providers is just this one var; all
# configs stay present so switching back doesn't need any code change.
# Individual jobs can also override the provider per-request (see llm_client).
LLM_PROVIDER           = os.getenv("LLM_PROVIDER", "deepinfra").strip().lower()

# name -> config dict. The single source of truth for every text-LLM provider
# the worker can talk to. Per-provider quirks live next to the credentials so
# adding a provider is a one-place edit:
#   - headers:           extra HTTP headers (e.g. Kimi's coding-agent UA)
#   - omit_temperature:  drop `temperature` from the request (kimi-k2.6 == 1 only)
#   - disable_thinking:  send extra_body thinking=disabled (Zhipu reasoning models)
PROVIDER_CONFIGS       = {
    "deepinfra": {"api_key": DEEPINFRA_API_KEY, "base_url": DEEPINFRA_BASE_URL, "model": DEEPINFRA_MODEL},
    "openai":    {"api_key": OPENAI_API_KEY,    "base_url": OPENAI_BASE_URL,    "model": OPENAI_MODEL},
    "zhipu":     {"api_key": ZHIPU_API_KEY,     "base_url": ZHIPU_BASE_URL,     "model": ZHIPU_MODEL, "disable_thinking": True},
    "glm":       {"api_key": ZHIPU_API_KEY,     "base_url": "https://api.z.ai/api/coding/paas/v4", "model": "glm-4.6", "disable_thinking": True},
    "kimi":      {"api_key": KIMI_API_KEY,      "base_url": KIMI_BASE_URL,      "model": KIMI_MODEL,  "headers": {"User-Agent": "claude-code/0.1.0"}, "omit_temperature": True},
}

_default_cfg = PROVIDER_CONFIGS.get(LLM_PROVIDER, PROVIDER_CONFIGS["deepinfra"])
LLM_API_KEY, LLM_BASE_URL, LLM_MODEL = _default_cfg["api_key"], _default_cfg["base_url"], _default_cfg["model"]

STREAM_CHANNEL_PREFIX  = os.getenv("STREAM_CHANNEL_PREFIX", "ppt:stream")
