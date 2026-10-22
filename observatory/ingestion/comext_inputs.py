"""Raw-material agent — EU trade in electrolysis salt, Eurostat Comext DS-045409.

Monthly EU27 imports from extra-EU and from other member states (intra-EU, the
bulk of the salt trade) for the CN8 lines in config/input_products.yaml.
Unit values (EUR/t) are a public check on the salt cost in the Argus study,
as wages are for its fixed costs. Quantities arrive in 100 kg -> tonnes.
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.jsonstat import iter_observations
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START, load_config

BASE = "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/DS-045409"
PARTNER_GEO = {"EXT_EU27_2020": "EXTRA_EU", "INT_EU27_2020": "INTRA_EU"}


class ComextInputsAgent(IngestionAgent):
    name = "comext_inputs"
    source = "Eurostat Comext DS-045409 (raw materials)"

    def fetch(self):
        products = load_config("input_products")["products"]
        url = (f"{BASE}?format=JSON&lang=en&freq=M&reporter=EU27_2020"
               + "".join(f"&partner={p}" for p in PARTNER_GEO)
               + "".join(f"&product={p['cn8']}" for p in products)
               + f"&flow=1&sinceTimePeriod={HISTORY_START}-01")
        resp = httpx.get(url, timeout=180)
        resp.raise_for_status()
        return [(url, resp.json())]

    def parse(self, payloads):
        conv = load_config("conversions")["units"]["comext_100kg_to_tonne"]
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            for coords, value in iter_observations(payload):
                if value is None:
                    continue
                indicator = coords["indicators"]
                if indicator == "VALUE_IN_EUROS":
                    series_id, val, unit, currency = "trade.value", float(value), "EUR", "EUR"
                elif indicator == "QUANTITY_IN_100KG":
                    series_id, val, unit, currency = "trade.quantity", float(value) * conv, "t", None
                else:
                    continue
                period = coords["time"]
                rows.append(SeriesRow(
                    series_id=series_id,
                    geo_id="EU27_2020",
                    partner_geo_id=PARTNER_GEO[coords["partner"]],
                    product_code=coords["product"],
                    flow="import",
                    period=period,
                    period_start=period_start(period),
                    value=val,
                    unit=unit,
                    currency=currency,
                    source="Eurostat Comext",
                    source_dataset="DS-045409 (raw materials, imports)",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows
