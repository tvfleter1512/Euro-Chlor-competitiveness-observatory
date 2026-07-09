"""China caustic spot-price agent — SunSirs daily 32% ion-membrane price (RMB/t).

Part of the China module (assessment §2.4). The page shows only the last ~6
daily prices, so the series accumulates via the daily cron run; vintages make
re-runs safe. SunSirs gates with a JS cookie challenge whose token is embedded
in the challenge page — a two-step fetch passes it.

NBS monthly caustic output is geo-blocked from EU IPs (HTTP 403, checked
2026-07); if needed, add a curated file-drop like proxy_tariffs.
"""
import re
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow

URL = "https://www.sunsirs.com/uk/prodetail-368.html"
UA = {"User-Agent": "Mozilla/5.0 (compatible; EuroChlorObservatory/1.0)"}


class SunSirsChinaAgent(IngestionAgent):
    name = "sunsirs_china"
    source = "SunSirs China Commodity Data Group"

    def fetch(self):
        with httpx.Client(timeout=60, headers=UA, follow_redirects=True) as client:
            resp = client.get(URL)
            token = re.search(r'"([0-9a-f]{32})"', resp.text)
            if token and "HW_CHECK" in resp.text:
                resp = client.get(URL, cookies={"HW_CHECK": token.group(1)})
            resp.raise_for_status()
            if "Caustic soda" not in resp.text:
                raise RuntimeError("SunSirs challenge not passed or page layout changed")
            return [(URL, {"html": resp.text})]

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            text = re.sub(r"<[^>]+>", "|", payload["html"])
            for m in re.finditer(
                    r"Caustic soda\|+Chemical\|+([\d.,]+)\|+(20\d\d-\d\d-\d\d)", text):
                price = float(m.group(1).replace(",", ""))
                day = m.group(2)
                rows.append(SeriesRow(
                    series_id="price.caustic_spot_cn",
                    geo_id="CN",
                    period=day,
                    period_start=period_start(day[:7]),
                    value=price,
                    unit="RMB/t",
                    currency="CNY",
                    price_basis="32pct_spot",
                    source="SunSirs",
                    source_dataset="China caustic soda (32% ion-membrane) daily spot",
                    reference_period=day,
                    retrieved_at=retrieved_at,
                ))
        return rows
