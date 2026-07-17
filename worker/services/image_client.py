"""
DeepInfra image-gen client (OpenAI-compatible).

Endpoint: {DEEPINFRA_BASE_URL}/images/generations
Model: DEEPINFRA_IMAGE_MODEL (default black-forest-labs/FLUX-2-klein-4b)
"""
import base64
import logging

from openai import OpenAI
from core.configs.env import (
    DEEPINFRA_API_KEY,
    DEEPINFRA_BASE_URL,
    DEEPINFRA_IMAGE_MODEL,
)

logger = logging.getLogger(__name__)

_client = OpenAI(api_key=DEEPINFRA_API_KEY, base_url=DEEPINFRA_BASE_URL)


def generate_image(
    prompt: str,
    *,
    model: str | None = None,
    size: str = "1024x1024",
) -> bytes:
    """Generate one image from a prompt. Returns raw image bytes (PNG)."""
    logger.info("[image_client] generating | model=%s size=%s prompt=%r", model or DEEPINFRA_IMAGE_MODEL, size, prompt[:120])
    resp = _client.images.generate(
        model=model or DEEPINFRA_IMAGE_MODEL,
        prompt=prompt,
        size=size,
        n=1,
    )
    b64 = resp.data[0].b64_json
    return base64.b64decode(b64)
