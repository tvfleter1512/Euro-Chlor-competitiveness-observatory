"""Trade agent, US fast leg — US Census Bureau international trade API, monthly.

US exports of the basket products (HS6) to the world and to the European
Union, published about five weeks after the month — ahead of UN Comtrade.
The US is the EU's largest caustic-soda supplier, so this is the earliest
public read on what is heading to Europe and at what price.

Census reports ALL_VAL_MO in USD (EUR at display) and a quantity (QTY_1_MO in
UNIT_QY1) only at the HS10 level, so every HS10 line under each HS6 is fetched
and summed; the quantity is kept only when all lines report kilograms/tonnes.
Partner rows: 'TOTAL FOR ALL COUNTRIES' -> WORLD, 'EUROPEAN UNION' -> EU27_2020.
Dormant until CENSUS_KEY is set (free key: api.census.gov/data/key_signup.html).
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import CENSUS_KEY, HISTORY_START, load_config

URL = "https://api.census.gov/data/timeseries/intltrade/exports/hs"
PARTNERS = {"TOTAL FOR ALL COUNTRIES": "WORLD", "EUROPEAN UNION": "EU27_2020"}
KG_PER_UNIT = {"KG": 1.0, "T": 1000.0}


def parse_table(table: list[list], hs6: str) -> list[dict]:
    """Census [[header...], [row...], ...] at HS10 -> one dict per partner-month we
    keep, HS10 lines summed to the HS6."""
    if not table:
        return []
    head, acc = table[0], {}
    for raw in table[1:]:
        r = dict(zip(head, raw))
        geo = PARTNERS.get(str(r.get("CTY_NAME", "")).strip().upper())
        if geo is None or r.get("ALL_VAL_MO") in (None, ""):
            continue
        a = acc.setdefault((geo, r["time"]), {"usd": 0.0, "kg": 0.0, "qty_ok": True})
        a["usd"] += float(r["ALL_VAL_MO"])
        unit = str(r.get("UNIT_QY1") or "").upper()
        if unit in KG_PER_UNIT and r.get("QTY_1_MO") not in (None, ""):
            a["kg"] += float(r["QTY_1_MO"]) * KG_PER_UNIT[unit]
        else:
            a["qty_ok"] = False
    return [{"partner": geo, "hs6": hs6, "period": period, "usd": a["usd"],
             "tonnes": a["kg"] / 1000 if a["qty_ok"] and a["kg"] > 0 else None}
            for (geo, period), a in sorted(acc.items(), key=lambda kv: (kv[0][1], kv[0][0]))]


class CensusTradeAgent(IngestionAgent):
    name = "census_trade"
    source = "US Census Bureau international trade API"

    def available(self):
        if not CENSUS_KEY:
            return False, "CENSUS_KEY not set — free key at https://api.census.gov/data/key_signup.html"
        return True, ""

    def fetch(self):
        payloads = []
        with httpx.Client(timeout=120) as client:
            for product in load_config("product_basket")["products"]:
                params = {"get": "CTY_CODE,CTY_NAME,ALL_VAL_MO,QTY_1_MO,UNIT_QY1",
                          "E_COMMODITY": product["hs6"] + "*", "COMM_LVL": "HS10",
                          "time": f"from {HISTORY_START}-01", "key": CENSUS_KEY}
                resp = client.get(URL, params=params)
                if resp.status_code == 204:          # no rows for this code
                    continue
                resp.raise_for_status()
                payloads.append((str(resp.request.url).replace(CENSUS_KEY, "***"),
                                 {"hs6": product["hs6"], "table": resp.json()}))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            for r in parse_table(payload["table"], payload["hs6"]):
                common = dict(geo_id="US", partner_geo_id=r["partner"], product_code=r["hs6"],
                              flow="export", period=r["period"], period_start=period_start(r["period"]),
                              source="US Census Bureau",
                              source_dataset="timeseries/intltrade/exports/hs (HS10 lines summed to HS6, monthly)",
                              reference_period=r["period"], retrieved_at=retrieved_at)
                rows.append(SeriesRow(series_id="trade.value", value=r["usd"], unit="USD", currency="USD", **common))
                if r["tonnes"] is not None:
                    rows.append(SeriesRow(series_id="trade.quantity", value=r["tonnes"], unit="t", **common))
        return rows
