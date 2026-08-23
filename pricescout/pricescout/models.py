"""Core data structures for the plant-based price extractor."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional, Dict, Any, List


@dataclass
class Offer:
    """A single product/price observation at one retailer."""

    retailer: str
    country: str
    query: str

    name: str
    url: Optional[str] = None
    brand: Optional[str] = None

    price: Optional[float] = None
    currency: Optional[str] = None

    # As advertised by the retailer, e.g. "325 g", "2 x 200g".
    pack_size_raw: Optional[str] = None
    # Retailer-published unit price string, e.g. "prijs per kg EUR 3.85".
    unit_price_raw: Optional[str] = None

    # Derived fields, filled in by normalize.py
    price_eur: Optional[float] = None
    grams: Optional[float] = None
    eur_per_kg: Optional[float] = None
    eur_per_kg_source: Optional[str] = None  # "pack_size" | "retailer_unit_price"

    # Derived by classify.py
    category: Optional[str] = None
    plant_based: Optional[bool] = None
    match_terms: List[str] = field(default_factory=list)

    # Provenance
    source: Optional[str] = None      # adapter name that produced this row
    scraped_at: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["match_terms"] = "|".join(self.match_terms)
        d.pop("extra", None)
        return d


@dataclass
class FetchResult:
    """Outcome of one retailer/query fetch, success or failure."""

    retailer: str
    query: str
    ok: bool
    status: Optional[int] = None
    offers: List[Offer] = field(default_factory=list)
    error: Optional[str] = None
    blocked_reason: Optional[str] = None
