"""China spot-price agent — SunSirs daily quotes (RMB/t).

Products (config below): caustic soda (32% ion-membrane) and PVC. Each page
shows only the last ~6 daily prices, so the series accumulate via the daily
cron run; vintages make re-runs safe. SunSirs gates with a JS cookie challenge
whose token is embedded in the challenge page — a two-step fetch passes it.

NBS monthly output is geo-blocked from EU IPs (HTTP 403, checked 2026-07);
if needed, add a curated file-drop like proxy_tariffs.
"""
import re
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow

BASE = "https://www.sunsirs.com/uk/prodetail-{pid}.html"
UA = {"User-Agent": "Mozilla/5.0 (compatible; EuroChlorObservatory/1.0)"}

PRODUCTS = [
    {"pid": 368, "commodity": "Caustic soda", "series_id": "price.caustic_spot_cn",
     "price_basis": "32pct_spot",
     "dataset": "China caustic soda (32% ion-membrane) daily spot"},
    {"pid": 107, "commodity": "PVC", "series_id": "price.pvc_spot_cn",
     "price_basis": "spot",
     "dataset": "China PVC daily spot"},
]


class SunSirsChinaAgent(IngestionAgent):
    name = "sunsirs_china"
    source = "SunSirs China Commodity Data Group"

    def fetch(self):
        payloads = []
        with httpx.Client(timeout=60, headers=UA, follow_redirects=True) as client:
            for spec in PRODUCTS:
                url = BASE.format(pid=spec["pid"])
                resp = client.get(url)
                token = re.search(r'"([0-9a-f]{32})"', resp.text)
                if token and "HW_CHECK" in resp.text:
                    client.cookies.set("HW_CHECK", token.group(1))
                    resp = client.get(url)
                resp.raise_for_status()
                if spec["commodity"] not in resp.text:
                    raise RuntimeError(
                        f"SunSirs challenge not passed or layout changed for {spec['commodity']}")
                payloads.append((url, {"html": resp.text, "spec": spec}))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            spec = payload["spec"]
            text = re.sub(r"<[^>]+>", "|", payload["html"])
            pattern = (re.escape(spec["commodity"])
                       + r"\|+[^|]+\|+([\d.,]+)\|+(20\d\d-\d\d-\d\d)")
            for m in re.finditer(pattern, text):
                price = float(m.group(1).replace(",", ""))
                day = m.group(2)
                rows.append(SeriesRow(
                    series_id=spec["series_id"],
                    geo_id="CN",
                    period=day,
                    period_start=period_start(day[:7]),
                    value=price,
                    unit="RMB/t",
                    currency="CNY",
                    price_basis=spec["price_basis"],
                    source="SunSirs",
                    source_dataset=spec["dataset"],
                    reference_period=day,
                    retrieved_at=retrieved_at,
                ))
        return rows
