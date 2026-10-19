from observatory.ingestion.entsoe_power import EntsoePowerAgent, _local_month

NS = "urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3"


def _doc(days):
    periods = "".join(
        f"<Period><timeInterval><start>{start}</start><end>x</end></timeInterval>"
        f"<resolution>PT60M</resolution><Point><position>1</position>"
        f"<price.amount>{price}</price.amount></Point></Period>" for start, price in days)
    return f'<Publication_MarketDocument xmlns="{NS}"><TimeSeries>{periods}</TimeSeries></Publication_MarketDocument>'


def test_utc_start_maps_to_brussels_delivery_month():
    assert _local_month("2024-11-30T23:00Z") == "2024-12"   # winter: CET = UTC+1
    assert _local_month("2024-06-30T22:00Z") == "2024-07"   # summer: CEST = UTC+2


def test_edge_day_of_previous_year_is_dropped():
    xml = _doc([("2023-12-31T23:00Z", 50.0), ("2024-12-30T23:00Z", 100.0)])
    rows = EntsoePowerAgent().parse([("u", {"zone": "BE", "year": 2024, "xml": xml})])
    assert [(r.period, r.value) for r in rows] == [("2024-01", 50.0), ("2024-12", 100.0)]
