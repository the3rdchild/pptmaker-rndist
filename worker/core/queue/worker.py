import time
import redis
import json
import logging
from core.configs.env import REDIS_URL, QUEUE_NAME

logger = logging.getLogger(__name__)


def start(handler, queue_name: str = QUEUE_NAME):
    """
    Dengarkan job dari Redis pakai BRPOP.
    Pas ada job masuk, langsung lempar ke handler(data).

    NB: kita konsumsi pakai BRPOP, bypass lifecycle BullMQ.
    Setelah proses, hapus hash job biar ga numpuk.
    """
    r = redis.from_url(REDIS_URL)
    wait_key = f"bull:{queue_name}:wait"
    label = f"worker-{queue_name.lower()}"

    logger.info(f"[{label}] dengerin {wait_key}...")

    while True:
        try:
            result = r.brpop(wait_key, timeout=5)
        except redis.exceptions.TimeoutError:
            continue
        except redis.exceptions.ConnectionError as e:
            logger.warning(f"[{label}] redis connection error: {e}, retry...")
            time.sleep(1)
            continue

        if result is None:
            continue

        _, job_id = result
        job_id = job_id.decode()

        rawdata = r.hgetall(f"bull:{queue_name}:{job_id}")
        job = {k.decode(): v.decode() for k, v in rawdata.items()}
        data = json.loads(job.get("data", "{}"))

        logger.info(f"[job masuk] queue={queue_name} id={job_id}")

        try:
            handler(data)
        except Exception as e:
            logger.error(f"[job error] id={job_id} | {e}", exc_info=True)

        r.delete(f"bull:{queue_name}:{job_id}")
