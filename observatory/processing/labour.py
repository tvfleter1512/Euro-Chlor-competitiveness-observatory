"""Labour-cost indicators — a public-data check on the labour part of the Argus
fixed costs (manpower, maintenance, overheads, insurance, tax; report p.91).

wages_per_employee           EU (Eurostat SBS) and US (BLS QCEW), kEUR/employee —
                             wages and salaries only on both sides, so comparable.
personnel_cost_per_employee  EU only: wages + employer social charges (QCEW has no
                             equivalent), the figure closest to Argus' "manpower".
wages_index                  base_year = 100, EU4 vs US vs Louisiana — the growth
                             to set against the Argus fixed-cost escalation.

Levels use the narrow sector (C20.13 / NAICS 325180) from level_from on: earlier
C20.13 employee counts jump with reclassifications (DE 2017 x2.5). The index uses
C20 (all chemicals), complete and stable for the four countries.
"""
import json
from collections import defaultdict

from observatory.processing import normalisation as norm

SERIES = ("structure.wages", "structure.employees", "structure.personnel_costs")


def per_employee(totals: dict, employees: dict, scale: float) -> dict:
    """{year: total} / {year: persons} * scale -> {year: value}, both present and > 0."""
    return {y: totals[y] * scale / employees[y]
            for y in totals if employees.get(y) and totals[y] is not None}


def aggregate_per_employee(totals: dict, employees: dict, geos: list, scale: float) -> dict:
    """Σ totals / Σ employees over geos, only for years where every geo has both."""
    years = set.intersection(*(set(totals.get(g, {})) & set(employees.get(g, {})) for g in geos))
    return {y: sum(totals[g][y] for g in geos) * scale / sum(employees[g][y] for g in geos)
            for y in years}


def rebase(values: dict, base_year: str) -> dict:
    base = values.get(base_year)
    return {y: v / base * 100 for y, v in values.items()} if base else {}


def _annual_usd_rate(fx: dict) -> dict:
    """Mean of the twelve ECB monthly USD-per-EUR rates, complete years only."""
    by_year = defaultdict(list)
    for (cur, d), rate in fx.items():
        if cur == "USD":
            by_year[str(d.year)].append(rate)
    return {y: sum(r) / len(r) for y, r in by_year.items() if len(r) == 12}


def compute(conn, run_id: int, cfg: dict) -> int:
    spec = cfg["labour_cost"]
    p = spec["params"]
    data = defaultdict(lambda: defaultdict(dict))   # (series, band) -> geo -> year -> value
    for r in conn.execute(
            """SELECT series_id, band, geo_id, period, value FROM v_series_latest
               WHERE series_id = ANY(%s) AND period NOT LIKE '%%-%%'""",
            (list(SERIES),)).fetchall():
        data[(r["series_id"], r["band"])][r["geo_id"]][r["period"]] = float(r["value"])
    usd = _annual_usd_rate(norm.load_fx(conn))
    rows = []   # (indicator_id, geo, year, value, unit, inputs)

    # EU levels, narrow sector
    nace = p["level_nace"]
    for geo in p["eu_countries"]:
        for ind, series in (("wages_per_employee", "structure.wages"),
                            ("personnel_cost_per_employee", "structure.personnel_costs")):
            vals = per_employee(data[(series, nace)][geo], data[("structure.employees", nace)][geo], 1000)
            for y, v in vals.items():
                if y >= p["level_from"]:
                    rows.append((ind, geo, y, v, "kEUR/employee",
                                 {"sector": nace, "source": "Eurostat SBS sbs_ovw_act / sbs_na_ind_r2"}))

    # US levels, NAICS 325180, USD -> EUR at the annual mean ECB rate
    naics = p["us_naics"]
    us_w, us_e = data[("structure.wages", naics)], data[("structure.employees", naics)]
    us_w["US_GULF"] = {y: us_w["US_LA"][y] + us_w["US_TX"][y]
                       for y in us_w.get("US_LA", {}) if y in us_w.get("US_TX", {})}
    us_e["US_GULF"] = {y: us_e["US_LA"][y] + us_e["US_TX"][y]
                       for y in us_e.get("US_LA", {}) if y in us_e.get("US_TX", {})}
    us_levels = {}
    for geo in ("US", "US_LA", "US_TX", "US_GULF"):
        usd_vals = per_employee(us_w[geo], us_e[geo], 1 / 1000)          # kUSD/employee
        us_levels[geo] = usd_vals
        for y, v in usd_vals.items():
            if y in usd and y >= p["level_from"]:
                rows.append(("wages_per_employee", geo, y, v / usd[y], "kEUR/employee",
                             {"sector": naics, "kusd": round(v, 2), "usd_per_eur": round(usd[y], 4),
                              "source": "BLS QCEW annual averages, private"}))

    # growth index, base year = 100
    eu4 = aggregate_per_employee(data[("structure.wages", p["index_nace"])],
                                 data[("structure.employees", p["index_nace"])],
                                 p["eu_countries"], 1000)
    for geo, vals, sector in (("EU4", eu4, p["index_nace"]),
                              ("US", us_levels["US"], naics),
                              ("US_LA", us_levels["US_LA"], naics)):
        for y, v in rebase(vals, p["base_year"]).items():
            rows.append(("wages_index", geo, y, v, "index",
                         {"sector": sector, "base_year": p["base_year"], "currency": "local (EUR / USD)"}))

    for ind, geo, y, v, unit, inputs in rows:
        conn.execute(
            """INSERT INTO fact_indicator
               (indicator_id, methodology_version, geo_id, period, period_start,
                value, unit, inputs, run_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (ind, spec["methodology_version"], geo, y, f"{y}-01-01", round(v, 3), unit,
             json.dumps({**inputs, "params": p}), run_id))
    return len(rows)
