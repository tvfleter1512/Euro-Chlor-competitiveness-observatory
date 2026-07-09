"""Apply schema and seed dimension tables from the config registries.

Idempotent: safe to run on every deploy. Dimension rows are upserted; the
'confirmed' flag on products is preserved once a human has set it in config.
"""
import logging

from observatory import db
from observatory.settings import PROJECT_ROOT, load_config

log = logging.getLogger(__name__)

SERIES = [
    ("power.industrial_delivered", "Industrial delivered electricity price", "power",
     "Energy + network + non-recoverable levies. The decision-relevant price."),
    ("power.wholesale_day_ahead", "Wholesale day-ahead electricity price", "power",
     "Context series — never conflated with delivered."),
    ("trade.value", "Trade value", "trade", "Import/export value per product/partner/period."),
    ("trade.quantity", "Trade quantity (tonnes)", "trade", "Normalised to tonnes at ingestion."),
    ("production.capacity", "Chlorine capacity", "production", "Euro Chlor authoritative for EU."),
    ("production.production", "Chlorine production", "production", ""),
    ("production.utilisation", "Capacity utilisation", "production", ""),
    ("production.caustic_stocks", "Caustic soda stocks", "production",
     "Euro Chlor monthly statistics."),
    ("gas.industrial_delivered", "Industrial delivered natural-gas price", "gas",
     "Eurostat nrg_pc_203; EU cost driver."),
    ("gas.hub_price", "Natural-gas hub price (monthly average)", "gas",
     "EU (IMF Europe/TTF-based) vs US (Henry Hub), USD/MMBtu."),
    ("price.caustic_spot_cn", "China caustic soda spot price (32% ion-membrane)", "price",
     "SunSirs daily spot, RMB/t."),
    ("carbon.eua_price", "EUA carbon price", "carbon", "Phase 2."),
]

GEOS = [
    ("EU27_2020", "European Union (27)", "region"),
    ("EXTRA_EU", "Extra-EU27 aggregate", "region"),
    ("INTRA_EU", "Intra-EU27 aggregate", "region"),
    ("EU27_EFTA_UK", "EU-27 + Norway/Switzerland/UK (Euro Chlor reporting area)", "region"),
    ("GULF", "Gulf (GCC)", "region"),
    ("WORLD", "World", "world"),
    ("US", "United States", "country"), ("CN", "China", "country"),
    ("IN", "India", "country"), ("SA", "Saudi Arabia", "country"),
    ("AE", "United Arab Emirates", "country"),
    ("DE", "Germany", "country"), ("FR", "France", "country"),
    ("NL", "Netherlands", "country"), ("BE", "Belgium", "country"),
    ("ES", "Spain", "country"), ("IT", "Italy", "country"), ("PL", "Poland", "country"),
    ("DE_LU", "Germany-Luxembourg bidding zone", "bidding_zone"),
]


def bootstrap() -> None:
    with db.get_conn() as conn:
        conn.execute((PROJECT_ROOT / "db" / "schema.sql").read_text())
        for series_id, name, category, desc in SERIES:
            conn.execute(
                """INSERT INTO dim_series (series_id, name, category, description)
                   VALUES (%s,%s,%s,%s) ON CONFLICT (series_id) DO UPDATE
                   SET name = EXCLUDED.name, description = EXCLUDED.description""",
                (series_id, name, category, desc))
        for geo_id, name, kind in GEOS:
            conn.execute(
                """INSERT INTO dim_geo (geo_id, name, kind) VALUES (%s,%s,%s)
                   ON CONFLICT (geo_id) DO UPDATE SET name = EXCLUDED.name""",
                (geo_id, name, kind))
        for product in load_config("product_basket")["products"]:
            for cn8 in product["cn8"]:
                conn.execute(
                    """INSERT INTO dim_product (product_code, nomenclature, name, hs6, confirmed)
                       VALUES (%s,'CN8',%s,%s,%s) ON CONFLICT (product_code) DO UPDATE
                       SET name = EXCLUDED.name, hs6 = EXCLUDED.hs6, confirmed = EXCLUDED.confirmed""",
                    (cn8, product["name"], product["hs6"], product["confirmed"]))
            conn.execute(
                """INSERT INTO dim_product (product_code, nomenclature, name, hs6, confirmed)
                   VALUES (%s,'HS6',%s,%s,%s) ON CONFLICT (product_code) DO UPDATE
                   SET name = EXCLUDED.name, confirmed = EXCLUDED.confirmed""",
                (product["hs6"], product["name"], product["hs6"], product["confirmed"]))
        conn.commit()
    log.info("bootstrap complete")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    bootstrap()
