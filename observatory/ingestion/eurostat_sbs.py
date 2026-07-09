"""Structural business statistics agent — employment & enterprises,
NACE C2013 'other inorganic basic chemicals' (assessment §2.10).

Annual, ~18-month lag; the 'jobs at stake' figure for MC position papers,
with provenance. C20 (chemicals total) fetched as context.
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.jsonstat import iter_observations
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START, load_config

BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_ovw_act"
SERIES = {"EMP_NR": "structure.employment", "ENT_NR": "structure.enterprises"}


class EurostatSBSAgent(IngestionAgent):
    name = "eurostat_sbs"
    source = "Eurostat SBS sbs_ovw_act"

    def fetch(self):
        regions = load_config("regions")
        geos = [regions["eu"]["geo_id"]] + regions["eu"]["detail_countries"]
        geo_params = "&".join(f"geo={g}" for g in geos)
        url = (f"{BASE}?format=JSON&lang=en&{geo_params}"
               f"&nace_r2=C2013&nace_r2=C20&indic_sbs=EMP_NR&indic_sbs=ENT_NR"
               f"&sinceTimePeriod={HISTORY_START}")
        resp = httpx.get(url, timeout=120)
        resp.raise_for_status()
        return [(url, resp.json())]

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            for coords, value in iter_observations(payload):
                series_id = SERIES.get(coords.get("indic_sbs"))
                if series_id is None or value is None:
                    continue
                period = coords["time"]
                rows.append(SeriesRow(
                    series_id=series_id,
                    geo_id=coords["geo"],
                    period=period,
                    period_start=period_start(period),
                    value=float(value),
                    unit="persons" if series_id.endswith("employment") else "enterprises",
                    band=coords.get("nace_r2"),   # NACE stored in band for filtering
                    source="Eurostat",
                    source_dataset=f"sbs_ovw_act ({coords.get('nace_r2')})",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows
