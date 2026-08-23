"""Retailer-agnostic extraction using Scrapling's Selector.

Three strategies are tried in order of reliability:

1. JSON-LD  (schema.org Product/Offer) -- structured, unambiguous.
2. Microdata (itemprop="price") -- still structured.
3. Adaptive card detection -- locate one element whose text looks like a price,
   then use Scrapling's `find_similar()` to pull every sibling card that shares
   its structure. This survives class-name churn, which is what usually breaks
   hand-written CSS selectors.
"""

from __future__ import annotations

import json
import re
from typing import List, Dict, Any, Iterable, Optional

from .base import Adapter, new_offer
from ..models import Offer

PRICE_TEXT_RE = re.compile(
    r"(?:€|£|CHF|kr|zł|Kč|Ft|lei|лв)\s*\d{1,4}(?:[.,]\d{1,2})?"
    r"|\d{1,4}[.,]\d{2}\s*(?:€|£|CHF|kr|zł|Kč|Ft|lei|лв|EUR|GBP|SEK|NOK|DKK|PLN|CZK)",
    re.I,
)


# ---------------------------------------------------------------- JSON-LD ---
def _walk_jsonld(node, out: List[dict]):
    """Collect every schema.org Product node in an arbitrarily nested blob."""
    if isinstance(node, list):
        for n in node:
            _walk_jsonld(n, out)
        return
    if not isinstance(node, dict):
        return
    types = node.get("@type")
    types = [types] if isinstance(types, str) else (types or [])
    if any(str(t).lower() == "product" for t in types):
        out.append(node)
    for key in ("@graph", "itemListElement", "hasPart", "item", "mainEntity"):
        if key in node:
            _walk_jsonld(node[key], out)


def _offer_price(product: dict):
    """Pull (price, currency) out of a schema.org Product's offers block."""
    offers = product.get("offers")
    if isinstance(offers, list):
        offers = offers[0] if offers else None
    if isinstance(offers, dict):
        price = offers.get("price") or offers.get("lowPrice") or offers.get("highPrice")
        cur = offers.get("priceCurrency")
        spec = offers.get("priceSpecification")
        if price is None and isinstance(spec, dict):
            price = spec.get("price")
            cur = cur or spec.get("priceCurrency")
        return price, cur
    return None, None


def extract_jsonld(selector, retailer: Dict[str, Any], query: str) -> List[Offer]:
    offers: List[Offer] = []
    for raw in selector.css('script[type="application/ld+json"]::text'):
        text = str(raw).strip()
        if not text:
            continue
        try:
            data = json.loads(text)
        except Exception:
            continue
        products: List[dict] = []
        _walk_jsonld(data, products)
        for p in products:
            name = p.get("name")
            if not name:
                continue
            price, cur = _offer_price(p)
            if price is None:
                continue
            brand = p.get("brand")
            if isinstance(brand, dict):
                brand = brand.get("name")
            offers.append(new_offer(
                retailer, query,
                name=str(name).strip(),
                url=p.get("url") or p.get("@id"),
                brand=brand if isinstance(brand, str) else None,
                price=price,
                currency=cur or retailer.get("currency"),
                pack_size_raw=p.get("weight") or p.get("size"),
                source="jsonld",
            ))
    return offers


# -------------------------------------------------------------- microdata ---
def extract_microdata(selector, retailer: Dict[str, Any], query: str) -> List[Offer]:
    offers: List[Offer] = []
    for node in selector.css('[itemtype*="schema.org/Product"]'):
        try:
            name = node.css_first('[itemprop="name"]::text') if hasattr(node, "css_first") else None
            if name is None:
                got = node.css('[itemprop="name"]::text')
                name = got[0] if got else None
            price_nodes = node.css('[itemprop="price"]')
            if not price_nodes:
                continue
            price = price_nodes[0].attrib.get("content") or price_nodes[0].get_all_text()
            cur_nodes = node.css('[itemprop="priceCurrency"]')
            cur = cur_nodes[0].attrib.get("content") if cur_nodes else None
            link = node.css("a::attr(href)")
            if not name or price is None:
                continue
            offers.append(new_offer(
                retailer, query,
                name=str(name).strip(),
                url=selector.urljoin(str(link[0])) if link else None,
                price=price,
                currency=cur or retailer.get("currency"),
                source="microdata",
            ))
        except Exception:
            continue
    return offers


# ------------------------------------------------------- adaptive cards -----
def _clean(text: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def extract_adaptive(selector, retailer: Dict[str, Any], query: str,
                     max_cards: int = 60) -> List[Offer]:
    """Find product cards without knowing the retailer's markup.

    Anchors on an element whose own text is a price, walks up to a plausible
    card container, then asks Scrapling for structurally similar elements.
    """
    offers: List[Offer] = []
    try:
        anchors = selector.find_by_regex(PRICE_TEXT_RE, first_match=False)
    except Exception:
        anchors = []
    if not anchors:
        return offers

    card = None
    for anchor in anchors[:12]:
        node = anchor
        for _ in range(5):                     # climb toward the card container
            node = getattr(node, "parent", None)
            if node is None:
                break
            text = _clean(node.get_all_text())
            has_link = bool(node.css("a::attr(href)"))
            if has_link and 15 < len(text) < 400:
                card = node
                break
        if card is not None:
            break
    if card is None:
        return offers

    try:
        siblings = card.find_similar()
    except Exception:
        siblings = []
    cards = [card] + list(siblings or [])

    seen = set()
    for c in cards[:max_cards]:
        try:
            text = _clean(c.get_all_text())
            m = PRICE_TEXT_RE.search(text)
            if not m:
                continue
            links = c.css("a::attr(href)")
            href = selector.urljoin(str(links[0])) if links else None

            # Product name: prefer link text / heading / image alt over raw blob.
            name = ""
            for sel in ("h1::text", "h2::text", "h3::text", "h4::text",
                        "a::attr(title)", "img::attr(alt)", "a::text"):
                got = c.css(sel)
                for g in got:
                    cand = _clean(str(g))
                    if len(cand) > 3 and not PRICE_TEXT_RE.fullmatch(cand):
                        name = cand
                        break
                if name:
                    break
            if not name:
                name = _clean(text[: m.start()]) or text[:80]
            key = (name.lower(), m.group(0))
            if not name or key in seen:
                continue
            seen.add(key)

            unit = None
            um = re.search(r"[^|]*(?:per|/)\s*(?:kg|l\b|100\s*g|100\s*ml)[^|]*", text, re.I)
            if um:
                unit = _clean(um.group(0))[:60]

            offers.append(new_offer(
                retailer, query,
                name=name[:180],
                url=href,
                price=m.group(0),
                currency=retailer.get("currency"),
                pack_size_raw=name,
                unit_price_raw=unit,
                source="adaptive",
            ))
        except Exception:
            continue
    return offers


class GenericAdapter(Adapter):
    """Runs all three strategies and keeps whichever yields the most rows."""

    name = "generic"

    def search(self, transport, retailer: Dict[str, Any], query: str) -> List[Offer]:
        url = retailer["search_url"].format(query=query.replace(" ", "+"))
        resp = transport.get(url, headers=retailer.get("headers"))
        if resp.status == 999:
            raise RuntimeError("robots.txt disallows this path")
        if resp.status >= 400:
            raise RuntimeError(f"HTTP {resp.status}")

        sel = resp.selector
        results: List[List[Offer]] = []
        for fn in (extract_jsonld, extract_microdata, extract_adaptive):
            try:
                results.append(fn(sel, retailer, query))
            except Exception:
                results.append([])
        best = max(results, key=len) if results else []
        return best
