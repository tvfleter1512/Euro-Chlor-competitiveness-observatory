"""Gas-price agent, US delivered leg — EIA natural-gas industrial price (monthly).

The US counterpart of Eurostat nrg_pc_203 (gas.industrial_delivered): average
price paid by industrial consumers, US total, Louisiana and Texas. EIA reports
USD per thousand cubic feet; converted to USD/MWh (gross calorific value) with
the registry constants units.mmbtu_per_mcf and units.mwh_per_mmbtu. Dormant
until EIA_KEY is set (same key as eia_power).
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import EIA_KEY, HISTORY_START, load_config

URL = "https://api.eia.gov/v2/natural-gas/pri/sum/data/"
AREAS = {"NUS": "US", "SLA": "US_LA", "STX": "US_TX"}   # EIA duoarea -> geo_id


def usd_per_mwh(usd_per_mcf: float, units: dict) -> float:
    return usd_per_mcf / (units["mmbtu_per_mcf"] * units["mwh_per_mmbtu"])


class EIAGasAgent(IngestionAgent):
    name = "eia_gas"
    source = "US EIA natural-gas prices"

    def available(self):
        if not EIA_KEY:
            return False, "EIA_KEY not set — register at https://www.eia.gov/opendata/register.php"
        return True, ""

    def fetch(self):
        params = {
            "api_key": EIA_KEY,
            "frequency": "monthly",
            "data[0]": "value",
            "facets[process][]": "PIN",            # industrial price
            "facets[duoarea][]": list(AREAS),
            "start": f"{HISTORY_START}-01",
            "sort[0][column]": "period",
            "sort[0][direction]": "asc",
            "length": 5000,
        }
        resp = httpx.get(URL, params=params, timeout=120)
        resp.raise_for_status()
        return [(str(resp.request.url).replace(EIA_KEY, "***"), resp.json())]

    def parse(self, payloads):
        units = load_config("conversions")["units"]
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            for rec in payload["response"]["data"]:
                if rec.get("value") in (None, "") or rec.get("duoarea") not in AREAS:
                    continue
                period = rec["period"]
                rows.append(SeriesRow(
                    series_id="gas.industrial_delivered",
                    geo_id=AREAS[rec["duoarea"]],
                    period=period,
                    period_start=period_start(period),
                    value=round(usd_per_mwh(float(rec["value"]), units), 4),
                    unit="USD/MWh",
                    currency="USD",
                    price_basis="delivered",
                    tax_treatment="retail",
                    source="US EIA",
                    source_dataset=f"natural-gas/pri/sum (process=PIN, {rec['duoarea']}), $/MCF converted to USD/MWh GCV",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows
