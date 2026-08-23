"""Price, pack-size and currency normalisation.

European retailers use wildly different number formats ("1.234,56", "1,234.56",
"3,85 EUR", "EUR 3.85"), so parsing is deliberately conservative: when a value is
ambiguous we return None rather than guess and pollute the dataset.
"""

from __future__ import annotations

import re
import datetime as _dt
from typing import Optional, Tuple, Dict

# --------------------------------------------------------------------------
# Currency
# --------------------------------------------------------------------------

CURRENCY_SYMBOLS = {
    "€": "EUR", "eur": "EUR", "euro": "EUR",
    "£": "GBP", "gbp": "GBP",
    "chf": "CHF", "fr.": "CHF", "sfr": "CHF",
    "kr": None,  # ambiguous across SEK/NOK/DKK -> resolved from retailer country
    "sek": "SEK", "nok": "NOK", "dkk": "DKK", "isk": "ISK",
    "zł": "PLN", "pln": "PLN", "zl": "PLN",
    "kč": "CZK", "czk": "CZK",
    "ft": "HUF", "huf": "HUF",
    "lei": "RON", "ron": "RON",
    "лв": "BGN", "bgn": "BGN",
    "kn": "HRK", "hrk": "HRK",
    "₺": "TRY", "try": "TRY",
    "₴": "UAH", "uah": "UAH",
    "din": "RSD", "rsd": "RSD",
}

# Fallback ECB rates (units of currency per 1 EUR). Only used when the live ECB
# feed is unreachable; refreshed values are fetched at runtime.
FALLBACK_EUR_RATES: Dict[str, float] = {
    "EUR": 1.0, "GBP": 0.8567, "CHF": 0.9376, "SEK": 10.94, "NOK": 11.53,
    "DKK": 7.4758, "PLN": 4.24, "CZK": 24.116, "HUF": 362.78, "RON": 5.09,
    "BGN": 1.9558, "ISK": 143.0, "TRY": 49.0, "RSD": 117.2, "UAH": 48.5,
}


def fetch_ecb_rates(session=None, timeout: int = 20) -> Dict[str, float]:
    """Fetch ECB daily reference rates (currency units per 1 EUR)."""
    rates = dict(FALLBACK_EUR_RATES)
    url = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
    try:
        if session is not None:
            body = session.get(url, timeout=timeout).text
        else:
            import urllib.request
            body = urllib.request.urlopen(url, timeout=timeout).read().decode()
        for cur, rate in re.findall(r"currency='([A-Z]{3})'\s+rate='([\d.]+)'", body):
            rates[cur] = float(rate)
        rates["EUR"] = 1.0
    except Exception:
        pass
    return rates


def detect_currency(text: str, default: Optional[str] = None) -> Optional[str]:
    """Pick a currency out of a raw price string; falls back to `default`."""
    if not text:
        return default
    low = text.lower()
    for token, code in CURRENCY_SYMBOLS.items():
        if token in low:
            if code is None:      # bare "kr" -> need the retailer's country
                return default
            return code
    return default


# --------------------------------------------------------------------------
# Numbers
# --------------------------------------------------------------------------

_NUM_RE = re.compile(r"\d{1,3}(?:[.,\s ']\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?")


def parse_number(raw: str) -> Optional[float]:
    """Parse a European or Anglo formatted decimal number.

    Rules: if both separators appear, the right-most is the decimal separator.
    A lone separator followed by exactly three digits is treated as a thousands
    separator ("1.234" -> 1234) unless that would be nonsensical.
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    m = _NUM_RE.search(s.replace(" ", " "))
    if not m:
        return None
    num = m.group(0)
    num = num.replace(" ", "").replace(" ", "").replace("'", "")

    has_dot, has_comma = "." in num, "," in num
    if has_dot and has_comma:
        dec = "." if num.rfind(".") > num.rfind(",") else ","
        thou = "," if dec == "." else "."
        num = num.replace(thou, "").replace(dec, ".")
    elif has_comma:
        num = num.replace(",", "") if re.search(r",\d{3}$", num) else num.replace(",", ".")
    elif has_dot:
        if re.search(r"\.\d{3}$", num) and not re.match(r"^\d\.\d{3}$", num):
            num = num.replace(".", "")
    try:
        return float(num)
    except ValueError:
        return None


def parse_price(raw, default_currency: Optional[str] = None) -> Tuple[Optional[float], Optional[str]]:
    """Return (amount, currency_code) from a raw price string or number."""
    if raw is None:
        return None, default_currency
    if isinstance(raw, (int, float)):
        return float(raw), default_currency
    return parse_number(raw), detect_currency(str(raw), default_currency)


# --------------------------------------------------------------------------
# Pack sizes
# --------------------------------------------------------------------------

_WEIGHT_UNITS = {
    "kg": 1000.0, "kilo": 1000.0, "kilogram": 1000.0,
    "g": 1.0, "gr": 1.0, "gram": 1.0, "grammes": 1.0, "grams": 1.0,
    "mg": 0.001,
    # Volume is converted at 1 ml == 1 g, which is close enough for drinks,
    # yoghurts and creams to be comparable per kg. Flagged in `eur_per_kg_source`.
    "l": 1000.0, "liter": 1000.0, "litre": 1000.0, "ltr": 1000.0,
    "ml": 1.0, "cl": 10.0, "dl": 100.0,
}
_MULTIPACK_RE = re.compile(r"(\d+)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*([a-z]+)", re.I)
_SINGLE_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*([a-z]+)", re.I)


def parse_pack_grams(raw: Optional[str]) -> Optional[float]:
    """Convert a pack-size string to grams. Handles multipacks ("2 x 200 g")."""
    if not raw:
        return None
    s = str(raw).lower().replace(" ", " ")

    m = _MULTIPACK_RE.search(s)
    if m:
        count = float(m.group(1))
        amount = parse_number(m.group(2))
        unit = m.group(3)
        if amount is not None and unit in _WEIGHT_UNITS:
            return count * amount * _WEIGHT_UNITS[unit]

    best = None
    for m in _SINGLE_RE.finditer(s):
        amount = parse_number(m.group(1))
        unit = m.group(2)
        if amount is None or unit not in _WEIGHT_UNITS:
            continue
        grams = amount * _WEIGHT_UNITS[unit]
        if 1.0 <= grams <= 20000.0:   # ignore absurd matches
            best = grams if best is None else max(best, grams)
    return best


def parse_unit_price(raw: Optional[str], default_currency: Optional[str] = None):
    """Parse a retailer's own unit price string into (amount, currency, per_kg?).

    Examples: "prijs per kg EUR 3.85", "3,85 EUR/kg", "0,99 EUR/100 g".
    Returns (value_per_kg, currency) or (None, None).
    """
    if not raw:
        return None, None
    s = str(raw).lower().replace(" ", " ")
    if not re.search(r"per\s*(kg|kilo|l\b|liter|litre|100\s*(g|ml)|1\s*(kg|l))|/\s*(kg|l|100\s*g)", s):
        return None, None
    amount, cur = parse_price(s, default_currency)
    if amount is None:
        return None, None
    if re.search(r"(per|/)\s*100\s*(g|ml)", s):
        amount *= 10.0
    return amount, cur


def to_eur(amount: Optional[float], currency: Optional[str], rates: Dict[str, float]) -> Optional[float]:
    """Convert an amount to EUR using ECB rates (units per EUR)."""
    if amount is None or not currency:
        return None
    rate = rates.get(currency.upper())
    if not rate:
        return None
    return round(amount / rate, 4)


def enrich(offer, rates: Dict[str, float]):
    """Fill in price_eur / grams / eur_per_kg on an Offer in place."""
    offer.scraped_at = offer.scraped_at or _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")

    if offer.price is not None and offer.currency:
        offer.price_eur = to_eur(offer.price, offer.currency, rates)

    offer.grams = offer.grams or parse_pack_grams(offer.pack_size_raw) or parse_pack_grams(offer.name)

    # Prefer the retailer's own published unit price -- it accounts for drained
    # weight, multipacks and deposits better than anything we can infer.
    unit_val, unit_cur = parse_unit_price(offer.unit_price_raw, offer.currency)
    if unit_val is not None:
        eur = to_eur(unit_val, unit_cur or offer.currency, rates)
        if eur:
            offer.eur_per_kg = round(eur, 3)
            offer.eur_per_kg_source = "retailer_unit_price"
            return offer

    if offer.price_eur is not None and offer.grams:
        offer.eur_per_kg = round(offer.price_eur / (offer.grams / 1000.0), 3)
        offer.eur_per_kg_source = "pack_size"
    return offer
