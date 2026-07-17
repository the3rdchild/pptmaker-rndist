import logging
import json

from core.db.repository import get_request, update_status, save_error

logger = logging.getLogger(__name__)


def handle(data: dict):
    """
    Dispatcher: baca job, ambil request row, lalu lempar ke service yang sesuai
    berdasarkan params.type (outline | deck | slide | agent).
    """
    job_id = data.get("jobId")
    payload = data.get("payload") or {}

    if not job_id:
        logger.error("[ppt_worker] job_id kagak ada, skip")
        return

    logger.info("[ppt_worker] job diterima: %s", job_id)
    logger.debug(json.dumps(payload, indent=2, default=str))

    request = get_request(job_id)
    if not request:
        logger.error("[ppt_worker] pool_request nga ketemu | job_id=%s", job_id)
        return

    params = {**request["params"], **payload}
    job_type = params.get("type")

    if not job_type:
        save_error(job_id, "Job tanpa params.type")
        update_status(job_id, "failed")
        return

    update_status(job_id, "processing")

    try:
        _dispatch(job_type, job_id, request, params)
        update_status(job_id, "completed")
        logger.info("[ppt_worker] selesai | job_id=%s", job_id)
    except Exception as e:
        logger.exception("[ppt_worker] error | job_id=%s", job_id)
        try:
            save_error(job_id, str(e))
        except Exception:
            logger.exception("[ppt_worker] gagal nyimpen error | job_id=%s", job_id)
        update_status(job_id, "failed")
        # Notify any SSE/streaming listeners so the client doesn't hang
        try:
            from services.pubsub import publish
            publish(job_id, {"type": "error", "message": str(e)})
        except Exception:
            pass


def _dispatch(job_type: str, job_id: str, request: dict, params: dict):
    """Route to the right service based on type."""
    ctx = {
        "job_id": job_id,
        "request_id": request["request_id"],
        "session_id": request["session_id"],
        "deck_id": request["deck_id"],
        "params": params,
    }

    if job_type == "outline":
        from services.outline_service import process
        process(ctx)
    elif job_type == "deck":
        from services.deck_service import process
        process(ctx)
    elif job_type == "writing":
        from services.writing_service import process
        process(ctx)
    elif job_type == "agent":
        from services.agent_service import process
        process(ctx)
    elif job_type == "image":
        from services.image_service import process
        process(ctx)
    else:
        raise ValueError(f"Unknown job type: {job_type}")
