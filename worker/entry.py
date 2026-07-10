from core.logging.setup import setup_logging
from core.db.connection import db_get_connection
from core.queue.worker import start
from workers.ppt_worker import handle

if __name__ == "__main__":
    setup_logging()

    conn = db_get_connection()
    conn.close()
    print("[db] konek!")

    # single queue; job params.type dispatches to the right service.
    # (outline | deck | slide | agent)
    start(handle)
