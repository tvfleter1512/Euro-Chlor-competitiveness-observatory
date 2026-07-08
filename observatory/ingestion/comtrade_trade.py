"""Trade agent, non-EU leg — UN Comtrade, annual HS6, comparator reporters vs world.

Dormant until COMTRADE_KEY is set. Annual frequency conserves the free tier
(500 calls/day). Values are USD (converted to EUR in normalisation); net weight
kg -> tonnes per the conversion registry.
"""
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import COMTRADE_KEY, HISTORY_START, load_config

URL = "https://comtradeapi.un.org/data/v1/get/C/A/HS"
FLOW = {"M": "import", "X": "export"}


class ComtradeTradeAgent(IngestionAgent):
    name = "comtrade_trade"
    source = "UN Comtrade"

    def available(self):
        if not COMTRADE_KEY:
            return False, "COMTRADE_KEY not set — register at comtradeplus.un.org (free tier)"
        return True, ""

    def fetch(self):
        regions = load_config("regions")
        basket = load_config("product_basket")["products"]
        reporters = regions["comtrade_reporters"]           # {'US': '842', ...}
        hs6_codes = ",".join(p["hs6"] for p in basket)
        this_year = datetime.now(timezone.utc).year
        years = ",".join(str(y) for y in range(HISTORY_START, this_year + 1))
        payloads = []
        with httpx.Client(timeout=180) as client:
            # one call per reporter keeps each response under the 100k-record cap
            for geo_id, code in reporters.items():
                params = {
                    "reporterCode": code, "period": years, "cmdCode": hs6_codes,
                    "flowCode": "M,X", "partnerCode": "0",  # 0 = world
                    "includeDesc": "false",
                }
                resp = client.get(URL, params=params,
                                  headers={"Ocp-Apim-Subscription-Key": COMTRADE_KEY})
                resp.raise_for_status()
                payloads.append((str(resp.request.url), {"geo": geo_id, "data": resp.json()}))
        return payloads

    def parse(self, payloads):
        kg_to_t = 0.001
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            geo = payload["geo"]
            for rec in payload["data"].get("data", []):
                flow = FLOW.get(rec.get("flowCode"))
                if flow is None:
                    continue
                period = str(rec["period"])
                common = dict(
                    geo_id=geo, partner_geo_id="WORLD",
                    product_code=rec["cmdCode"], flow=flow,
                    period=period, period_start=period_start(period),
                    source="UN Comtrade", source_dataset="C/A/HS via comtradeapi.un.org",
                    reference_period=period, retrieved_at=retrieved_at,
                )
                if rec.get("primaryValue") is not None:
                    rows.append(SeriesRow(series_id="trade.value", value=float(rec["primaryValue"]),
                                          unit="USD", currency="USD", **common))
                if rec.get("netWgt"):
                    rows.append(SeriesRow(series_id="trade.quantity",
                                          value=float(rec["netWgt"]) * kg_to_t,
                                          unit="t", **common))
        return rows
