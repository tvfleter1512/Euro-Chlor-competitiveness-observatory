"""Power-price agent, EU leg — Eurostat nrg_pc_205 (industrial *delivered* electricity price).

Semi-annual, per consumption band and tax treatment. This is the decision-relevant
series; ENTSO-E wholesale is context and lives in a separate agent (never conflated).
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.jsonstat import iter_observations
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START, load_config

BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_205"


class EurostatPowerAgent(IngestionAgent):
    name = "eurostat_power"
    source = "Eurostat nrg_pc_205"

    def fetch(self):
        regions = load_config("regions")
        geos = [regions["eu"]["geo_id"]] + regions["eu"]["detail_countries"]
        geo_params = "&".join(f"geo={g}" for g in geos)
        url = (f"{BASE}?format=JSON&lang=en&currency=EUR&{geo_params}"
               f"&sinceTimePeriod={HISTORY_START}")
        resp = httpx.get(url, timeout=120)
        resp.raise_for_status()
        return [(url, resp.json())]

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            for coords, value in iter_observations(payload):
                if coords.get("unit") != "KWH" or value is None:
                    continue
                period = coords["time"]
                rows.append(SeriesRow(
                    series_id="power.industrial_delivered",
                    geo_id=coords["geo"],
                    period=period,
                    period_start=period_start(period),
                    value=round(float(value) * 1000, 4),   # EUR/kWh -> EUR/MWh (registry: units.kwh_per_mwh)
                    unit="EUR/MWh",
                    currency="EUR",
                    price_basis="delivered",
                    band=coords["nrg_cons"],
                    tax_treatment=coords["tax"],
                    source="Eurostat",
                    source_dataset="nrg_pc_205",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows
