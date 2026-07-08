"""Ingestion agent base: run bookkeeping, raw landing, gatekeeper, failure isolation.

Each agent implements fetch() -> list[(url, payload)] and parse(payloads) -> list[SeriesRow].
run() guarantees: every payload lands immutably in raw_landing; every parsed row
passes through the provenance gatekeeper; any exception marks the run failed
without touching other agents (graceful degradation, spec §3.2).
"""
import json
import logging
import traceback
from abc import ABC, abstractmethod
from datetime import datetime, timezone

from observatory import db, provenance

log = logging.getLogger(__name__)


class IngestionAgent(ABC):
    name: str = "base"          # unique agent id, used in ingestion_run.agent
    source: str = ""            # human-readable source name for raw_landing

    def available(self) -> tuple[bool, str]:
        """Override for agents needing credentials. (available?, reason-if-not)."""
        return True, ""

    @abstractmethod
    def fetch(self) -> list[tuple[str, dict | list | str]]:
        """Return [(request_url, payload), ...] — payloads stored as-fetched."""

    @abstractmethod
    def parse(self, payloads: list[tuple[str, dict | list | str]]) -> list[provenance.SeriesRow]:
        """Turn raw payloads into SeriesRow objects."""

    def run(self) -> dict:
        with db.get_conn() as conn:
            ok, reason = self.available()
            if not ok:
                run_id = db.start_run(conn, self.name)
                db.finish_run(conn, run_id, "skipped", notes=reason)
                log.info("%s skipped: %s", self.name, reason)
                return {"agent": self.name, "status": "skipped", "notes": reason}

            run_id = db.start_run(conn, self.name)
            try:
                payloads = self.fetch()
                retrieved_at = datetime.now(timezone.utc)
                for url, payload in payloads:
                    conn.execute(
                        """INSERT INTO raw_landing (run_id, source, request_url, payload, retrieved_at)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (run_id, self.source, url,
                         json.dumps(payload) if not isinstance(payload, str) else json.dumps({"raw": payload}),
                         retrieved_at),
                    )
                conn.commit()
                rows = self.parse(payloads)
                if hasattr(self, "pre_insert"):
                    self.pre_insert(conn, rows)   # e.g. upsert dim_geo for new partners
                inserted, quarantined = provenance.insert_rows(conn, run_id, self.name, rows)
                status = "success" if quarantined == 0 else "partial"
                db.finish_run(conn, run_id, status, inserted, quarantined)
                log.info("%s: %d inserted, %d quarantined", self.name, inserted, quarantined)
                return {"agent": self.name, "status": status,
                        "inserted": inserted, "quarantined": quarantined}
            except Exception as exc:
                conn.rollback()
                db.finish_run(conn, run_id, "failed", notes=f"{exc}\n{traceback.format_exc()[-1500:]}")
                log.exception("%s failed", self.name)
                return {"agent": self.name, "status": "failed", "error": str(exc)}
