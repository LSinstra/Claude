"""Orchestration: run every (retailer, query) pair and collect normalised rows."""

from __future__ import annotations

import csv
import json
import os
import sys
import datetime as _dt
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Optional

import yaml

from .models import Offer, FetchResult
from .transport import Transport
from .adapters import get_adapter
from . import normalize, classify


def load_config(base_dir: str):
    with open(os.path.join(base_dir, "retailers.yaml")) as f:
        retailers = yaml.safe_load(f)["retailers"]
    with open(os.path.join(base_dir, "queries.yaml")) as f:
        queries = yaml.safe_load(f)
    return [r for r in retailers if r.get("enabled", True)], queries


def queries_for(retailer: Dict[str, Any], queries: Dict[str, Any]) -> List[str]:
    return queries.get("by_country", {}).get(retailer["country"], queries["default"])


def _classify_error(exc: Exception) -> str:
    msg = str(exc)
    if "HTTP 403" in msg or "HTTP 401" in msg:
        return "blocked (bot protection / auth required)"
    if "HTTP 404" in msg:
        return "search URL not valid"
    if "HTTP 429" in msg:
        return "rate limited"
    if "robots" in msg.lower():
        return "robots.txt disallows"
    if "timeout" in msg.lower() or "timed out" in msg.lower():
        return "timeout"
    if "HTTP 5" in msg:
        return "retailer server error"
    return msg[:120]


def run(base_dir: str, only: Optional[List[str]] = None, countries: Optional[List[str]] = None,
        max_workers: int = 6, min_delay: float = 1.5, respect_robots: bool = True,
        limit_queries: Optional[int] = None, verbose: bool = True):
    retailers, queries = load_config(base_dir)

    if only:
        low = [o.lower() for o in only]
        retailers = [r for r in retailers if r["name"].lower() in low]
    if countries:
        up = [c.upper() for c in countries]
        retailers = [r for r in retailers if r["country"].upper() in up]

    transport = Transport(min_delay=min_delay, respect_robots=respect_robots)
    rates = normalize.fetch_ecb_rates(transport.requests_session)
    if verbose:
        print(f"[fx] ECB rates loaded ({len(rates)} currencies)", file=sys.stderr)

    jobs = []
    for r in retailers:
        terms = queries_for(r, queries)
        if limit_queries:
            terms = terms[:limit_queries]
        for q in terms:
            jobs.append((r, q))

    if verbose:
        print(f"[plan] {len(retailers)} retailers x queries = {len(jobs)} fetches",
              file=sys.stderr)

    results: List[FetchResult] = []

    def work(job):
        retailer, query = job
        adapter = get_adapter(retailer["adapter"])
        try:
            offers = adapter.search(transport, retailer, query)
            return FetchResult(retailer["name"], query, True, offers=offers)
        except Exception as e:
            return FetchResult(retailer["name"], query, False,
                               error=str(e)[:200], blocked_reason=_classify_error(e))

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = {pool.submit(work, j): j for j in jobs}
        done = 0
        for fut in as_completed(futs):
            res = fut.result()
            results.append(res)
            done += 1
            if verbose:
                status = f"{len(res.offers):>3} rows" if res.ok else f"FAIL {res.blocked_reason}"
                print(f"[{done:>3}/{len(jobs)}] {res.retailer:<20} {res.query:<22} {status}",
                      file=sys.stderr)

    # Normalise + classify every row.
    offers: List[Offer] = []
    for res in results:
        for o in res.offers:
            price, cur = normalize.parse_price(o.price, o.currency)
            o.price = price
            o.currency = cur or o.currency
            normalize.enrich(o, rates)
            cat, is_plant, terms = classify.classify(o.name, str(o.extra.get("category", "")))
            o.category, o.plant_based, o.match_terms = cat, is_plant, terms
            offers.append(o)

    return offers, results, rates


# ------------------------------------------------------------------ output ---
FIELDS = ["retailer", "country", "query", "name", "brand", "price", "currency",
          "price_eur", "pack_size_raw", "grams", "eur_per_kg", "eur_per_kg_source",
          "unit_price_raw", "category", "plant_based", "match_terms", "url",
          "source", "scraped_at"]


def write_outputs(offers: List[Offer], results: List[FetchResult], out_dir: str,
                  plant_only: bool = True):
    os.makedirs(out_dir, exist_ok=True)
    rows = [o for o in offers if (o.plant_based or not plant_only)]
    # A zero or negative price means the extractor latched onto something that
    # was not a price (a "0" badge, a struck-through placeholder). Drop it
    # rather than let it drag medians down.
    rows = [o for o in rows if o.price is not None and o.price > 0]

    csv_path = os.path.join(out_dir, "prices.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        for o in rows:
            w.writerow(o.to_dict())

    json_path = os.path.join(out_dir, "prices.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump([o.to_dict() for o in rows], f, ensure_ascii=False, indent=1)

    # Coverage report: which retailers produced data and why the rest did not.
    per_retailer: Dict[str, Dict[str, Any]] = {}
    for res in results:
        e = per_retailer.setdefault(res.retailer, {"ok": 0, "fail": 0, "rows": 0, "reasons": set()})
        if res.ok:
            e["ok"] += 1
            e["rows"] += len(res.offers)
        else:
            e["fail"] += 1
            e["reasons"].add(res.blocked_reason or "unknown")

    plant_rows = {}
    for o in rows:
        plant_rows[o.retailer] = plant_rows.get(o.retailer, 0) + 1

    report = []
    for name, e in sorted(per_retailer.items()):
        report.append({
            "retailer": name,
            "queries_ok": e["ok"],
            "queries_failed": e["fail"],
            "raw_rows": e["rows"],
            "plant_based_rows": plant_rows.get(name, 0),
            "failure_reasons": sorted(e["reasons"]),
        })
    rep_path = os.path.join(out_dir, "coverage.json")
    with open(rep_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    return csv_path, json_path, rep_path, rows, report
