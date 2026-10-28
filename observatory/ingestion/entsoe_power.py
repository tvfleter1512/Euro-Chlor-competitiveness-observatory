"""Power-price agent, wholesale context — ENTSO-E day-ahead prices (doc type A44).

Dormant until ENTSOE_TOKEN is set. Hourly prices aggregated to monthly averages
per bidding zone at ingestion. Kept strictly separate from the delivered series:
series_id 'power.wholesale_day_ahead', price_basis 'wholesale' (spec: never conflate).
"""
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import ENTSOE_TOKEN, HISTORY_START, load_config

URL = "https://web-api.tp.entsoe.eu/api"
# Day-ahead periods are delivery days in CET/CEST: a day starts at 23:00 or 22:00 UTC
# the evening before, so months must be read in local time, not from the UTC string.
LOCAL_TZ = ZoneInfo("Europe/Brussels")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _local_month(start_utc: str) -> str:
    """'2024-11-30T23:00Z' -> '2024-12' (the delivery month in Brussels time)."""
    dt = datetime.fromisoformat(start_utc.replace("Z", "+00:00"))
    return dt.astimezone(LOCAL_TZ).strftime("%Y-%m")


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
                    # ENTSO-E intermittently answers 400 to a request it accepts
                    # seconds later, or times out; one flake must not fail the whole run.
                    for attempt in range(3):
                        try:
                            resp = client.get(URL, params=params)
                        except httpx.TimeoutException:
                            if attempt == 2:
                                raise
                            time.sleep(10 * (attempt + 1))
                            continue
                        if resp.status_code < 400 or attempt == 2:
                            break
                        time.sleep(10 * (attempt + 1))
                    resp.raise_for_status()
                    url_masked = str(resp.request.url).replace(ENTSOE_TOKEN, "***")
                    payloads.append((url_masked, {"zone": zone["geo_id"], "year": year, "xml": resp.text}))
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
                                monthly[_local_month(start)].append(price)
            year = payload.get("year")
            for month, prices in sorted(monthly.items()):
                if year and not month.startswith(str(year)):
                    continue   # edge day of a neighbouring year: that year's request covers it
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
