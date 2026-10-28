"""Serving API — normalised series, computed indicators, source health.

Every payload row carries its provenance (spec §8: no provenance, no render).
Model A: everything public; redistribution_class is served so a model-B
entitlement layer can be added in front without schema change.
"""
import base64
import secrets
from datetime import date

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from observatory import db
from observatory.processing import normalisation as norm
from observatory.settings import DASHBOARD_PASSWORD, PROJECT_ROOT, load_config

app = FastAPI(title="Euro Chlor Competitiveness Observatory", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1000)   # JSON and the JS bundle compress ~3-10x

# MEMBER_MODE: while the password gate is up, member-restricted (licensed)
# series are served. Replace with per-user entitlements on the cloud deployment.
MEMBER_MODE = bool(DASHBOARD_PASSWORD)


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    if DASHBOARD_PASSWORD:
        header = request.headers.get("authorization", "")
        ok = False
        if header.startswith("Basic "):
            try:
                _, _, password = base64.b64decode(header[6:]).decode().partition(":")
                ok = secrets.compare_digest(password, DASHBOARD_PASSWORD)
            except Exception:
                ok = False
        if not ok:
            return Response(status_code=401, content="Authentication required",
                            headers={"WWW-Authenticate": 'Basic realm="Euro Chlor Observatory"'})
    return await call_next(request)


@app.get("/api/mode")
def mode():
    return {"member_mode": MEMBER_MODE}


@app.get("/api/health")
def health():
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM v_source_health ORDER BY agent").fetchall()
        # newest data period each agent has landed (what the data covers, not when it ran)
        public_only = "" if MEMBER_MODE else " WHERE f.redistribution_class = 'public'"
        latest = {r["agent"]: r["latest_period"] for r in conn.execute(
            f"""SELECT r.agent, max(f.period) AS latest_period FROM fact_series f
                JOIN ingestion_run r USING (run_id){public_only} GROUP BY r.agent""").fetchall()}
    return {"agents": [{**r, "latest_period": latest.get(r["agent"])} for r in rows]}


# dedup key of v_series_latest / v_series_latest_public (db/schema.sql) — keep in step
LATEST_KEY = ("series_id, geo_id, COALESCE(partner_geo_id, ''), COALESCE(product_code, ''), "
              "COALESCE(flow, ''), COALESCE(band, ''), COALESCE(tax_treatment, ''), period")


@app.get("/api/series")
def series(
    series_id: str,
    geo: str | None = None,
    partner: str | None = None,
    product: str | None = None,
    flow: str | None = None,
    band: str | None = None,
    tax: str | None = None,
    freq: str | None = Query(None, description="'M' = sub-annual periods, 'A' = annual"),
    date_from: date | None = Query(None, alias="from"),
    limit: int = Query(20000, le=100000),
    eur: bool = Query(False, description="convert non-EUR money values to EUR (ECB monthly average; annual mean for annual periods)"),
):
    # Same rows as v_series_latest(_public), but the filters are applied to
    # fact_series BEFORE the latest-vintage dedup: the views sort the whole table
    # first (~1.2 M trade rows, 6-10 s per call); scoped, the indexes answer in
    # ~0.1 s. Safe because every filter is on a dedup-key column (period_start
    # follows period). Public mode restricts to public rows before deduping, as
    # v_series_latest_public does, so licensed vintages never shadow public data.
    where = ["series_id = %s"]
    params: list = [series_id]
    if not MEMBER_MODE:
        where.append("redistribution_class = 'public'")
    for col, val in (("geo_id", geo), ("partner_geo_id", partner),
                     ("product_code", product), ("flow", flow),
                     ("band", band), ("tax_treatment", tax)):
        if val is not None:
            where.append(f"{col} = %s")
            params.append(val)
    # one series can hold annual (survey) and monthly (statistics) periods for
    # the same geo — charts must pick one periodicity, never mix magnitudes
    if freq == "M":
        where.append("period LIKE '%%-%%'")
    elif freq == "A":
        where.append("period NOT LIKE '%%-%%'")
    if date_from:
        where.append("period_start >= %s")
        params.append(date_from)
    q = f"""SELECT * FROM (
              SELECT DISTINCT ON ({LATEST_KEY}) * FROM fact_series
              WHERE {" AND ".join(where)}
              ORDER BY {LATEST_KEY}, run_id DESC, id DESC) latest
            ORDER BY period_start LIMIT %s"""
    params.append(limit)
    with db.get_conn() as conn:
        rows = conn.execute(q, params).fetchall()
        if eur:
            rows = _rows_to_eur(rows, norm.load_fx(conn))
    return {"series_id": series_id, "count": len(rows), "rows": rows}


def _rows_to_eur(rows, fx):
    """Money rows in another currency -> EUR, keeping the native value, at the mean
    ECB monthly rate over the row's period (normalisation.to_eur_period). Rows
    without any usable rate are dropped rather than shown in the wrong currency."""
    out = []
    for r in rows:
        cur = r.get("currency")
        if cur in (None, "EUR"):
            out.append(r)
            continue
        try:
            value = norm.to_eur_period(float(r["value"]), cur, r["period"], r["period_start"], fx)
        except norm.FXError:
            continue
        out.append({**r, "value": value, "value_native": r["value"], "currency_native": cur,
                    "currency": "EUR", "unit": str(r["unit"]).replace(cur, "EUR")})
    return out


@app.get("/api/indicators")
def indicators(indicator_id: str | None = None,
               comparator: str | None = None,
               product: str | None = None):
    q = "SELECT * FROM fact_indicator WHERE TRUE"
    params: list = []
    if not MEMBER_MODE:   # indicators derived from member-restricted inputs
        q += " AND (inputs->>'licensed') IS DISTINCT FROM 'true'"
    if indicator_id:
        q += " AND indicator_id = %s"
        params.append(indicator_id)
    if comparator:
        q += " AND comparator_geo_id = %s"
        params.append(comparator)
    if product:
        q += " AND product_code = %s"
        params.append(product)
    q += " ORDER BY indicator_id, period_start"
    with db.get_conn() as conn:
        rows = conn.execute(q, params).fetchall()
    return {"count": len(rows), "rows": rows}


@app.get("/api/alerts")
def alerts(months: int = Query(6, le=36)):
    """Open trade-surge alerts (durable `alert` table), newest first."""
    with db.get_conn() as conn:
        rows = conn.execute(
            """SELECT a.*, p.name AS product_name,
                      split_part(g.name, ' (', 1) AS partner_name   -- Comext's long names
               FROM alert a
               JOIN dim_product p ON p.product_code = a.product_code
               LEFT JOIN dim_geo g ON g.geo_id = a.partner_geo_id
               WHERE a.period >= to_char(now() - (%s || ' months')::interval, 'YYYY-MM')
               ORDER BY a.period DESC, a.severity, a.product_code, a.flow, a.partner_geo_id""",
            (months,),
        ).fetchall()
    return {"count": len(rows), "rows": rows}


@app.get("/api/trade/partners")
def trade_partners(product: str, flow: str, series_id: str = "trade.quantity",
                   top: int = Query(6, le=12), date_from: date | None = Query(None, alias="from")):
    """Monthly extra-EU flow by partner: top-N partners (by last-12-month sum) + Other,
    plus latest-month screening statistics per partner (same maths as the surge detector)."""
    from observatory.processing.surges import EU_MEMBERS, partner_stats
    # latest vintage per partner-month, scoped BEFORE deduping: v_series_latest sorts the
    # whole table first (~4 s per call); this uses idx_fact_series_trade (~50 ms)
    public_only = "" if MEMBER_MODE else " AND redistribution_class = 'public'"
    q = f"""SELECT DISTINCT ON (partner_geo_id, period)
                   partner_geo_id, period, period_start, value, source, source_dataset,
                   retrieved_at, quality_flag
            FROM fact_series
            WHERE series_id = %s AND geo_id = 'EU27_2020' AND product_code = %s
              AND flow = %s AND period LIKE '%%-%%'{public_only}
            ORDER BY partner_geo_id, period, run_id DESC"""
    with db.get_conn() as conn:
        rows = conn.execute(q, (series_id, product, flow)).fetchall()
        # screening statistics are ALWAYS on tonnes and EUR/t — the detector's floors
        # are tonnage — so the table agrees with the alerts whatever the chart shows
        both = {s: (rows if s == series_id else conn.execute(q, (s, product, flow)).fetchall())
                for s in ("trade.quantity", "trade.value")}
        names = {r["geo_id"]: (r["name"] or r["geo_id"]).split(" (")[0]   # Comext's long names
                 for r in conn.execute("SELECT geo_id, name FROM dim_geo").fetchall()}
    excluded = set(load_config("surges")["excluded_partners"]) | EU_MEMBERS

    by_partner: dict[str, dict] = {}
    for r in rows:
        by_partner.setdefault(r["partner_geo_id"], {})[r["period"]] = float(r["value"])
    by_partner_qv: dict[str, dict] = {}          # {partner: {period: (tonnes, eur)}}
    for slot, s in ((0, "trade.quantity"), (1, "trade.value")):
        for r in both[s]:
            cell = by_partner_qv.setdefault(r["partner_geo_id"], {}).setdefault(r["period"], [0.0, 0.0])
            cell[slot] = float(r["value"])
    months = sorted(by_partner.get("EXTRA_EU", {}))
    if not months:
        return {"periods": [], "series": [], "other": [], "total": [], "stats": []}
    stats = partner_stats(by_partner_qv, sorted(by_partner_qv.get("EXTRA_EU", {})))
    last12 = set(months[-12:])
    ranked = sorted((p for p in by_partner if p not in excluded),
                    key=lambda p: -sum(v for m, v in by_partner[p].items() if m in last12))
    shown = ranked[:top]
    keep = [m for m in months if not date_from or m >= date_from.strftime("%Y-%m")]
    series = [{"geo": p, "name": names.get(p, p), "values": [by_partner[p].get(m) for m in keep]}
              for p in shown]
    total = [by_partner["EXTRA_EU"].get(m) for m in keep]
    other = [None if t is None else round(t - sum(by_partner[p].get(m, 0.0) for p in shown), 3)
             for m, t in zip(keep, total)]
    for s in stats:
        s["name"] = names.get(s["geo"], s["geo"])
    prov = rows[0] if rows else None
    return {"periods": keep, "series": series, "other": other, "total": total,
            "latest_period": months[-1], "stats": stats,
            "provenance": prov and {k: prov[k] for k in ("source", "source_dataset",
                                                         "retrieved_at", "quality_flag")}}


@app.get("/api/fx")
def fx(currency: str = "USD"):
    with db.get_conn() as conn:
        rows = conn.execute(
            """SELECT rate_date, rate FROM v_fx_latest
               WHERE quote_currency = %s ORDER BY rate_date""", (currency,)).fetchall()
    return {"currency": currency, "base": "EUR", "rows": rows}


@app.get("/api/meta/products")
def meta_products():
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM dim_product ORDER BY nomenclature, product_code").fetchall()
    return {"products": rows, "basket": load_config("product_basket")["products"]}


@app.get("/api/meta/regions")
def meta_regions():
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM dim_geo ORDER BY geo_id").fetchall()
    return {"geos": rows, "config": load_config("regions")}


@app.get("/api/meta/indicators")
def meta_indicators():
    return load_config("indicators")


@app.get("/api/meta/carbon")
def meta_carbon():
    with db.get_conn() as conn:
        constants = conn.execute("SELECT * FROM benchmark_constant ORDER BY key").fetchall()
    return {"constants": constants, "config": load_config("carbon")}


@app.get("/api/meta/references")
def meta_references():
    return load_config("references")


@app.get("/api/meta/trade-defence")
def meta_trade_defence():
    try:
        measures = load_config("trade_defence")["measures"]
    except FileNotFoundError:
        measures = []
    return {"measures": sorted(measures, key=lambda m: str(m["date"]), reverse=True)}


@app.get("/api/trade-defence/signals")
def trade_defence_signals(days: int = Query(120, le=730)):
    """Watch hits not yet cited in config/trade_defence.yaml, newest first."""
    try:
        cited = {u for m in load_config("trade_defence")["measures"]
                 for u in (m.get("source_url"), m.get("official_url")) if u}
    except FileNotFoundError:
        cited = set()
    with db.get_conn() as conn:
        rows = conn.execute(
            """SELECT signal_id, source, title, url, published, products, first_seen FROM td_signal
               WHERE COALESCE(published, first_seen::date) >= current_date - %s
               ORDER BY COALESCE(published, first_seen::date) DESC""", (days,)).fetchall()
    return {"signals": [r for r in rows if r["url"] not in cited]}


@app.get("/api/meta/capacity-events")
def meta_capacity_events():
    try:
        events = load_config("capacity_events")["events"]
    except FileNotFoundError:
        events = []
    return {"events": sorted(events, key=lambda e: e["date"], reverse=True)}


@app.get("/api/quarantine")
def quarantine(limit: int = 200):
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM quarantine ORDER BY quarantined_at DESC LIMIT %s", (limit,)
        ).fetchall()
    return {"rows": rows}


dist = PROJECT_ROOT / "dashboard" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="dashboard")
else:
    @app.get("/")
    def root():
        raise HTTPException(503, "dashboard not built — run `npm run build` in dashboard/")
