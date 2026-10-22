"""Carbon agent, price leg — EUA secondary-market price via the ICAP
Allowance Price Explorer open API (assessment §2.8).

Daily EUR/tCO2 closes aggregated to monthly averages. Two ICAP system ids
cover the history: 33 (EU ETS until 2018) and 34 (from 2019). Each daily
value is a triple [USD, EUR nominal, EUR]; the EUR nominal (index 1) is used
(index 0 is USD — checked against EEX auction prices, Oct 2026).

ICAP updates in batches (its feed stopped at 2026-06-30 for months), so
months after ICAP's last day are filled from EEX primary-auction clearing
prices, flagged 'estimated': auctions clear on average ~1.5 % below the ICAP
secondary-market mean (2025-01..2026-06, max 2.9 %). ICAP replaces them once
it catches up. Benchmarks/aid constants live in config/carbon.yaml ->
benchmark_constant table, NOT here.
"""
import io
from collections import defaultdict
from datetime import datetime, timezone

import httpx
import openpyxl

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START

URL = "https://allowancepriceexplorer.icapcarbonaction.com/api/systems"
EU_SYSTEM_IDS = {33: "EU ETS (until 2018)", 34: "EU ETS (from 2019)"}
UA = {"User-Agent": "Mozilla/5.0 (compatible; EuroChlorObservatory/1.0)"}
EEX = ("https://public.eex-group.com/eex/eua-auction-report/"
       "emission-spot-primary-market-auction-report-{year}-data.xlsx")
ICAP_EUR = 1   # index of the nominal EUR price in ICAP's value triple


def eex_auctions(xlsx: bytes) -> list[list]:
    """[[YYYY-MM-DD, clearing price EUR/tCO2], ...] from an EEX yearly auction report."""
    ws = openpyxl.load_workbook(io.BytesIO(xlsx), read_only=True, data_only=True).worksheets[0]
    out = []
    for r in ws.iter_rows(values_only=True):
        # columns: _, Date, Time, Auction Name, Contract, Status, Auction Price, ...
        if len(r) > 6 and hasattr(r[1], "year") and r[5] == "successful" and isinstance(r[6], (int, float)):
            out.append([r[1].strftime("%Y-%m-%d"), float(r[6])])
    return out


def monthly_rows(icap_systems: list, auctions: list) -> list[tuple]:
    """(period, mean EUR price, basis) per month: ICAP secondary where it has data,
    EEX auctions for complete-or-current months after ICAP's last day."""
    secondary = defaultdict(list)
    last_icap = ""
    for system in icap_systems:
        for day, triple in system["secondary"].items():
            if int(day[:4]) < HISTORY_START:
                continue
            price = triple[ICAP_EUR] if isinstance(triple, list) else triple
            if price is not None:
                secondary[day[:7]].append(float(price))
                last_icap = max(last_icap, day)
    auction = defaultdict(list)
    for day, price in auctions:
        if day[:7] > last_icap[:7]:
            auction[day[:7]].append(price)
    out = [(p, sum(v) / len(v), "secondary_market") for p, v in secondary.items()]
    out += [(p, sum(v) / len(v), "primary_auction") for p, v in auction.items()]
    return sorted(out)


class EUAPriceAgent(IngestionAgent):
    name = "eua_price"
    source = "ICAP Allowance Price Explorer"

    def fetch(self):
        resp = httpx.get(URL, timeout=90, headers=UA, follow_redirects=True)
        resp.raise_for_status()
        systems = resp.json()
        keep = [{"id": s["id"], "name": s["name"],
                 "secondary": s["values"]["secondary"]}
                for s in systems if s["id"] in EU_SYSTEM_IDS]
        if not keep:
            raise RuntimeError("ICAP payload no longer contains EU ETS systems 33/34")
        payloads = [(URL, {"systems": keep})]
        # EEX auction reports for the current and previous year (gap filler)
        this_year = datetime.now(timezone.utc).year
        for year in (this_year - 1, this_year):
            r = httpx.get(EEX.format(year=year), timeout=90, headers=UA, follow_redirects=True)
            if r.status_code == 200:
                payloads.append((EEX.format(year=year), {"auctions": eex_auctions(r.content)}))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        systems = [s for _, p in payloads for s in p.get("systems", [])]
        auctions = [a for _, p in payloads for a in p.get("auctions", [])]
        rows = []
        for period, value, basis in monthly_rows(systems, auctions):
            icap = basis == "secondary_market"
            rows.append(SeriesRow(
                series_id="carbon.eua_price",
                geo_id="EU27_2020",
                period=period,
                period_start=period_start(period),
                value=round(value, 2),
                unit="EUR/tCO2",
                currency="EUR",
                price_basis=basis,
                source="ICAP" if icap else "EEX",
                source_dataset=("Allowance Price Explorer, EU ETS secondary market, monthly average of daily nominal EUR"
                                if icap else
                                "EU ETS primary-market auction reports, monthly mean clearing price (fills months ICAP has not published)"),
                quality_flag="ok" if icap else "estimated",
                reference_period=period,
                retrieved_at=retrieved_at,
            ))
        return rows
