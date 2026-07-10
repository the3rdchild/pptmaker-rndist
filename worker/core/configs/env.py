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

STREAM_CHANNEL_PREFIX  = os.getenv("STREAM_CHANNEL_PREFIX", "ppt:stream")
