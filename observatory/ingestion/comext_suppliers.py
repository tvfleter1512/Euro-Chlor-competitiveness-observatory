"""Trade agent, supplier detail — Comext imports by EVERY partner country.

Feeds the Core Dependency Indicators: per-country import values give the HHI
(CDI 1); the INT_/EXT_EU27_2020 aggregates give reliance (CDI 2); intra-EU
exports (fetched here) plus extra-EU exports (comext_trade agent) give the
substitution ratio (CDI 3). Value only — CDIs are value-based.
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.jsonstat import iter_observations
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START, load_config

BASE = "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/DS-045409"
AGG_GEO = {"EXT_EU27_2020": "EXTRA_EU", "INT_EU27_2020": "INTRA_EU"}


class ComextSupplierAgent(IngestionAgent):
    name = "comext_suppliers"
    source = "Eurostat Comext DS-045409 (all partners)"

    def fetch(self):
        basket = load_config("product_basket")["products"]
        payloads = []
        with httpx.Client(timeout=240) as client:
            for product in basket:
                for cn8 in product["cn8"]:
                    # all partners, both flows — individual countries AND the
                    # INT_/EXT_EU27_2020 aggregates come back in one response
                    for flow in ("1", "2"):
                        url = (f"{BASE}?format=JSON&lang=en&freq=M&reporter=EU27_2020"
                               f"&product={cn8}&flow={flow}&sinceTimePeriod={HISTORY_START}-01")
                        resp = client.get(url)
                        resp.raise_for_status()
                        payloads.append((url, resp.json()))
        return payloads

    def parse(self, payloads):
        conv = load_config("conversions")["units"]["comext_100kg_to_tonne"]
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        self._partner_labels = {}
        for url, payload in payloads:
            labels = payload["dimension"]["partner"]["category"].get("label", {})
            for coords, value in iter_observations(payload):
                indicator = coords["indicators"]
                if value is None:
                    continue
                if indicator == "VALUE_IN_EUROS":
                    series_id, val, unit, cur = "trade.value", float(value), "EUR", "EUR"
                elif indicator == "QUANTITY_IN_100KG":   # tonnage-parallel CDIs
                    series_id, val, unit, cur = "trade.quantity", float(value) * conv, "t", None
                else:
                    continue
                partner = AGG_GEO.get(coords["partner"], coords["partner"])
                if partner not in AGG_GEO.values():
                    self._partner_labels[partner] = labels.get(coords["partner"], partner)
                period = coords["time"]
                rows.append(SeriesRow(
                    series_id=series_id,
                    geo_id="EU27_2020",
                    partner_geo_id=partner,
                    product_code=coords["product"],
                    flow={"1": "import", "2": "export"}[coords["flow"]],
                    period=period,
                    period_start=period_start(period),
                    value=val,
                    unit=unit,
                    currency=cur,
                    source="Eurostat Comext",
                    source_dataset="DS-045409 (partner detail)",
                    reference_period=period,
                    retrieved_at=retrieved_at,
                ))
        return rows

    def pre_insert(self, conn, rows):
        """Register any new partner country in dim_geo before the FK check."""
        for geo_id, name in self._partner_labels.items():
            conn.execute(
                """INSERT INTO dim_geo (geo_id, name, kind) VALUES (%s, %s, 'country')
                   ON CONFLICT (geo_id) DO NOTHING""",
                (geo_id, name))
