"""Production & capacity agent — Euro Chlor internal data via file drop (Phase 2).

Wired now so the schema and drop mechanism exist; stays 'skipped' until files
arrive in data/eurochlor_drop/. Euro Chlor member data is the SOURCE OF TRUTH
for EU capacity/production/utilisation (config/source_of_truth.yaml).
"""
import csv
from datetime import datetime, timezone

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import DATA_DIR

DROP_DIR = DATA_DIR / "eurochlor_drop"
METRICS = {"capacity": "production.capacity",
           "production": "production.production",
           "utilisation": "production.utilisation"}


class EuroChlorDropAgent(IngestionAgent):
    name = "eurochlor_drop"
    source = "Euro Chlor internal (file drop)"

    def available(self):
        files = [f for f in DROP_DIR.glob("*.csv") if f.name != "TEMPLATE.csv"]
        if not files:
            return False, f"no member-data files in {DROP_DIR} (Phase 2; see TEMPLATE.csv)"
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
                series_id = METRICS.get(rec.get("metric", "").strip().lower())
                rows.append(SeriesRow(
                    series_id=series_id or f"UNKNOWN:{rec.get('metric')}",
                    geo_id=rec.get("region", ""),
                    period=rec.get("period", ""),
                    period_start=period_start(rec["period"]) if rec.get("period") else None,
                    value=rec.get("value"),
                    unit=rec.get("unit", ""),
                    source=rec.get("source", "Euro Chlor member data"),
                    source_dataset=f"file drop: {path.split('/')[-1]}",
                    reference_period=rec.get("reference_period", rec.get("period", "")),
                    retrieved_at=retrieved_at,
                ))
        return rows
