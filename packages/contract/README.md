# @bluelytics/contract

The legacy API contract as data: byte-exact captures of `https://api.bluelytics.com.ar`
(`golden/`) and pure helpers that turn legacy response bodies into D1 rows.

```ts
import { seedDailyRates, seedCurrencies, seedAlerts, seedLatestRates, GOLDEN_NAMES } from '@bluelytics/contract';
import { goldenText, goldenHeaders, goldenRequest } from '@bluelytics/contract/golden'; // Node only
```

## Fixtures (`golden/`, read-only)

27 captures taken through Cloudflare on 2026-11-22 14:37 UTC (a Sunday, so nothing moved between
requests). For each `<name>`: `<name>.body` = raw response bytes, `<name>.headers` = HTTP/2 status
line and response headers. Never edit or reformat them (`.editorconfig` disables whitespace rules
there).

`golden-manifest.json` (next to `golden/`, which holds only the capture files) describes each capture: `name`, `method`, `path`, `query`, `requestHeaders`,
`request` (`documented` per `docs/legacy/legacy-backend-spec.md` §A.9, or `representative` where the
exact path/query was not recorded and a value with the same documented behaviour stands in),
`status`, `contentType` (`null` = none), `body` (`static` | `time-varying` | `empty`), `bytes`,
`sha256`, `capturedAt`, `edgeCache` (`cf-cache-status`) and `notes`.

- **static**: byte-comparable against a system whose database was seeded from the goldens (the
  evolution, currency and historical bodies, error bodies, `/`).
- **time-varying**: `v2_latest`, `origin`, `v2_latest_jsonp`, `v2_alerts`, `v1_last_price`,
  `v1_last_price_jsonp` change with every scrape; compare live systems structurally. They are still
  byte-reproducible from a database seeded from them (`v1_last_price*` with `legacyBlueBug: true`).

Facts worth knowing: `evolution_days_bad` and `evolution_days_big` are byte-identical to
`evolution_full`; `historical_sat`/`_sun` equal `historical_weekday`; `origin` equals `v2_latest`;
`options` is empty (204).

## Golden helpers (`@bluelytics/contract/golden`, Node only)

| Export | Semantics |
|---|---|
| `GOLDEN_DIR` | `URL` of `golden/`. |
| `goldenManifest(): readonly GoldenCapture[]` | Parsed `golden-manifest.json`. |
| `GOLDEN_MANIFEST` | `URL` of `golden-manifest.json`. |
| `goldenCapture(name): GoldenCapture` | One manifest entry (throws for unknown names). |
| `goldenBody(name): Uint8Array` | Raw body bytes. |
| `goldenText(name): string` | Body decoded as UTF-8 (fatal on invalid bytes). |
| `goldenHeaders(name): { status, headers: [name, value][] }` | Parsed `.headers` file; names lower-cased, repeated headers kept. |
| `goldenRequest(name, baseUrl): Request` | A `Request` replaying the capture's method, path, query and request headers against `baseUrl`. |

`GOLDEN_NAMES`, `GoldenName` and `GoldenCapture` are exported from the main entry.

## Seed helpers (main entry, runtime-neutral)

Pure functions from legacy response text to `@bluelytics/core` row types. Numbers are taken from
their JSON source text (`JSON.parse` source-text access, Node ≥ 21 / workerd) and converted with
`parseFixed2`, so there is no float drift; any value that is not `%.2f`, not whole pesos where pesos
are expected, or an inconsistent `value_avg`, throws.

| Export | Semantics |
|---|---|
| `seedDailyRates(evolutionJson): DailyRow[]` | `/v2/evolution.json` → `daily_rates` rows in response order, `origin: 'backfill_api'`, `updatedAt: null`; `null` body → `[]`. |
| `seedCurrencies(currencyJson, { valueDate? }): CurrencyRow[]` | `/data/json/currency.json` → `currencies`; `position` = 0-based order in the response; names byte-exact (U+02BB in `TOP`, U+200B in `VES`). |
| `seedAlerts(alertsJson, { previousAlertAt? }): AlertRow[]` | `/v2/alerts` → `[previous, current]`: previous gets `id − 1` and an earlier `alert_at` (default one hour before), current its id and `alert_at`; `pushStatus: null`. `alert_id` 0 → `[]`. |
| `seedLatestRates(latestJson, { eurPerUsd? }): PublishedState` | `/v2/latest` → `latest_rates`; both rates get the blue `last_update` in storage form (microseconds kept); Go zero time → both `null`. The unrounded values are not public: with `eurPerUsd` (the capture's EUR, `0.92`) `buyRaw`/`sellRaw` are the midpoint of the values that round to both the published pesos and euros (oficial sell 1601 / euro 1741 → 1601.38), so `withEuro(state, 0.92)` republishes identical bytes; it throws when no such value exists. Without it, raw = the published pesos, and re-deriving the euro can move a figure by one (1601 / 0.92 → 1740). Pass it whenever the state may be re-rendered with an EUR value. |

Inserting these rows (`@bluelytics/db`) and rendering them (`@bluelytics/core`) reproduces the
corresponding goldens byte for byte; `@bluelytics/db/testing` `seedFromGoldens` does exactly that.

The OpenAPI document and the parity checker (`pnpm parity`) will live here too; they are not written yet.
