"""Power-price agent, proxy leg — curated industrial tariffs for China/Gulf/India.

No free official API exists for these regions. Values come from a curated CSV
(data/proxy_tariffs/) that a human fills from published tariff schedules, each
row carrying full provenance. The agent FORCES quality_flag='estimated' so proxy
numbers can never masquerade as official statistics downstream.
"""
import csv
from datetime import datetime, timezone
from pathlib import Path

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import DATA_DIR

DROP_DIR = DATA_DIR / "proxy_tariffs"
REQUIRED = {"geo_id", "period", "value", "currency", "unit",
            "source", "source_dataset", "reference_period"}


class ProxyPowerAgent(IngestionAgent):
    name = "proxy_power"
    source = "Curated proxy tariffs (CN/GULF/IN)"

    def available(self):
        files = [f for f in DROP_DIR.glob("*.csv") if f.name != "TEMPLATE.csv"]
        if not files:
            return False, f"no curated tariff CSVs in {DROP_DIR} (see TEMPLATE.csv)"
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
                missing = REQUIRED - {k for k, v in rec.items() if v}
                # incomplete rows still go through the gatekeeper -> quarantined with reason
                rows.append(SeriesRow(
                    series_id="power.industrial_delivered",
                    geo_id=rec.get("geo_id", ""),
                    period=rec.get("period", ""),
                    period_start=period_start(rec["period"]) if rec.get("period") else None,
                    value=rec.get("value"),
                    unit=rec.get("unit", ""),
                    currency=rec.get("currency"),
                    price_basis="delivered",
                    band=rec.get("band") or None,
                    tax_treatment=rec.get("tax_treatment") or None,
                    source=rec.get("source", ""),
                    source_dataset=rec.get("source_dataset", "") + f" [file: {Path(path).name}]",
                    reference_period=rec.get("reference_period", ""),
                    retrieved_at=retrieved_at,
                    quality_flag="estimated",   # forced — proxies are never 'ok'
                ))
        return rows
