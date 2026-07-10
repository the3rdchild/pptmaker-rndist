"""Redis pub/sub helper — publish job events to the SSE channel consumed by the API."""
import json
import logging

import redis as redis_lib
from core.configs.env import REDIS_URL, STREAM_CHANNEL_PREFIX

logger = logging.getLogger(__name__)

_redis = redis_lib.from_url(REDIS_URL, decode_responses=True)


def publish(job_id: str, payload: dict) -> None:
    """Publish an event to ppt:stream:{job_id}. API SSE route subscribes to this."""
    channel = f"{STREAM_CHANNEL_PREFIX}:{job_id}"
    try:
        _redis.publish(channel, json.dumps(payload))
    except Exception:
        logger.warning("[pubsub] gagal publish ke channel %s", channel)
