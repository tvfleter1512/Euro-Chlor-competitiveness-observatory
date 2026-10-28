"""Trade agent, US fast leg — US Census Bureau international trade API, monthly.

US exports of the basket products (HS6) to the world and to the European
Union, published about five weeks after the month — ahead of UN Comtrade.
The US is the EU's largest caustic-soda supplier, so this is the earliest
public read on what is heading to Europe and at what price.

Census reports ALL_VAL_MO in USD (EUR at display) and a quantity (QTY_1_MO in
UNIT_QY1) only at the HS10 level, so every HS10 line under each HS6 is fetched
and summed; the quantity is kept only when all lines report kilograms/tonnes.
Partner rows: 'TOTAL FOR ALL COUNTRIES' -> WORLD, 'EUROPEAN UNION' -> EU27_2020.

US imports of the same products are fetched too, with GEN_CHA_MO: the freight,
insurance and other charges paid to bring the goods from the foreign port to the
US (series trade.import_charges). Import value (GEN_VAL_MO) is the customs value,
at the foreign port. Charges / tonnes = measured freight cost per tonne, EU -> US.
Dormant until CENSUS_KEY is set (free key: api.census.gov/data/key_signup.html).
"""
import time
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import CENSUS_KEY, HISTORY_START, load_config

URL = "https://api.census.gov/data/timeseries/intltrade/exports/hs"
IMPORTS_URL = "https://api.census.gov/data/timeseries/intltrade/imports/hs"
EXPORT_FIELDS = {"value": "ALL_VAL_MO", "qty": "QTY_1_MO"}
IMPORT_FIELDS = {"value": "GEN_VAL_MO", "qty": "GEN_QY1_MO", "charges": "GEN_CHA_MO"}
PARTNERS = {"TOTAL FOR ALL COUNTRIES": "WORLD", "EUROPEAN UNION": "EU27_2020"}
KG_PER_UNIT = {"KG": 1.0, "T": 1000.0}
EU_CTY_CODE = "0003"   # Census country code for the European Union


def parse_table(table: list[list], hs6: str, fields: dict = EXPORT_FIELDS) -> list[dict]:
    """Census [[header...], [row...], ...] at HS10 -> one dict per partner-month we
    keep, HS10 lines summed to the HS6."""
    if not table:
        return []
    head, acc = table[0], {}
    for raw in table[1:]:
        r = dict(zip(head, raw))
        geo = PARTNERS.get(str(r.get("CTY_NAME", "")).strip().upper())
        if geo is None or r.get(fields["value"]) in (None, ""):
            continue
        a = acc.setdefault((geo, r["time"]), {"usd": 0.0, "kg": 0.0, "qty_ok": True, "charges": 0.0})
        a["usd"] += float(r[fields["value"]])
        if "charges" in fields:
            a["charges"] += float(r.get(fields["charges"]) or 0)
        unit = str(r.get("UNIT_QY1") or "").upper()
        if unit in KG_PER_UNIT and r.get(fields["qty"]) not in (None, ""):
            a["kg"] += float(r[fields["qty"]]) * KG_PER_UNIT[unit]
        else:
            a["qty_ok"] = False
    return [{"partner": geo, "hs6": hs6, "period": period, "usd": a["usd"],
             "tonnes": a["kg"] / 1000 if a["qty_ok"] and a["kg"] > 0 else None,
             **({"charges_usd": a["charges"]} if "charges" in fields else {})}
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
        with httpx.Client(timeout=300) as client:
            for product in load_config("product_basket")["products"]:
                for flow, url, fields, commodity in (
                        ("export", URL, EXPORT_FIELDS, "E_COMMODITY"),
                        ("import", IMPORTS_URL, IMPORT_FIELDS, "I_COMMODITY")):
                    params = {"get": ",".join(["CTY_CODE", "CTY_NAME", *fields.values(), "UNIT_QY1"]),
                              commodity: product["hs6"] + "*", "COMM_LVL": "HS10",
                              "time": f"from {HISTORY_START}-01", "key": CENSUS_KEY}
                    if flow == "import":
                        params["CTY_CODE"] = EU_CTY_CODE   # only imports from the EU are used
                    for attempt in range(3):              # large answers occasionally time out
                        try:
                            resp = client.get(url, params=params)
                            break
                        except httpx.TimeoutException:
                            if attempt == 2:
                                raise
                            time.sleep(15 * (attempt + 1))
                    if resp.status_code == 204:          # no rows for this code
                        continue
                    resp.raise_for_status()
                    payloads.append((str(resp.request.url).replace(CENSUS_KEY, "***"),
                                     {"hs6": product["hs6"], "flow": flow, "table": resp.json()}))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            flow = payload.get("flow", "export")
            fields = IMPORT_FIELDS if flow == "import" else EXPORT_FIELDS
            for r in parse_table(payload["table"], payload["hs6"], fields):
                common = dict(geo_id="US", partner_geo_id=r["partner"], product_code=r["hs6"],
                              flow=flow, period=r["period"], period_start=period_start(r["period"]),
                              source="US Census Bureau",
                              source_dataset=f"timeseries/intltrade/{flow}s/hs (HS10 lines summed to HS6, monthly)",
                              reference_period=r["period"], retrieved_at=retrieved_at)
                rows.append(SeriesRow(series_id="trade.value", value=r["usd"], unit="USD", currency="USD", **common))
                if r["tonnes"] is not None:
                    rows.append(SeriesRow(series_id="trade.quantity", value=r["tonnes"], unit="t", **common))
                if "charges_usd" in r:
                    rows.append(SeriesRow(series_id="trade.import_charges", value=r["charges_usd"],
                                          unit="USD", currency="USD", **common))
        return rows
