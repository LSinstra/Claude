# pricescout

A [Scrapling](https://github.com/D4Vinci/Scrapling)-based price extractor for
plant-based foods across European grocery retailers.

It queries each retailer in its own language, extracts product rows, normalises
everything to **EUR per kg**, classifies each row into a plant-based category,
and writes CSV + JSON plus a coverage report explaining what it could *not*
reach and why.

```bash
pip install "scrapling[fetchers]" pyyaml requests

python -m pricescout.cli                          # every retailer in the registry
python -m pricescout.cli --country NL --country DE
python -m pricescout.cli --retailer "Albert Heijn" --queries 2
python -m pricescout.cli --all-rows               # keep non-plant-based rows too
```

## What it produces

| file | contents |
|---|---|
| `out/prices.csv` | one row per product observation, normalised |
| `out/prices.json` | same data as JSON |
| `out/coverage.json` | per-retailer success/failure and the reason for each failure |

Each row carries `price`, `currency`, `price_eur`, `grams`, `eur_per_kg`,
`eur_per_kg_source`, `category`, `plant_based`, and the source URL.

`eur_per_kg_source` matters when reading the data: `retailer_unit_price` means
the figure came from the retailer's own published price-per-kg (authoritative —
it accounts for drained weight, multipacks and deposits), while `pack_size`
means we divided price by a pack size parsed out of the product name.

## Architecture

```
retailers.yaml        registry: 46 retailers, 26 countries
queries.yaml          search terms per market, in the local language
pricescout/
  transport.py        Scrapling Fetcher + robots.txt + per-host rate limiting
  adapters/
    generic.py        JSON-LD -> microdata -> adaptive card detection
    apis.py           retailers with structured JSON search endpoints
  normalize.py        price/pack-size parsing, ECB FX, EUR-per-kg
  classify.py         multilingual plant-based classification
  runner.py           concurrency, orchestration, output
tests/                regression tests for the parsing layer
```

### Extraction strategies

The generic adapter tries three approaches and keeps whichever yields most rows:

1. **JSON-LD** — schema.org `Product`/`Offer` blocks. Structured and unambiguous.
2. **Microdata** — `itemprop="price"` attributes.
3. **Adaptive cards** — anchor on an element whose text looks like a price, climb
   to its card container, then use Scrapling's `find_similar()` to pull every
   structurally similar sibling. This survives class-name churn, which is what
   usually breaks hand-written CSS selectors.

Retailers with a JSON search endpoint use `adapter: json` instead, configured
entirely in YAML — no Python needed to add one:

```yaml
- name: Rohlik
  country: CZ
  currency: CZK
  adapter: json
  search_url: "https://www.rohlik.cz/services/frontend-service/search-metadata?search={query}&companyId=1"
  json:
    items: "data.productList"
    name: "productName"
    price: "price.full"
    size: "textualAmount"
    unit_price_value: "pricePerUnit.full"
    unit_price_unit: "unit"
```

### Politeness

`robots.txt` is honoured by default (`--ignore-robots` to override), every host
gets a minimum delay with jitter (`--delay`, default 1.5s), and concurrency is
capped (`--workers`). Two retailers in the registry — Mercadona and Continente —
disallow their search paths in robots.txt and are correctly skipped.

## Results from the last full run

513 plant-based price rows from 9 retailers across 7 countries.

| Country | rows | median EUR/kg |
|---|---:|---:|
| NL | 119 | 9.61 |
| DE | 110 | 15.57 |
| AT | 81 | 17.56 |
| RO | 59 | 12.83 |
| CZ | 57 | 9.77 |
| HU | 44 | 17.34 |
| NO | 32 | 16.65 |

| Category | rows | median EUR/kg |
|---|---:|---:|
| tofu / tempeh / seitan | 202 | 13.18 |
| plant milk | 69 | 2.89 |
| plant meat | 29 | 23.45 |
| legumes & pulses | 2 | 19.94 |
| plant cheese | 2 | 19.48 |

Working sources: Albert Heijn (NL), Jumbo (NL), Oda (NO), and the Rohlik Group
platform — Rohlik (CZ), Knuspr (DE), Gurkerl (AT), Kifli (HU), Sezamo (RO).

## Why 9 retailers and not 46

Two hard limits, both visible in `out/coverage.json`:

**1. Most modern grocery sites are single-page apps.** Tuš, Mercator, Esselunga,
Konzum, ICA, Coop SE, Ocado and others return an HTML shell with zero prices in
it; the products arrive later over XHR. Extracting those requires executing
JavaScript.

**2. Bot protection.** Tesco (UK/IE/HU), Carrefour (FR/ES), REWE, Kaufland,
Migros, Coop CH, Sainsbury's, Monoprix and Spar SI return HTTP 403 to
non-browser clients.

Scrapling solves both with `StealthyFetcher` / `DynamicFetcher`, which drive a
real browser. **That path does not work in the container this was built in**: the
sandbox routes all outbound HTTPS through a TLS-terminating egress proxy, and
that proxy resets both Chromium's and curl_cffi's TLS handshakes
(`ERR_CONNECTION_RESET` for every host, including `example.com`). So in this
environment the impersonating transport is unavailable and only plain HTTPS
works — which is why `transport.py` falls back to `requests` automatically and
the run leans on JSON APIs.

On a normal machine, `Fetcher`'s TLS impersonation should clear a good share of
the 403s on its own, and adding a browser fetcher to `transport.py` would unlock
the SPA retailers. That is the single highest-value extension.

## Extending

- **New HTML retailer** — add a `search_url` to `retailers.yaml`; the generic
  adapter usually needs nothing else.
- **New JSON retailer** — add a `json:` field map as shown above.
- **New market** — add search terms under `by_country` in `queries.yaml`. Native
  language matters: searching "oat milk" on a German site returns nothing.
- **New product category** — extend `CATEGORIES` in `classify.py`.

## Tests

```bash
python tests/test_normalize.py
```

Covers the parsing layer, where wrong-but-plausible numbers are the real risk:
European vs Anglo decimal formats, multipack sizing, per-100g unit prices, and
FX conversion.
