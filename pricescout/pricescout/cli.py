"""Command line entry point: python -m pricescout.cli [options]"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from statistics import median

from .runner import run, write_outputs

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="pricescout",
        description="Scrapling-based plant-based food price extractor for European retailers.",
    )
    p.add_argument("--retailer", action="append", help="limit to retailer name (repeatable)")
    p.add_argument("--country", action="append", help="limit to ISO country code (repeatable)")
    p.add_argument("--queries", type=int, default=None, help="max search terms per retailer")
    p.add_argument("--workers", type=int, default=6, help="concurrent fetches (default 6)")
    p.add_argument("--delay", type=float, default=1.5, help="min seconds between hits on one host")
    p.add_argument("--ignore-robots", action="store_true", help="skip robots.txt checks")
    p.add_argument("--all-rows", action="store_true", help="keep rows that are not plant-based")
    p.add_argument("--out", default=os.path.join(BASE_DIR, "out"), help="output directory")
    p.add_argument("--quiet", action="store_true")
    args = p.parse_args(argv)

    offers, results, rates = run(
        BASE_DIR,
        only=args.retailer,
        countries=args.country,
        max_workers=args.workers,
        min_delay=args.delay,
        respect_robots=not args.ignore_robots,
        limit_queries=args.queries,
        verbose=not args.quiet,
    )

    csv_path, json_path, rep_path, rows, report = write_outputs(
        offers, results, args.out, plant_only=not args.all_rows
    )

    ok_retailers = [r for r in report if r["plant_based_rows"] > 0]
    print()
    print("=" * 74)
    print(f"  {len(rows)} plant-based price rows from "
          f"{len(ok_retailers)}/{len(report)} retailers")
    print("=" * 74)

    by_country = defaultdict(list)
    for o in rows:
        if o.eur_per_kg:
            by_country[o.country].append(o.eur_per_kg)

    if by_country:
        print(f"\n  {'Country':<9}{'rows':>6}{'median EUR/kg':>16}")
        print("  " + "-" * 31)
        for c, vals in sorted(by_country.items(), key=lambda kv: -len(kv[1])):
            print(f"  {c:<9}{len(vals):>6}{median(vals):>16.2f}")

    by_cat = defaultdict(list)
    for o in rows:
        if o.eur_per_kg and o.category:
            by_cat[o.category].append(o.eur_per_kg)
    if by_cat:
        print(f"\n  {'Category':<22}{'rows':>6}{'median EUR/kg':>16}")
        print("  " + "-" * 44)
        for c, vals in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
            print(f"  {c:<22}{len(vals):>6}{median(vals):>16.2f}")

    blocked = [r for r in report if r["plant_based_rows"] == 0]
    if blocked:
        print(f"\n  No data from {len(blocked)} retailers:")
        for r in blocked:
            reason = ", ".join(r["failure_reasons"]) or "reachable but no parseable products"
            print(f"    - {r['retailer']:<22} {reason[:70]}")

    print(f"\n  CSV      {csv_path}")
    print(f"  JSON     {json_path}")
    print(f"  Coverage {rep_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
