import time
import redis
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from core.configs.env import REDIS_URL, QUEUE_NAME

logger = logging.getLogger(__name__)


def start(handler, queue_name: str = QUEUE_NAME, max_workers: int = 4):
    """
    Dengarkan job dari Redis pakai BRPOP, proses secara paralel.

    Jobs di-submit ke ThreadPoolExecutor (max_workers) karena kerjaannya
    I/O-bound (DeepInfra streaming). BRPOP loop tetap single-threaded
    (Redis connection tidak thread-safe untuk blocking commands), tapi
    handler jalan di thread pool.

    NB: kita konsumsi pakai BRPOP, bypass lifecycle BullMQ.
    Setelah proses, hapus hash job biar ga numpuk.
    """
    r = redis.from_url(REDIS_URL)
    wait_key = f"bull:{queue_name}:wait"
    label = f"worker-{queue_name.lower()}"

    pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ppt-job")

    logger.info(f"[{label}] dengerin {wait_key}... (max_workers={max_workers})")

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

        # Run handler in thread pool (concurrent)
        def run_job(jid, payload):
            try:
                handler(payload)
            except Exception as e:
                logger.error(f"[job error] id={jid} | {e}", exc_info=True)
            # bersihin hash job biar ga numpuk
            try:
                r.delete(f"bull:{queue_name}:{jid}")
            except Exception:
                pass

        pool.submit(run_job, job_id, data)
