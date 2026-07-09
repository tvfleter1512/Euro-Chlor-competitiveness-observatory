"""Freight agent — curated container-freight index drop (assessment §2.9).

No usable free API exists (Drewry WCI is JS/rate-limit gated; SSE indices are
session-gated; tanker rates are licensed). The weekly Drewry WCI composite is
published openly in a browser — paste it into data/freight/*.csv with full
provenance. Liquid-caustic tanker rates remain a model-B (licensed) candidate.
"""
import csv
from datetime import datetime, timezone

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import DATA_DIR

DROP_DIR = DATA_DIR / "freight"


class FreightDropAgent(IngestionAgent):
    name = "freight_drop"
    source = "Curated freight indices (file drop)"

    def available(self):
        files = [f for f in DROP_DIR.glob("*.csv") if f.name != "TEMPLATE.csv"]
        if not files:
            return False, f"no freight CSVs in {DROP_DIR} (see TEMPLATE.csv; weekly Drewry WCI composite)"
        return True, ""

    def fetch(self):
        payloads = []
        for f in sorted(DROP_DIR.glob("*.csv")):
            if f.name == "TEMPLATE.csv":
                continue
            with open(f, newline="", encoding="utf-8") as fh:
                payloads.append((str(f), list(csv.DictReader(fh))))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for path, records in payloads:
            for rec in records:
                day = (rec.get("date") or "").strip()
                rows.append(SeriesRow(
                    series_id="freight.container_index",
                    geo_id="WORLD",
                    period=day,
                    period_start=period_start(day[:7]) if len(day) >= 7 else None,
                    value=rec.get("value"),
                    unit=rec.get("unit", "USD/40ft"),
                    currency="USD",
                    source=rec.get("source", ""),
                    source_dataset=(rec.get("source_dataset", "")
                                    + f" [file: {path.split('/')[-1]}]"),
                    reference_period=day,
                    retrieved_at=retrieved_at,
                ))
        return rows
