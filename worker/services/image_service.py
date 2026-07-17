"""Image generation service — one-shot job, no streaming.

Consumed via the poll endpoint (GET /api/v1/status/:jobId), not SSE: the
result is a single base64 data URL, nothing worth streaming in chunks.
"""
import base64
import logging

from services import image_client
from core.db.repository import save_result

logger = logging.getLogger(__name__)


def process(ctx: dict):
    params = ctx["params"]
    prompt = params.get("prompt", "")
    size = params.get("size") or "1024x1024"

    logger.info("[image_service] job_id=%s size=%s prompt=%r", ctx["job_id"], size, prompt[:120])

    image_bytes = image_client.generate_image(prompt, size=size)
    data_url = "data:image/png;base64," + base64.b64encode(image_bytes).decode("ascii")

    save_result(ctx["request_id"], ctx["job_id"], "image", {"data_url": data_url})
    logger.info("[image_service] done | job_id=%s bytes=%d", ctx["job_id"], len(image_bytes))
