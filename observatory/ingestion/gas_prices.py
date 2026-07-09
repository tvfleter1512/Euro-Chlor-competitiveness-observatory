"""Gas-price agent — the causal driver behind the electricity ratio (assessment §2.2).

Two legs, never conflated (same discipline as power):
- gas.hub_price: monthly hub prices, USD/MMBtu — EU (IMF 'Natural gas, EU'
  series, TTF-based, FRED PNGASEUUSDM) vs US (Henry Hub, FRED MHHNGSP).
  FRED's fredgraph.csv endpoint is keyless.
- gas.industrial_delivered: Eurostat nrg_pc_203 (delivered industrial gas,
  GJ bands / tax treatments), converted to EUR/MWh like the power series.
"""
import csv
import io
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.jsonstat import iter_observations
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START, load_config

FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"
FRED_SERIES = [  # (fred id, geo, description)
    ("PNGASEUUSDM", "EU27_2020", "IMF Global price of Natural gas, EU (TTF-based)"),
    ("MHHNGSP", "US", "Henry Hub Natural Gas Spot Price, monthly"),
]
EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_203"


class GasPriceAgent(IngestionAgent):
    name = "gas_prices"
    source = "FRED (IMF/Henry Hub) + Eurostat nrg_pc_203"

    def fetch(self):
        payloads = []
        with httpx.Client(timeout=90, follow_redirects=True) as client:
            for sid, geo, desc in FRED_SERIES:
                url = FRED.format(sid=sid)
                resp = client.get(url)
                resp.raise_for_status()
                payloads.append((url, {"kind": "fred", "sid": sid, "geo": geo,
                                       "desc": desc, "csv": resp.text}))
            regions = load_config("regions")
            geos = [regions["eu"]["geo_id"]] + regions["eu"]["detail_countries"]
            geo_params = "&".join(f"geo={g}" for g in geos)
            url = (f"{EUROSTAT}?format=JSON&lang=en&currency=EUR&{geo_params}"
                   f"&sinceTimePeriod={HISTORY_START}")
            resp = client.get(url)
            resp.raise_for_status()
            payloads.append((url, {"kind": "eurostat", "data": resp.json()}))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        rows = []
        for url, payload in payloads:
            if payload["kind"] == "fred":
                for rec in csv.DictReader(io.StringIO(payload["csv"])):
                    date_s = rec.get("observation_date", "")
                    val = rec.get(payload["sid"], "")
                    if not date_s or val in ("", "."):
                        continue
                    if int(date_s[:4]) < HISTORY_START:
                        continue
                    period = date_s[:7]
                    rows.append(SeriesRow(
                        series_id="gas.hub_price",
                        geo_id=payload["geo"],
                        period=period,
                        period_start=period_start(period),
                        value=float(val),
                        unit="USD/MMBtu",
                        currency="USD",
                        price_basis="wholesale",
                        source="FRED",
                        source_dataset=f"{payload['sid']} — {payload['desc']}",
                        reference_period=period,
                        retrieved_at=retrieved_at,
                    ))
            else:
                for coords, value in iter_observations(payload["data"]):
                    if coords.get("unit") != "KWH" or value is None:
                        continue
                    period = coords["time"]
                    rows.append(SeriesRow(
                        series_id="gas.industrial_delivered",
                        geo_id=coords["geo"],
                        period=period,
                        period_start=period_start(period),
                        value=round(float(value) * 1000, 4),  # EUR/kWh -> EUR/MWh
                        unit="EUR/MWh",
                        currency="EUR",
                        price_basis="delivered",
                        band=coords["nrg_cons"],
                        tax_treatment=coords["tax"],
                        source="Eurostat",
                        source_dataset="nrg_pc_203",
                        reference_period=period,
                        retrieved_at=retrieved_at,
                    ))
        return rows
