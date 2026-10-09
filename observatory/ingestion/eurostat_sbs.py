"""Structural business statistics agent — employment, enterprises and labour
costs, NACE C2013 'other inorganic basic chemicals' (assessment §2.10).

Annual, ~18-month lag; the 'jobs at stake' figure for MC position papers,
with provenance. C20 (chemicals total) fetched as context. Employees, wages
and personnel costs (wages + employer social charges) feed the labour-cost
check on the Argus fixed costs (processing/labour.py).
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.jsonstat import iter_observations
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START, load_config

BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_ovw_act"
CURRENT = {"EMP_NR": "structure.employment", "ENT_NR": "structure.enterprises",
           "SAL_NR": "structure.employees", "WAGE_MEUR": "structure.wages",
           "EXPN_SAL_BEN_MEUR": "structure.personnel_costs"}
ARCHIVED = {"V16110": "structure.employment", "V11110": "structure.enterprises",
            "V16130": "structure.employees", "V13320": "structure.wages",
            "V13310": "structure.personnel_costs"}   # V13310 = personnel costs (incl. social charges)
UNITS = {"structure.employment": "persons", "structure.enterprises": "enterprises",
         "structure.employees": "persons", "structure.wages": "EUR million",
         "structure.personnel_costs": "EUR million"}


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
                   f"&nace_r2=C2013&nace_r2=C20&" + "&".join(f"indic_sbs={c}" for c in CURRENT) +
                   f"&sinceTimePeriod=2021")
            resp = client.get(url)
            resp.raise_for_status()
            payloads.append((url, {"dataset": "sbs_ovw_act", "dim": "indic_sbs",
                                   "codes": CURRENT,
                                   "data": resp.json()}))
            # archived methodology (2008-2020) — extends the trend
            url2 = ("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
                    f"sbs_na_ind_r2?format=JSON&lang=en&{geo_params}"
                    f"&nace_r2=C2013&nace_r2=C20&" + "&".join(f"indic_sb={c}" for c in ARCHIVED) +
                    f"&sinceTimePeriod=2008")
            resp2 = client.get(url2)
            resp2.raise_for_status()
            payloads.append((url2, {"dataset": "sbs_na_ind_r2 (pre-2021 methodology)",
                                    "dim": "indic_sb",
                                    "codes": ARCHIVED,
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
                    unit=UNITS[series_id],
                    currency="EUR" if UNITS[series_id].startswith("EUR") else None,
                    band=coords.get("nace_r2"),   # NACE stored in band for filtering
                    source="Eurostat",
                    source_dataset=f"{payload['dataset']} ({coords.get('nace_r2')})",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows
