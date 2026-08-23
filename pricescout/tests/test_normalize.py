"""Regression tests for the parsing layer -- the part most likely to silently
produce plausible-but-wrong numbers."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pricescout.normalize import (parse_number, parse_pack_grams, parse_unit_price,
                                  parse_price, to_eur)
from pricescout.classify import classify


def test_number_formats():
    cases = {
        "3,85": 3.85, "1.234,56": 1234.56, "1,234.56": 1234.56,
        "1 234,56": 1234.56, "12.99": 12.99, "10": 10.0,
        # 4+ digit values must not be truncated to their first three digits
        "8277.0": 8277.0, "1490": 1490.0, "8277": 8277.0, "12345,67": 12345.67,
    }
    for raw, want in cases.items():
        got = parse_number(raw)
        assert got == want, f"{raw!r} -> {got}, want {want}"


def test_pack_sizes():
    assert parse_pack_grams("325 g") == 325
    assert parse_pack_grams("2 x 200g") == 400
    assert parse_pack_grams("1,5 l") == 1500
    assert parse_pack_grams("6 x 33cl") == 1980
    assert parse_pack_grams("1 kg") == 1000
    assert parse_pack_grams("per stuk") is None


def test_unit_prices():
    assert parse_unit_price("prijs per kg EUR 3.85", "EUR")[0] == 3.85
    assert parse_unit_price("0,99 EUR/100 g", "EUR")[0] == 9.9
    assert parse_unit_price("8277.0 per kg", "HUF")[0] == 8277.0
    assert parse_unit_price("2,50 per stuk", "EUR")[0] is None


def test_currency_conversion():
    rates = {"EUR": 1.0, "HUF": 362.78, "GBP": 0.8567}
    assert abs(to_eur(8277.0, "HUF", rates) - 22.82) < 0.05
    assert abs(to_eur(2.50, "GBP", rates) - 2.918) < 0.01


def test_classification():
    assert classify("AH Terra Biologische tofu")[1] is True
    assert classify("Beyond Meat Burger")[0] == "plant_meat"
    assert classify("Hähnchen Burger")[1] is False       # animal, despite burger
    assert classify("Hafermilch Barista")[0] == "plant_milk"
    assert classify("Coca Cola 1.5l")[1] is False


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print(f"  PASS {name}")
            except AssertionError as e:
                fails += 1; print(f"  FAIL {name}: {e}")
    print("all tests passed" if not fails else f"{fails} test(s) failed")
    sys.exit(1 if fails else 0)
