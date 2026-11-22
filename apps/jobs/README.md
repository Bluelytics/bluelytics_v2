# @bluelytics/jobs

Worker `bluelytics-jobs` (ARCHITECTURE §7): the five-minute cron pipeline (sources → consensus →
pre-rendered API bodies → alerts → social posts → Open Graph image → source health), the daily
currency step, and a small bearer-token admin API. `docs/MIGRATION.md` drives it through exactly the
commands below.

```sh
pnpm --filter @bluelytics/jobs typecheck   # src under workers-types, then src + tests under Node types
pnpm --filter @bluelytics/jobs test        # vitest on a real local D1 (Miniflare) with fakes for everything external
pnpm dev:jobs                              # wrangler dev --local --test-scheduled (needs .dev.vars, see below)
pnpm deploy:jobs [-- <wrangler deploy flags>]   # e.g. -- --dry-run, -- --secrets-file <file>
```

`deploy` runs the shared `scripts/wrangler-deploy.mjs` (repo root; api and web use it too), which drops the `--` that pnpm 12 forwards: a plain `wrangler deploy`
script would receive `-- --dry-run`, ignore the flag and deploy for real (MIGRATION.md C1).

## Schedule

One cron, `*/5 * * * *` (UTC). Each invocation uses `controller.scheduledTime` as its instant (`run_at`) and
branches on Argentine time (UTC−3):

| When | What runs |
|---|---|
| Daily step not done yet today and ART hour ≥ 06 | currencies, `extra_rates`, pruning (see below) |
| Mon–Fri 07:00–19:59 ART (`isTradingWindow`) | the tick |
| Anything else | nothing: no fetch, no D1 query besides one `state` read |

### Tick

1. `fetchAll(TICK_SOURCES)` (`@bluelytics/scrapers`, 8 s / BNA 20 s timeouts).
2. `computeConsensus` with the fresh observations of the last 30 min, current `latest_rates` and EUR.
3. **One D1 batch**: the observations, `latest_rates`, today's two `daily_rates` rows, the `ticks` row and every
   re-rendered body whose etag changed. `latest`/`last_price` are rendered every run; the two evolution bodies
   (≈700 KB each) only when today's daily values moved (or a body was never rendered).
4. Alerts (only when blue had voters): core `shouldAlert` over the 6 h window (empty window → last tick before
   it, then the previous trading day's close). The alert row is inserted (`push_status = 'pending'`) and
   `/v2/alerts` re-rendered first, then FCM HTTP v1 (core `buildFcmMessage`, service-account JWT signed with
   WebCrypto RS256). Final `push_status`: `sent`, `failed: <reason>`, or **`disabled`** when `PUSH_ENABLED` is off.
5. Social, per network in `BUFFER_CHANNELS` (only if it parses; errors fail this step only):
   - `failStalePendingPosts(now − 15 min)`, then retries: `failed` rows with attempts < 3, **only on the ART day
     they were created** (so a retry never publishes an old day's price).
   - `shouldPost` update (baseline: `getLastSentPost(network, 'update')`; with `SOCIAL_ENABLED` on only `sent`
     rows count (C9), with it off `sent` and `dry_run` rows count, so shadow rows follow the real cooldowns and
     0.75 % rule and their keys end in `-dry`, never blocking a live post; previous close = `getPreviousClose`, Monday → Friday) and weekly (Friday
     18:00–18:59, `weekly-<ISO week>`).
   - Claim `(network, event_key)` as `pending` → store the post payload `social/<yyyy>/<mm>/<network>-<event_key>.json`
     → render the card (Browser Run) → `…/<network>-<event_key>.jpg` → Buffer `createImagePost` with
     `https://$MEDIA_HOSTNAME/<image_key>` → `sent`; with `SOCIAL_ENABLED` off → `dry_run` (Buffer is never
     constructed). Any failure → `failed` with the error. A row that already exists is never sent again except
     through the retry rule. Story posts (`{"channelId":…,"story":true}`) are their own rows, key `<key>-story`.
   - Shadow mode still renders the cards and writes them to R2 (that is what `dry_run` rows point at). `-dry` rows
     are never retried once `SOCIAL_ENABLED` is on.
6. `og/latest.jpg` (the website's `og:image`) is re-rendered when blue buy/sell or oficial sell differ from the
   last image, at most every 15 min (`state.og_image`).
7. Source health: a tick source with ≥ 6 consecutive failures in the last hour, or < 3 blue voters for 60 min,
   sends **one** message per incident to `OPS_WEBHOOK_URL` (body `{"text":…,"content":…}`: Slack, Discord,
   Telegram `sendMessage?chat_id=…`) and logs an error. Open incidents live in `state.ops_incidents`.
8. `API_MODE=static-first`: every body whose etag differs from the copy recorded in `state.static_api_etags`
   (all six on the first run) is put to R2 `api/<path>` with its content type and the API's `Cache-Control`,
   then purged by prefix (public path and rewritten `/api<path>`, one request). The copy is recorded only after
   the purge succeeds, so failures repeat on the next run.

The core of the tick (steps 1–3) throws; every later step fails on its own and is listed in the run report.
A run with any failed step makes `scheduled()` throw at the end, so Workers Issues / Cron Events show it.

### Daily step

`fetchCurrencies` (fawazahmed0 jsDelivr → pages.dev → Frankfurter v2, table guards in scrapers), then the
per-code jump guard here: a code moving > 30 % (and more than one hundredth) from its stored value is updated
only if the other provider agrees within 5 %; otherwise it keeps its value and is listed in `rejected`. Only
codes already in `currencies` change (legacy names and order). On 2026-11-22 data this rejects `ZWL`, `SLL`, `SYP`
(redenominated, not in Frankfurter) and accepts ARS. Then `withEuro` on `latest_rates` and `currency`, `latest`,
`last_price` re-rendered in one batch; `extra_rates` from `ambito_extras`; observations older than 90 days pruned.
The day is marked done (`state.daily_last_day`) even if a part failed, so a broken provider is not hammered.

## Admin API

All routes need `Authorization: Bearer $ADMIN_TOKEN` (constant-time comparison); without it, or when the secret
is unset, every path answers `404`.

| Route | Behaviour |
|---|---|
| `POST /admin/run?force=1` | Runs now and returns the run report. Inside the window: a normal tick. **Outside: only fetches sources, inserts `observations` and re-renders all bodies from D1** (never `daily_rates`, `ticks`, `alerts`, `social_posts` or `latest_rates`: C6), plus the daily step if it is due. Without `force=1` it behaves like a cron run. |
| `GET /admin/health` | Effective flags `PUSH_ENABLED`, `SOCIAL_ENABLED`, `API_MODE`, `LEGACY_V1_BLUE_BUG` (C3), configured networks (or the `BUFFER_CHANNELS` error), the last run report (`failedSources`), daily day, `latest_rates`, rendered etags, and every source of the last 24 h with `status` `ok` / `degraded` / `failing` (≥ 6 consecutive failures). |
| `GET /admin/card?kind=update\|weekly\|og&size=landscape\|portrait\|story\|og` | Card HTML from current data (400 for a size the kind does not have). |
| `POST /admin/social/test` | One Buffer **draft** per planned post (`saveToDraft`, never published), image at `social/<yyyy>/<mm>/test-<network>-<post>-<stamp>.jpg`; no `social_posts` row; independent of `SOCIAL_ENABLED`. |
| `POST /admin/push/test` | FCM `validate_only: true` with the deployed secret and the current price (C10): `{ok, name}` or `{ok:false, error}`; nothing is delivered. |

## Configuration (`wrangler.jsonc`)

Bindings: `DB` (D1 `bluelytics`, id placeholder filled by `pnpm infra:sync-ids`, migrations from
`packages/db/migrations`), `MEDIA` (R2 `bluelytics-public`), `BROWSER` (Browser Run). `workers_dev: true`
(admin host on workers.dev; MIGRATION decision list for a custom domain). Cron `*/5 * * * *`.

| Var | Default | Meaning |
|---|---|---|
| `PUSH_ENABLED`, `SOCIAL_ENABLED` | `"false"` | On only for the exact string `"true"` (C2) |
| `API_MODE` | `"worker"` | `"static-first"` adds step 8 |
| `LEGACY_V1_BLUE_BUG` | `"false"` | Passed to `/json/last_price` rendering (keep equal to apps/api) |
| `BUFFER_CHANNELS` | `"{}"` | `{"twitter":"<id>","instagram":"<id>"}` (`parseBufferChannels`) |
| `MEDIA_HOSTNAME` | `media.bluelytics.com.ar` | Public host of `MEDIA` (image URLs sent to Buffer) |
| `API_HOSTNAME`, `CLOUDFLARE_ZONE_ID` | `api.bluelytics.com.ar`, `""` | static-first purge target; both must be set before `API_MODE` = `static-first` (MIGRATION.md 7.3) |

Secrets (names only): `BUFFER_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `ADMIN_TOKEN` (declared in
`secrets.required`, so the first deploy must pass them, e.g. `--secrets-file`), optional `OPS_WEBHOOK_URL`,
`CLOUDFLARE_PURGE_TOKEN` (static-first). `FIREBASE_SERVICE_ACCOUNT_JSON` is parsed only when a push is sent
(C5); it must belong to project `bluelytics-mobile`. Local dev: put dummy values of the three required secrets
in `apps/jobs/.dev.vars` (git-ignored); `wrangler dev` loads only the listed names, and triggers a run with
`curl "http://localhost:8787/cdn-cgi/handler/scheduled?time=<epoch ms>"`.

## CPU budget: Workers Paid is needed

Workers Free allows 10 ms CPU per cron invocation (`docs/research/cloudflare.md` §1). Measured in Node 24
(upper bounds; workerd figures not measured): fetching + parsing the nine sources with page bodies padded to
their real sizes ≈ 4–6 ms; consensus ≈ 0.1–0.3 ms; `latest`/`last_price` ≈ 0.2–0.3 ms; merging and rendering the
two evolution bodies (9,365 daily rows) ≈ 7–10 ms, plus decoding ~19k D1 rows to get them. A steady tick is
therefore at or near the limit, and every tick where the day's value moves (and the daily step) is well above
it. D1 is the other wall: Free allows 50 queries per invocation, and a counted Monday 10:00 run (daily step,
tick, social) makes 47 and a Friday 18:05 run (daily, tick, update and weekly posts on two networks) exactly 50;
one more network, a story or an alert goes over. **Plan on Workers Paid** (flat $5/month; the cron limit becomes 30 s CPU). On Free, ticks would be killed
intermittently. Browser Run's Free quota (10 min/day, one Quick Action per 10 s) is handled by the renderer's
429 waits; card renders are a few per day plus at most four og renders an hour.

## Code map

`src/index.ts` (handlers) · `run.ts` (orchestration, report) · `tick.ts` · `alerts.ts` · `fcm.ts` + `jwt.ts` ·
`social.ts` · `card-data.ts` · `og.ts` · `ops.ts` · `daily.ts` + `currencies.ts` · `static-api.ts` · `admin.ts` ·
`env.ts` (bindings, flags) · `deps.ts` (every external effect is injectable: `db`, `bucket`, `renderer`, `fetch`,
`sources`, `log`). Tests: `test/pipeline.test.ts` (multi-tick week, crash between claim and result, shadow
mode), `daily.test.ts`, `admin.test.ts`, `fcm.test.ts` (flags, JWT signature verified, exact FCM payload),
`sources-and-static.test.ts` (real parsers on fixtures, static-first copies and purge).
