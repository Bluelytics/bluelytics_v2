# @bluelytics/db

D1 schema (`migrations/`) and typed repository functions for the API Worker, the jobs Worker, the
site and the tools. Depends only on `@bluelytics/core` at runtime.

```ts
import { buildRendered, getRendered, runBatch, upsertDailyRowsStatements } from '@bluelytics/db';
import { createLocalD1, seedFromGoldens } from '@bluelytics/db/testing'; // Node-only, tests
```

## Conventions

- Every function takes `db: D1DatabaseLike`, a structural subset of the D1 binding
  (`prepare`/`bind`/`first`/`all`/`run`/`batch`). The real `env.DB`, Miniflare's `getD1Database()`
  and any compatible emulator fit (checked at compile time by `test/binding-types.ts`).
- Values are the core types (`DailyRow`, `PublishedState`, `Tick`, …): integers for money, storage-form
  UTC strings for instants (see `@bluelytics/core` README). Columns map 1:1 in snake_case.
- Instant bounds of range queries (`getTicksBetween`, `getLastTickAtOrBefore`, `getFreshObservations`,
  `getSourceHealth`, `pruneObservations`, `failStalePendingPosts`) and the `run_at` of inserted ticks
  and observations go through core `toStoredUtc`, so any ISO instant compares correctly (raw,
  `…15:00:00Z` would sort after `…15:00:00.000Z`). Other instant columns are stored as given: pass
  storage form.
- **Writes return statements** (`…Statement(s)`) so a caller can combine them into one atomic
  `db.batch()` (`runBatch(db, …groups)`); only writes whose result is needed run directly.
- Multi-row inserts are chunked to D1's 100-bound-parameter limit (`insertRowsStatements`).
- Upserts are idempotent: re-running a tick with the same `run_at` / day / key replaces the row.

## API

### Plumbing (`d1.ts`)

| Export | Semantics |
|---|---|
| `D1DatabaseLike`, `D1StatementLike`, `D1ResultLike<T>`, `D1Value` | Structural binding types; bind only `string \| number \| null`. |
| `runBatch(db, ...groups): Promise<void>` | One `db.batch()` over all groups (transaction); empty = no-op. |
| `insertRowsStatements(db, table, columns, rows, suffix?)` | Chunked multi-row `INSERT … VALUES … <suffix>`. |
| `MAX_BOUND_PARAMETERS` | `100`. |
| `toBoolean(value)` | SQLite 0/1 → boolean. |

### API Worker

| Export | Semantics |
|---|---|
| `getRendered(db, key): Promise<StoredRendered \| null>` | One pre-rendered body `{ key, contentType, body, etag, updatedAt }`. |
| `getRenderedEtags(db): Promise<Partial<Record<RenderedKey, string>>>` | All six etags in one small read (re-read evolution bodies only when theirs changed). |
| `getDayRates(db, day): Promise<{ oficial: RatePair \| null; blue: RatePair \| null }>` | `/v2/historical` point lookup (apply `historicalLookupDay` + `renderHistorical` from core). |

### Jobs Worker

| Export | Semantics |
|---|---|
| `insertObservationsStatements(db, observations)` | One `observations` row per source per run. |
| `getFreshObservations(db, since): Promise<Observation[]>` | Successful observations with `run_at >= since`, newest first (consensus `recent`). |
| `getLatestRates(db): Promise<PublishedState>` | `latest_rates` (missing row = `null`). |
| `upsertLatestRatesStatements(db, state)` | Upsert the non-null rates. |
| `upsertDailyRowsStatements(db, rows)` | Upsert `daily_rates` by `(day, tipo)`; a live row replaces a backfilled one. |
| `insertTickStatement(db, tick)` | Insert or replace the tick of `run_at`. |
| `getTicksBetween(db, after, before): Promise<Tick[]>` | Ticks with `after < run_at < before`, oldest first (use with core `alertWindow`). |
| `getLastTickAtOrBefore(db, at): Promise<Tick \| null>` | Previous close for an empty alert window. |
| `getPreviousClose(db, day, tipo = 'Blue'): Promise<DailyRow \| null>` | Newest Mon–Fri `daily_rates` row strictly before `day` (Monday → Friday). |
| `insertAlert(db, { alertAt, buy, sell, pushStatus? }): Promise<AlertRow>` | Record the alert first; returns it with its id (continues the legacy sequence). |
| `setAlertPushStatus(db, id, status)` | Store the push outcome. |
| `getLatestAlerts(db): Promise<{ current, previous }>` | The two newest alerts (`/v2/alerts`). |
| `insertAlertsStatements(db, alerts)` | Insert alerts with explicit ids (backfill). |
| `insertPendingPost(db, post): Promise<{ claimed, post }>` | Claim `(network, event_key)` as `pending` before sending; `claimed: false` returns the existing row. |
| `markPostSent(db, id, { sentAt, externalId, imageKey? })` | `sent`, attempts + 1, clears `error`. |
| `markPostFailed(db, id, { error, imageKey? })` | `failed`, attempts + 1. |
| `markPostDryRun(db, id, { at, imageKey? })` | `dry_run` (`SOCIAL_ENABLED=false`), `sent_at = at`. |
| `getLastSentPost(db, network, kind \| null, statuses = ['sent'])` | Newest post by `sent_at`; `kind: null` = any kind (core `shouldPost` `lastSentAt`, the cooldown clock), `'update'` = the comparison base (`lastSent`). |
| `getRetryablePosts(db, maxAttempts)` | `failed` posts with `attempts < maxAttempts`, oldest first. |
| `failStalePendingPosts(db, before): Promise<SocialPost[]>` | `pending` rows with `created_at < before` (a run died mid-send) → `failed`, attempts + 1, `error: 'stale pending'`; call each run with `now − SOCIAL_CONFIG.pendingTimeoutMs`. |
| `getCurrencies(db)`, `getCurrency(db, code)` | Currencies by `position`; one by code (EUR: `valueHundredths / 100` = EUR per USD). |
| `upsertCurrenciesStatements(db, rows)` | Upsert by code. |
| `upsertExtraRatesStatements(db, rates)`, `getExtraRates(db)` | `extra_rates` by code. |
| `getState(db, key)`, `setState(db, key, value, now)`, `setStateStatement(…)` | Small named values (`{ value, updatedAt }`). |
| `pruneObservations(db, before): Promise<number>` | Delete observations with `run_at < before`; returns the count. |
| `getSourceHealth(db, since): Promise<SourceHealth[]>` | Per source since `since`: runs, ok runs, last run/success, consecutive failures after the last success, last ok quote, last error, mean duration. |

### Publishing

| Export | Semantics |
|---|---|
| `buildRendered(db, { legacyBlueBug, keys? }): Promise<RenderedRow[]>` | Reads only the tables the requested keys need (default all six: `latest`, `last_price`, `alerts`, `currency`, `evolution_json`, `evolution_csv`) and renders them with core, with etags. |
| `renderRows(source, { legacyBlueBug }, keys?)` | Pure variant over in-memory data (`RenderSource`), to write bodies in the same batch as the rows they come from. |
| `mergeDailyRows(evolution, rows): DailyRow[]` | `getEvolutionRows` output as it will be after upserting `rows` (same `(day, tipo)` replaced, API order kept): the `daily` of `renderRows` for a tick (`mergeDailyRows(await getEvolutionRows(db), dailyRowsFromState(now, state))`). |
| `writeRendered(db, rows, now?): Promise<RenderedKey[]>` | Upserts only rows whose etag differs from the stored one (one batch); returns the keys written. |
| `upsertRenderedStatements(db, rows, now)` | Unconditional upsert statements. |

### Site

| Export | Semantics |
|---|---|
| `getLatestRates`, `getCurrencies`, `getExtraRates`, `getSourceHealth` | As above. |
| `getEvolutionRows(db): Promise<DailyRow[]>` | Every daily row in API order. |
| `getDailyRowsBetween(db, { from?, to?, tipo? })` | Inclusive range, oldest first, Oficial before Blue. |
| `getDailySeries(db, { tipo, from?, to?, maxPoints? })` | One rate's series, optionally downsampled (`downsample` keeps both ends). |
| `getHistoryDay(db, day)`, `getHistoryMonth(db, year, month)`, `getHistoryYear(db, year)` | History pages; empty array = 404. |
| `getHistoryCoverage(db): Promise<{ month: 'YYYY-MM'; days }[]>` | Months with data, for navigation and sitemaps. |

### Testing (`@bluelytics/db/testing`, Node only)

| Export | Semantics |
|---|---|
| `createLocalD1({ migrate? }): Promise<{ db, dispose }>` | Fresh in-memory D1 (Miniflare 5 / workerd SQLite) with the migrations applied. |
| `seedFromGoldens(db)` | Loads `daily_rates` (9,365), `currencies` (169), `alerts` (1884, 1885) and `latest_rates` from the legacy goldens via `@bluelytics/contract`; `latest_rates` raw values are seeded with the golden EUR (0.92) so a re-render with that EUR keeps every euro figure. |
| `applyMigrations(db)`, `migrationFiles()`, `splitSqlStatements(sql)`, `MIGRATIONS_DIR` | Apply this package's migration files in name order (comments stripped, split on `;`). |

`@cloudflare/vitest-pool-workers` is not used: its current release (0.23.0) requires vitest ^4.1 and
the workspace runs vitest 5.

## Migrations

Files in `migrations/` follow wrangler's D1 format (`NNNN_name.sql`, applied in file-name order,
recorded in the `d1_migrations` table). Never edit an applied migration; add a new file.

Each Worker's `wrangler.jsonc` points at this directory:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "bluelytics", "database_id": "<from pulumi>",
    "migrations_dir": "../../packages/db/migrations" }
]
```

- Local (Miniflare state under the app's `.wrangler/`): `pnpm db:migrate:local`
  = `wrangler d1 migrations apply bluelytics --local` run in `apps/api`.
- Remote: `pnpm db:migrate:remote` = the same with `--remote` (token needs D1 Edit; wrangler captures
  a backup and skips the confirmation in CI). Run it before deploying code that needs the change.

Verified 2026-11-22 with wrangler 4.166.0: `wrangler d1 migrations apply <db> --local` with
`migrations_dir` pointing here applied `0001_init.sql` ("14 commands executed successfully").
The tests apply the same files through `applyMigrations`.
