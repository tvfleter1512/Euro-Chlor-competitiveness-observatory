from observatory.watch.trade_defence import is_signal, match_products


def test_needs_instrument_and_product():
    assert is_signal("EU Opens Anti-Dumping Probe into PVC from China, Korea, Mexico and Taiwan") == ["pvc"]
    assert is_signal("Minimum tax rate of 3.66%! South Korea makes preliminary anti-dumping ruling on solid sodium hydroxide") == ["caustic_soda"]
    assert is_signal("PVC prices rise in Asia") == []
    assert is_signal("Anti-dumping duty on steel wire") == []


def test_product_patterns():
    assert match_products("Countervailing duty on ethylene dichloride and VCM") == ["edc", "vcm"]
    assert match_products("Notice of initiation ... certain Polyvinyl chloride (PVC) originating in") == ["pvc"]
    assert match_products("Sodium chlorate from Canada") == ["sodium_chlorate"]
