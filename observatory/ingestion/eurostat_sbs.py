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
        payloads = []
        with httpx.Client(timeout=120) as client:
            # current methodology (2021+)
            url = (f"{BASE}?format=JSON&lang=en&{geo_params}"
                   f"&nace_r2=C2013&nace_r2=C20&indic_sbs=EMP_NR&indic_sbs=ENT_NR"
                   f"&sinceTimePeriod=2021")
            resp = client.get(url)
            resp.raise_for_status()
            payloads.append((url, {"dataset": "sbs_ovw_act", "dim": "indic_sbs",
                                   "codes": {"EMP_NR": "structure.employment",
                                             "ENT_NR": "structure.enterprises"},
                                   "data": resp.json()}))
            # archived methodology (2008-2020) — extends the trend
            url2 = ("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
                    f"sbs_na_ind_r2?format=JSON&lang=en&{geo_params}"
                    f"&nace_r2=C2013&nace_r2=C20&indic_sb=V16110&indic_sb=V11110"
                    f"&sinceTimePeriod=2008")
            resp2 = client.get(url2)
            resp2.raise_for_status()
            payloads.append((url2, {"dataset": "sbs_na_ind_r2 (pre-2021 methodology)",
                                    "dim": "indic_sb",
                                    "codes": {"V16110": "structure.employment",
                                              "V11110": "structure.enterprises"},
                                    "data": resp2.json()}))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            for coords, value in iter_observations(payload["data"]):
                series_id = payload["codes"].get(coords.get(payload["dim"]))
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
                    source_dataset=f"{payload['dataset']} ({coords.get('nace_r2')})",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows
