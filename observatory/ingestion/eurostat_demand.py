"""Demand-side agent — distinguishes 'uncompetitive' from 'customers in
recession' (assessment §2.6).

Eurostat short-term statistics, EU27, monthly, seasonally+calendar adjusted,
index 2021=100:
- sts_copr_m  NACE F   -> demand.construction_output   (PVC demand proxy)
- sts_inpr_m  NACE C17 -> demand.paper_production      (caustic/chlorate demand)
- sts_inpr_m  NACE C20 -> demand.chemicals_production  (own-industry context)
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.jsonstat import iter_observations
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START

BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
REQUESTS = [
    ("sts_copr_m", "nace_r2=F", {"F": "demand.construction_output"}),
    ("sts_inpr_m", "nace_r2=C17&nace_r2=C20",
     {"C17": "demand.paper_production", "C20": "demand.chemicals_production"}),
]


class EurostatDemandAgent(IngestionAgent):
    name = "eurostat_demand"
    source = "Eurostat short-term statistics"

    def fetch(self):
        payloads = []
        with httpx.Client(timeout=120) as client:
            for dataset, nace, mapping in REQUESTS:
                url = (f"{BASE}/{dataset}?format=JSON&lang=en&geo=EU27_2020"
                       f"&indic_bt=PRD&s_adj=SCA&unit=I21&{nace}"
                       f"&sinceTimePeriod={HISTORY_START}-01")
                resp = client.get(url)
                resp.raise_for_status()
                payloads.append((url, {"dataset": dataset, "mapping": mapping,
                                       "data": resp.json()}))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            for coords, value in iter_observations(payload["data"]):
                series_id = payload["mapping"].get(coords.get("nace_r2"))
                if series_id is None or value is None:
                    continue
                period = coords["time"]
                rows.append(SeriesRow(
                    series_id=series_id,
                    geo_id="EU27_2020",
                    period=period,
                    period_start=period_start(period),
                    value=float(value),
                    unit="index 2021=100",
                    source="Eurostat",
                    source_dataset=f"{payload['dataset']} (SCA, I21, {coords.get('nace_r2')})",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows
