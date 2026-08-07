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

# Which text-LLM provider llm_client.py talks to — "deepinfra" (default),
# "openai", or "zhipu". Swapping providers is just this one var; all configs
# stay present so switching back doesn't need any code change. Individual
# jobs can also override the provider per-request (see llm_client).
LLM_PROVIDER           = os.getenv("LLM_PROVIDER", "deepinfra").strip().lower()

# name -> (api_key, base_url, default_model). The single source of truth for
# every text-LLM provider the worker can talk to.
PROVIDER_CONFIGS       = {
    "deepinfra": (DEEPINFRA_API_KEY, DEEPINFRA_BASE_URL, DEEPINFRA_MODEL),
    "openai":    (OPENAI_API_KEY,    OPENAI_BASE_URL,    OPENAI_MODEL),
    "zhipu":     (ZHIPU_API_KEY,     ZHIPU_BASE_URL,     ZHIPU_MODEL),
}

LLM_API_KEY, LLM_BASE_URL, LLM_MODEL = PROVIDER_CONFIGS.get(
    LLM_PROVIDER, PROVIDER_CONFIGS["deepinfra"]
)

STREAM_CHANNEL_PREFIX  = os.getenv("STREAM_CHANNEL_PREFIX", "ppt:stream")
