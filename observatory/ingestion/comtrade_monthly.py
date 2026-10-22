"""Trade agent, competitors' monthly leg — UN Comtrade, monthly HS6, by partner.

Where the comparator countries (config regions.comtrade_reporters) export the
basket products and where they import from, month by month: e.g. whether US
or Indian caustic soda heads to the EU or elsewhere. Complements the annual
comtrade_trade agent (partner = world) and Comext (the EU's own view).

Coverage depends on each reporter's filing to the UN: in Oct 2026 the US and
India were current to mid-2026, Saudi Arabia lagged a quarter, China stopped
at Dec 2024 and the UAE files no monthly data. Rows are stored per ISO2
partner (Eurostat-style codes where they differ), plus WORLD and an EU27_2020
sum. Values USD (EUR at display), net weight kg -> t. Last 36 months only,
to stay inside the free tier (500 calls/day). Dormant until COMTRADE_KEY.
"""
import time
from collections import defaultdict
from datetime import date, datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import COMTRADE_KEY, load_config

URL = "https://comtradeapi.un.org/data/v1/get/C/M/HS"
PARTNERS_URL = "https://comtradeapi.un.org/files/v1/app/reference/partnerAreas.json"
FLOW = {"M": "import", "X": "export"}
MONTHS = 36
EU27 = {"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
        "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"}
ISO_TO_GEO = {"RS": "XS"}          # Comext codes Serbia as XS
CODE_TO_GEO = {490: "TW"}          # 'Other Asia, nes' = Taiwan in UN usage


def recent_months(n: int, today: date) -> list[str]:
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append(f"{y}{m:02d}")
    return sorted(out)


def partner_geo(code: int, iso2: dict) -> str | None:
    if code == 0:
        return "WORLD"
    if code in CODE_TO_GEO:
        return CODE_TO_GEO[code]
    geo = iso2.get(code)
    return ISO_TO_GEO.get(geo, geo) if geo else None


class ComtradeMonthlyAgent(IngestionAgent):
    name = "comtrade_monthly"
    source = "UN Comtrade (monthly)"

    def available(self):
        if not COMTRADE_KEY:
            return False, "COMTRADE_KEY not set — register at comtradeplus.un.org (free tier)"
        return True, ""

    def fetch(self):
        reporters = load_config("regions")["comtrade_reporters"]
        hs6 = ",".join(p["hs6"] for p in load_config("product_basket")["products"])
        months = recent_months(MONTHS, datetime.now(timezone.utc).date())
        headers = {"Ocp-Apim-Subscription-Key": COMTRADE_KEY}
        payloads = []
        with httpx.Client(timeout=180) as client:
            ref = client.get(PARTNERS_URL)
            ref.raise_for_status()
            payloads.append((PARTNERS_URL, {"partners": [
                [p["PartnerCode"], p.get("PartnerCodeIsoAlpha2"), p["PartnerDesc"]]
                for p in ref.json()["results"]]}))
            for geo_id, code in reporters.items():
                for i in range(0, len(months), 12):      # the API takes up to 12 periods per call
                    params = {"reporterCode": code, "period": ",".join(months[i:i + 12]),
                              "cmdCode": hs6, "flowCode": "M,X", "maxRecords": 100000,
                              "includeDesc": "false"}
                    resp = client.get(URL, params=params, headers=headers)
                    resp.raise_for_status()
                    payloads.append((str(resp.request.url), {"geo": geo_id, "data": resp.json()}))
                    time.sleep(1.2)                       # free tier: ~1 call per second
        return payloads

    def parse(self, payloads):
        ref = next(p["partners"] for _, p in payloads if "partners" in p)
        iso2 = {c: a for c, a, _ in ref if a}
        self._partner_labels = {partner_geo(c, iso2): name.strip() for c, _, name in ref
                                if partner_geo(c, iso2) not in (None, "WORLD")}
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        eu = defaultdict(lambda: [0.0, 0.0, False])   # (geo, hs6, flow, period) -> value, tonnes, has_qty
        partner_t = defaultdict(float)                 # same key -> tonnes summed over partners
        world_no_qty = {}                              # same key -> world value lacking a weight
        for url, payload in payloads:
            if "data" not in payload:
                continue
            geo = payload["geo"]
            for rec in payload["data"].get("data", []):
                flow = FLOW.get(rec.get("flowCode"))
                if flow is None or rec.get("motCode") != 0 or rec.get("customsCode") != "C00" \
                        or rec.get("partner2Code") != 0:
                    continue
                partner = partner_geo(rec["partnerCode"], iso2)
                if partner is None or partner == geo:
                    continue
                period = f"{str(rec['period'])[:4]}-{str(rec['period'])[4:6]}"
                value, kg = rec.get("primaryValue"), rec.get("netWgt")
                key = (geo, rec["cmdCode"], flow, period)
                if partner == "WORLD" and not kg:
                    world_no_qty[key] = value     # Comtrade's world aggregate sometimes has no weight
                elif partner != "WORLD" and kg:
                    partner_t[key] += kg / 1000
                if partner in EU27:
                    acc = eu[(geo, rec["cmdCode"], flow, period)]
                    acc[0] += value or 0
                    if kg:
                        acc[1] += kg / 1000
                        acc[2] = True
                rows += self._rows(geo, partner, rec["cmdCode"], flow, period, value,
                                   kg / 1000 if kg else None, retrieved_at)
        for (geo, hs6, flow, period), value in world_no_qty.items():
            tonnes = partner_t.get((geo, hs6, flow, period))
            if tonnes:
                rows.append(SeriesRow(
                    series_id="trade.quantity", value=tonnes, unit="t", geo_id=geo, partner_geo_id="WORLD",
                    product_code=hs6, flow=flow, period=period, period_start=period_start(period),
                    source="UN Comtrade",
                    source_dataset="C/M/HS via comtradeapi.un.org (world weight = sum of partner weights; aggregate had none)",
                    quality_flag="estimated", reference_period=period, retrieved_at=retrieved_at))
        for (geo, hs6, flow, period), (value, tonnes, has_qty) in eu.items():
            rows += self._rows(geo, "EU27_2020", hs6, flow, period, value,
                               tonnes if has_qty else None, retrieved_at, eu_sum=True)
        return rows

    def _rows(self, geo, partner, hs6, flow, period, value, tonnes, retrieved_at, eu_sum=False):
        common = dict(geo_id=geo, partner_geo_id=partner, product_code=hs6, flow=flow,
                      period=period, period_start=period_start(period),
                      source="UN Comtrade",
                      source_dataset="C/M/HS via comtradeapi.un.org" + (" (sum of EU27 partners)" if eu_sum else ""),
                      reference_period=period, retrieved_at=retrieved_at)
        out = []
        if value is not None:
            out.append(SeriesRow(series_id="trade.value", value=float(value), unit="USD", currency="USD", **common))
        if tonnes is not None:
            out.append(SeriesRow(series_id="trade.quantity", value=float(tonnes), unit="t", **common))
        return out

    def pre_insert(self, conn, rows):
        """Register partner countries not yet in dim_geo before the FK check."""
        for geo_id, name in self._partner_labels.items():
            conn.execute(
                """INSERT INTO dim_geo (geo_id, name, kind) VALUES (%s, %s, 'country')
                   ON CONFLICT (geo_id) DO NOTHING""", (geo_id, name))
