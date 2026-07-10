from contextlib import contextmanager
import logging

import psycopg2
from psycopg2.extras import Json
from core.configs.env import DATABASE_URL

logger = logging.getLogger(__name__)


@contextmanager
def _db():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
    finally:
        conn.close()


# ── pool_request status ──

_GET_REQUEST = """
    SELECT id, session_id, deck_id, params
    FROM pool_request
    WHERE job_id = %s
"""

_UPDATE_STATUS = """
    UPDATE pool_request
    SET status = %s::pool_request_status, updated_at = NOW()
    WHERE job_id = %s
"""

_UPDATE_ERROR = """
    UPDATE pool_request
    SET error = %s, updated_at = NOW()
    WHERE job_id = %s
"""


# ── generation_result (upsert by job_id — idempotent) ──

_INSERT_RESULT = """
    INSERT INTO generation_result (job_id, request_id, type, result)
    VALUES (%s, %s, %s, %s)
    ON CONFLICT (job_id) DO UPDATE SET
        type       = EXCLUDED.type,
        result     = EXCLUDED.result,
        updated_at = NOW()
"""


# ── deck upsert (for deck/agent jobs that produce a full presentation) ──

_GET_DECK_BY_REQUEST = """
    SELECT deck_id FROM pool_request WHERE job_id = %s
"""

_INSERT_DECK = """
    INSERT INTO deck (id, session_id, title, payload, thumbnail)
    VALUES (%s, %s, %s, %s, %s)
    ON CONFLICT (id) DO UPDATE SET
        title     = EXCLUDED.title,
        payload   = EXCLUDED.payload,
        thumbnail = EXCLUDED.thumbnail,
        updated_at = NOW()
"""

_UPDATE_DECK_PAYLOAD = """
    UPDATE deck
    SET title = %s, payload = %s, thumbnail = %s, updated_at = NOW()
    WHERE id = %s
"""


def get_request(job_id: str):
    """Return (request_id, session_id, deck_id, params) or None."""
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(_GET_REQUEST, (job_id,))
            row = cur.fetchone()
    if not row:
        return None
    request_id, session_id, deck_id, params = row
    return {
        "request_id": str(request_id),
        "session_id": str(session_id),
        "deck_id": str(deck_id) if deck_id else None,
        "params": params or {},
    }


def update_status(job_id: str, status: str) -> None:
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(_UPDATE_STATUS, (status, job_id))
        conn.commit()
    logger.info("[db] status %s → %s", job_id, status)


def save_result(request_id: str, job_id: str, result_type: str, result: dict) -> None:
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(_INSERT_RESULT, (job_id, request_id, result_type, Json(result)))
        conn.commit()
    logger.info("[db] generation_result tersimpan | job_id=%s type=%s", job_id, result_type)


def save_error(job_id: str, message: str) -> None:
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(_UPDATE_ERROR, (message, job_id))
        conn.commit()
    logger.info("[db] error tersimpan | job_id=%s", job_id)


def upsert_deck(
    deck_id: str,
    session_id: str,
    title: str,
    payload: dict,
    thumbnail: str | None = None,
) -> str:
    """Insert-or-update a deck. Returns deck_id."""
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                _INSERT_DECK,
                (deck_id, session_id, title, Json(payload), thumbnail),
            )
        conn.commit()
    logger.info("[db] deck upserted | id=%s title=%s", deck_id, title)
    return deck_id
