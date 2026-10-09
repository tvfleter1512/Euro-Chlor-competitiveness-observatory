"""US labour agent — BLS Quarterly Census of Employment and Wages (QCEW).

NAICS 325180 'other basic inorganic chemical manufacturing' (the US
counterpart of NACE C20.13, includes chlor-alkali), private ownership,
annual averages for the US, Louisiana and Texas (the Gulf Coast producers
Argus models). Public open-data CSV, no key. Feeds the labour-cost check on
the Argus fixed costs (processing/labour.py).

Wages are wages and salaries only: QCEW excludes employer health insurance
and payroll taxes, so compare them with EU wages, not EU personnel costs.
"""
import csv
import io
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START

URL = "https://data.bls.gov/cew/data/api/{year}/a/industry/325180.csv"
AREAS = {"US000": "US", "22000": "US_LA", "48000": "US_TX"}
FIELDS = {"total_annual_wages": ("structure.wages", "USD", "USD"),
          "annual_avg_emplvl": ("structure.employees", "persons", None)}
HEADERS = {"User-Agent": "Mozilla/5.0 (Euro Chlor Competitiveness Observatory)"}


class BLSQCEWAgent(IngestionAgent):
    name = "bls_qcew"
    source = "US BLS QCEW"

    def fetch(self):
        payloads = []
        with httpx.Client(timeout=120, headers=HEADERS) as client:
            for year in range(HISTORY_START, datetime.now(timezone.utc).year):
                url = URL.format(year=year)
                resp = client.get(url)
                if resp.status_code == 404:      # annual file not published yet
                    continue
                resp.raise_for_status()
                rows = [r for r in csv.DictReader(io.StringIO(resp.text))
                        if r["own_code"] == "5" and r["area_fips"] in AREAS]
                payloads.append((url, {"year": year, "rows": rows}))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        out = []
        for url, payload in payloads:
            for r in payload["rows"]:
                if r.get("disclosure_code") == "N":   # suppressed for confidentiality
                    continue
                period = r["year"]
                for field, (series_id, unit, currency) in FIELDS.items():
                    out.append(SeriesRow(
                        series_id=series_id,
                        geo_id=AREAS[r["area_fips"]],
                        period=period,
                        period_start=period_start(period),
                        value=float(r[field]),
                        unit=unit,
                        currency=currency,
                        band="NAICS325180",
                        source="US Bureau of Labor Statistics",
                        source_dataset=f"QCEW annual averages, NAICS 325180, private ({field})",
                        reference_period=period,
                        retrieved_at=retrieved_at,
                    ))
        return out
