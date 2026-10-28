"""Freight cost per tonne on the EU's trade routes, measured from trade statistics.

No public freight index covers chemical tankers, and container indices are
route averages for all goods, so phase 1 measures freight on our own products:

- customs (EU -> US): US Census records the freight, insurance and other charges
  paid from the foreign port to the US (GEN_CHA_MO). Charges / tonnes, direct.
- mirror (all other routes): the importer values goods on arrival (CIF: cost,
  insurance, freight), the exporter at departure (FOB, or FAS for US exports).
  CIF unit value - FOB unit value = freight + insurance (+ loading) per tonne.
  US -> EU: Comext imports from US vs Census US exports to the EU.
  CN/IN/SA -> EU: Comext imports vs UN Comtrade exports to the EU (monthly).
  EU -> CN/IN/SA: Comtrade imports from the EU vs Comext exports.

Single months are noisy (a cargo leaves in one month and lands in the next; the
two sides value it differently), so every route is a trailing 12-month figure
from summed values and tonnes, not a mean of monthly ratios.
"""
import json
from collections import defaultdict
from datetime import date

from observatory.processing.normalisation import FXError, load_fx, to_eur
from observatory.settings import load_config

WINDOW = 12          # months in the rolling window
MIN_MONTHS = 9       # months with trade on both sides needed inside the window
MIN_TONNES = 1000    # tonnes on the arrival side over the window
# mirror only: both sides must count roughly the same tonnes, or they are not
# describing the same shipments (other grades, re-exports, misattributed partners)
TONNES_RATIO = (2 / 3, 1.5)
MAX_SHARE = 0.5      # mirror only: freight above half the landed price, above MAX_EUR_T,
MAX_EUR_T = 600      # or below 0 means the two sides price different grades under one code
                     # (600 EUR/t is above even the 2021 container peak, ~$12-15k per 40ft box)

# route key -> (origin, destination, method)
ROUTES = {
    "US_EU": ("US", "EU27_2020", "mirror"), "CN_EU": ("CN", "EU27_2020", "mirror"),
    "IN_EU": ("IN", "EU27_2020", "mirror"), "SA_EU": ("SA", "EU27_2020", "mirror"),
    "EU_US": ("EU27_2020", "US", "customs"), "EU_CN": ("EU27_2020", "CN", "mirror"),
    "EU_IN": ("EU27_2020", "IN", "mirror"), "EU_SA": ("EU27_2020", "SA", "mirror"),
}


def _months_back(month: str, n: int) -> list[str]:
    y, m = int(month[:4]), int(month[5:7])
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out


def rolling_freight(arrival: dict, departure: dict | None = None, charges: dict | None = None) -> list[dict]:
    """Pure core, for tests. Inputs are {'YYYY-MM': (eur, tonnes)}.

    mirror: arrival = CIF side, departure = FOB side -> CIF/t - FOB/t.
    customs: charges = {'YYYY-MM': (charges_eur, tonnes)} -> charges / tonnes.
    One row per month whose trailing window has MIN_MONTHS usable months (and, for
    mirror routes, arrival and departure tonnes within TONNES_RATIO of each other and
    freight between 0 and the smaller of MAX_SHARE of the landed price and MAX_EUR_T).
    """
    if charges is not None:
        months = sorted(m for m, (_, t) in charges.items() if t)
    else:
        months = sorted(m for m in arrival if m in departure and arrival[m][1] and departure[m][1])
    usable = set(months)
    out = []
    for month in months:
        window = [m for m in _months_back(month, WINDOW) if m in usable]
        if len(window) < MIN_MONTHS:
            continue
        if charges is not None:
            eur = sum(charges[m][0] for m in window)
            t = sum(charges[m][1] for m in window)
            if t < MIN_TONNES:
                continue
            out.append({"period": month, "value": eur / t, "tonnes": t, "months": len(window)})
            continue
        cif_eur, cif_t = (sum(arrival[m][i] for m in window) for i in (0, 1))
        fob_eur, fob_t = (sum(departure[m][i] for m in window) for i in (0, 1))
        if cif_t < MIN_TONNES or not TONNES_RATIO[0] <= cif_t / fob_t <= TONNES_RATIO[1]:
            continue
        cif, fob = cif_eur / cif_t, fob_eur / fob_t
        if not 0 <= cif - fob <= min(MAX_SHARE * cif, MAX_EUR_T):
            continue
        out.append({"period": month, "value": cif - fob, "cif_eur_t": cif, "fob_eur_t": fob,
                    "tonnes": cif_t, "tonnes_ratio": cif_t / fob_t, "months": len(window)})
    return out


def _load(conn, fx) -> dict:
    """{(product, reporter, partner, flow, series): {'YYYY-MM': EUR or tonnes}},
    monthly trade between the EU and the four comparators, values in EUR."""
    out = defaultdict(dict)
    geos = ["EU27_2020"] + [o for o, _, _ in ROUTES.values() if o != "EU27_2020"]
    for r in conn.execute(
            """SELECT product_code, geo_id, partner_geo_id, flow, series_id, period, period_start,
                      value, currency
               FROM v_series_latest
               WHERE series_id IN ('trade.value', 'trade.quantity', 'trade.import_charges')
                 AND period ~ '^\\d{4}-\\d{2}$' AND geo_id = ANY(%s) AND partner_geo_id = ANY(%s)""",
            (geos, geos)).fetchall():
        value = float(r["value"])
        if r["series_id"] != "trade.quantity":
            try:
                value = to_eur(value, r["currency"], r["period_start"], fx)[0]
            except FXError:
                continue
        out[(r["product_code"], r["geo_id"], r["partner_geo_id"], r["flow"], r["series_id"])][r["period"]] = value
    return out


def _pair(data: dict, product, reporter, partner, flow, money="trade.value") -> dict:
    """{'YYYY-MM': (eur, tonnes)} for months with both a value and a quantity."""
    eur = data.get((product, reporter, partner, flow, money), {})
    t = data.get((product, reporter, partner, flow, "trade.quantity"), {})
    return {m: (v, t[m]) for m, v in eur.items() if t.get(m)}


def compute(conn, run_id: int, cfg: dict) -> int:
    spec = cfg["freight_cost"]
    data = _load(conn, load_fx(conn))
    n = 0
    for product in load_config("product_basket")["products"]:
        cn8, hs6 = product["cn8"][0], product["hs6"]
        for route, (origin, dest, method) in ROUTES.items():
            if method == "customs":       # US imports from the EU, charges recorded by US customs
                rows = rolling_freight({}, charges=_pair(data, hs6, dest, origin, "import",
                                                         "trade.import_charges"))
                source = "US Census imports from the EU: import charges (GEN_CHA_MO) / tonnes"
            elif dest == "EU27_2020":     # EU imports (Comext, CIF) vs the partner's exports to the EU
                rows = rolling_freight(_pair(data, cn8, dest, origin, "import"),
                                       _pair(data, hs6, origin, dest, "export"))
                source = ("Comext EU imports (CIF) vs "
                          + ("US exports to the EU (FAS)" if origin == "US" else "UN Comtrade exports to the EU (FOB)"))
            else:                         # the partner's imports from the EU (CIF) vs EU exports (Comext, FOB)
                rows = rolling_freight(_pair(data, hs6, dest, origin, "import"),
                                       _pair(data, cn8, origin, dest, "export"))
                source = "UN Comtrade imports from the EU (CIF) vs Comext EU exports (FOB)"
            for r in rows:
                conn.execute(
                    """INSERT INTO fact_indicator
                       (indicator_id, methodology_version, geo_id, comparator_geo_id, product_code,
                        period, period_start, value, unit, inputs, run_id)
                       VALUES ('freight_cost',%s,%s,%s,%s,%s,%s,%s,'EUR/t',%s,%s)""",
                    (spec["methodology_version"], origin, dest, cn8, r["period"],
                     date(int(r["period"][:4]), int(r["period"][5:]), 1), round(r["value"], 2),
                     json.dumps({**{k: round(v, 2) if isinstance(v, float) else v for k, v in r.items()},
                                 "route": route, "method": method, "source": source}),
                     run_id))
                n += 1
    return n
