"""Database connection helpers and run bookkeeping."""
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from observatory.settings import DATABASE_URL


@contextmanager
def get_conn():
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        yield conn


def start_run(conn, agent: str) -> int:
    row = conn.execute(
        "INSERT INTO ingestion_run (agent) VALUES (%s) RETURNING run_id", (agent,)
    ).fetchone()
    conn.commit()
    return row["run_id"]


def finish_run(conn, run_id: int, status: str, ingested: int = 0,
               quarantined: int = 0, notes: str | None = None) -> None:
    conn.execute(
        """UPDATE ingestion_run
           SET finished_at = now(), status = %s, rows_ingested = %s,
               rows_quarantined = %s, notes = %s
           WHERE run_id = %s""",
        (status, ingested, quarantined, notes, run_id),
    )
    conn.commit()
