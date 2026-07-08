"""Power-price agent, wholesale context — ENTSO-E day-ahead prices (doc type A44).

Dormant until ENTSOE_TOKEN is set. Hourly prices aggregated to monthly averages
per bidding zone at ingestion. Kept strictly separate from the delivered series:
series_id 'power.wholesale_day_ahead', price_basis 'wholesale' (spec: never conflate).
"""
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import ENTSOE_TOKEN, HISTORY_START, load_config

URL = "https://web-api.tp.entsoe.eu/api"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


class EntsoePowerAgent(IngestionAgent):
    name = "entsoe_power"
    source = "ENTSO-E Transparency (A44 day-ahead)"

    def available(self):
        if not ENTSOE_TOKEN:
            return False, ("ENTSOE_TOKEN not set — register at transparency.entsoe.eu, "
                           "then email transparency@entsoe.eu 'Restful API access'")
        return True, ""

    def fetch(self):
        zones = load_config("regions")["entsoe_bidding_zones"]
        this_year = datetime.now(timezone.utc).year
        payloads = []
        with httpx.Client(timeout=180) as client:
            for zone in zones:
                for year in range(HISTORY_START, this_year + 1):
                    params = {
                        "securityToken": ENTSOE_TOKEN,
                        "documentType": "A44",
                        "in_Domain": zone["eic"],
                        "out_Domain": zone["eic"],
                        "periodStart": f"{year}01010000",
                        "periodEnd": f"{year}12312300",
                    }
                    resp = client.get(URL, params=params)
                    resp.raise_for_status()
                    url_masked = str(resp.request.url).replace(ENTSOE_TOKEN, "***")
                    payloads.append((url_masked, {"zone": zone["geo_id"], "xml": resp.text}))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            zone = payload["zone"]
            root = ET.fromstring(payload["xml"])
            monthly = defaultdict(list)   # 'YYYY-MM' -> [prices]
            for ts in root:
                if _local(ts.tag) != "TimeSeries":
                    continue
                for period_el in ts:
                    if _local(period_el.tag) != "Period":
                        continue
                    start = None
                    for child in period_el:
                        if _local(child.tag) == "timeInterval":
                            for t in child:
                                if _local(t.tag) == "start":
                                    start = t.text          # '2015-01-01T23:00Z'
                        elif _local(child.tag) == "Point" and start:
                            price = None
                            for p in child:
                                if _local(p.tag) == "price.amount":
                                    price = float(p.text)
                            if price is not None:
                                monthly[start[:7]].append(price)
            for month, prices in sorted(monthly.items()):
                rows.append(SeriesRow(
                    series_id="power.wholesale_day_ahead",
                    geo_id=zone,
                    period=month,
                    period_start=period_start(month),
                    value=round(sum(prices) / len(prices), 4),
                    unit="EUR/MWh",
                    currency="EUR",
                    price_basis="wholesale",
                    source="ENTSO-E Transparency",
                    source_dataset="A44 day-ahead, monthly average of hourly prices",
                    reference_period=month,
                    retrieved_at=retrieved_at,
                ))
        return rows
