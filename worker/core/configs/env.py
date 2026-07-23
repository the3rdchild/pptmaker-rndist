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

# Which text-LLM provider llm_client.py talks to — "deepinfra" (default) or
# "openai". Swapping providers is just this one var; both configs stay
# present so switching back doesn't need any code change.
LLM_PROVIDER           = os.getenv("LLM_PROVIDER", "deepinfra").strip().lower()
LLM_API_KEY            = OPENAI_API_KEY if LLM_PROVIDER == "openai" else DEEPINFRA_API_KEY
LLM_BASE_URL           = OPENAI_BASE_URL if LLM_PROVIDER == "openai" else DEEPINFRA_BASE_URL
LLM_MODEL              = OPENAI_MODEL if LLM_PROVIDER == "openai" else DEEPINFRA_MODEL

STREAM_CHANNEL_PREFIX  = os.getenv("STREAM_CHANNEL_PREFIX", "ppt:stream")
