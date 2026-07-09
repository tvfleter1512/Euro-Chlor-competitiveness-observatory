"""Serving API — normalised series, computed indicators, source health.

Every payload row carries its provenance (spec §8: no provenance, no render).
Model A: everything public; redistribution_class is served so a model-B
entitlement layer can be added in front without schema change.
"""
from datetime import date

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from observatory import db
from observatory.settings import PROJECT_ROOT, load_config

app = FastAPI(title="Euro Chlor Competitiveness Observatory", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM v_source_health ORDER BY agent").fetchall()
    return {"agents": rows}


@app.get("/api/series")
def series(
    series_id: str,
    geo: str | None = None,
    partner: str | None = None,
    product: str | None = None,
    flow: str | None = None,
    band: str | None = None,
    tax: str | None = None,
    date_from: date | None = Query(None, alias="from"),
    limit: int = Query(20000, le=100000),
):
    q = "SELECT * FROM v_series_latest WHERE series_id = %s"
    params: list = [series_id]
    for col, val in (("geo_id", geo), ("partner_geo_id", partner),
                     ("product_code", product), ("flow", flow),
                     ("band", band), ("tax_treatment", tax)):
        if val is not None:
            q += f" AND {col} = %s"
            params.append(val)
    if date_from:
        q += " AND period_start >= %s"
        params.append(date_from)
    q += " ORDER BY period_start LIMIT %s"
    params.append(limit)
    with db.get_conn() as conn:
        rows = conn.execute(q, params).fetchall()
    return {"series_id": series_id, "count": len(rows), "rows": rows}


@app.get("/api/indicators")
def indicators(indicator_id: str | None = None,
               comparator: str | None = None,
               product: str | None = None):
    q = "SELECT * FROM fact_indicator WHERE TRUE"
    params: list = []
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
