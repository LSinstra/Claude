"""Adapter contract."""

from __future__ import annotations
from typing import List, Dict, Any
from ..models import Offer


class Adapter:
    name = "base"

    def search(self, transport, retailer: Dict[str, Any], query: str) -> List[Offer]:
        raise NotImplementedError


def new_offer(retailer: Dict[str, Any], query: str, **kw) -> Offer:
    return Offer(
        retailer=retailer["name"],
        country=retailer["country"],
        query=query,
        **kw,
    )
