"""PRODCOM agent — EU sold production for the chlor-alkali core (assessment §2.11).

Eurostat DS-059358 via the Comext SDMX 2.1 endpoint (the JSON-stat endpoint
does not filter this dataset). Annual PRODQNT (kg -> t) and PRODVAL (EUR).

CAVEAT stored with every row: PRODCOM measures SOLD production — chlorine is
mostly consumed captively on-site, so sold << total production (cf. Euro Chlor
stats). Fine for caustic (mostly merchant); weak for chlorine.
"""
import re
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START, load_config

URL = ("https://ec.europa.eu/eurostat/api/comext/dissemination/sdmx/2.1/data/"
       "DS-059358/A.EU27_2020.{products}./?startPeriod={start}")

# PRODCOM list codes (CXT_PRODCOM2_SOLD v6.0) — human-confirmable config
PRODUCTS = {
    "20132111": "Chlorine (PRODCOM, sold production)",
    "20132525": "Caustic soda, solid (PRODCOM, sold production)",
    "20132527": "Caustic soda lye (PRODCOM, sold production)",
    "20132413": "Hydrochloric acid (PRODCOM, sold production)",
}


class ProdcomAgent(IngestionAgent):
    name = "prodcom"
    source = "Eurostat PRODCOM DS-059358"

    def fetch(self):
        url = URL.format(products="+".join(PRODUCTS), start=HISTORY_START)
        resp = httpx.get(url, timeout=180)
        resp.raise_for_status()
        return [(url, {"xml": resp.text})]

    def parse(self, payloads):
        kg_to_t = load_config("conversions")["units"].get("kg_to_tonne", 0.001)
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            for s in re.findall(r"<g:Series>.*?</g:Series>", payload["xml"], re.S):
                key = dict(re.findall(r'<g:Value id="([^"]+)" value="([^"]+)"/>', s))
                indicator = key.get("indicators")
                product = key.get("product")
                if product not in PRODUCTS or indicator not in ("PRODQNT", "PRODVAL"):
                    continue
                for year, val in re.findall(
                        r'<g:ObsDimension value="([^"]+)"/><g:ObsValue value="([^"]*)"/>', s):
                    if not val:
                        continue
                    qty = indicator == "PRODQNT"
                    rows.append(SeriesRow(
                        series_id="production.sold_production" if qty
                                  else "production.sold_production_value",
                        geo_id="EU27_2020",
                        product_code=product,
                        period=year,
                        period_start=period_start(year),
                        value=float(val) * (kg_to_t if qty else 1.0),
                        unit="t" if qty else "EUR",
                        currency=None if qty else "EUR",
                        source="Eurostat PRODCOM",
                        source_dataset="DS-059358 (sold production — excludes captive use)",
                        reference_period=year,
                        retrieved_at=retrieved_at,
                    ))
        return rows

    def pre_insert(self, conn, rows):
        for code, name in PRODUCTS.items():
            conn.execute(
                """INSERT INTO dim_product (product_code, nomenclature, name, confirmed)
                   VALUES (%s, 'PRODCOM', %s, FALSE) ON CONFLICT (product_code) DO NOTHING""",
                (code, name))
