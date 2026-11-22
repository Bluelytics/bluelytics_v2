# @bluelytics/api

Worker `bluelytics-api`: the public API of `api.bluelytics.com.ar`, byte-compatible with the legacy Go
service (`docs/legacy/legacy-backend-spec.md` part A, `docs/ARCHITECTURE.md` §6). It only serves bytes:
every body is pre-rendered by `bluelytics-jobs` into the D1 table `rendered`; this Worker adds the
request-dependent parts (`?days`, `?day`, `?callback`, `?pretty`) and the v2 caching headers.

## Routes

Exact, case-sensitive, no trailing slash (`/v2/latest/` is a 404, as legacy).

| Path | Body | `Cache-Control` | Parameters |
|---|---|---|---|
| `/` | `OK` (text, never touches D1) | `public, max-age=60` | |
| `/v2/latest` | `rendered.latest` | `public, max-age=30` | `callback`, `pretty` |
| `/json/last_price` | `rendered.last_price` | `public, max-age=30` | `callback`, `pretty` |
| `/v2/alerts` | `rendered.alerts` | `public, max-age=30` | `pretty` |
| `/v2/evolution.json` | `rendered.evolution_json` | `public, max-age=300` | `days`, `pretty` |
| `/v2/evolution.csv` | `rendered.evolution_csv` | `public, max-age=300` | `days` |
| `/data/json/currency.json` | `rendered.currency` | `public, max-age=300` | `pretty` |
| `/v2/historical` | `daily_rates` point lookup | `public, max-age=86400` past day, `public, max-age=60` today / 404 | `day`, `pretty` |

Legacy behaviour kept: `?days=N` (first value, `strconv.Atoi` rules) → first N rows by string slicing,
`N <= 0` → `null\n` / CSV header only, non-integer or `>= 10000` → everything; `?day` strict
`YYYY-MM-DD`, weekend → Friday, bad day and missing day both 404 with their legacy bodies;
JSONP `callback(` + body + `);` as `application/javascript`; `?pretty` (any value, JSON only, error
bodies too) indents with two spaces keeping number text; `OPTIONS` on any path → 204 with the legacy
preflight headers (requested headers echoed); unknown path → 404, other methods on a known path → 405,
both with legacy JSON bodies; every response carries `Access-Control-Allow-Origin: *` and `Vary: Origin`.

Additive (ARCHITECTURE §2 item 9): `HEAD`; a strong `ETag` on every 200/404 (each byte-different
variant gets its own, e.g. `"…-r5-p"`), `If-None-Match` → 304 on 200s; explicit `Cache-Control`
(`no-store` on 400/405/500); a callback outside `[A-Za-z0-9_$.\[\]]{1,128}` → 400 with `{"message":"Bad Request"}\n`
(`BODY.badRequest`); `X-Robots-Tag: noindex` on the `SHADOW_HOSTNAME` host.

## Caching and failure behaviour

- `src/rendered-cache.ts`: each body is read once per isolate and kept with its UTF-8 bytes. At most
  every 15 s (first check 15 s after the first read) one background query (`waitUntil`) reads the six
  etags; only bodies whose etag changed are read again, so the evolution bodies (720 KB JSON, 280 KB CSV) are re-read only
  when they change. The `?pretty` text of a whole body is memoised per body version.
- `src/historical-cache.ts`: one entry per lookup day; past days with data for 1 hour (a later `backfill --since` must reach warm isolates), today and misses for
  60 s; cleared when it reaches 10,000 entries.
- D1 errors are logged and the last copy in memory is served (even if stale). Without one the answer is
  the legacy JSON 500 body; the Worker never returns an HTML error page.

## Configuration (`wrangler.jsonc`)

- D1 binding `DB` → database `bluelytics`; `database_id` is the placeholder
  `00000000-0000-0000-0000-000000000000` until `pnpm infra:sync-ids` writes the Pulumi-managed id;
  `migrations_dir` is `../../packages/db/migrations`.
- Routes: only the shadow custom domain `api-v2.bluelytics.com.ar`. The production route
  (`api.bluelytics.com.ar/*`, a plain zone route, never a custom domain) is added at cutover,
  `docs/MIGRATION.md` 4.7.
- Vars: `SHADOW_HOSTNAME` (read: `noindex` host); `LEGACY_V1_BLUE_BUG` and `API_MODE` are not read
  here (the jobs Worker renders the bodies and owns static-first mode) and must equal the values in
  `apps/jobs/wrangler.jsonc`.
- No secrets.

## Commands

```
pnpm --filter @bluelytics/api dev                 # wrangler dev --local (state in .wrangler/)
pnpm db:migrate:local | db:migrate:remote         # wrangler d1 migrations apply bluelytics (run here)
pnpm deploy:api [-- <flags>]                      # wrangler deploy via scripts/wrangler-deploy.mjs (e.g. -- --dry-run)
pnpm --filter @bluelytics/api typecheck           # Worker types for src/, Node types for tests and bench
pnpm --filter @bluelytics/api test
pnpm --filter @bluelytics/api bench               # rough CPU per request
```

A local dev server answers `500` on `/v2/*` until the local D1 has rendered bodies (run the jobs Worker
or the backfill against it).

## Tests

- `test/contract.test.ts` bundles `src/index.ts` with esbuild (as wrangler does) and runs it in workerd
  through Miniflare, on a local D1 seeded with `@bluelytics/db/testing` `seedFromGoldens` and rendered
  with `buildRendered`. With `legacyBlueBug: true` every one of the 27 captures in
  `packages/contract/golden-manifest.json` matches status, `Content-Type`, `Access-Control-Allow-Origin`,
  `Access-Control-Allow-Methods`, `Vary` and the body byte for byte. With the default flags the six
  time-varying captures match structurally, the static ones still byte for byte, and `/json/last_price`
  carries the blue values.
- `test/behaviour.test.ts` drives `createApi` in Node with a controllable clock and a spying D1:
  `Cache-Control` values, ETag/304, HEAD, callback validation, `?days`/`?pretty` edge cases, routing,
  preflight, shadow `noindex`, the 15 s recheck, historical cache lifetimes, D1 failure serving the last
  copy and the 500 before the first render.

## Measured cost

`pnpm --filter @bluelytics/api bench` (Node 24, warm caches, 2,000 requests per path, includes
constructing and consuming the `Response`; 2026-11-22 on the development machine): 10–60 µs CPU per request
for every small body, `?days` slices and historical hits; about 1.5 ms for the full `/v2/evolution.json`
(≈700 KB, dominated by Node copying the body into its `Response`; about 0.35 ms without consuming it)
and about 1.9 ms for its memoised `?pretty` variant. workerd streams the body natively, so these are
upper bounds rather than Workers billing figures.
