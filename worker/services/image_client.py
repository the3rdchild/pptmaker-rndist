"""Runware image-generation client."""
import logging
import re
import uuid

import requests
from core.configs.env import (
    RUNWARE_API_KEY,
    RUNWARE_BASE_URL,
    RUNWARE_IMAGE_MODEL,
    RUNWARE_IMAGE_MODELS,
)

logger = logging.getLogger(__name__)

def resolve_image_model(model: str | None) -> tuple[str, str]:
    alias = (model or RUNWARE_IMAGE_MODEL).strip().lower()
    if alias not in RUNWARE_IMAGE_MODELS:
        logger.warning("[image_client] unknown model alias %r; using runware-mid", alias)
        alias = "runware-mid"
    return alias, RUNWARE_IMAGE_MODELS[alias]


def parse_size(size: str) -> tuple[int, int]:
    match = re.fullmatch(r"(\d{2,4})x(\d{2,4})", size.strip().lower())
    if not match:
        return 1024, 1024
    width, height = int(match.group(1)), int(match.group(2))
    width = max(512, min(2048, width)) // 16 * 16
    height = max(512, min(2048, height)) // 16 * 16
    return width, height


def generate_image(
    prompt: str,
    *,
    model: str | None = None,
    size: str = "1024x1024",
) -> bytes:
    """Generate one PNG with a whitelisted Runware model alias."""
    if not RUNWARE_API_KEY:
        raise RuntimeError("RUNWARE_API_KEY is not configured")
    alias, air = resolve_image_model(model)
    width, height = parse_size(size)
    logger.info("[image_client] generating | model=%s air=%s size=%sx%s prompt=%r", alias, air, width, height, prompt[:120])
    response = requests.post(
        RUNWARE_BASE_URL,
        headers={"Authorization": f"Bearer {RUNWARE_API_KEY}", "Content-Type": "application/json"},
        json=[{
            "taskType": "imageInference",
            "taskUUID": str(uuid.uuid4()),
            "model": air,
            "positivePrompt": prompt,
            "width": width,
            "height": height,
            "numberResults": 1,
            "outputType": "URL",
            "outputFormat": "PNG",
        }],
        timeout=180,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("errors"):
        message = payload["errors"][0].get("message", "Runware image generation failed")
        raise RuntimeError(message)
    data = payload.get("data") or []
    image_url = data[0].get("imageURL") if data else None
    if not image_url:
        raise RuntimeError("Runware returned no image URL")
    image_response = requests.get(image_url, timeout=60)
    image_response.raise_for_status()
    return image_response.content
