# @bluelytics/tools

Operator CLIs behind the root scripts of `docs/ARCHITECTURE.md` §11, as `docs/MIGRATION.md` uses them.
They run in Node with `tsx`. Every command takes `--help`, prints its errors as `<command>: <message>`
with exit code 1, and never prints a secret.

| Root script | Entry | What it does |
|---|---|---|
| `pnpm backfill -- --from <url> [--since D] [--remote] [--dry-run]` | `src/backfill/main.ts` | Loads the legacy API's history into D1 and re-renders the API bodies |
| `pnpm parity -- --old <url> --new <url> [--strict]` | `src/parity/main.ts` | Compares two APIs over every golden capture |
| `pnpm buffer:channels` | `src/buffer-channels.ts` | Lists Buffer channels and prints `BUFFER_CHANNELS` |
| `pnpm cards:preview` | `src/cards-preview.ts` | Renders every social card to `out/cards/*.jpg` with local Chrome |
| `pnpm infra:sync-ids` | `src/sync-ids.ts` | Copies the Pulumi D1 id into the three `wrangler.jsonc` (see `infra/README.md`) |

Relative paths given on the command line resolve against the caller's directory. Default outputs go to
`out/` at the repository root (gitignored).

## backfill

```sh
pnpm backfill -- --from https://api.bluelytics.com.ar --dry-run      # counts + SQL files, no database
pnpm backfill -- --from https://api.bluelytics.com.ar                # local D1 (state of `pnpm dev:api`)
pnpm backfill -- --from https://api.bluelytics.com.ar --remote
pnpm backfill -- --from https://api.bluelytics.com.ar --since 2026-11-16 [--remote]
```

1. **Download.** GETs `/v2/evolution.json`, `/v2/alerts` and, in a full run, `/data/json/currency.json` and
   `/v2/latest`, each with a unique `ts=` query parameter. The legacy edge caches for 2 hours, and
   each query string is its own cache key. Any status other than 200, or a body that is not JSON, stops the run.
2. **Convert** with the `@bluelytics/contract` seed helpers, which parse `%.2f` exactly and throw on
   anything unexpected. Daily rows get `origin = 'backfill_api'`. `latest_rates` is seeded with the
   downloaded EUR value, so the euro figures re-render unchanged.
3. **Write.** The SQL comes from the same `@bluelytics/db` statement builders the Workers use. They are
   recorded by `SqlRecorder` and written as literal SQL to `out/backfill/backfill-<UTC stamp>-data.sql`
   (no bound parameters; every statement is at most 50 KB, under D1's 100 KB limit). All writes are
   idempotent upserts. Alerts are upserted by id and keep legacy's ids. The file then runs through
   `wrangler d1 execute bluelytics --local|--remote --json --yes --file …` inside `apps/api`, the
   same config `wr_api` uses in MIGRATION.md.
4. **Re-render.** The tables that the bodies depend on are read back from the target with
   `wrangler … --json --command`. They are loaded into a throwaway in-memory D1 (`@bluelytics/db/testing`)
   and rendered with `buildRendered`, the jobs Worker's code. The bodies therefore reflect what D1
   really holds, including the days that a `--since` run did not touch. Only bodies whose etag changed
   are written (`…-rendered.sql`), and the etags are checked afterwards. `LEGACY_V1_BLUE_BUG` is read
   from `apps/jobs/wrangler.jsonc`, falling back to `apps/api/wrangler.jsonc`.

What a run touches (MIGRATION.md C7/C8):

| | full run | `--since <day>` |
|---|---|---|
| `daily_rates` | every legacy row (upsert) | rows with `day >= <day>` (upsert); rows in that range that legacy lacks (still `live` afterwards) are deleted; earlier days untouched |
| `alerts` | legacy's last two, with their ids | same |
| `currencies`, `latest_rates` | upsert | **not touched** |
| `rendered` | all six keys | `alerts`, `evolution_json`, `evolution_csv` |
| `ticks`, `observations`, `social_posts`, `state`, `extra_rates` | never | never |

An evolution body (about 720 KB) does not fit in one D1 statement. Each body is built in a staging
table, `backfill_rendered_stage`, chunk by chunk. It is then copied into `rendered` by one statement
that only matches when the assembled length is complete, and the staging table is dropped. A script
that dies halfway therefore never publishes a truncated body; re-running the backfill fixes it.

`--dry-run` makes no database calls and does not need wrangler. It prints the per-table counts and
writes both SQL files, rendered as if the target held exactly the downloaded data. Extra flags:
`--out <dir>` (default `out/backfill`) and `--persist-to <dir>`, which uses another local Miniflare
state directory (local only).

## parity

```sh
pnpm parity -- --old https://api.bluelytics.com.ar --new https://api-v2.bluelytics.com.ar [--strict]
```

The command replays every capture of `packages/contract/golden-manifest.json` (method, path, query
and request headers, plus a shared `ts=` cache-buster) against both APIs. It uses `redirect: manual`
and prints one table row per capture:

| Capture | Compared | Expected difference (WARN; FAIL with `--strict`) |
|---|---|---|
| static bodies (`/`, historical, errors, `post`, `options`) | bytes | none |
| `/v2/evolution.json`, `.csv` (all `days` variants) | rows by `(day, type)`; header, order and row format must hold | changed, missing or added rows only within 31 days of the old API's newest day (days v2 computed itself) |
| time-varying (`v2_latest`, `origin`, JSONP, `v2_alerts`, `v1_last_price*`) and `currency` | shape: keys, key order, `%.2f`/integer formats, timestamp offsets, string values (codes, names, sources), JSONP wrapper, trailing newline | other values. The detail lists the first changes as `key old → new` |
| every capture | status; `content-type`, `access-control-allow-origin/-methods/-headers`, `vary` (as a token set) | none |

`etag` and `cache-control`, which v2 adds, are not compared. The exit code is 1 when any check fails,
including network errors. Warnings alone exit 0.

## buffer:channels

```sh
read -rs BUFFER_API_KEY && export BUFFER_API_KEY
pnpm buffer:channels
```

The command runs read-only GraphQL queries (`listOrganizations`, then `listChannels` for each
organization) through the `@bluelytics/social` `BufferClient`. It prints one row per channel:
organization, Buffer **channel id**, service, name, and status (`ok`, `disconnected`, `locked`,
`queue paused`). The table never shows `serviceId`. It then prints `BUFFER_CHANNELS={"instagram":"…","twitter":"…"}`,
with the first usable (not disconnected, not locked) channel of each supported network
(`instagram`, `twitter`, `facebook`), validated with `parseBufferChannels`. A warning names every
extra candidate, paused queue or unusable network. The exit code is 1 when no network is usable.
The key goes only into the `Authorization` header, and it is redacted from any error message.

## cards:preview

```sh
pnpm cards:preview [-- --out <dir>] [--chrome <path>]
```

The command renders `renderCardHtml(kind, size, data)` for each kind in `CARD_KIND_SIZES` × its sizes
× the scenarios in `CARD_SCENARIOS`, using `LocalChromeRenderer` (default
`/usr/bin/google-chrome-stable`, or `$CHROME_PATH`; network blocked). Each card goes to
`out/cards/<kind>-<size>-<scenario>.jpg`. The scenarios are update `up`, `down`, `flat`,
`no-reference` and `five-digits`; weekly `week-up`, `week-down` and `one-day-week`; and og `up` and
`no-reference`. Together that makes 26 JPEGs.

## Library exports (`src/index.ts`)

`runBackfill(options)`, `wranglerTarget(options)` / `D1Target`, `runParity(options)`, `formatReport`,
`compareCapture`, `bodyMode`, `listAllChannels`, `suggestChannels`, `renderPreviews(renderer, outDir)`,
`CARD_SCENARIOS`, and everything from `sync-ids.ts`.

## Tests

`pnpm --filter @bluelytics/tools test` (also part of the root `pnpm test`):

- **backfill:** SQL literals and chunking; the generated statements are run against a Miniflare D1
  (idempotence, `--since` range replacement, a truncated body is never published). A dry run against
  a local HTTP server that replays the goldens re-renders the goldens byte for byte. The full and
  `--since` runs go through real `wrangler d1 execute --local` into a temporary `--persist-to`
  directory, which takes about 30 s.
- **parity:** two local golden servers, one of them altered. The tests cover OK, WARN, strict FAIL,
  and structure, status, content-type, CORS and unreachable-host failures.
- **buffer:channels:** a mocked Buffer `fetch`; the key never appears in the output.
- **cards:preview:** a fake renderer covers file names and JPEG checks. `@bluelytics/social` tests
  the real Chrome renders.

No test touches the network beyond 127.0.0.1.
