from observatory.ingestion.eua_price import monthly_rows

# ICAP daily value triple is [USD, EUR nominal, EUR]; synthetic numbers
ICAP = [{"id": 34, "secondary": {
    "2026-05-04": [110.0, 100.0, 100.0],
    "2026-05-05": [114.0, 104.0, 104.0],
    "2026-06-30": [99.0, 90.0, 90.0],
}}]


def test_icap_uses_eur_not_usd():
    rows = dict((p, (v, b)) for p, v, b in monthly_rows(ICAP, []))
    assert rows["2026-05"] == (102.0, "secondary_market")
    assert rows["2026-06"] == (90.0, "secondary_market")


def test_auctions_fill_only_months_after_icap():
    auctions = [["2026-06-10", 80.0], ["2026-07-01", 86.0], ["2026-07-15", 88.0], ["2026-08-03", 91.0]]
    rows = {p: (round(v, 2), b) for p, v, b in monthly_rows(ICAP, auctions)}
    assert rows["2026-06"] == (90.0, "secondary_market")      # ICAP month untouched
    assert rows["2026-07"] == (87.0, "primary_auction")
    assert rows["2026-08"] == (91.0, "primary_auction")
