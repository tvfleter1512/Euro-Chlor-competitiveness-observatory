from datetime import date

from observatory.ingestion.census_trade import parse_table
from observatory.ingestion.comtrade_monthly import partner_geo, recent_months
from observatory.ingestion.eia_gas import usd_per_mwh

UNITS = {"mmbtu_per_mcf": 1.036, "mwh_per_mmbtu": 0.293071}


def test_eia_gas_mcf_to_mwh():
    # 1 MCF = 1.036 MMBtu = 0.30362 MWh -> $3.0362/MCF is $10/MWh
    assert abs(usd_per_mwh(1.036 * 0.293071 * 10, UNITS) - 10) < 1e-9


def test_comtrade_months_and_partners():
    assert recent_months(3, date(2026, 1, 15)) == ["202510", "202511", "202512"]
    iso2 = {276: "DE", 688: "RS"}
    assert partner_geo(0, iso2) == "WORLD"
    assert partner_geo(276, iso2) == "DE"
    assert partner_geo(688, iso2) == "XS"      # Eurostat code for Serbia
    assert partner_geo(490, iso2) == "TW"
    assert partner_geo(999, iso2) is None


def test_census_sums_hs10_and_keeps_world_and_eu():
    table = [["CTY_CODE", "CTY_NAME", "ALL_VAL_MO", "QTY_1_MO", "UNIT_QY1", "time", "E_COMMODITY"],
             ["-", "TOTAL FOR ALL COUNTRIES", "1000000", "2500000", "KG", "2026-08", "3904100010"],
             ["-", "TOTAL FOR ALL COUNTRIES", "500000", "500000", "KG", "2026-08", "3904100090"],
             ["0003", "EUROPEAN UNION", "400000", "1000000", "KG", "2026-08", "3904100010"],
             ["0003", "EUROPEAN UNION", "100000", "20", "NO", "2026-08", "3904100090"],
             ["2010", "MEXICO", "300000", "800000", "KG", "2026-08", "3904100010"]]
    rows = parse_table(table, "390410")
    assert [(r["partner"], r["period"], r["usd"], r["tonnes"]) for r in rows] == [
        ("EU27_2020", "2026-08", 500000.0, None), ("WORLD", "2026-08", 1500000.0, 3000.0)]


def test_comtrade_world_weight_from_partners():
    from observatory.ingestion.comtrade_monthly import ComtradeMonthlyAgent
    rec = lambda partner, value, kg: {"flowCode": "X", "motCode": 0, "customsCode": "C00", "partner2Code": 0,
                                      "partnerCode": partner, "period": "202606", "cmdCode": "281512",
                                      "primaryValue": value, "netWgt": kg}
    payloads = [("ref", {"partners": [[276, "DE", "Germany"], [484, "MX", "Mexico"]]}),
                ("url", {"geo": "US", "data": {"data": [rec(0, 300.0, None), rec(276, 100.0, 4000.0),
                                                        rec(484, 200.0, 6000.0)]}})]
    rows = ComtradeMonthlyAgent().parse(payloads)
    world_t = [r for r in rows if r.partner_geo_id == "WORLD" and r.series_id == "trade.quantity"]
    eu_t = [r for r in rows if r.partner_geo_id == "EU27_2020" and r.series_id == "trade.quantity"]
    assert len(world_t) == 1 and world_t[0].value == 10.0 and world_t[0].quality_flag == "estimated"
    assert len(eu_t) == 1 and eu_t[0].value == 4.0


def test_to_eur_period_averages_monthly_rates():
    from observatory.processing.normalisation import to_eur_period
    fx = {("CNY", date(2025, m, 1)): (8.0 if m <= 6 else 4.0) for m in range(1, 13)}
    # year: mean of 1/rate = (6/8 + 6/4)/12 = 0.1875 EUR per CNY
    assert abs(to_eur_period(800.0, "CNY", "2025", date(2025, 1, 1), fx) - 150.0) < 1e-9
    assert abs(to_eur_period(800.0, "CNY", "2025-S2", date(2025, 7, 1), fx) - 200.0) < 1e-9
    assert to_eur_period(5.0, "EUR", "2025", date(2025, 1, 1), fx) == 5.0
