# @bluelytics/core

Pure domain logic shared by every package: money, time, consensus, API body rendering, alert and
social rules, and the shared types. Zero runtime dependencies; runs unchanged in Workers and Node
(the only platform API used is `crypto.subtle.digest` in `etag`). Rules come from
`docs/ARCHITECTURE.md` §4 and `docs/legacy/legacy-backend-spec.md` (A: byte contract, C.0: median and
rint, E: alerts, F: social).

```ts
import { computeConsensus, renderLatest, toArtOffset } from '@bluelytics/core';
```

## Invariants

- **Money is always an integer.** `*Cents` = centavos (raw quotes), `buy` / `sell` / `euro*` = whole
  pesos (published values), `*Hundredths` = 1/100 units (currency values). `*Raw` fields are the only
  floats: unrounded peso medians kept for audit and for the euro derivation.
- **Numbers are printed from integers**: `formatFixed2(hundredths)`, never `toFixed` on a float.
- **Timestamps are strings and never pass through `Date`.** Storage form is UTC with a `Z` suffix and
  at least millisecond digits (`2026-11-20T22:45:51.758Z`, or the legacy `…51.758024Z`); every
  fractional digit is preserved end to end.
- **Days** are `YYYY-MM-DD` Argentine calendar dates (UTC−3, no DST).
- **Rounding** is half to even (`rint`), medians are Postgres `PERCENTILE_CONT(0.5)` (`median`).
- Response bodies are produced by hand, byte for byte (Go `encoding/json` rules): compact, raw UTF-8,
  `%.2f` numbers, trailing `\n`, `null` for an empty list.

## money

| Export | Semantics |
|---|---|
| `rint(x: number): number` | Round half to even (C `rint`, Postgres `round(float8)`); throws on non-finite. |
| `median(xs: readonly number[]): number` | `PERCENTILE_CONT(0.5)`: sort ascending, lerp at `0.5·(n−1)`; throws on empty. |
| `formatFixed2(hundredths: number): string` | `"%.2f"` text of an integer number of hundredths (`157450` → `"1574.50"`); throws on non-integers. |
| `parseFixed2(text: string): number` | Inverse of `formatFixed2`; accepts exactly `-?\d+\.\d\d`. |
| `decimalToHundredths(text: string): number` | Exact decimal text → hundredths, half away from zero beyond 2 decimals (`numeric(30,2)`). |
| `numberToHundredths(value: number): number` | A JSON number → hundredths through its shortest decimal text. |
| `centsToPesos(cents: number): number` | Integer centavos → float pesos (the unit medians are taken in). |
| `pesosToHundredths(pesos: number): number` | Integer pesos → hundredths. |
| `averageHundredths(buy: number, sell: number): number` | Hundredths of `(buy + sell) / 2` for integer pesos (`value_avg`). |

## time

| Export | Semantics |
|---|---|
| `GO_ZERO_TIME` | `'0001-01-01T00:00:00Z'`, emitted when a row is missing. |
| `ART_OFFSET_SECONDS` | `-10800`. |
| `TRADING_WINDOW` | `{ fromHour: 7, toHour: 20 }` (Mon–Fri 07:00–19:59 ART). |
| `parseInstant(iso: string): Instant` | `YYYY-MM-DDTHH:MM:SS[.f…](Z\|±HH:MM)` → `{ epochSeconds, fraction }` (trailing zeros trimmed, ≤ 9 digits). |
| `toArtOffset(iso: string): string` | Wire format of `last_update` / `date`: Argentine time, `-03:00`, Go RFC3339Nano trimming (`…22:45:51.758024Z` → `…19:45:51.758024-03:00`; `.120` → `.12`; `.000` → no fraction). |
| `toUtcZ(iso: string): string` | Wire format of `alert_at`: UTC, `Z`, same trimming. |
| `toStoredUtc(iso: string): string` | Storage form: UTC, `Z`, at least 3 fractional digits (more kept). |
| `epochMs(iso: string): number` | Milliseconds since the epoch (digits beyond ms truncated). |
| `addSeconds(iso: string, seconds: number): string` | Shift by whole seconds, storage form, fraction kept. |
| `compareInstants(a: string, b: string): number` | Sign of `a − b` at full precision (works across offsets and digit counts). |
| `artParts(iso: string): ArtParts` | `{ day, isoWeekday, hour, minute, second }` in Argentine time. |
| `artDate(iso: string): string` | Argentine calendar date of an instant (the trading day; 00:00–02:59 UTC is the previous day). |
| `isTradingWindow(iso: string): boolean` | Mon–Fri 07:00–19:59 ART. |
| `isValidDay(text: string): boolean` | Go `time.Parse("2006-01-02")`: exactly 4-2-2 digits and a real calendar date. |
| `isoWeekday(day: string): number` | 1 = Monday … 7 = Sunday. |
| `addDays(day: string, count: number): string` | Calendar arithmetic on dates. |
| `previousTradingDay(day: string): string` | The weekday strictly before `day` (Monday → Friday); throws `RangeError` when that falls before year 0000. |
| `historicalLookupDay(day: string): string \| null` | `/v2/historical` remap: Saturday/Sunday → Friday, weekdays unchanged; `null` for `0000-01-01`/`02`, whose Friday is in year −1 (answer `BODY.dayNotFound`, as legacy). |
| `isoWeekKey(day: string): string` | ISO week with week-year, e.g. `2026-W48`. |
| `isoWeekTradingDays(day: string): string[]` | Monday…Friday of the ISO week containing `day`. |

Every function that takes a `day` throws `RangeError` on an invalid date; validate input with `isValidDay` first.

## api-render

All functions return the exact body text; callers encode it as UTF-8.

| Export | Semantics |
|---|---|
| `renderLatest(state: LatestRenderInput): string` | `/v2/latest`. Missing rate → zeros; missing blue → `last_update` = Go zero time. |
| `renderLastPrice(state, { legacyBlueBug }): string` | `/json/last_price`; `legacyBlueBug: true` repeats the oficial values in the `blue` entry (legacy v1.go:23). |
| `renderAlerts(current, previous): string` | `/v2/alerts`; `alert_at` in UTC `Z`; missing → zeros / id 0. |
| `renderCurrency(rows): string` | `/data/json/currency.json` in the given order; rows with `valueHundredths: null` skipped; none → `null\n`. |
| `renderEvolutionJson(rows): string` | `/v2/evolution.json` for rows in API order (`day DESC`, Oficial first); sell before buy; none → `null\n`. |
| `renderEvolutionCsv(rows): string` | `/v2/evolution.csv`: header `day,type,value_buy,value_sell`, buy before sell, LF. |
| `renderHistorical(day): { status: 200 \| 404, body }` | `/v2/historical` for one day's rows; 404 `day not found` when blue is missing or its sell is 0. |
| `parseDaysParam(raw: string \| null \| undefined): DaysLimit` | Legacy `?days=`: `strconv.Atoi` + `< 10000` + SQL LIMIT → `{kind:'all'}` / `{kind:'none'}` / `{kind:'rows', rows}`. |
| `sliceEvolutionJson(body, rows): string` | First `rows` rows of a pre-rendered JSON body, by string scanning. |
| `sliceEvolutionCsv(body, rows): string` | Header plus the first `rows` lines of a pre-rendered CSV body. |
| `limitEvolutionJson(body, rawDays): string` | `parseDaysParam` + slicing: `none` → `null\n`. |
| `limitEvolutionCsv(body, rawDays): string` | Same for CSV: `none` → header only. |
| `DAYS_LIMIT_CEILING` | `10000`. |
| `prettyJson(compactBody: string): string` | `?pretty`: Go `json.Indent` with two spaces, token level (number text untouched), trailing `\n`. Apply before `wrapJsonp`. |
| `wrapJsonp(callback, jsonBody): string` | `callback(` + body (with its `\n`) + `);`, no trailing newline. |
| `isValidJsonpCallback(callback): boolean` | v2 restriction `[A-Za-z0-9_$.\[\]]{1,128}` (otherwise answer 400 with `BODY.badRequest`). |
| `goJsonString(value): string` | JSON string literal with Go 1.14 escaping (raw UTF-8; `<`, `>`, `&`, U+2028/9 as `\u00XX`). U+0008/U+000C are `\u0008`/`\u000c` as in Go 1.14; Go ≥ 1.22 writes `\b`/`\f`, so do not "fix" this against a current Go. |
| `etag(body): Promise<string>` | Strong ETag: `"` + first 16 hex digits of SHA-256(UTF-8 body) + `"`. |
| `sha256Hex(text): Promise<string>` | Full lower-case hex SHA-256 of the UTF-8 bytes. |
| `CONTENT_TYPE` | `json` `application/json; charset=UTF-8`, `javascript` `application/javascript; charset=UTF-8`, `csv` `text/csv`, `text` `text/plain; charset=UTF-8`. |
| `RENDERED_CONTENT_TYPE` | Content type per `RenderedKey`. |
| `BODY` | Fixed bodies: `root` (`OK`), `null`, `csvHeader`, `notFound`, `methodNotAllowed`, `internalServerError`, `badRequest` (new), `badDay`, `dayNotFound`. |
| `CORS` | Legacy CORS values: `allowOrigin`, `allowMethods`, `vary`, `preflightVary` (three separate `Vary` headers). |

Input types: `LatestRenderInput`, `LatestRateRenderInput`, `AlertRenderInput`, `CurrencyRenderInput`,
`EvolutionRenderInput`, `HistoricalRenderInput`, `HistoricalResponse`, `LastPriceOptions`, `DaysLimit`.

## consensus

| Export | Semantics |
|---|---|
| `computeConsensus(input: ConsensusInput, config = CONSENSUS_CONFIG): ConsensusResult` | One run of the publishing rule (ARCHITECTURE §4). Pure. |
| `withEuro(state, eurPerUsd): PublishedState` | Re-derives `euro_*` of both rates as `rint(raw / eurPerUsd)` (the daily currency step); unusable EUR (null, ≤ 0, NaN) keeps the old values. |
| `tickFromConsensus(runAt, result): Tick \| null` | The `ticks` row of a run (`null` until both rates exist). |
| `dailyRowsFromState(runAt, state): DailyRow[]` | The day's `daily_rates` rows (Oficial, Blue) with `origin: 'live'`. |
| `CONSENSUS_CONFIG` | Every threshold: freshness 30 min, `100 < pesos < 1 000 000`, `maxSpreadPercent: 10` (≤), `maxJumpPercent: 15` (≤) unless 2 vendor groups agree within `jumpAgreementTolerancePercent: 5` (≤), primaries `ambito dolarhoy cronista infodolar`, `infobae` substitutes `cronista`, reserve `lanacion` below 3 primaries, last resort `criptoya` below 2 voters, oficial chain `ambito_oficial` → `bna`. |

`ConsensusInput = { now, observations, recent, previous, eurPerUsd }`: this run's observations
(failures included), earlier ones (only successful observations within 30 minutes of `now` count;
the newest usable one per source votes), the current `latest_rates`, and EUR per USD.
`ConsensusResult = { state, voters, held, changed, rejected }`:

- only sources that may vote for the kind are read (blue: primaries, `infobae`, `lanacion`,
  `criptoya`; oficial: the chain). Anything else (`ambito_extras`, an id outside `SOURCE_IDS`) is
  ignored, so it can neither vote nor confirm a jump.
- validation rejects (never clamps): `future` (`runAt` after `now`), `invalid` (missing/non-integer
  cents), `range`, `inverted` (sell < buy), `spread`, `jump`. A source whose newest quote is an
  unconfirmed jump falls back to its newest earlier fresh quote that is not one. Percentage limits are
  compared by integer cross-multiplication, so exactly ±15 % and exactly 5 % agreement are accepted.
- **usable** = fresh (≤ 30 min, not in the future) and valid. `infobae` substitutes for `cronista`
  whenever cronista has no usable quote (missing, stale *or rejected*); the reserve and last-resort
  thresholds count usable voters (ARCHITECTURE §4 says "fresh"; this is the clarified reading).
- published = `rint(median(pesos))` of the voters, buy and sell independently; `buyRaw`/`sellRaw` keep
  the medians; euro = `rint(raw / eurPerUsd)`. Oficial = first usable source of the chain.
- a rate without voters is held: every previous value, euro included, and `updatedAt` unchanged
  (`held[kind] = true`), so a run without voters never republishes anything; a new EUR value reaches
  a held rate only through `withEuro`. Otherwise `updatedAt = now`. So `latest_rates.blue.updated_at`
  (the API's `last_update`) is the last run in which blue had a fresh voter.
- `changed` = some published integer (buy, sell, euro buy, euro sell of either rate) moved.

## alerts

| Export | Semantics |
|---|---|
| `shouldAlert(input: AlertRuleInput, config = ALERT_CONFIG): AlertDecision` | Fire when: > 10 min since the last alert; `\|sell/lastAlertSell − 1\| > 0.5 %`; sell strictly outside `[min, max]` of the window's tick sells, or of the previous close when the window is empty. Without any previous alert only the breakout is checked. |
| `alertWindow(now, config?): { after, before }` | The window `(now − 6 h, now − 15 min)`, both exclusive, storage form. |
| `buildAlertNotification(currentSell, previousSell): AlertNotification` | Legacy text: `Subió el Dólar Blue` / `Bajó el Dólar Blue`, `Venta: 1670.00 (+12.00 / +0.72%)` (`+` only when rising; percent formatted like Python `{:.2f}`). |
| `buildFcmMessage(notification): FcmMessage` | The FCM HTTP v1 body of `docs/legacy/legacy-mobile.md` §2.6; `JSON.stringify` it. |
| `ALERT_CONFIG` | `{ cooldownMs: 600000, minChangePercent: 0.5, windowStartMs: 21600000, windowEndMs: 900000 }`. |
| `FCM` | Contract constants: project `bluelytics-mobile`, `endpoint`, OAuth `scope`, topic `alertas-blue`, `collapseKey`, `priority`, `ttl`, `color`, `channelId`. |

Percentage thresholds are compared by cross-multiplication on integers, so a move of exactly 0.5 %
does not fire (and exactly 0.75 % does post) regardless of float division. Legacy `alerts.py`
divided in floats, which puts some exact −0.5 % moves above the threshold (1592 after 1600: 25
integer pairs in 100..5000) and fired on them; the new rule does not (one-sided difference, covered
by deviation 6 of ARCHITECTURE §2).

`previousSell` is the caller's choice of previous close: the last tick at or before the window start
(`@bluelytics/db` `getLastTickAtOrBefore`); right after cutover, while `ticks` is still empty, the
previous day's `daily_rates` sell (`getPreviousClose`) is a sensible fallback.

Build push texts with `buildAlertNotification`, not with the JavaScript snippet of
`docs/legacy/legacy-mobile.md` §2.6: its `toFixed(2)` differs from Python `{:.2f}` on exact binary
ties of the percentage (15 of 59,926 legacy cases).

## social-rules

| Export | Semantics |
|---|---|
| `shouldPost(input: PostInput, config = SOCIAL_CONFIG): PostDecision` | `update`: weekdays 10:00–18:59 ART; cooldown since the network's last sent post of any kind (`lastSentAt`, or `lastSent.sentAt` if later; twitter 15 min, others 60, exclusive); `\|sell/lastSent.sell − 1\| ≥ 0.75 %` (`lastSent` = last sent *update* post; baseline = previous close when the network never posted one); `sell ≠ previousClose`. `weekly`: Friday 18:00–18:59 ART, once per ISO week (`lastSentEventKey`), 1–5 points. Positive decisions carry the `eventKey` to claim. |
| `updateEventKey(now, sell, afterSentAt): string` | `update-<ART day>-<sell>` for a network's first update post, else `…-after-<sent_at of lastSent, UTC, compact>` (e.g. `update-2026-11-20-1600-after-20261120T171500Z`). |
| `weeklyEventKey(now): string` | `weekly-<ISO week of the ART day>`, e.g. `weekly-2026-W48`. |
| `postCooldownMs(network, config?): number` | Cooldown of a network. |
| `canRetryPost({ status, attempts }, config?): boolean` | Only `failed` posts with fewer than `maxAttempts` (3 = first try + 2 retries). |
| `SOCIAL_CONFIG` | `{ updateWindow: {10, 19}, cooldownMs: { twitter: 900000, default: 3600000 }, minChangePercent: 0.75, weekly: { isoWeekday: 5, fromHour: 18, toHour: 19 }, maxAttempts: 3, pendingTimeoutMs: 900000 }`. |

`previousClose` must be the previous trading day's close (`@bluelytics/db` `getPreviousClose`), so
Monday compares with Friday. The update key names the post it follows, so every run that sees the
same last post claims the same key (one send per decision, also for overlapping runs), while a
return to an already-posted sell later the same day (1600 → 1620 → 1600) is a new decision with a
new key. A `pending` row older than `pendingTimeoutMs` belongs to a run that died mid-send: record it
as a failed attempt (`@bluelytics/db` `failStalePendingPosts`) so the retry rule applies.

## types

`RateKind`, `ObservationKind`, `SOURCE_IDS` / `SourceId`, `NETWORKS` / `Network`, `Observation`,
`PublishedRate`, `PublishedState`, `RatePair`, `DailyTipo`, `DailyOrigin`, `DailyRow`, `CurrencyRow`,
`AlertRow`, `TickVoters`, `Tick`, `ExtraRate`, `SocialPostKind`, `SocialPostStatus`, `SocialPost`,
`RENDERED_KEYS` / `RenderedKey`, `RenderedRow`. Each mirrors one D1 table row of ARCHITECTURE §5 in
camelCase (see `src/types.ts` for field-level docs).

## Tests

`pnpm --filter @bluelytics/core test`. The golden tests rebuild every static capture in
`packages/contract/golden/` byte for byte from data parsed out of the captures themselves;
`test/fixtures/live-pretty/` holds the legacy API's `?pretty` responses (public GETs, 2026-11-22).
