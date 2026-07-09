"""Carbon agent, price leg — EUA secondary-market price via the ICAP
Allowance Price Explorer open API (assessment §2.8).

Daily EUR/tCO2 closes aggregated to monthly averages. Two ICAP system ids
cover the history: 33 (EU ETS until 2018) and 34 (from 2019). The API's
value triple's first element is the nominal EUR price. Benchmarks/aid
constants live in config/carbon.yaml -> benchmark_constant table, NOT here.
"""
from collections import defaultdict
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START

URL = "https://allowancepriceexplorer.icapcarbonaction.com/api/systems"
EU_SYSTEM_IDS = {33: "EU ETS (until 2018)", 34: "EU ETS (from 2019)"}
UA = {"User-Agent": "Mozilla/5.0 (compatible; EuroChlorObservatory/1.0)"}


class EUAPriceAgent(IngestionAgent):
    name = "eua_price"
    source = "ICAP Allowance Price Explorer"

    def fetch(self):
        resp = httpx.get(URL, timeout=90, headers=UA, follow_redirects=True)
        resp.raise_for_status()
        systems = resp.json()
        keep = [{"id": s["id"], "name": s["name"],
                 "secondary": s["values"]["secondary"]}
                for s in systems if s["id"] in EU_SYSTEM_IDS]
        if not keep:
            raise RuntimeError("ICAP payload no longer contains EU ETS systems 33/34")
        return [(URL, {"systems": keep})]

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        monthly = defaultdict(list)
        for url, payload in payloads:
            for system in payload["systems"]:
                for day, triple in system["secondary"].items():
                    if int(day[:4]) < HISTORY_START:
                        continue
                    price = triple[0] if isinstance(triple, list) else triple
                    if price is not None:
                        monthly[day[:7]].append(float(price))
        rows = []
        for period, prices in sorted(monthly.items()):
            rows.append(SeriesRow(
                series_id="carbon.eua_price",
                geo_id="EU27_2020",
                period=period,
                period_start=period_start(period),
                value=round(sum(prices) / len(prices), 2),
                unit="EUR/tCO2",
                currency="EUR",
                price_basis="secondary_market",
                source="ICAP",
                source_dataset="Allowance Price Explorer, EU ETS secondary market, monthly average of daily nominal EUR",
                reference_period=period,
                retrieved_at=retrieved_at,
            ))
        return rows
