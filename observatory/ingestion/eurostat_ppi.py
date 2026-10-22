"""Price agent, EU domestic leg — Eurostat industrial producer prices.

sts_inppd_m: domestic output prices, monthly, index 2021=100, not seasonally
adjusted, EU27 + the chlor-alkali member states. NACE C20.13 'other basic
inorganic chemicals' (chlorine, caustic soda, hydrochloric acid, chlorates)
and C20 (all chemicals, context). Complements the trade unit values, which
only see what crosses the EU border. Band = NACE. Country cells Eurostat
suppresses for confidentiality are simply absent.
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.jsonstat import iter_observations
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START, load_config

URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_inppd_m"
NACE = ["C2013", "C20"]


class EurostatPPIAgent(IngestionAgent):
    name = "eurostat_ppi"
    source = "Eurostat sts_inppd_m"

    def fetch(self):
        regions = load_config("regions")
        geos = [regions["eu"]["geo_id"]] + regions["eu"]["detail_countries"]
        url = (f"{URL}?format=JSON&lang=en&unit=I21&s_adj=NSA&indic_bt=PRC_PRR_DOM"
               + "".join(f"&nace_r2={n}" for n in NACE)
               + "".join(f"&geo={g}" for g in geos)
               + f"&sinceTimePeriod={HISTORY_START}-01")
        resp = httpx.get(url, timeout=120)
        resp.raise_for_status()
        return [(url, resp.json())]

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            for coords, value in iter_observations(payload):
                if value is None:
                    continue
                period = coords["time"]
                rows.append(SeriesRow(
                    series_id="price.ppi_domestic",
                    geo_id=coords["geo"],
                    period=period,
                    period_start=period_start(period),
                    value=float(value),
                    unit="index 2021=100",
                    band=coords["nace_r2"],
                    source="Eurostat",
                    source_dataset=f"sts_inppd_m (domestic output prices, NSA, I21, {coords['nace_r2']})",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows
