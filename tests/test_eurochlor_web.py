from observatory.ingestion.eurochlor_web import parse_post

MODERN = ("Chlorine production & capacity utilisation - EU 27 + Norway/Switzerland/UK "
          "Month Production (tonnes) Capacity Utilisation (%)   2025 2026 % change 2025 2026 "
          "January 721,147 637,404 -11.6% 73.7% 64.4% "
          "May 599,953 700,778 +16.8% 61.3% 70.8% "
          "Caustic Soda stocks (tonnes) 2025 2026 January 244,917 209,474 May 189,712 235,086 For more")

LEGACY = ("Month Production (tonnes) Capacity Utilisation (%) 2018 2019 % change 2018 2019 "
          "January 843,064 863,084 +2.4 88.2 88.7 "
          "June 788,642 750,825 -4.8 85.3 79.7 "
          "First 1/2 Year 4,780,962 4,757,060 -0.5 85.7 83.8 "
          "December 790,625 761,026 -3.7 82.7 78.2 "
          "Year 9,379,583 9,410,585 +0.3 83.4 82.2 "
          "Caustic soda stocks (tonnes) 2018 2019 January 231,000 240,111 December 210,500 220,900")


def test_modern_format():
    out = parse_post(MODERN)
    assert out[("production.production", "2026-05")] == 700778
    assert out[("production.production", "2025-01")] == 721147
    assert out[("production.utilisation", "2026-01")] == 64.4
    assert out[("production.caustic_stocks", "2026-05")] == 235086


def test_legacy_format_without_percent_signs():
    out = parse_post(LEGACY)
    assert out[("production.production", "2019-01")] == 863084
    assert out[("production.utilisation", "2018-06")] == 85.3
    assert out[("production.caustic_stocks", "2019-12")] == 220900
    # half-year and full-year aggregate rows must not be captured as months
    periods = [p for (s, p) in out if s == "production.production"]
    assert all(len(p) == 7 for p in periods)
