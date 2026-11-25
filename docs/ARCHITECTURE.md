# bluelytics v2 — architecture and build spec

Status: authoritative design for the rewrite. Decisions here were taken from the legacy analysis
(`docs/legacy/*.md`) and the platform research (`docs/research/*.md`); when this file and a research
file disagree, this file wins. Platform mechanics (exact wrangler/Pulumi/Astro syntax) live in the
research files and must be checked there, not recalled from memory — several of these tools changed
in 2026.

## 1. Goals

1. Keep the public API contract byte-compatible (`api.bluelytics.com.ar`), served as cheaply as possible.
2. Lowest running cost: target a flat ~USD 5/month (Workers Paid), independent of API traffic.
3. A server-rendered, SEO-first website replacing the AngularJS SPA.
4. Reliable scraping from several independent sources, with per-source health visible.
5. Automatic social posts through Buffer's current GraphQL API with a new dark card design.
6. One monorepo, one `pulumi up` + deploy script, safe staged cutover from the legacy AWS stack.

Non-goals: adding new public API endpoints,
user accounts, anything stateful beyond D1/R2.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Everything on Cloudflare: Workers, D1, R2, Cron Triggers, Browser Run. | DNS/CDN already there; no egress fees; replaces RDS + containers + S3. |
| D2 | Three Workers: `bluelytics-api` (`apps/api`), `bluelytics-jobs` (`apps/jobs`), `bluelytics-web` (`apps/web`). | Hot API path stays tiny and stable; cron code and the site deploy independently. |
| D3 | D1 database `bluelytics` is the single source of truth. R2 bucket `bluelytics-public` holds post images and a copy of the pre-rendered API bodies. No KV. | KV write limits and eventual consistency buy nothing here. |
| D4 | Every API response body is pre-rendered by the jobs Worker when data changes. The API Worker only serves bytes (plus `?days`, `?day`, `?callback`, `?pretty`). | "It doesn't change often": request path does no computation and no D1 work beyond a cached read. |
| D5 | Two API serving modes, same code: `worker` (default: Worker answers every request) and `static-first` (opt-in: R2 custom domain + CDN cache for the hot fixed paths, Worker routes only for parameterised paths). | `worker` is correct by construction and testable locally; `static-first` removes per-request cost but depends on four Cloudflare behaviours that must be tested live (see `docs/research/cloudflare.md` §14). |
| D6 | Pulumi (TypeScript, `@pulumi/cloudflare` pinned 6.24.0) owns long-lived resources: D1, R2 bucket + public custom domain + lifecycle + CORS, zone rulesets, DNS not auto-created. Wrangler 4 owns Worker code, bindings, routes/custom domains, crons, secrets, D1 migrations. IDs flow Pulumi outputs → `wrangler.jsonc` via `pnpm infra:sync-ids`. | "Architecture C" in `docs/research/pulumi-cloudflare.md`; the provider is a poor fit for uploading built Workers and assets. |
| D7 | Social posting through Buffer GraphQL (`https://api.buffer.com`, `createPost`, `mode: shareNow`). Images are JPEGs on a public R2 URL. Direct X/Meta integrations are NOT built (research kept for reference). | Owner decision 2026-11-22. The legacy v1 token is rejected by the new API (`FORBIDDEN`), so a new API key is required. |
| D8 | Post images: HTML/CSS template → JPEG screenshot via Browser Run (Worker `BROWSER` binding, Quick Action). Locally the same HTML is rendered with Playwright/Chrome for previews and visual tests. | Real CSS, negligible Worker CPU, 10 free browser-minutes/day. |
| D9 | TypeScript everywhere, pnpm 12 workspace, Node 24 (`.nvmrc`), vitest 5. **One TypeScript version for the whole workspace: `typescript@6.0.3`** (pnpm `catalog:` in `pnpm-workspace.yaml`; astro check rejects TS 7, and a single version avoids two toolchains). D1 tests run against Miniflare's real SQLite D1 (`@bluelytics/db/testing`); `@cloudflare/vitest-pool-workers` 0.23.0 needs vitest ^4.1 and is not used. | See research; changed 2026-11-22 from "`apps/web` pins 6.0.3". |
| D10 | `apps/mobile` is a Flutter app (2026-11-25) that replaces the React Native 0.69 app and keeps its store identifiers, Firebase project and FCM topic. It is a client of the public API like any other, built with Flutter's own tools and CI workflow, and excluded from the pnpm workspace. `legacy/**` is reference only: excluded from workspace, lint, tests, CI. | See `apps/mobile/README.md`; the old app is described in `docs/legacy/legacy-mobile.md` and remains in git history. |
| D11 | Licence AGPL-3.0 (same as the legacy frontend and scraper). | Continuity; the About page says open source. |

### Deliberate behaviour changes versus legacy (each is documented for users in `docs/DECISIONS.md`)

1. **Source set**: blue voters are Ámbito, dolarhoy, Cronista, Infodolar; La Nación only votes when fewer than three of those are fresh; criptoya is a last resort. Official is a priority chain: Ámbito oficial, then BNA. (Legacy: Ámbito + La Nación + dead Cronista.)
2. **Freshness**: a source votes only if it parsed successfully in this run or within the last 30 minutes. If nobody is fresh the last published value is held. (Legacy: a dead source kept voting for 3 days.)
3. **Daily value** = the last consensus published on that Argentine calendar day (a close). History up to cutover is imported as published and never recomputed. (Legacy: median of the last 49 samples of the UTC day.)
4. **`/json/last_price`**: the `blue` entry carries blue values. Env flag `LEGACY_V1_BLUE_BUG=true` restores the legacy copy-paste bug. Default: fixed.
5. **Currencies** refresh daily from the keyless CC0 fawazahmed0 currency-api (fallback Frankfurter v2); defunct codes keep their last value. `*_euro` uses the live EUR rate (legacy: frozen 0.92 since 2023).
6. **Alerts** use one statistic on both sides (published sell per run), real elapsed time, and compare against the previous close when the 6-hour window is empty (legacy never alerted on an opening gap).
7. **Social posts** use a Monday-safe "previous trading day" and record status before sending (legacy never posted on Mondays and logged failed posts as sent).
8. **Cadence**: every 5 minutes inside the trading window (legacy: 15).
9. Additive only: `HEAD` works, `ETag`/`304`, explicit `Cache-Control`, JSONP callback restricted to `[A-Za-z0-9_$.\[\]]{1,128}` (anything else → 400 JSON error).

Everything else in `docs/legacy/legacy-backend-spec.md` part A is preserved exactly, including: `?days=N`
limits rows, `null` for empty lists, 404 (not 400) for bad `day`, weekend → Friday, `%.2f` numbers,
key order, trailing `\n`, the JSONP wrapper bytes, wildcard CORS, 204 on `OPTIONS`.

## 3. Repository layout

```
apps/
  api/        Worker: public API (fetch only)
  jobs/       Worker: scheduled() pipeline + small authenticated admin fetch()
  web/        Astro 7 site on Workers
  mobile/     Flutter app for Android and iOS (NOT in the pnpm workspace)
packages/
  core/       pure domain logic: money, time, consensus, API body rendering, alert + social rules
  db/         D1 migrations + typed repository functions
  scrapers/   source adapters: pure parsers + fetchers + fixtures
  social/     card templates (HTML/CSS), renderers, Buffer client, captions
  contract/   golden responses captured from the legacy API, OpenAPI spec (parity checker: tools/)
infra/        Pulumi program
tools/        backfill, parity checker, id sync, local previews (run with tsx)
scripts/      wrangler-deploy.mjs: the apps' `deploy` wrapper (drops the `--` pnpm forwards)
assets/brand/ logo.svg, logo-dark.svg, logo-mono.svg (traced from the 1024px app icon)
docs/         ARCHITECTURE.md, MIGRATION.md, DECISIONS.md, research/, legacy/
legacy/       imported legacy repos (reference only)
```

Package names: `@bluelytics/core`, `@bluelytics/db`, `@bluelytics/scrapers`, `@bluelytics/social`,
`@bluelytics/contract`, apps `@bluelytics/api|jobs|web`, `@bluelytics/infra`, `@bluelytics/tools`.
Workspace packages are consumed as TypeScript source (`"exports": "./src/index.ts"`); bundling is
done by wrangler/astro. No build step for packages.

## 4. Domain rules (`packages/core`) — must be exact

Money: raw quotes are integer **centavos**; published values are integer **pesos**; currency values are
integer **hundredths**. Never format from floats: `formatFixed2(hundredths)` → `"1574.50"`.

```ts
median(xs)   // Postgres PERCENTILE_CONT(0.5): sort asc, lerp at 0.5*(n-1)  (legacy-backend-spec C.0)
rint(x)      // round half to EVEN (C rint), NOT Math.round
```

Consensus per run (`computeConsensus`):
- Inputs: this run's observations per source `{source, kind, buyCents, sellCents, ok}`, the fresh
  observations of the last 30 minutes, and the previous published state.
- Validation per observation (reject, do not clamp): `100 < pesos < 1_000_000`, `sell >= buy`,
  `(sell-buy)/sell <= 0.10`, and jump guard `|x/lastPublished - 1| <= 0.15` unless at least two
  sources agree on the new level. Clarified 2026-11-22: all three limits are inclusive and compared by
  integer cross-multiplication (exactly ±15 % passes); "agree" = buy and sell within 5 % of each
  other, and only sources that may vote for that kind (and are not the same vendor feed) can confirm;
  an observation with `run_at` after the run is rejected (`future`).
- Blue voters: primaries `ambito`, `dolarhoy`, `cronista`, `infodolar` (`infobae` substitutes for
  `cronista` only when cronista is not fresh — same vendor feed, one vote). Reserve `lanacion` votes
  only if fewer than 3 primaries are fresh. `criptoya` votes only if fewer than 2 voters are fresh.
  Clarified 2026-11-22: "fresh" in these three rules means *usable* (fresh and passing validation), so
  a fresh but rejected cronista is replaced by infobae and does not count towards the thresholds.
- Blue published = `rint(median(buy))`, `rint(median(sell))` in pesos, medians taken over voters'
  values in pesos (cents/100). Keep the unrounded medians (`buyRaw`, `sellRaw`).
- Official published = first fresh of `bna`, `ambito_oficial` (rint to pesos; keep raw). BNA (Banco Nación counter rate) became primary on 2026-11-24.
- No fresh voter for a kind → hold previous published values for that kind; `updated_at` unchanged.
  Held values include the euro ones: a run without voters republishes nothing. A new EUR value is
  applied to held rates only by the daily currency step (`withEuro`).
- `value_avg = (buy + sell) / 2` (may end in `.50`).
- Euro: `euro_x = rint(xRaw / eurPerUsd)` with the current EUR value (units per USD) from `currencies`.
- `last_update` = time of the last run in which blue had at least one fresh voter.

Trading window: Monday–Friday, 07:00–19:59 America/Argentina/Buenos_Aires (UTC−3, no DST).
Trading day = Argentine calendar date. `daily_rates(day, tipo)` is upserted with the published values on
every run inside the window (so every weekday has a row, including holidays, like legacy).

Timestamps: stored as UTC ISO-8601 with milliseconds. Emitted Go-style: fractional digits with
trailing zeros trimmed, fraction omitted when zero. `last_update`/`date` → `-03:00` offset; `alert_at` → `Z`.

Alert rule (`shouldAlert`): fire when all hold — (a) more than 10 minutes since the last alert;
(b) `|sellNow/lastAlertSell − 1| > 0.005` (integer comparison: exactly ±0.5 % does not fire; legacy's
float division fired on some exact −0.5 % moves); (c) `sellNow` strictly outside `[min, max]` of published blue
sell over ticks in `(now−6h, now−15min)`; if that window has no ticks, use the last tick before it
(previous close) as both min and max. Insert the alert row first (id continues the legacy sequence),
then send the push; store `push_status`.

FCM message (must match so installed apps keep working — `docs/legacy/legacy-mobile.md` §2.6):
topic `alertas-blue`; title `Subió el Dólar Blue` / `Bajó el Dólar Blue`; body
`Venta: 1670.00 (+12.00 / +0.72%)` (sign `+` only when rising); android `collapse_key: dolar-blue`,
`priority: high`, `ttl: 1200s`, notification `color: #221199`, `channel_id: Dolar Blue`.
Sent with FCM HTTP v1 using a service-account JWT signed with WebCrypto (project `bluelytics-mobile`).

Social rule (`shouldPost`), evaluated per network inside 10:00–18:59 ART on weekdays:
- `update`: cooldown since that network's last sent post of any kind (twitter 15 min, others 60 min) AND
  `|sellNow/lastPostedSell − 1| >= 0.0075` (`lastPostedSell` = that network's last sent update post) AND
  `sellNow != previousTradingDayClose`.
- `weekly`: Friday from 18:00 ART (so 18:00–18:59, inside the window above), once per ISO week per
  network; chart of that week's daily blue sell values (works for short weeks: 1–5 points).
- Idempotency: `social_posts` has `UNIQUE(network, event_key)`; insert `pending` before calling Buffer,
  then update to `sent`/`failed`. A failed post is retried at most twice on later runs. Update keys are
  `update-<day>-<sell>[-after-<sent_at of the last sent update post>]`, so runs that see the same last
  post share a key but a return to an earlier sell on the same day is a new post. With `SOCIAL_ENABLED`
  off, `dry_run` rows stand in for `sent` ones (cooldowns and baselines, so the shadow rows show what live
  posting would do) and keys end in `-dry`; once enabled only `sent` rows count and `-dry` rows never block
  or seed a live post. A `pending` row
  older than 15 minutes (its run died) is recorded as a failed attempt and follows the retry rule.

## 5. D1 schema (`packages/db/migrations`)

```sql
CREATE TABLE observations (            -- one row per source per run, successes and failures
  id INTEGER PRIMARY KEY, run_at TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL,
  ok INTEGER NOT NULL, buy_cents INTEGER, sell_cents INTEGER, source_ts TEXT,
  error TEXT, duration_ms INTEGER );
CREATE INDEX observations_source_run ON observations (source, run_at DESC);
CREATE INDEX observations_run ON observations (run_at);

CREATE TABLE ticks (                   -- one row per run inside the trading window
  run_at TEXT PRIMARY KEY, day TEXT NOT NULL,
  blue_buy INTEGER NOT NULL, blue_sell INTEGER NOT NULL, blue_buy_raw REAL, blue_sell_raw REAL,
  oficial_buy INTEGER NOT NULL, oficial_sell INTEGER NOT NULL, oficial_buy_raw REAL, oficial_sell_raw REAL,
  voters TEXT NOT NULL,                -- JSON: which sources voted
  changed INTEGER NOT NULL ) WITHOUT ROWID;
CREATE INDEX ticks_day ON ticks (day, run_at);

CREATE TABLE latest_rates (
  tipo TEXT PRIMARY KEY CHECK (tipo IN ('oficial','blue')), updated_at TEXT NOT NULL,
  buy INTEGER NOT NULL, sell INTEGER NOT NULL, buy_raw REAL NOT NULL, sell_raw REAL NOT NULL,
  euro_buy INTEGER NOT NULL, euro_sell INTEGER NOT NULL ) WITHOUT ROWID;

CREATE TABLE daily_rates (
  day TEXT NOT NULL, tipo TEXT NOT NULL CHECK (tipo IN ('Oficial','Blue')),
  buy INTEGER NOT NULL, sell INTEGER NOT NULL, updated_at TEXT,
  origin TEXT NOT NULL DEFAULT 'live',  -- 'backfill_api' | 'live'
  PRIMARY KEY (day, tipo) ) WITHOUT ROWID;

CREATE TABLE extra_rates (             -- MEP, CCL, cripto, mayorista, tarjeta… (site only, not in the API)
  code TEXT PRIMARY KEY, name TEXT NOT NULL, buy_cents INTEGER, sell_cents INTEGER,
  source TEXT NOT NULL, source_ts TEXT, updated_at TEXT NOT NULL ) WITHOUT ROWID;

CREATE TABLE currencies (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, value_hundredths INTEGER, value_date TEXT,
  position INTEGER NOT NULL ) WITHOUT ROWID;

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, alert_at TEXT NOT NULL,
  buy INTEGER NOT NULL, sell INTEGER NOT NULL, push_status TEXT );

CREATE TABLE social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT NOT NULL, kind TEXT NOT NULL,
  event_key TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT,
  buy INTEGER, sell INTEGER, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  external_id TEXT, image_key TEXT, error TEXT, UNIQUE (network, event_key) );

CREATE TABLE rendered (                -- pre-rendered API bodies
  key TEXT PRIMARY KEY, content_type TEXT NOT NULL, body TEXT NOT NULL,
  etag TEXT NOT NULL, updated_at TEXT NOT NULL ) WITHOUT ROWID;

CREATE TABLE state ( key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL ) WITHOUT ROWID;
```

`rendered.key` values: `latest`, `last_price`, `alerts`, `currency`, `evolution_json`, `evolution_csv`.
Evolution order is `day DESC`, then `Oficial` before `Blue`. `observations` older than 90 days are pruned daily.

## 6. API Worker (`apps/api`)

Routes (exact, case-sensitive, no trailing slash): `/`, `/v2/latest`, `/v2/alerts`, `/json/last_price`,
`/v2/evolution.json`, `/v2/evolution.csv`, `/v2/historical`, `/data/json/currency.json`. Full contract:
`docs/legacy/legacy-backend-spec.md` part A; byte-level fixtures: `packages/contract/golden/`.

- Bodies come from `rendered`, cached in isolate memory: small keys re-read at most every 15 s; the two
  evolution bodies are re-read only when their `etag` changes.
- `?days=N` (first value wins): integer `0 < N < 10000` → first N rows of the pre-rendered body (string
  slicing, no JSON parse); `N <= 0` → `null\n` (JSON) / header-only CSV as legacy; non-integer or
  `>= 10000` → everything.
- `/v2/historical?day=`: strict `YYYY-MM-DD`; Saturday/Sunday → Friday (`0000-01-01`/`02`, whose
  Friday would be in year −1, → "day not found" without a lookup, as legacy); D1 point lookup on
  `daily_rates`, cached in memory (past days 1 h, today 60 s); "not found" keyed on blue sell
  missing/zero, as legacy.
- JSONP only on `/v2/latest` and `/json/last_price`: `callback(` + body-with-`\n` + `);`.
- `?pretty` (any value): two-space indented variant produced by a token-level pretty-printer that keeps
  number text untouched.
- CORS exactly as legacy (`Access-Control-Allow-Origin: *`, `Vary: Origin`; `OPTIONS` → 204 with the
  legacy header set). 404/405 bodies as legacy.
- Added headers: `ETag` + `If-None-Match` → 304; `Cache-Control`: `public, max-age=30` for latest,
  last_price, alerts; `public, max-age=300` for evolution and currency; `public, max-age=86400` for a
  past-day historical hit; `public, max-age=60` for today's row and for 404s.
- Never throws to the client without a JSON body; a D1 failure serves the last in-memory copy if any.

`static-first` mode (opt-in, infra-only): the jobs Worker also writes each fixed body to R2 as
`api/<path>` (e.g. `api/v2/latest`) with content type and cache-control metadata; Pulumi adds the R2
custom domain / Cloud Connector rule, a Cache Rule and CORS transform; Worker routes shrink to the
parameterised paths. Nothing in `apps/api` changes.

## 7. Jobs Worker (`apps/jobs`)

One cron expression `*/5 * * * *`; the handler branches on Argentine time. Every step is idempotent.

Tick inside the trading window:
1. Fetch all sources in parallel (`Promise.allSettled`, 8 s timeout each, 20 s for BNA), parse with
   `@bluelytics/scrapers`, insert one `observations` row per source.
2. `computeConsensus` → upsert `latest_rates`, upsert today's two `daily_rates` rows, insert `ticks`.
3. Re-render changed API bodies → `rendered` (same D1 batch as step 2). If a body changed, also put it
   to R2 `api/…` (best effort) and, in `static-first` mode, purge the CDN prefix.
4. Alerts: `shouldAlert` → insert `alerts`, re-render `alerts` body, send FCM when `PUSH_ENABLED=true`.
5. Social: `shouldPost` per configured network → render card (Browser Run) → put JPEG to R2
   `social/<yyyy>/<mm>/<network>-<event_key>.jpg` → Buffer `createPost` when `SOCIAL_ENABLED=true`
   (otherwise log a dry run and store status `dry_run`).
6. Refresh Open Graph images (`og/*.jpg` on R2) when the published blue changed.
7. Source health: if a source failed 6 consecutive runs, or fewer than 3 blue voters for an hour, send
   one message to `OPS_WEBHOOK_URL` (optional; Slack/Discord/Telegram-compatible JSON) and log an error.

Daily (first tick after 06:00 ART): refresh currencies (guards: ≥150 codes, `0.5 < EUR < 1.5`,
ARS > 100, per-code jump ≤ 30 % unless both providers agree), re-render `currency` and `latest`
(euro), prune old observations, capture `extra_rates`.

Admin `fetch()` (requires header `Authorization: Bearer $ADMIN_TOKEN`; otherwise 404):
`POST /admin/run?force=1` (run a tick now), `GET /admin/health` (last run, per-source status),
`GET /admin/card?kind=update|weekly&size=…` (card HTML for preview), `POST /admin/social/test`
(creates a Buffer **draft**, never publishes).

Flags (plain vars): `PUSH_ENABLED`, `SOCIAL_ENABLED`, `API_MODE` (`worker`|`static-first`),
`LEGACY_V1_BLUE_BUG`. Shadow mode before cutover = both `*_ENABLED` false.

## 8. Scrapers (`packages/scrapers`)

Each source = `{ id, kind, url, timeoutMs, parse(text): {buyCents, sellCents, sourceTs?} }`, parsers are
pure functions tested against trimmed fixtures (a few KB cut around the values from the full pages
saved on 2026-11-22; recipes and expected values in `docs/research/sources.md` and
`docs/research/sources_recipes.mjs`). Extraction is `indexOf` anchor + small-window regex (no DOM;
HTML pages are up to 760 KB). Explicit number format per source (`ar`: `.` thousands, `,` decimals).
Honest `User-Agent: bluelytics-bot/2.0 (+https://bluelytics.com.ar)`; one request per source per run.

Sources: `ambito` (blue JSON), `ambito_oficial` (JSON), `dolarhoy` (HTML), `cronista` (HTML page with
embedded JSON; not the robots-disallowed `/pf/api`), `infodolar` (HTML), `lanacion` (HTML, reserve),
`infobae` (HTML, standby for cronista), `bna` (HTML, official fallback), `criptoya` (JSON, last resort),
`ambito_extras` (`/mercados/monedas`: MEP, CCL, cripto, mayorista, tarjeta → `extra_rates`).
Currencies: `fawazahmed0` (jsDelivr + pages.dev mirror), fallback `frankfurter_v2`.

## 9. Social (`packages/social`)

- `cards/`: `renderCardHtml(kind, size, data)` → self-contained HTML (inline CSS, inline SVG logo and
  chart, fonts embedded as base64 `@font-face`, OFL fonts only). Kinds: `update`, `weekly`, `og`.
  Sizes: `landscape` 1600×900 (X), `portrait` 1080×1350 (Instagram feed, Facebook), `story` 1080×1920,
  `og` 1200×630. Dark theme built on the brand blue/green; hero number neutral, colour only on the
  delta (green up / red down, always with arrow and sign); es-AR formatting (`$ 1.675`, 24-hour clock,
  "20 nov 2026, 19:45"); essential content ≥ 64 px from the side edges of the portrait card.
  No tax-surcharge line. Guidance: `docs/research/social-channels-specs.md` part C.
- `render/`: `Renderer` interface `(html, {width, height}) => Promise<Uint8Array /* JPEG */>` with
  `BrowserRunRenderer` (Worker binding) and `LocalChromeRenderer` (Playwright, dev/tests only).
- `buffer/`: minimal GraphQL client (`fetch`, no SDK): `listChannels()`, `createImagePost({channelId,
  text, imageUrl, altText, service, draft?})`, `getPost(id)`, `deletePost(id)`. Handles HTTP 200 with
  `errors[]`, typed mutation errors (`... on MutationError { message }`), 429 + `Retry-After`.
  Instagram needs `metadata: { instagram: { type: post, shouldShareToFeed: true } }` (`type: story, shouldShareToFeed: false`
  for stories); X needs no metadata. Input shapes come from Buffer's own schema, saved as
  `docs/research/buffer-schema.graphql` (introspection works without a key); `docs/research/buffer-api.md`
  explains usage, limits and error handling.
- `captions.ts`: per-network text in Spanish with correct accents; site URL on Facebook, hashtags on
  Instagram. X carries no URL or bare domain (decision 2026-11-22: X bills posts with a URL in the text at
  the higher rate, and the domain is printed on the card), only `#DólarBlue`.

Config: secret `BUFFER_API_KEY`; var `BUFFER_CHANNELS` = JSON `{"twitter":"<channelId>","instagram":"<channelId>"}`
(only listed networks are posted to; the account currently has Instagram and Twitter connected).

## 10. Web (`apps/web`, Astro 7 on Workers)

Details and verified setup: `docs/research/astro-seo.md`. `output: 'static'` with SSR opt-in per page;
bindings via `import { env } from 'cloudflare:workers'`; reads D1 through `@bluelytics/db`.
One route manifest (`src/i18n/routes.ts`) pairs Spanish and English slugs and feeds nav, canonical,
hreflang (`es`, `en`, `x-default`) and sitemaps.

| Spanish | English | Rendering |
|---|---|---|
| `/` (dólar blue hoy) | `/en` | SSR, cached 60 s |
| `/dolar-oficial` | `/en/official-dollar` | SSR 60 s |
| `/euro-blue` | `/en/blue-euro` | SSR 60 s |
| `/brecha` | `/en/gap` | SSR 60 s + SVG chart |
| `/calculadora` | `/en/calculator` | SSR 60 s + custom element |
| `/evolucion` | `/en/evolution` | 301 to `/historico` / `/en/history` (merged into the history hub: interactive chart with range presets, downloads, yearly table) |
| `/historico`, `/historico/[yyyy]`, `/historico/[yyyy]/[mm]`, `/historico/[yyyy]/[mm]/[dd]` | `/en/history/…` | SSR; past periods cached 1 day; 404 for dates without data |
| `/api` | `/en/api` | prerendered docs (corrected: `date`/`source` field names, `days` = rows, `currency.json`) |
| `/acerca` | `/en/about` | prerendered |
| `/estado` | `/en/status` | SSR 60 s: source health |
| `/privacy.html` | — | static, unchanged content (URL registered with the app stores) |
| `/sitemap.xml` (+ pages, history), `/robots.txt`, `/llms.txt`, `/widget`, `/embed.js` | | endpoints/static |

Requirements: prices in the HTML (no client fetch needed to read them); per-page title/description with
the live price; JSON-LD (WebSite, Organization, WebPage with `dateModified`, BreadcrumbList, Dataset on
history); OG/Twitter tags pointing at the R2 `og/*.jpg`; client shim mapping legacy `#!/x` and `#/x`
routes to the new URLs; es-AR number formatting on Spanish pages; no framework runtime (vanilla custom
elements; server-rendered SVG charts with a small enhancer); dark/light themes from brand colours;
Lighthouse ≥ 95 on performance/SEO/accessibility. Store badges are hidden unless
`PUBLIC_ANDROID_URL` / `PUBLIC_IOS_URL` are set (both listings returned 404 on 2026-11-22).
Analytics: Cloudflare Web Analytics; GA4 only if `PUBLIC_GA4_ID` is set. On any non-production
hostname every response carries `X-Robots-Tag: noindex`.

## 11. Infra (`infra/`) and operator commands

Pulumi stack config (`bluelytics:*`): `accountId`, `zoneId`, `zoneName` (`bluelytics.com.ar`),
`webHostname`, `apiHostname`, `mediaHostname` (`media.bluelytics.com.ar`), `apiMode`,
`manageRulesets` (default `false` until existing zone rules are imported). Resources: D1 `bluelytics`
(`protect`), R2 `bluelytics-public` (`protect`) + custom domain + lifecycle (`social/` 90 days) + CORS,
rulesets when enabled (www → apex redirect, media cache rule, static-first rules). Offline validation:
`pulumi preview` on a `file://` backend with a dummy token (rulesets excluded) — never touch the
owner's Pulumi Cloud state from automation.

Root scripts (the operator interface — `docs/MIGRATION.md` uses exactly these):

```
pnpm install | pnpm typecheck | pnpm test | pnpm build
pnpm dev:api | dev:jobs | dev:web
pnpm db:migrate:local | db:migrate:remote
pnpm backfill -- --from https://api.bluelytics.com.ar [--since YYYY-MM-DD] [--remote] [--dry-run]
pnpm parity -- --old https://api.bluelytics.com.ar --new <url> [--strict]
pnpm cards:preview            # renders every card kind/size to out/cards/*.jpg with local Chrome
pnpm buffer:channels          # lists Buffer organizations/channels for BUFFER_API_KEY (read-only)
pnpm infra:preview | infra:up | infra:sync-ids
pnpm deploy:api | deploy:jobs | deploy:web | deploy:all
```

Secrets (names only; set with `wrangler secret put` / `--secrets-file`, never committed):
jobs: `BUFFER_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `ADMIN_TOKEN`, `OPS_WEBHOOK_URL` (optional),
`CLOUDFLARE_PURGE_TOKEN` (static-first only). Pulumi: `cloudflare:apiToken`. CI: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `PULUMI_ACCESS_TOKEN`.

## 12. Quality bar

- `pnpm typecheck && pnpm test && pnpm build` green from a clean clone.
- `packages/core`: unit tests for `rint` (the 117 half-even ties style cases), `median`, timestamp
  formatting, consensus matrix (source failures, reserve voting, jump guard), alert and social rules.
- `apps/api`: contract tests run the real Worker against a local D1 seeded from the goldens and compare
  **bytes** with `packages/contract/golden/*.body` for every static capture, and structure for the
  time-varying ones; headers checked for content type and CORS.
- `packages/scrapers`: every parser against its fixture + mutated fixtures (must throw, never guess).
- `packages/social`: Buffer client against a mocked `fetch`; cards rendered locally and inspected.
- `apps/jobs`: pipeline test with fake fetch/renderer/Buffer/FCM over a multi-tick scenario.
- `infra`: type-checks; offline preview.
- No secrets, no legacy credentials, no files from `bluelytics_vpn` or the legacy `.env` in the repo.
