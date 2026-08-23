"""Adapters for retailers that expose a structured JSON search endpoint.

These are preferred over HTML scraping wherever a retailer publishes one: the
data is cleaner (real pack sizes, retailer-computed unit prices) and the request
volume is a fraction of rendering a search page.
"""

from __future__ import annotations

import json
import re
import time
from typing import List, Dict, Any, Optional

from .base import Adapter, new_offer
from ..models import Offer


class AlbertHeijnAdapter(Adapter):
    """Albert Heijn (NL). Public mobile API behind an anonymous bearer token."""

    name = "api:ah"
    _token: Optional[str] = None
    _token_ts: float = 0.0

    def _get_token(self, transport) -> str:
        if self._token and (time.time() - self._token_ts) < 1800:
            return self._token
        r = transport.post_json(
            "https://api.ah.nl/mobile-auth/v1/auth/token/anonymous",
            {"clientId": "appie"},
        )
        if r.status != 200:
            raise RuntimeError(f"AH token failed: HTTP {r.status}")
        AlbertHeijnAdapter._token = r.json()["access_token"]
        AlbertHeijnAdapter._token_ts = time.time()
        return AlbertHeijnAdapter._token

    def search(self, transport, retailer, query) -> List[Offer]:
        token = self._get_token(transport)
        url = f"https://api.ah.nl/mobile-services/product/search/v2?query={query.replace(' ', '%20')}&size=40"
        r = transport.get(url, headers={
            "Authorization": f"Bearer {token}",
            "x-application": "AHWEBSHOP",
            "Accept": "application/json",
        }, check_robots=False)
        if r.status >= 400:
            raise RuntimeError(f"HTTP {r.status}")
        out = []
        for p in r.json().get("products", []):
            price = p.get("currentPrice") or p.get("priceBeforeBonus")
            if price is None:
                continue
            wid = p.get("webshopId")
            out.append(new_offer(
                retailer, query,
                name=p.get("title", ""),
                brand=p.get("brand"),
                url=f"https://www.ah.nl/producten/product/wi{wid}" if wid else None,
                price=price,
                currency="EUR",
                pack_size_raw=p.get("salesUnitSize"),
                unit_price_raw=p.get("unitPriceDescription"),
                source=self.name,
                extra={"category": p.get("mainCategory"),
                       "icons": p.get("propertyIcons"),
                       "nutriscore": p.get("nutriscore")},
            ))
        return out


class OdaAdapter(Adapter):
    """Oda (NO). Open JSON search with retailer-computed unit prices."""

    name = "api:oda"

    def search(self, transport, retailer, query) -> List[Offer]:
        url = f"https://oda.com/api/v1/search/mixed/?q={query.replace(' ', '%20')}"
        r = transport.get(url, headers={"Accept": "application/json"}, check_robots=False)
        if r.status >= 400:
            raise RuntimeError(f"HTTP {r.status}")
        out = []
        for item in r.json().get("items", []):
            if item.get("type") != "product":
                continue
            a = item.get("attributes", {})
            price = a.get("gross_price")
            if price is None:
                continue
            unit = None
            if a.get("gross_unit_price") and a.get("unit_price_quantity_abbreviation"):
                unit = f"{a['gross_unit_price']} NOK per {a['unit_price_quantity_abbreviation']}"
            out.append(new_offer(
                retailer, query,
                name=a.get("full_name") or a.get("name", ""),
                brand=a.get("brand"),
                url=("https://oda.com" + a["absolute_url"]) if a.get("absolute_url") else a.get("front_url"),
                price=price,
                currency="NOK",
                pack_size_raw=a.get("name_extra") or a.get("full_name"),
                unit_price_raw=unit,
                source=self.name,
            ))
        return out


class NuxtAdapter(Adapter):
    """Retailers rendering a Nuxt app (e.g. Lidl): mine the embedded payload.

    The search page ships its product list as a serialised JS object. We pull
    every {name, price} shaped record out of it rather than driving a browser.
    """

    name = "api:nuxt"

    _PRODUCT_RE = re.compile(
        r'\{"[^{}]{0,4000}?"(?:fullTitle|title|name|keyfacts)"\s*:\s*"(?P<name>[^"]{4,180})"'
        r'[^{}]{0,4000}?"price"\s*:\s*\{(?P<price>[^{}]{0,400})\}',
        re.S,
    )

    def search(self, transport, retailer, query) -> List[Offer]:
        url = retailer["search_url"].format(query=query.replace(" ", "+"))
        r = transport.get(url, headers=retailer.get("headers"))
        if r.status >= 400:
            raise RuntimeError(f"HTTP {r.status}")
        body = r.text
        out, seen = [], set()
        for m in self._PRODUCT_RE.finditer(body):
            name = m.group("name").strip()
            blob = m.group("price")
            pm = re.search(r'"(?:price|value|amount)"\s*:\s*"?([\d.,]+)"?', blob)
            if not pm or not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            raw = pm.group(1)
            # Lidl serialises minor units (245 == EUR 2.45) when there is no separator.
            val = float(raw.replace(",", ".")) if ("." in raw or "," in raw) else float(raw) / 100.0
            um = re.search(r'"(?:basePrice|pricePerUnit|unitPrice)"\s*:\s*"([^"]{1,60})"', blob)
            out.append(new_offer(
                retailer, query,
                name=name,
                url=None,
                price=val,
                currency=retailer.get("currency", "EUR"),
                pack_size_raw=name,
                unit_price_raw=um.group(1) if um else None,
                source=self.name,
            ))
        return out


class JsonPathAdapter(Adapter):
    """Config-driven adapter for plain JSON search endpoints.

    The retailer entry supplies `json` mapping: items path plus field names, so a
    new JSON retailer can be added in YAML without writing Python.
    """

    name = "api:json"

    @staticmethod
    def _dig(obj, path: str):
        cur = obj
        for part in path.split("."):
            if part == "":
                continue
            if isinstance(cur, list):
                try:
                    cur = cur[int(part)]
                    continue
                except (ValueError, IndexError):
                    return None
            if not isinstance(cur, dict):
                return None
            cur = cur.get(part)
            if cur is None:
                return None
        return cur

    def _unit_price(self, item, cfg) -> Optional[str]:
        """Build a parseable unit-price string from the API's numeric fields.

        Retailers usually publish price-per-unit as a bare number plus a unit
        field ("160.56" + "kg"); normalize.parse_unit_price needs the two
        stitched together to recognise it as a per-kg figure.
        """
        if cfg.get("unit_price"):
            val = self._dig(item, cfg["unit_price"])
            return str(val) if val is not None else None
        if not cfg.get("unit_price_value"):
            return None
        val = self._dig(item, cfg["unit_price_value"])
        if val is None:
            return None
        unit = cfg.get("unit_price_unit_literal")
        if not unit and cfg.get("unit_price_unit"):
            unit = self._dig(item, cfg["unit_price_unit"])
        if not unit:
            return None
        unit = str(unit).strip().lower()
        if unit not in ("kg", "l", "100g", "100 g", "100ml", "100 ml"):
            return None          # per-piece pricing is not comparable per kg
        return f"{val} per {unit}"

    def search(self, transport, retailer, query) -> List[Offer]:
        cfg = retailer["json"]
        url = retailer["search_url"].format(query=query.replace(" ", "%20"))
        r = transport.get(url, headers={**(retailer.get("headers") or {}),
                                        "Accept": "application/json"}, check_robots=False)
        if r.status >= 400:
            raise RuntimeError(f"HTTP {r.status}")
        data = r.json()
        items = self._dig(data, cfg.get("items", "")) or []
        if not isinstance(items, list):
            return []
        out = []
        for it in items:
            name = self._dig(it, cfg["name"]) if cfg.get("name") else None
            price = self._dig(it, cfg["price"]) if cfg.get("price") else None
            if not name or price is None:
                continue
            href = self._dig(it, cfg["url"]) if cfg.get("url") else None
            if href and cfg.get("url_prefix"):
                href = cfg["url_prefix"] + str(href)
            out.append(new_offer(
                retailer, query,
                name=str(name),
                brand=self._dig(it, cfg["brand"]) if cfg.get("brand") else None,
                url=href,
                price=price,
                currency=retailer.get("currency"),
                pack_size_raw=self._dig(it, cfg["size"]) if cfg.get("size") else None,
                unit_price_raw=self._unit_price(it, cfg),
                source=self.name,
            ))
        return out
