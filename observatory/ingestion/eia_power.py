"""Power-price agent, US leg — EIA retail industrial electricity price (monthly).

Dormant until EIA_KEY is set. Retail industrial price is the US analogue of the
EU delivered price. EIA reports cents/kWh; converted to USD/MWh (×10, registry
units.kwh_per_mwh); currency conversion to EUR happens in normalisation.
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import EIA_KEY, HISTORY_START

URL = "https://api.eia.gov/v2/electricity/retail-sales/data/"


class EIAPowerAgent(IngestionAgent):
    name = "eia_power"
    source = "US EIA retail-sales"

    def available(self):
        if not EIA_KEY:
            return False, "EIA_KEY not set — register at https://www.eia.gov/opendata/register.php"
        return True, ""

    def fetch(self):
        params = {
            "api_key": EIA_KEY,
            "frequency": "monthly",
            "data[0]": "price",
            "facets[sectorid][]": "IND",
            "facets[stateid][]": "US",
            "start": f"{HISTORY_START}-01",
            "sort[0][column]": "period",
            "sort[0][direction]": "asc",
            "length": 5000,
        }
        resp = httpx.get(URL, params=params, timeout=120)
        resp.raise_for_status()
        return [(str(resp.request.url).replace(EIA_KEY, "***"), resp.json())]

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            for rec in payload["response"]["data"]:
                if rec.get("price") is None:
                    continue
                period = rec["period"]                     # '2015-01'
                rows.append(SeriesRow(
                    series_id="power.industrial_delivered",
                    geo_id="US",
                    period=period,
                    period_start=period_start(period),
                    value=round(float(rec["price"]) * 10, 4),   # cents/kWh -> USD/MWh
                    unit="USD/MWh",
                    currency="USD",
                    price_basis="delivered",
                    tax_treatment="retail",
                    source="US EIA",
                    source_dataset="electricity/retail-sales (sector=IND, US total)",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows
