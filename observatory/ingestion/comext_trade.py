"""Trade agent, EU leg — Eurostat Comext DS-045409, monthly, CN8 detail.

EU27 reporter vs extra-EU aggregate + key partners. One request per basket
product (Comext cannot be pulled whole — spec §6). Quantities arrive in 100 kg
and are normalised to tonnes per the conversion registry.
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.jsonstat import iter_observations
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START, load_config

BASE = "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/DS-045409"
PARTNERS = ["EXT_EU27_2020", "US", "CN", "IN", "SA", "AE"]
PARTNER_GEO = {"EXT_EU27_2020": "EXTRA_EU"}   # others map to themselves
FLOW = {"1": "import", "2": "export"}


class ComextTradeAgent(IngestionAgent):
    name = "comext_trade"
    source = "Eurostat Comext DS-045409"

    def fetch(self):
        basket = load_config("product_basket")["products"]
        partner_params = "&".join(f"partner={p}" for p in PARTNERS)
        payloads = []
        with httpx.Client(timeout=180) as client:
            for product in basket:
                for cn8 in product["cn8"]:
                    url = (f"{BASE}?format=JSON&lang=en&freq=M&reporter=EU27_2020"
                           f"&{partner_params}&product={cn8}&flow=1&flow=2"
                           f"&sinceTimePeriod={HISTORY_START}-01")
                    resp = client.get(url)
                    resp.raise_for_status()
                    payloads.append((url, resp.json()))
        return payloads

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
                    partner_geo_id=PARTNER_GEO.get(coords["partner"], coords["partner"]),
                    product_code=coords["product"],
                    flow=FLOW[coords["flow"]],
                    period=period,
                    period_start=period_start(period),
                    value=val,
                    unit=unit,
                    currency=currency,
                    source="Eurostat Comext",
                    source_dataset="DS-045409",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows
