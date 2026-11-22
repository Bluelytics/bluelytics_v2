# Bluelytics legacy BACKEND — authoritative behavior spec

Scope: database (`bluelytics_database`), scraper + alert/social jobs (`bluescraper`), HTTP API (`bluelytics_api`), and the older generation of the social jobs (`bluelytics_notifiy`, `blueimg`).
Written 2026-11-22 for the `bluelytics_v2` rewrite. All legacy paths are relative to `/home/sicarul/dev/bluelytics/`.

Evidence tags used throughout:

- **[CODE]** read directly from the legacy source (file:line given).
- **[GOLDEN]** observed in the captured production responses in `scratchpad/golden/` (2026-11-22 14:33–14:38 UTC).
- **[LIVE]** extra public GETs I made against `https://api.bluelytics.com.ar` on 2026-11-22 14:49–15:00 UTC.
- **[FIXTURE]** source pages captured today by sibling research in `scratchpad/work_sources/` and `scratchpad/fixtures/sources/`.
- **[INFERRED]** deduction, reasoning given. Treat as probable, not proven.

No secret values appear in this document. Secret *names* and file paths only.

---

## 0. Twelve things an implementer must know first

1. **`?days=N` limits ROWS, not days.** `/v2/evolution.json?days=5` returns 5 rows = 2.5 days (Oficial+Blue per day). The public docs say "last X days". Consumers have lived with row semantics since 2021. [CODE evolution.go:27-31] [GOLDEN evolution_days5]
2. **Every published buy/sell value is a whole peso** (`ROUND()` to integer, printed as `1670.00`). Only `value_avg` can end in `.50`. All 18,730 numbers in the full history end in `.00`. [GOLDEN]
3. **Rounding is round-half-to-EVEN**, not half-up (Postgres `round(double precision)`). Proven: all 117 exact `.5` ties in the 2011–2020 history match half-even and none match half-up. `Math.round` in JS is wrong for this.
4. **`/json/last_price` returns the OFICIAL numbers in the `"blue"` entry** (copy-paste bug, v1.go:23). Confirmed in production today.
5. **Blue today is the mean of only TWO sources** (Ámbito + La Nación). The Cronista scraper is dead: its URL 301-redirects and the markup changed, so the XPath finds nothing and the script crashes every run. [FIXTURE + numeric proof in C.1]
6. **`/data/json/currency.json` has been frozen since about May 2023** (ARS = 232.41 per USD). The `*_euro` values in `/v2/latest` are therefore computed with a stale EUR rate of exactly `0.92`.
7. **`/v2/latest` (live) and the same day's `/v2/evolution` row disagree by design**: latest = median of each source's last value; daily = median of the last 49 samples of the day. On 2026-11-20: latest blue 1635/1670 vs daily blue 1615/1665.
8. **Everything runs in UTC** (container and DB). Scrape window `weekday<5 and 10<=hour<23` UTC = Mon–Fri 07:00–19:59 ART. Because that window sits inside one UTC day, UTC date == Argentine date for every row.
9. **Cadence is every 15 minutes**, aligned to :00/:15/:30/:45 UTC, about 50 s start-up latency. [INFERRED, two independent arguments in D.5]
10. **Cloudflare caches everything except `/v2/latest`**, including 404s, and adds `cache-control: max-age=7200`. The Go origin sends no caching headers at all.
11. **Social posts never fire on Mondays** (the trigger needs yesterday's daily row; Sunday has none), and the image shows "Dólar Oficial Venta (+75%)" = official sell × 1.75, a tax surcharge that no longer exists (today it would print 2801.75 next to a blue of 1670.00).
12. **Any DB error in the API calls `log.Fatal`** which kills the whole process. `middleware.Recover()` cannot catch it.

---

## 1. System map

```
                     every 15 min (UTC)                         Cloudflare (cache-everything, except /v2/latest)
 ambito / lanacion / cronista ──► bluescraper container ──► Postgres ◄── bluelytics_api (Go/echo :8080) ◄── api.bluelytics.com.ar
 (HTML + JSON scraping)            entrypoint.sh               │
                                   ├ scrape_*.py  → INSERT dolar_values
                                   ├ refresh_dolar.py → REFRESH MATERIALIZED VIEW CONCURRENTLY dolar_latest, dolar_evolution
                                   ├ alerts.py   → FCM topic "alertas-blue" + INSERT alertas_dolar
                                   ├ updates.py  → wkhtmltoimage → S3 → Buffer API (twitter, instagram, facebook)
                                   └ weekly.py   → wkhtmltoimage (d3 chart) → S3 → Buffer (+ linkedin), Fridays
 openexchangerates.org ──► entrypoint_currencies.sh (separate schedule; dead since ~2023-05) → currency_map / currency_values
```

| Component | Stack | Evidence |
|---|---|---|
| DB | PostgreSQL, session TZ UTC, 3 tables + 3 notification tables + 3 materialized views | `bluelytics_database/schema/*.sql` |
| Scraper/jobs | `python:3.8-buster`, requests, lxml, psycopg2, boto3, firebase-admin, pytz, `wkhtmltopdf` (apt), `jpegoptim`, `fonts-noto-extra`; no `TZ` set → UTC | `bluescraper/Dockerfile:1-23` |
| API | Go 1.14, `labstack/echo/v4 v4.1.16`, `jackc/pgx/v4 v4.6.0` (`lib/pq` listed but unused), image `golang:1.14-alpine`, `CMD ["./main"]`, `EXPOSE 8080` | `bluelytics_api/go.mod`, `Dockerfile` |
| Deploy | `docker build` → push to two ECR repos (`bluelytics_scraper`, `bluelytics_api`) in `us-west-2`; the scheduler/orchestrator definition is not in any repo | `*/redeploy.sh`, `bluescraper/README.md` |
| Edge | Cloudflare in front of `api.bluelytics.com.ar` | [GOLDEN] headers |

Schema (verbatim, `bluelytics_database/schema/core.sql:1-19` and `notifications.sql:2-21`):

```sql
create table currency_map( ID int primary key, code VARCHAR(3), name varchar(200) );
create table currency_values ( scraped_dt date, currency_id int references currency_map(id), value numeric(30,2),
                               primary key (scraped_dt, currency_id) );
create table dolar_values ( scraped_at timestamp, source varchar(20), value_buy numeric(30,2), value_sell numeric(30,2) );
-- no primary key and no index on dolar_values in the repo

create table alertas_dolar ( id SERIAL, alert_at timestamp, value_buy numeric(30,2), value_sell numeric(30,2) );
create table actualizaciones_sociales ( id SERIAL, social_network varchar(100), update_at timestamp,
                                        value_buy numeric(30,2), value_sell numeric(30,2) );
create table actualizaciones_sociales_weekly ( id SERIAL, social_network varchar(100), sent_at timestamp );
```

All `timestamp` columns are `timestamp WITHOUT time zone` filled with `current_timestamp` in a UTC session, so they hold UTC wall-clock values with microsecond precision.

Known consumers (for compatibility judgement): web frontend uses `v2/latest`, `data/json/currency.json`, `v2/evolution.json` (`bluelytics_frontend/app/scripts/services/blueapi.js:21-29`); mobile app uses `v2/latest`, `data/json/currency.json` and subscribes to FCM topic `alertas-blue` (`bluelytics_mobile_v3/screens/ValueScreen.js:42`, `CalculatorScreen.js:45,51`, `SettingsScreen.js:49,56`); the public docs page (`bluelytics_frontend/app/views/api.html`) advertises `/v2/latest`, `/v2/historical?day=`, `/v2/evolution.json`, `/v2/evolution.csv`, `/json/last_price` and links three third-party bindings that all use **v1** (`fedeisas/laravel-dolar-blue`, `matiu/dolar-blue`, `morrillo/currency_usd_update`).

---

# A. API CONTRACT

## A.0 Behavior common to all endpoints

### A.0.1 Routing [CODE server.go:10-49]

```go
e := echo.New()
e.Use(middleware.Recover())
e.Use(middleware.CORS())
e.GET("/", index)
e.GET("v2/latest", ...)            // echo prepends the missing "/"
e.GET("v2/alerts", ...)
e.GET("json/last_price", ...)
e.GET("v2/evolution.json", ...)
e.GET("v2/historical", ...)
e.GET("v2/evolution.csv", ...)
e.GET("data/json/currency.json", ...)
e.Logger.Fatal(e.Start(":8080"))
```

- Paths are matched exactly and case-sensitively. No trailing-slash tolerance: `/v2/latest/` → 404 [GOLDEN latest_slash]; `/V2/latest` → 404 [LIVE]; `//v2/latest` → 404 [LIVE].
- Only `GET` is registered. Unknown query parameters are ignored. For repeated parameters the **first** value wins (`c.QueryParam`) [LIVE `days=3&days=1` → 3 rows].
- Plain `http://` is 301-redirected to `https://` by Cloudflare [LIVE].

### A.0.2 JSON serialization rules (apply to every JSON body)

Produced by Go `encoding/json` `Encoder.Encode` through echo's `c.JSON`:

| Rule | Detail |
|---|---|
| Whitespace | Compact: no spaces, no newlines inside. [GOLDEN: 0 spaces in 721 kB] |
| Trailing byte | Exactly one `\n` (0x0A) after the JSON value. No CR. [GOLDEN xxd] |
| Key order | Struct declaration order, fixed (listed per endpoint below). |
| Numbers | Every numeric value field uses the custom `Number` type → `fmt.Sprintf("%.2f", n)`: always exactly two decimals, never an exponent, never quoted (`1574.50`, `4.00`, `0.00`, `23480.00`). `alert_id` is the only plain integer. [CODE v2.go:15-19] |
| Strings | Raw UTF-8, no `\uXXXX` for non-ASCII (`Colón`, `Złoty`, `Paʻanga` U+02BB, and a literal zero-width space U+200B inside the VES name are emitted as bytes). Go would escape `<`, `>`, `&`, U+2028, U+2029 as `<` etc.; no current data contains them. [GOLDEN currency: 155 non-ASCII bytes, no `\u`] |
| Empty list | A Go nil slice → the 4-byte body `null` + `\n`, **not** `[]`. [GOLDEN evolution_days0] |
| Content-Type | `application/json; charset=UTF-8` (capital `UTF-8`) |

`Number` verbatim:

```go
type Number float64
func (n Number) MarshalJSON() ([]byte, error) { return []byte(fmt.Sprintf("%.2f", n)), nil }
```

A JS rewrite cannot use `JSON.stringify` for these (it prints `1574.5`); bodies must be assembled by hand or with a serializer that formats numbers via integer hundredths. Avoid `toFixed(2)` on arbitrary doubles: it resolves exact binary ties differently from C `printf` (0.125 → `0.13` vs `0.12`). With whole-peso inputs and `.5` averages the two agree, and formatting from integer hundredths removes the question.

### A.0.3 Timestamps

Go `time.Time` marshals as RFC 3339 with nanosecond layout `2006-01-02T15:04:05.999999999Z07:00`:

- Fractional seconds: Postgres stores microseconds, so **0 to 6 digits** appear. Trailing zeros are trimmed (`.758024`, `.75802`, `.7`); if the fraction is exactly zero the dot and fraction are omitted entirely (`2026-11-20T19:45:51-03:00`).
- `last_update` (`/v2/latest`) and `date` (`/json/last_price`): converted with `updated_at.In(America/Buenos_Aires)` → offset suffix `-03:00` (Argentina has had no DST since 2009). [CODE v2.go:95-99] [GOLDEN `2026-11-20T19:45:51.758024-03:00`]
- `alert_at` (`/v2/alerts`): **not** converted; emitted in UTC with suffix `Z`. [GOLDEN `2026-11-20T20:00:54.374497Z`]
- Zero value (no row found): `0001-01-01T00:00:00Z`.
- `date` in evolution rows and the CSV `day` column: plain `YYYY-MM-DD`.

### A.0.4 Undocumented `?pretty` switch [LIVE]

echo v4.1.16 pretty-prints whenever the query string contains a key named `pretty` (any value, even empty). Indent is two spaces; numbers keep the `%.2f` form; trailing `\n` kept. Works on every JSON and JSONP response, including error bodies:

```
GET /v2/latest?pretty
{
  "oficial": {
    "value_avg": 1574.50,
    "value_sell": 1601.00,
    ...
```

### A.0.5 JSONP (only `/v2/latest` and `/json/last_price`)

If query param `callback` is non-empty: status 200, `Content-Type: application/javascript; charset=UTF-8`, body bytes are exactly

```
<callback>(<same JSON as the non-JSONP response>\n);
```

i.e. `callback`, `(`, compact JSON, `0x0A`, `)`, `;` and **no** trailing newline after `;`. [GOLDEN v2_latest_jsonp ends `…-03:00"}\n);` = `7d 0a 29 3b`]

- The callback string is reflected verbatim after URL-decoding, with no validation: `?callback=a.b[0]<x>` → body starts `a.b[0]<x>({"oficial":…` [LIVE].
- `callback=` (empty) → normal JSON.
- `/v2/alerts`, `/v2/evolution.*`, `/v2/historical`, `/data/json/currency.json` ignore `callback` [CODE: they call `c.JSON` unconditionally].

### A.0.6 CORS [CODE `middleware.CORS()` defaults] [GOLDEN] [LIVE]

- Every non-OPTIONS response (200, 404, 405 alike), with or without a request `Origin` header: `Access-Control-Allow-Origin: *` and `Vary: Origin`.
- `OPTIONS` on **any** path (registered or not, with or without preflight headers): `204 No Content`, empty body, and
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE`
  - `Vary: Origin`, `Vary: Access-Control-Request-Method`, `Vary: Access-Control-Request-Headers` (three separate headers)
  - `Access-Control-Allow-Headers: <verbatim echo of the request's Access-Control-Request-Headers>` only when that request header is present [LIVE: sent `X-Foo, Content-Type`, got it back]
  - no `Access-Control-Max-Age`, no `Access-Control-Allow-Credentials`.

### A.0.7 Status codes and error bodies

| Situation | Status | Body (bytes) | Content-Type |
|---|---|---|---|
| Unknown path, any method | 404 | `{"message":"Not Found"}\n` (24 bytes) | `application/json; charset=UTF-8` |
| Known path, method other than GET/OPTIONS/HEAD (POST, PUT, …) | 405 | `{"message":"Method Not Allowed"}\n` (33 bytes), **no `Allow` header** | same |
| `HEAD` on a known path, at the origin | 405, empty body, no Content-Type | [LIVE `HEAD /v2/latest`] | – |
| `HEAD` on a path Cloudflare has cached | 200 answered by Cloudflare from cache | [LIVE `HEAD /v2/alerts`] | as cached |
| `/v2/historical` bad/missing `day`, or day without data | **404** (not 400) | `{"error":"Error: …"}\n` (see A.7) | same |
| DB error inside a handler | process exits (`log.Fatal`) → Cloudflare 52x/502 until the container restarts | – | – |
| Panic inside a handler | 500 `{"message":"Internal Server Error"}\n` via `middleware.Recover()` | | |

### A.0.8 Origin vs Cloudflare

**What the Go origin sends** [CODE]: status, `Content-Type`, `Access-Control-Allow-Origin: *`, `Vary: Origin`, and Go's automatic `Content-Length` (small bodies) or chunked encoding and `Date`. It sends **no** `Cache-Control`, `ETag`, `Last-Modified`, `Expires`, compression, or security headers.

**What Cloudflare adds or changes** [GOLDEN] [LIVE]:

| Behavior | Observation |
|---|---|
| Cache rule A ("cache everything") | Every path except `/v2/latest` is edge-cached regardless of extension, query string (each distinct query string is its own cache key) **and status code** (404s show `MISS` → `HIT`). |
| Cache rule B (bypass) | Path `/v2/latest` (any query string) is always `cf-cache-status: DYNAMIC` with no `cache-control`. Matching is on Cloudflare's normalized path: `//v2/latest` is DYNAMIC (but 404 at the origin), `/v2/latest/` is cached. 405 responses and OPTIONS are DYNAMIC too. |
| Browser TTL | `cache-control: max-age=7200` added to every cacheable response, including 404s. |
| Edge TTL | Unknown upper bound. Lower bound: objects cached at 14:33:22 were still `HIT` with `age: 2189` at 15:09:51, and 404s were `HIT` at `age: 271`, so the edge TTL is longer than 36 minutes for 200s and longer than 4.5 minutes for 404s (Cloudflare's default for a 404 would be 3 minutes, so the TTL is explicitly overridden for all statuses). 2 hours matching the browser TTL is the natural guess. [INFERRED] |
| Synthesized validators | `last-modified: <time the edge cached it>`, `age`, `accept-ranges: bytes`; answers `If-Modified-Since` with 304 itself [LIVE]. No ETag. |
| Compression | `content-encoding: br` (or gzip) on the fly when the client asks [LIVE]. |
| Other headers | `server: cloudflare`, `cf-ray`, `cf-cache-status`, `nel`, `report-to`, `alt-svc: h3=":443"; ma=86400`. HTTP/2 and HTTP/3. |
| Managed `robots.txt` | `GET /robots.txt` returns a Cloudflare "content signals" robots file, 200 `text/plain; charset=utf-8`; the origin has no such route. `/favicon.ico` → origin 404. [LIVE] |

Practical consequence today: `/json/last_price`, `/v2/alerts`, `/v2/evolution.*`, `/v2/historical` and `currency.json` can be stale by (edge TTL + up to 2 h in the browser) after the underlying value changes. Only `/v2/latest` is live, and it hits Postgres on every request.

---

## A.1 `GET /`

- 200, `Content-Type: text/plain; charset=UTF-8`, body is the two bytes `OK` (0x4F 0x4B), **no trailing newline**. [CODE server.go:47-49] [GOLDEN root, content-length 2]
- Does not touch the DB (liveness only). Cached by Cloudflare.

## A.2 `GET /v2/latest`

Query params: `callback` (JSONP, A.0.5), `pretty` (A.0.4). Not cached by Cloudflare.

Body shape and key order [CODE v2.go:50-62]:

```
{"oficial":{"value_avg":N,"value_sell":N,"value_buy":N},
 "blue":{"value_avg":N,"value_sell":N,"value_buy":N},
 "oficial_euro":{"value_avg":N,"value_sell":N,"value_buy":N},
 "blue_euro":{"value_avg":N,"value_sell":N,"value_buy":N},
 "last_update":"<RFC3339, -03:00>"}\n
```

(shown wrapped; real output is one line). Golden, 347 bytes, sha256 prefix `761c5e8b4122d23e`:

```
{"oficial":{"value_avg":1574.50,"value_sell":1601.00,"value_buy":1548.00},"blue":{"value_avg":1652.50,"value_sell":1670.00,"value_buy":1635.00},"oficial_euro":{"value_avg":1712.00,"value_sell":1741.00,"value_buy":1683.00},"blue_euro":{"value_avg":1796.00,"value_sell":1815.00,"value_buy":1777.00},"last_update":"2026-11-20T19:45:51.758024-03:00"}
```

Field semantics [CODE v2.go:64-110]: one query `select tipo, updated_at, value_buy, value_sell, euro_buy, euro_sell from dolar_latest` (≤ 2 rows).

- row `tipo = 'oficial'` → `oficial.value_buy/sell` = row values; `oficial.value_avg = (sell + buy) / 2` computed in float64 in Go; same for `oficial_euro` from `euro_buy/euro_sell`.
- any other row (i.e. `'blue'`) → `blue`, `blue_euro` likewise, **and** `last_update = updated_at` converted to Buenos Aires time.
- `last_update` therefore reflects only the **blue** sources (the newest `scraped_at` among each blue source's latest row). The oficial row's timestamp is discarded.
- `value_buy`/`value_sell` are whole pesos; `value_avg` ends in `.00` or `.50`.
- If a row is missing, its object is all `0.00`; if the blue row is missing, `last_update` is `0001-01-01T00:00:00Z`.

## A.3 `GET /v2/alerts`

No parameters besides `pretty`. Cached by Cloudflare. Returns the most recent push alert and the values of the alert before it.

Key order [CODE v2.go:125-130]: `alert_id` (uint32, plain integer), `alert_at` (UTC, `Z`), `current{value_avg,value_sell,value_buy}`, `previous{value_avg,value_sell,value_buy}`.

Golden, 206 bytes:

```
{"alert_id":1885,"alert_at":"2026-11-20T20:00:54.374497Z","current":{"value_avg":1652.50,"value_sell":1670.00,"value_buy":1635.00},"previous":{"value_avg":1640.50,"value_sell":1658.00,"value_buy":1623.00}}
```

SQL [CODE v2.go:134-152]:

```sql
with ranked as (
  select id, alert_at, value_buy, value_sell,
         (value_buy+value_sell)/2 as value_avg,
         lag(value_buy)  over (order by alert_at) as last_value_sell,   -- alias is wrong, see below
         lag(value_sell) over (order by alert_at) as last_value_buy,    -- alias is wrong, see below
         lag((value_buy+value_sell)/2) over (order by alert_at) as last_value_avg,
         row_number() over(order by alert_at desc) rnk
  from alertas_dolar )
select id, alert_at, value_buy, value_sell, value_avg, last_value_sell, last_value_buy, last_value_avg
from ranked where rnk = 1
```

The two swapped aliases are scanned into the opposite struct fields (`Previous.Value_buy ← last_value_sell`, `Previous.Value_sell ← last_value_buy`, v2.go:160-168), so the swaps cancel and **the output is correct**: `previous.value_buy` is the previous alert's buy. Here `value_avg` is computed in SQL (numeric), so it is exact.

Edge cases: empty table → `{"alert_id":0,"alert_at":"0001-01-01T00:00:00Z","current":{0.00…},"previous":{0.00…}}`; exactly one alert → `lag()` is NULL → scan error → `log.Fatal` (process exit). Not reachable in production (1885 alerts).

## A.4 `GET /json/last_price` (legacy "v1")

Query params: `callback` (JSONP), `pretty`. Cached by Cloudflare (each distinct `callback` value is a separate cache entry).

Body: JSON array of exactly two objects, key order `date, source, value_avg, value_sell, value_buy` [CODE v1.go:10-16]. First `"source":"oficial"`, second `"source":"blue"`. `date` is the same blue `last_update` timestamp (with `-03:00`) in both.

Golden, 247 bytes:

```
[{"date":"2026-11-20T19:45:51.758024-03:00","source":"oficial","value_avg":1574.50,"value_sell":1601.00,"value_buy":1548.00},{"date":"2026-11-20T19:45:51.758024-03:00","source":"blue","value_avg":1574.50,"value_sell":1601.00,"value_buy":1548.00}]
```

**Bug, verified**: the second entry carries the *oficial* values (compare `/v2/latest`: blue is 1652.50/1670.00/1635.00). Source, v1.go:22-23:

```go
json_v1[0] = v1_json_dolar{dolar.Last_update, "oficial", dolar.Oficial.Value_avg, dolar.Oficial.Value_sell, dolar.Oficial.Value_buy}
json_v1[1] = v1_json_dolar{dolar.Last_update, "blue",    dolar.Oficial.Value_avg, dolar.Oficial.Value_sell, dolar.Oficial.Value_buy}
```

JSONP golden (254 bytes): `myCb([…]\n);`.

## A.5 `GET /v2/evolution.json`

Query params: `days` (see table), `pretty`. No JSONP. Cached by Cloudflare per query string.

Body: JSON array, newest first. Element key order `date, source, value_sell, value_buy` [CODE evolution.go:17-22]. Note: `source` is capitalized `"Oficial"` / `"Blue"` here (lower-case in `/json/last_price`), and JSON puts **sell before buy**. The docs page calls these fields `day` and `type`; the real JSON keys are `date` and `source`.

SQL [CODE evolution.go:34-41]:

```sql
select dttm, tipo, value_sell, value_buy from dolar_evolution order by dttm desc  [limit <days>]
```

**Sort order and tie-break as observed**: date descending, and within a date **`Oficial` before `Blue`** for all 4,682 dates that have both [GOLDEN]. The SQL only orders by `dttm`; the stable secondary order comes from Postgres walking the unique index `(dttm, tipo)` backwards. Treat the contract as `ORDER BY date DESC, source DESC`.

Golden `?days=5` (406 bytes) shows both the row semantics and the tie-break:

```
[{"date":"2026-11-20","source":"Oficial","value_sell":1595.00,"value_buy":1543.00},{"date":"2026-11-20","source":"Blue","value_sell":1665.00,"value_buy":1615.00},{"date":"2026-11-19","source":"Oficial","value_sell":1586.00,"value_buy":1533.00},{"date":"2026-11-19","source":"Blue","value_sell":1640.00,"value_buy":1591.00},{"date":"2026-11-18","source":"Oficial","value_sell":1580.00,"value_buy":1527.00}]
```

`days` semantics [CODE evolution.go:27-31: `days_num, err := strconv.Atoi(days); if err == nil && days_num < 10000 { limitStr = "limit " + days }`]:

| `days` value | Effect | Result | Evidence |
|---|---|---|---|
| absent or empty | no LIMIT | all rows | GOLDEN full, LIVE `days=` |
| `5` | `limit 5` | first 5 **rows** (2 full days + the Oficial row of the third) | GOLDEN |
| `+2`, `02` | Atoi accepts; raw text is spliced: `limit +2`, `limit 02` | 2 rows | LIVE |
| `0`, `-0` | `limit 0` | body `null\n`, status 200 | GOLDEN, LIVE |
| negative (`-1`) | `limit -1` → Postgres raises "LIMIT must not be negative" during row fetch; the code never checks `rows.Err()` | body `null\n`, status 200 | GOLDEN evolution_daysneg |
| `9999` | `limit 9999` | all rows **today** (9,365 < 9,999); will start truncating once the table passes 9,999 rows, about 317 trading days from now (early 2028) | LIVE |
| `>= 10000` | condition false → no LIMIT | all rows | GOLDEN evolution_days_big (byte-identical to full) |
| non-integer (`abc`, `3.0`, `%203`, `1_0`, `0x5`, `1e3`, overflow) | Atoi error → no LIMIT | all rows | GOLDEN evolution_days_bad, LIVE |
| repeated (`days=3&days=1`) | first value | 3 rows | LIVE |

No SQL injection is possible (the text is only spliced after `Atoi` succeeds).

Dataset facts as of the golden (2026-11-22): 9,365 rows (4,682 Oficial + 4,683 Blue), 4,683 distinct dates from `2011-01-03` to `2026-11-20`, 721,233 bytes (about 77 bytes per row), sha256 prefix `4fee6951c154fcdf`.

- One orphan date: `2013-04-05` has a Blue row only.
- 649 weekend dates exist, all between 2013-01-27 and 2020-05-17 (old system). None since.
- Since 2020-05-18 every Mon–Fri has both rows, **including public holidays** (the scraper has no holiday calendar; it re-records the unchanged quotes).
- 97 rows have `value_buy > value_sell` (2012-05-15 … 2014-02-04) and 3,728 rows have `value_buy == value_sell` (mostly the pre-2015 era where whole-peso rounding collapses both; also four modern Blue rows: 2021-02-18, 2021-02-19, 2024-05-14, 2024-05-21).
- Today's row exists from the first run of the day (about 10:01 UTC = 07:01 ART) and keeps changing until the last run (about 22:46 UTC = 19:46 ART).

## A.6 `GET /v2/evolution.csv`

Same data, same `days` semantics and order as A.5. [CODE evolution.go:69-92]

- `Content-Type: text/csv` (no charset, no `Content-Disposition`).
- Go `encoding/csv` defaults: comma separator, **LF line endings (no CR)**, no BOM, no quoting (no field needs it), a trailing LF after the last row.
- Header line exactly `day,type,value_buy,value_sell`.
- Column order is **buy then sell** (the opposite of the JSON key order); numbers formatted `%.2f`.
- `days=0` or negative → just the header line (`day,type,value_buy,value_sell\n`). [CODE]

Golden `?days=3` (132 bytes):

```
day,type,value_buy,value_sell
2026-11-20,Oficial,1543.00,1595.00
2026-11-20,Blue,1615.00,1665.00
2026-11-19,Oficial,1533.00,1586.00
```

Golden full: 9,366 lines, 281,106 bytes, verified row-for-row identical to the JSON (with buy/sell swapped into CSV order).

## A.7 `GET /v2/historical?day=YYYY-MM-DD`

Query params: `day` (required), `pretty`. No JSONP. Cached by Cloudflare per query string, **including the 404s**.

Algorithm [CODE v2.go:194-263]:

1. `time.Parse("2006-01-02", day)`. Strict: 4-digit year, 2-digit month and day, real calendar date, nothing else. Missing/empty/`2024-1-5`/`20240105`/`2024-01-05T00:00:00`/leading space/`2024-02-30` all fail → **404** `{"error":"Error: parsing day parameter: use YYYY-MM-DD"}\n` (57 bytes). [GOLDEN historical_missing, historical_bad] [LIVE]
2. Weekend remap: Saturday → the day before (Friday); Sunday → two days before (Friday). This happens even for the 2013–2020 dates where real weekend rows exist, so those rows are unreachable here.
3. `select lower(tipo) as tipo, value_buy, value_sell from dolar_evolution where dttm = $1`.
4. Row `oficial` → `oficial{}`; any other → `blue{}`; `value_avg = (sell + buy) / 2` in float64.
5. If `blue.value_sell == 0` (no blue row) → **404** `{"error":"Error: day not found"}\n` (33 bytes). [GOLDEN historical_old, historical_future]
6. Else 200, key order `oficial{value_avg,value_sell,value_buy}`, `blue{…}`.

Golden (141 bytes; identical for 2024-01-05 Fri, 2024-01-06 Sat, 2024-01-07 Sun):

```
{"oficial":{"value_avg":824.00,"value_sell":853.00,"value_buy":795.00},"blue":{"value_avg":1000.00,"value_sell":1025.00,"value_buy":975.00}}
```

Edge cases:

- Valid range is `2011-01-03` … last trading day. `2011-01-02` → day not found [LIVE]; a future date → day not found.
- A day with a Blue row but no Oficial row returns 200 with zeros: `?day=2013-04-05` → `{"oficial":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00},"blue":{"value_avg":8.00,"value_sell":8.00,"value_buy":8.00}}` [LIVE].
- Holidays return data (rows exist).
- "Today" works intraday and is provisional (A.5); a 404 for today requested before the first scrape is then cached by Cloudflare and by browsers for up to 2 h.

## A.8 `GET /data/json/currency.json`

No parameters besides `pretty`. No JSONP. Cached by Cloudflare.

Body: JSON array of `{"code":"XXX","name":"…","value":N}` (key order `code, name, value`) from `select code, name, value from currency_value_latest` [CODE currency.go:12-46]. `null\n` if the view is empty.

- `value` = units of that currency per **1 USD** (openexchangerates base USD), stored `numeric(30,2)`, so two decimals: `EUR 0.92`, `ARS 232.41`, `USD 1.00`. Low-priced units collapse: `BTC`, `XAU`, `XPD`, `XPT` are `0.00`; `XAG 0.04`; `CLF 0.03`.
- `name` is the Spanish name from `currency_map` (full list in D.4).
- 169 entries today = the 177 rows of `currency_map.csv` minus 8 retired codes that received no value on the last load (`BYR EEK LTL LVL MRO MTL VEF ZMK`).
- **Frozen**: the values correspond to roughly 2023-05-19 (ARS 232.41, TRY 19.81, JPY 137.97). The refresh job has not succeeded since. [GOLDEN + INFERRED]
- **Order is not sorted.** The view definition has `order by name` but the API selects from the materialized view without `ORDER BY`, so the order is the heap order left by the last `REFRESH … CONCURRENTLY`. Observed order of codes (reproduce this list for byte parity, or declare the order unspecified):

```
PAB BTC SVC BHD JOD KWD AED BSD BZD BMD BBD KYD SBD XCD USD ZWL ANG AWG BGN SSP AZN TMT BAM ERN XAU XPD CUC CUP XPT
QAR OMR CLF KPW RWF GNF BIF CDF KMF XPF XOF XAF HUF EUR CVE AMD VND HTG NZD AFN NAD LRD JMD GYD FJD TTD SGD HKD BND
CAD AUD STD STN MAD TND RSD LYD IQD DZD XDR MKD GMD SEK NOK ISK DKK CZK NIO CRC UGX TZS SOS KES GHS BOB VES ETB THB
MGA SRD UAH PYG PGK LAK HRK MWK ZMW AOA MMK GEL ALL HNL SLL MDL RON GIP GGP JEP IMP SHP EGP GBP LBP FKP SYP SDG SZL
TRY LSL MZN NGN BTN TWD ILS TOP MOP ARS CLP COP DOP PHP MXN UYU XAG BWP GTQ ZAR BRL IRR SAR YER KHR MYR BYN RUB MVR
MUR LKR INR IDR NPR PKR SCR PEN KGS TJS UZS BDT WST KZT MNT MRU VUV KRW JPY CNY CNH PLN DJF CHF
```

Golden: 8,874 bytes, starts `[{"code":"PAB","name":"Balboa","value":1.00},{"code":"BTC","name":"Bitcoin","value":0.00},…`, ends `…{"code":"CHF","name":"Franco suizo","value":0.90}]\n`.

## A.9 Golden file index (request each capture corresponds to)

| File | Request | Status |
|---|---|---|
| `root` | `GET /` | 200 |
| `v2_latest`, `origin` (same bytes; `origin` sent an `Origin` header) | `GET /v2/latest` | 200 |
| `v2_latest_jsonp` | `GET /v2/latest?callback=myCb` | 200 |
| `v2_alerts` | `GET /v2/alerts` | 200 |
| `v1_last_price`, `v1_last_price_jsonp` | `GET /json/last_price[?callback=myCb]` | 200 |
| `evolution_full` / `_days5` / `_days_bad` / `_days_big` / `_days0` / `_daysneg` | `GET /v2/evolution.json` with no `days`, `5`, non-numeric, ≥10000, `0`, negative | 200 |
| `evolution_csv_full`, `evolution_csv_days3` | `GET /v2/evolution.csv[?days=3]` | 200 |
| `historical_weekday` / `_sat` / `_sun` | `day=2024-01-05` / `06` / `07` (dates inferred from the values) | 200 |
| `historical_missing`, `historical_bad` | no `day`, malformed `day` | 404 |
| `historical_old`, `historical_future` | before 2011-01-03, future date | 404 |
| `currency` | `GET /data/json/currency.json` | 200 |
| `notfound`, `latest_slash` | unknown path, `/v2/latest/` | 404 |
| `options` | `OPTIONS` | 204 |
| `post` | `POST` on a registered path | 405 |

These bodies are the acceptance tests for a rewrite: compare byte-for-byte (the three time-varying ones — `v2_latest*`, `v1_last_price*`, `v2_alerts` — structurally).

---

# B. BUGS AND QUIRKS, WITH A COMPATIBILITY VERDICT

Verdicts: **PRESERVE** (consumers can observe it; changing it breaks the "keep current API design" requirement), **FIX** (safe to fix; invisible or strictly an improvement), **JUDGMENT** (visible change that is arguably a correction; needs an owner decision; my recommendation given).

## B.1 API layer

| # | Bug / quirk | Evidence | Verdict and reasoning |
|---|---|---|---|
| A1 | `/json/last_price` `"blue"` entry carries oficial values | v1.go:23; GOLDEN | **JUDGMENT → recommend fix**, behind a flag for one release. It is an obvious typo, the field is labelled blue, and v1 is what the three published third-party bindings read. Nobody can sensibly depend on "blue == oficial", but the number a consumer sees will jump (about +4% today), so it must be a conscious, announced change. Implement both paths; default to fixed once the owner signs off. |
| A2 | `days` limits rows, not days; docs say days | evolution.go:27-31; GOLDEN | **PRESERVE.** Charts and scripts have been tuned to the real behavior for 5 years. Fix the documentation instead; if "real days" is wanted, add a new parameter. |
| A3 | `days` ≥ 10000 or unparsable silently returns everything | same | **PRESERVE** (harmless; keeps `?days=all`-style misuse working). |
| A4 | `days=0` and negative return `null` with 200; negative is really a swallowed SQL error | GOLDEN | **PRESERVE** `null` for 0. For negatives **JUDGMENT → preserve** `null` (cheapest; nobody relies on it, but there is no better answer). |
| A5 | Empty arrays serialize as `null` | Go nil slice | **PRESERVE** for the `days=0` case. For "table empty" it is unreachable. |
| A6 | Swapped `lag()` aliases in the alerts SQL | v2.go:142-143 | **FIX** (internal). The double swap cancels; output is already right. Do not "fix" one side only. |
| A7 | `log.Fatal` on any query/scan error kills the server | v2.go:71,84,97,154,170,220,231; evolution.go:43,52,88; currency.go:25,33 | **FIX.** Serve the last good pre-rendered body or a 5xx. |
| A8 | `rows.Err()` never checked → a mid-stream DB error yields a truncated-but-valid 200 that Cloudflare then caches for hours | all handlers | **FIX.** |
| A9 | `/v2/historical` returns 404 for a malformed `day` (should be 400) | v2.go:259; GOLDEN | **PRESERVE** status and body text; clients branch on 404. |
| A10 | Weekend → Friday remap ignores real weekend rows (2013–2020) | v2.go:202-210 | **PRESERVE.** |
| A11 | "day not found" keyed on `blue.value_sell == 0`; Blue-only day (2013-04-05) returns oficial zeros with 200 | v2.go:245; LIVE | **PRESERVE** (single historical date; falls out naturally if the data is copied as is). |
| A12 | `last_update` (and v1 `date`) reflect blue sources only; oficial timestamp discarded | v2.go:94-99 | **PRESERVE.** |
| A13 | `last_update` is `-03:00` while `alert_at` is `Z` | GOLDEN | **PRESERVE** both formats exactly. |
| A14 | `*_euro` values computed with a EUR rate frozen at `0.92` (2 decimals, ~May 2023) | C.1, C.3 | **FIX** (it is a data-freshness failure, not a contract). Visible effect: euro values shift by whatever EUR/USD has moved since 2023 on the first refresh. Announce it. Keep the formula (C.1). |
| A15 | `currency.json` frozen since ~May 2023; 2-decimal storage zeroes BTC/XAU/XPT/XPD | GOLDEN | Freshness: **FIX.** Two-decimal number format: **PRESERVE** (byte format of `value`). Row order: **JUDGMENT → sort by name** as the view intended (order was never stable). |
| A16 | JSONP callback reflected without validation | LIVE | **FIX**, permissively: allow `[A-Za-z0-9_$.\[\]]{1,128}`, otherwise 400 or fall back to plain JSON. jQuery/angular style callbacks (`jQuery1124_169…`, `angular.callbacks._0`) still pass. Keep the exact wrapper bytes `cb(` … `\n);`. |
| A17 | `?pretty` | LIVE | **JUDGMENT → preserve if cheap** (it is a pure function of the compact body), else ignore the parameter. Undocumented; low risk either way. |
| A18 | `HEAD` → 405 at origin; 405 has no `Allow` header | LIVE, GOLDEN | **FIX** (answer HEAD like GET without body; add `Allow: GET, HEAD, OPTIONS`). Cloudflare already masks this on cached paths. |
| A19 | `OPTIONS` on any path → 204 with wildcard CORS | GOLDEN | **PRESERVE.** `Access-Control-Allow-Origin: *` on everything is the contract browser widgets rely on. `Vary: Origin` is harmless; keep or drop. |
| A20 | No cache headers from origin; Cloudflare caches data endpoints and 404s for a long time with a 2 h browser TTL | A.0.8 | **FIX** deliberately: explicit `Cache-Control` per endpoint, purge on write, short or no caching for 404s. Not part of the contract. |
| A21 | JSON evolution keys (`date`,`source`, sell-then-buy) differ from the docs (`day`,`type`) and from the CSV (`day,type,value_buy,value_sell`) | A.5, A.6 | **PRESERVE** both real formats; fix the docs. |
| A22 | Trailing slash and case variants 404 | GOLDEN, LIVE | **PRESERVE** or relax; relaxing cannot break anyone. |
| A23 | Go 1.14 / echo 4.1.16 / pgx 4.6.0 are years out of support | go.mod | Moot after the rewrite. |

## B.2 Data semantics

| # | Bug / quirk | Evidence | Verdict |
|---|---|---|---|
| D1 | All values rounded to whole pesos, which flattens 2011–2015 history to e.g. `4.00/4.00` and creates 97 rows with buy > sell | views.sql:27-30,65-66; GOLDEN | **PRESERVE** for existing history (byte parity of `/v2/evolution.*`). For new days **JUDGMENT → keep whole-peso rounding** (at 1,600 pesos the loss is 0.03%), but store the unrounded medians so the decision can be revisited. |
| D2 | Round-half-to-even | C.5 | **PRESERVE** (otherwise medians of two sources that end in `.5` flip by one peso versus production). |
| D3 | Raw history before 2014 has buy/sell swapped (buy is the higher number) | `initial_load/dolar.csv` (la_nacion and oficial 2011–2013 all `buy > sell` by 0.10) | **PRESERVE** in the API-visible rows; optionally keep a corrected copy internally. |
| D4 | Daily value = median of the **last 49 samples** of the UTC day, pooling all blue sources. With two live sources and La Nación inserted last, this is effectively "La Nación's afternoon value" whenever the two disagree; with three sources it covers only the last ~4 h; for Oficial it is the mid-day value, not the close | views.sql:50-70; C.2 | **JUDGMENT → replace for new days** with a documented rule (recommended: the day's final `/v2/latest` values, so `historical(today)` and `latest` agree after close). Already-published days stay frozen. If strict continuity is preferred, C.2 gives the exact legacy algorithm. |
| D5 | Latest keeps a dead source's last quote in the median for up to 3 days (`scraped_at >= current_date - 3`) | views.sql:15 | **FIX** (shorter staleness window, e.g. same trading day, plus alerting when a source goes silent). Not directly observable. |
| D6 | "Blue" = every source that is not literally `'oficial'` | views.sql:25,54 | **PRESERVE** the mapping; make it explicit configuration. |
| D7 | Holidays produce rows with stale quotes | A.5 | **PRESERVE** (changing it would make `/v2/historical` 404 on holidays where it answers today). |
| D8 | `dolar_evolution` is recomputed over the entire table on every run (no incremental refresh, no indexes on `dolar_values`) | views.sql, core.sql | **FIX** (only today's two rows can change). |

## B.3 Scraper and jobs

| # | Bug / quirk | Evidence | Verdict |
|---|---|---|---|
| J1 | Cronista scraper is dead (URL 301s, markup changed, `[0]` → IndexError) | D.2; FIXTURE | **FIX** (new source recipe). Decide consciously whether to restore a third source: it will move published blue values (median of 3 instead of mean of 2). |
| J2 | No timeouts, retries, status checks or sanity bounds on any HTTP scrape; a parse error just skips that source for the run | scrape_*.py | **FIX.** |
| J3 | `scrape_cronista.py` cannot parse non-zero cents (`"1.635,50"` → `float("1635,50")` ValueError) | scrape_cronista.py:13,15 | **FIX.** |
| J4 | La Nación parsed by position (`dollar_elems[2]`, `[3]`) | scrape_lanacion.py:14-15 | **FIX** (select by label). |
| J5 | Time guards evaluated in container-local time, which is UTC | Dockerfile (no TZ) | Keep the effective window (D.1) but express it in ART explicitly. |
| J6 | Alert cooldown uses `timedelta.seconds` (ignores days) | alerts.py:67 | **FIX.** Real effect: after an alert at time T, runs between T and T+10 min on *later days* are also suppressed (one run per day at most). |
| J7 | Alert compares a rounded median-of-latest against unrounded per-minute means; can be "outside the range" by rounding alone | alerts.py:10-49,68 | **JUDGMENT** (E.4 proposes a cleaner rule). |
| J8 | Alert job crashes if `alertas_dolar` is empty (`now - None`) and can double-send if the insert fails after the push | alerts.py:65,72-76 | **FIX.** |
| J9 | Social update never fires on Mondays or after any day without a daily row | updates.py:14-22 | **FIX.** |
| J10 | Social cooldown uses `.seconds` too: a daily 15-minute (twitter) or **60-minute** (instagram/facebook) blind window at the time of day of the last post | updates.py:79 | **FIX.** |
| J11 | `ClientError` and `logging` are undefined names → S3 failure raises `NameError` | updates.py:120-121, weekly.py:84-85 | **FIX.** |
| J12 | Post record inserted even when Buffer returned non-200 | updates.py:138-145, weekly.py:97-103 | **FIX** (record status; retry policy). |
| J13 | Image prints Oficial Venta × 1.75 labelled "(+75%)" | updates.py:102, update_template.html:82 | **FIX** (remove; G). |
| J14 | Weekly: `res[4]` IndexError when the week has < 5 daily rows | weekly.py:44 | **FIX.** Real effect is narrower than it looks: holidays still have rows, so it only fails if the scraper missed an entire weekday. |
| J15 | Weekly image is JPEG data uploaded under a `.png` key; no `ContentType` set on any upload | weekly.py:72-78 | **FIX.** |
| J16 | `shutil.copytree` into `/tmp/<network>` collides between `updates.py` and `weekly.py` in the same container run (Fri 21:00–21:59 UTC) | updates.py:93, weekly.py:55 | **FIX.** |
| J17 | Weekly delta line is always styled "positive" (blue) | weekly.html:77 | **FIX.** |
| J18 | Currency refresh dead since ~2023-05; new currencies would get English names; one DB connection per currency; errors swallowed | openexchange*.py, database.py:40-56 | **FIX.** |
| J19 | Live credentials committed in working trees (`bluescraper/.env`, `bluescraper/test.py`, `bluescraper/bluelytics-mobile-firebase-adminsdk.json`, `bluelytics_vpn/*`, Buffer profile IDs in `bluelytics_notifiy/update.py`) | H | **FIX: rotate everything** before or at cutover; nothing from these files should be migrated by value. |

---

# C. DATA SEMANTICS

Definitions are verbatim from `bluelytics_database/schema/views.sql`. All three are `MATERIALIZED VIEW`s with a unique index, refreshed with `REFRESH MATERIALIZED VIEW CONCURRENTLY` (database.py:58-65): `dolar_latest` then `dolar_evolution` on every scraper run (refresh_dolar.py), `currency_value_latest` only by the separate currency job.

## C.0 Two primitives you must reproduce exactly

```ts
// Postgres PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY x): numeric input is cast to float8,
// rows sorted ascending, linear interpolation at position 0.5*(n-1).
function median(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b);
  const pos = 0.5 * (v.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (pos - lo) * (v[hi] - v[lo]);      // keep this expression shape (Postgres float8 lerp)
}

// Postgres round(double precision) = C rint(): round half to EVEN.  NOT Math.round.
function rint(x: number): number {                  // x >= 0 here
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
```

`round(...)::numeric(30,2)` therefore always yields an integer value with scale 2 (`1670.00`). **Yes: every published `value_buy`, `value_sell`, `euro_buy`, `euro_sell` is a whole number of pesos.** Only `value_avg` (computed afterwards as `(sell+buy)/2`) can carry `.50`. Verified on all 18,730 numbers of the full history and on `/v2/latest`.

Proof of the rounding rule (C.5 below): 117/117 ties agree with half-even.

## C.1 `dolar_latest` (feeds `/v2/latest`, `/json/last_price`, alerts, social posts)

```sql
create materialized view dolar_latest as
with rnked as (
    select *, row_number() over(partition by source order by scraped_at desc) rnk
    from dolar_values
    where scraped_at >= current_date - 3 ),
last_euro as (
    select value, row_number() over (order by scraped_dt desc) rnk
    from currency_values where currency_id = 22 )
select
  case when source = 'oficial' then 'oficial' else 'blue' end as tipo,
  max(scraped_at) as updated_at,
  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_buy))::numeric(30,2)  as value_buy,
  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_sell))::numeric(30,2) as value_sell,
  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_buy)/avg(last_euro.value))::numeric(30,2)  as euro_buy,
  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_sell)/avg(last_euro.value))::numeric(30,2) as euro_sell
from rnked r left join last_euro on last_euro.rnk = 1
where r.rnk = 1
group by 1;
CREATE UNIQUE INDEX IF NOT EXISTS dolar_latest_ix ON dolar_latest (tipo);
```

Meaning, step by step:

1. **Window**: rows with `scraped_at >= (today's UTC date − 3 days) at 00:00 UTC`. That is 3 full UTC days plus today so far (72–96 h).
2. **Latest per source**: keep the newest row of each distinct `source` string in the window.
3. **Group**: `source = 'oficial'` → `oficial`; everything else → `blue`. At most two output rows; a group with no rows is absent.
4. `updated_at` = newest `scraped_at` among the group's kept rows.
5. `value_buy` = `rint(median(buy of kept rows))`; `value_sell` likewise, **independently** (the two medians can come from different sources).
6. `euro_buy` = `rint(median(buy) / EUR)` using the **unrounded** median; `euro_sell` likewise. `EUR` = the newest `currency_values.value` for `currency_id = 22`. In `currency_map.csv`, **ID 22 is `EUR`, "Euro"** (line `22,EUR,Euro`). The stored value is "EUR per 1 USD" with 2 decimals, currently exactly `0.92`. The division is done in float8.
7. With one source the median is that source's value; with two it is their mean; with three the middle one.

**Worked example, reproduces today's golden exactly.** Inputs = each live source's last quote of Friday 2026-11-20 as still published today [FIXTURE]:

| source | buy | sell | where from |
|---|---|---|---|
| `ambito_financiero` | 1655.00 | 1675.00 | `mercados.ambito.com/dolar/informal/variacion` → `{"compra":"1655,00","venta":"1675,00","fecha":"20/11/2026 - 18:55",…}` |
| `lanacion` | 1615.05 | 1665.00 | La Nación page, `<strong>` nodes [2] and [3]: `$1615,05`, `$1665,00` |
| `cronista` | – | – | no row (scraper dead) |
| `oficial` | 1548.41 | 1601.32 | `mercados.ambito.com/dolar/oficial/variacion` → `{"compra":"1548,41","venta":"1601,32","fecha":"20/11/2026 - 16:46",…}` |
| EUR (id 22) | 0.92 | | frozen |

- blue buy: `median(1615.05, 1655.00) = 1635.025` → `rint` → **1635**; blue sell: `median(1665, 1675) = 1670` → **1670**.
- blue euro buy: `1635.025 / 0.92 = 1777.20` → **1777**; blue euro sell: `1670 / 0.92 = 1815.22` → **1815**.
- oficial buy: `1548.41` → **1548**; oficial sell: `1601.32` → **1601**.
- oficial euro buy: `1548.41 / 0.92 = 1683.05` → **1683**; oficial euro sell: `1601.32 / 0.92 = 1740.57` → **1741**. (From the rounded 1601 it would be 1740.22 → 1740, so this pins down "unrounded median first".)
- API then adds `value_avg`: oficial `(1601+1548)/2 = 1574.50`, blue `1652.50`, oficial_euro `1712.00`, blue_euro `1796.00`.

All twelve numbers equal `golden/v2_latest.body`. This match is also the evidence that only two blue sources are alive and that EUR is exactly 0.92.

Pseudocode (SQLite + TypeScript):

```sql
-- inputs: newest row per source inside the window
SELECT source, scraped_at, buy, sell FROM (
  SELECT s.*, ROW_NUMBER() OVER (PARTITION BY source ORDER BY scraped_at DESC) AS rn
  FROM quote_samples s
  WHERE scraped_at >= :utc_midnight_three_days_ago          -- e.g. '2026-11-17T00:00:00Z' on 2026-11-20
) WHERE rn = 1;
```

```ts
function computeLatest(lastPerSource: Sample[], eurPerUsd: number) {
  const out: Record<string, LatestRow> = {};
  for (const tipo of ['oficial', 'blue'] as const) {
    const rows = lastPerSource.filter(r => (r.source === 'oficial') === (tipo === 'oficial'));
    if (rows.length === 0) continue;                       // legacy: group simply absent → zeros in the API
    const mb = median(rows.map(r => r.buy)), ms = median(rows.map(r => r.sell));
    out[tipo] = {
      updated_at: rows.map(r => r.scraped_at).sort().at(-1)!,
      value_buy: rint(mb), value_sell: rint(ms),
      euro_buy: rint(mb / eurPerUsd), euro_sell: rint(ms / eurPerUsd),
    };
  }
  return out;   // API: value_avg = (value_sell + value_buy) / 2 ; last_update = out.blue.updated_at in -03:00
}
```

## C.2 `dolar_evolution` (feeds `/v2/evolution.*`, `/v2/historical`, social triggers, weekly chart)

```sql
create materialized view dolar_evolution as
with ranked as (
  select date(scraped_at) as dttm,
         case when source = 'oficial' then 'Oficial' else 'Blue' end as tipo,
         scraped_at as updated_at, value_buy, value_sell,
         row_number() over(partition by date(scraped_at),
                                        case when source = 'oficial' then 'Oficial' else 'Blue' end
                           order by scraped_at desc) rnk
  from dolar_values )
select dttm, tipo, max(updated_at) as updated_at,
       round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_buy))::numeric(30,2)  as value_buy,
       round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_sell))::numeric(30,2) as value_sell
from ranked
where rnk < 50
group by dttm, tipo;
CREATE UNIQUE INDEX IF NOT EXISTS dolar_evolution_ix ON dolar_evolution (dttm, tipo);
```

Meaning:

1. `dttm` = **UTC** calendar date of `scraped_at`.
2. `tipo` = `'Oficial'` or `'Blue'` (capitalized here; all non-oficial sources pooled).
3. Within each `(dttm, tipo)`, rank samples newest first and keep ranks 1..49 (`rnk < 50`): the **last 49 samples of the day** for that tipo, across sources.
4. `value_buy` = `rint(median(buy of those ≤49 rows))`, `value_sell` likewise and independently. `updated_at` = newest sample time.
5. It is a running value for the current day and becomes final after the last run.

How many samples that is in practice (15-minute cadence, 52 runs per trading day, D.5):

| tipo | live sources | rows per day | the 49 kept rows cover |
|---|---|---|---|
| Oficial | 1 | 52 | all but the first 3 runs → median ≈ the 25th of 49 ≈ the quote around 16:45 UTC (13:45 ART) |
| Blue, 3 sources | 3 | 156 | last 16⅓ runs ≈ 18:45–22:45 UTC (15:45–19:45 ART) |
| Blue, 2 sources (today) | 2 | 104 | last 24½ runs ≈ 16:45–22:45 UTC; 25 rows from the source inserted last (La Nación) and 24 from the other |

Worked examples:

- **2020-05-12 (raw rows are in `initial_load/dolar.csv`, exact).** Blue rows: `ambito_financiero 115.05 / 125.05`, `invertir_online 114.85 / 124.85`; Oficial row: `64.64 / 69.25`. Blue buy `median = 114.85 + 0.5·(115.05 − 114.85) = 114.95` → **115**; Blue sell `124.95` → **125**; Oficial `64.64` → **65**, `69.25` → **69**. API rows: `{"date":"2020-05-12","source":"Oficial","value_sell":69.00,"value_buy":65.00}`, `{"date":"2020-05-12","source":"Blue","value_sell":125.00,"value_buy":115.00}`. Match.
- **Tie, 2011-10-27 Blue**: single raw row `la_nacion 4.50 / 4.40` → `rint(4.5) = 4` (even), `rint(4.4) = 4` → API `4.00 / 4.00`. Half-up would have published 5.00.
- **Tie going the other way, 2012-07-25 Oficial**: raw `4.60 / 4.50` → buy **5**, sell `rint(4.5)` = **4** → API `value_buy 5.00`, `value_sell 4.00` (one of the 97 buy > sell rows; the raw data of that era already has buy and sell swapped).
- **2026-11-20, modern day [INFERRED, consistent with golden]**: Blue last 49 rows = 25 × La Nación (1615.05 / 1665.00) + 24 × Ámbito (1655 / 1675 at the end of the day). The 25th smallest of each column is La Nación's → **1615 / 1665**, exactly the golden row, while `/v2/latest` shows the mean of the two, **1635 / 1670**. Oficial: golden daily **1543 / 1595** vs closing quote 1548.41 / 1601.32, because the median lands on the early-afternoon sample.

Pseudocode:

```sql
SELECT buy, sell, scraped_at FROM quote_samples
WHERE day = :day AND tipo = :tipo            -- day = UTC date of scraped_at; tipo = 'Oficial' iff source='oficial'
ORDER BY scraped_at DESC LIMIT 49;
```

```ts
function computeDaily(rows49: Sample[]) {     // rows49.length >= 1
  return { value_buy: rint(median(rows49.map(r => r.buy))),
           value_sell: rint(median(rows49.map(r => r.sell))),
           updated_at: rows49[0].scraped_at };
}
// run for today's ('Oficial', 'Blue') after every scrape; never touch other days.
```

History loaded from the old system (2011-01-03 … 2020-05-12, `dolar.csv`) has one row per `(day, source)` stamped at midnight, so for those days the rule degenerates to "median across sources of the old per-source daily average" (`initial_load/scripts_download.sql`: `round(avg(value_buy),2)` per day and source).

## C.3 `currency_value_latest` (feeds `/data/json/currency.json`)

```sql
create materialized view currency_value_latest as
select code, name, value
from currency_values v inner join currency_map m on v.currency_id = m.id
where scraped_dt = (select max(scraped_dt) from currency_values)
order by name;
CREATE UNIQUE INDEX IF NOT EXISTS currency_value_latest_ix ON currency_value_latest (code);
```

Meaning: every currency that has a value on the single most recent `scraped_dt` in the whole table, with its code and Spanish name. Currencies that did not receive a value on that last date disappear from the API (that is why 8 retired codes are missing). `value` = units per 1 USD rounded to 2 decimals on insert (`numeric(30,2)`, Postgres numeric rounding = half away from zero on the decimal text psycopg2 sends).

Worked example: last load date D (≈ 2023-05-19) inserted `EUR → 0.92`, `ARS → 232.41`, `BTC → 0.00` (0.0000372… rounded), 169 rows in total → the API lists those 169. `currency_values` rows for D−1 and earlier are ignored.

Pseudocode:

```sql
SELECT code, name, value_hundredths FROM currencies WHERE value_dt = (SELECT MAX(value_dt) FROM currencies) ORDER BY position;
```

(or simply keep one "current value" per currency and an `active` flag; no history is API-visible).

## C.4 Time zones and day boundaries

Everything is UTC:

- The scraper image sets no `TZ` (`bluescraper/Dockerfile`), so `datetime.today()` / `datetime.now()` are UTC. `updates.py:104` uses `datetime.now(tz=buenos_aires)` only for the caption inside the image, which confirms the author knew the container clock was not Argentine time.
- Inserts use `current_timestamp` / `current_date` into `timestamp` / `date` columns, i.e. the DB session zone. The Go API reads `timestamp` as UTC and converts to Buenos Aires (`v2.go:95-99`). The observed `last_update` 19:45:51 −03:00 on a Friday equals 22:45:51 UTC, the last quarter-hour slot allowed by the `hour < 23` UTC guard, and the last alert at 20:00:54Z equals 17:00 ART, i.e. market close. An all-ART clock would put those at 22:45 and 20:00 local, after every source had stopped updating (Ámbito's own stamp is 18:55). So DB session zone = UTC. [INFERRED, consistent on every point]

Consequences for Argentina (UTC−3, no DST):

| Expression | Evaluated as | Effect |
|---|---|---|
| `date(scraped_at)` (daily bucket) | UTC date; the UTC day runs 21:00 → 21:00 ART | Scrapes happen 07:00–19:59 ART (10:00–22:59 UTC), entirely inside one UTC day whose date equals the Argentine date. **So today UTC date == ART date for every row.** A sample taken at 21:00–23:59 ART (only possible with `RUN_ALWAYS` or a wider window) would be booked to the next day, and Friday-night samples to Saturday. |
| `current_date - 3` (latest window) | UTC midnights | Friday's quotes stay eligible until Monday 23:59 UTC; Monday's first run (10:00 UTC) replaces them. The window never empties in normal operation. |
| `dttm > current_date - 2 and dttm < current_date` (social trigger) | "yesterday" in UTC, evaluated 13:00–21:59 UTC | Same calendar day in both zones. Monday looks at Sunday → no row (bug J9). |
| `date_trunc('week', current_date)` (weekly chart) | ISO week, Monday start, UTC; evaluated Friday 21:00–23:59 UTC | Friday 18:00–20:59 ART, same week. |
| `/v2/historical?day=` | compared to the stored UTC date | equals the ART trading date. |

For the rewrite: store instants in UTC and derive the trading day explicitly in `America/Argentina/Buenos_Aires`. It gives identical buckets for the legacy window and stays correct if the window is ever widened.

## C.5 Proof of the rounding rule and of the view definitions

I recomputed the daily table from `initial_load/dolar.csv` (7,816 rows, 2011-01-03 … 2020-05-12, values with cents) with the C.2 algorithm and compared with `golden/evolution_full.body`:

- 5,955 `(day, tipo)` pairs in that range; **5,955 / 5,955 match with half-even**, including the 117 pairs where a median is exactly `x.5`.
- With half-up, exactly those 117 mismatch.
- No pair present in one and missing in the other.

So production runs these exact view definitions on this exact CSV, and the repo CSV is a lossless (cents-preserving) source for that period.

## C.6 Sources seen in the data

| `source` string | Period (in `dolar.csv`) | Notes |
|---|---|---|
| `la_nacion` | 2011-01-03 … 2015-12-17 | 2011–2013 rows have buy > sell |
| `oficial` | 2011-01-03 … today | same swap in 2011–2013 |
| `ambito_financiero` | 2014-02-11 … today | |
| `elcronista` | 2014-10-20 … 2018-01-24 | |
| `invertir_online` | 2020-04-23 … 2020-05-12 | |
| `cronista` | written by the Docker-era scraper (2020-05 →), dead now | different string from `elcronista` |
| `lanacion` | written by the Docker-era scraper, alive | different string from `la_nacion` |

`source` is `varchar(20)`.

---

# D. SCRAPER PIPELINE

## D.1 Entry point, order, guards

`bluescraper/Dockerfile:23` → `ENTRYPOINT /app/entrypoint.sh` (shell form, `WORKDIR /app`). `src/entrypoint.sh` verbatim:

```sh
#!/bin/sh
echo "Running scrapers..."
python scrape_ambito.py
python scrape_oficial.py
python scrape_cronista.py
python scrape_lanacion.py
echo "Refreshing dollar..."
python refresh_dolar.py        # REFRESH MATERIALIZED VIEW CONCURRENTLY dolar_latest; then dolar_evolution
echo "Posting updates..."
python alerts.py
python updates.py
python weekly.py
```

- No `set -e`: each script is its own process; a crash in one (e.g. Cronista) does not stop the rest.
- Each script opens its own Postgres connections (`database.py:3-8`: `psycopg2.connect(user=PG_USER, password=PG_PASSWORD, host=PG_HOSTNAME, port="5432", database=PG_DB)`; `PG_SSLMODE` is not used by the Python side).
- Insert order inside a run is Ámbito, Oficial, Cronista, La Nación; consequently La Nación's row is the newest blue row of every run (this matters for C.2 and for `last_update`).

Time guards (all in **UTC**, see C.4):

| Script | Guard (verbatim) | UTC | Argentina |
|---|---|---|---|
| `scrape_ambito.py:5`, `scrape_oficial.py:5`, `scrape_cronista.py:6`, `scrape_lanacion.py:6` | `if now.weekday() < 5 and now.hour >= 10 and now.hour < 23 or 'RUN_ALWAYS' in os.environ:` with `now = datetime.datetime.today()` | Mon–Fri 10:00–22:59 | Mon–Fri 07:00–19:59 |
| `refresh_dolar.py` | none | every run | |
| `alerts.py` | none (but its inputs only change inside the scrape window) | every run | |
| `updates.py:155` | `if now.weekday() < 5 and now.hour >= 13 and now.hour < 22:` | Mon–Fri 13:00–21:59 | Mon–Fri 10:00–18:59 |
| `weekly.py:115` | `if now.weekday() == 4 and now.hour >= 21:` | Fri 21:00–23:59 | Fri 18:00–20:59 |

`RUN_ALWAYS` is a presence-only flag (any value, even empty) that bypasses the guard of the four scrapers only. It is set in the local `.env`; production evidently does not set it (no weekend rows since 2020-05-18). Operator precedence is `(weekday and hours) or RUN_ALWAYS`.

There is no holiday calendar and no de-duplication: every in-window run inserts one row per working source whether or not the quote changed.

## D.2 Sources

All four use `requests.get(url, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'})` and nothing else: **no timeout, no retry, no status-code check**, default `Accept: */*`. Each ends with `insertBlue(source, buy, sell)` → `insert into dolar_values (scraped_at, source, value_buy, value_sell) values(current_timestamp, %s, %s, %s)` (database.py:14); the column type rounds to 2 decimals.

| Source id stored | URL | Parsing (verbatim essentials) | Normalisation | State on 2026-11-22 |
|---|---|---|---|---|
| `ambito_financiero` | `https://mercados.ambito.com/dolar/informal/variacion` | `data = r.json()`; `data['compra']`, `data['venta']` | `.replace(',', '.')` on each string, passed as text (`"1655,00"` → `"1655.00"`). A thousands dot (`"1.655,00"`) would produce `"1.655.00"` and fail the insert. | **Working.** Returns `{"compra":"1655,00","venta":"1675,00","fecha":"20\/11\/2026 - 18:55","variacion":"2,13%","class-variacion":"up","valor_cierre_ant":"1640,00"}`; response is `application/json`, `cache-control: public, max-age=30` [FIXTURE] |
| `oficial` | `https://mercados.ambito.com/dolar/oficial/variacion` | same as above (scrape_oficial.py) | same | **Working.** `{"compra":"1548,41","venta":"1601,32","fecha":"20\/11\/2026 - 16:46",…}`. This is Ámbito's "Dólar Oficial" with cents, not the Banco Nación board (`/dolarnacion/variacion` gives 1550,00 / 1600,00). |
| `cronista` | `https://www.cronista.com/MercadosOnline/moneda.html?id=ARSB` | `tree = etree.HTML(r.text.encode())`; buy = first node of `//span[contains(@class, 'buy')]/div[contains(@class, 'val')]`; sell = same with `'sell'` | `float("".join(elem.itertext()).replace('$', '').replace(',00', '').replace('.',''))` i.e. strip `$`, drop a `,00` suffix, drop thousands dots. Non-zero cents are not handled (`"1635,50"` → `float()` ValueError). | **Dead.** The URL 301-redirects to `/MercadosOnline/moneda/ARSB/`; the new page has no `span.buy > div.val` (0 matches; quotes now live in embedded JSON with keys like `"Compra":1550,"Venta":1600`), so `[0]` raises IndexError on every run [FIXTURE]. Git history: "2024-07-08 Fix cronista y disable la nacion", "2024-09-03 Fix scrapers" are the last scraper commits. |
| `lanacion` | `https://www.lanacion.com.ar/tema/dolar-blue-tid67294/` | `dollar_elems = tree.xpath("//ul[contains(@class, 'dolar-subgroup')]/li/div[contains(@class, 'currency-data')]/p/strong")`; buy = `dollar_elems[2]`, sell = `dollar_elems[3]` (positions 0 and 1 are the official dollar) | `.replace('$', '').replace(',00', '').replace('.','').replace(',','.')` → text (`"$1615,05"` → `"1615.05"`, `"$1.665,00"` → `"1665"`) | **Working.** Today the XPath yields 10 nodes: `$1548,00, $1612,00, $1615,05, $1665,00, $2095,60, $1772,35, $1649,43, $1580,00, …` [FIXTURE] |

Failure behavior: any exception (network, JSON, XPath, cast) aborts that script only; no row for that source in that run; nothing is logged beyond the traceback on stdout. Its previous value stays in `dolar_latest` for up to 3 days (C.1) and silently drops out afterwards.

`src/tester.py` is a stub whose `insertBlue` only prints (a dry-run helper used by swapping the import). Stale `__pycache__` files for CPython 3.10/3.11/3.12 show the scripts were also run outside Docker.

## D.3 Refresh step

`database.py:58-65`: `REFRESH MATERIALIZED VIEW CONCURRENTLY <name>` for `dolar_latest` then `dolar_evolution`, each in a fresh connection. Readers never see an empty view. `dolar_evolution` is recomputed from the entire `dolar_values` table on every run.

## D.4 Currency refresh job

`src/entrypoint_currencies.sh` (must be started by overriding the image entrypoint; its schedule is not in the repo):

```sh
python openexchange.py          # discover new currency codes
python openexchange_values.py   # today's rates
python refresh_currencies.py    # REFRESH MATERIALIZED VIEW CONCURRENTLY currency_value_latest
```

1. `openexchange.py`: `GET https://openexchangerates.org/api/currencies.json` (no key needed) → `{code: englishName}`. For each code not in `currency_map`: `insert into currency_map (id, code, name) values (max(ID)+1, code, name)` (database.py:21-37). So **new currencies get the English name** from openexchangerates, while the 177 seeded ones have hand-written Spanish names (Appendix 1). Existing rows are never renamed or removed. No currency in today's API output has an English name.
2. `openexchange_values.py`: `GET https://openexchangerates.org/api/latest.json?app_id=<OPENEX_API_KEY>` → `r.json()['rates']` = units per **USD** (default base; no `base` or `symbols` parameter). That request shape works on the openexchangerates **Free** plan (USD base only, hourly data, 1,000 requests per month), so nothing implies a paid plan. For each `(code, rate)`: look up the id, `delete from currency_values where scraped_dt = current_date and currency_id = %s`, then insert `(current_date, id, rate)` (database.py:40-56). Idempotent per UTC day (last run of the day wins); a code missing from `currency_map` raises inside a `try` that prints `Oops! An exception has occured:` and continues. One DB connection per currency (~170 per run).
3. `refresh_currencies.py` refreshes the view (C.3).

State: the newest values correspond to about 2023-05-19, so this job has not completed since then (app id disabled, quota, or the schedule was removed; cannot tell from the repos). Initial load: `currency_values.csv` has 381,360 rows, 2,243 dates from 2014-03-01 to 2020-05-12, 166–174 currencies per date, 16 decimals in the file (rounded to 2 on load).

## D.5 How often does it run?

Not defined in any repo (the images are pushed to ECR by `redeploy.sh`; whatever schedules them lives in the cloud account). **Every 15 minutes, on the quarter hour, UTC** is the only cadence consistent with the evidence:

1. The two production timestamps available are `22:45:51.758` UTC (last blue insert) and `20:00:54.374` UTC (last alert, written about 3 s after the scrape step): both ~50 s after a quarter-hour mark, which looks like a cron-style trigger plus container start-up.
2. Friday's Oficial quote last changed at 16:46 ART = 19:46 UTC (Ámbito's own `fecha`) and closed at 1548.41 / 1601.32, yet the daily row (median of the last 49 Oficial samples) is 1543 / 1595. So fewer than 25 of the last 49 samples were taken after 19:46 UTC, i.e. fewer than 25 runs in those 179 minutes: the interval is longer than ~7.5 minutes. With quarter-hour-aligned stamps that leaves 15 minutes.
3. The alert SQL excludes "the last 15 minutes" to skip the current run, and the Twitter cooldown is 15 minutes.

That gives **52 scraping runs per trading day** (10:00, 10:15, … 22:45 UTC). Whether the container is also launched outside the window (and no-ops) is unknown; the in-code guards suggest a plain 24×7 schedule. Rough raw volume since 2020-05-18: 1,700 trading days × 52 runs × 3–4 sources ≈ 265k–354k rows in `dolar_values`.

---

# E. ALERT LOGIC (`bluescraper/src/alerts.py` → FCM push)

Runs on every container run, after the refresh. One evaluation, at most one push.

## E.1 Query (verbatim, alerts.py:10-49)

```sql
with values_blue as (
    select date_trunc('minute', scraped_at), avg(value_sell) as value
    from dolar_values
    where scraped_at > (now() - interval '6 hours')
      and scraped_at < (now() - interval '15 minutes')
      and source <> 'oficial'
    group by 1 ),
historical_value as ( select max(value) as value_max, min(value) as value_min from values_blue ),
current_value as ( select value_buy as value_current_buy, value_sell as value_current_sell
                   from dolar_latest where tipo = 'blue' ),
ranked_alertas as ( select *, row_number() over(order by alert_at desc) as rnk from alertas_dolar ),
last_alerta as ( select value_sell as value_last_alert, alert_at as alerta_at_last from ranked_alertas where rnk = 1 )
select value_current_buy, value_current_sell, value_min, value_max, value_last_alert, alerta_at_last
from current_value full join historical_value on 1=1 full join last_alerta on 1=1;
```

- `values_blue`: all non-oficial samples older than 15 minutes and newer than 6 hours, grouped per clock minute, **mean of `value_sell`** per minute (the sources of one run usually share a minute). The 15-minute cut is meant to exclude the current run.
- `value_min` / `value_max`: lowest and highest of those per-minute means (unrounded numerics). NULL when the window is empty.
- `value_current_*`: the rounded blue row of `dolar_latest` (C.1).
- `value_last_alert`, `alerta_at_last`: sell value and time of the most recent alert.

## E.2 Decision (alerts.py:52-76)

```python
now = datetime.datetime.now()                      # naive UTC
if value_min is None: value_min = 0.0
if value_max is None: value_max = 9999999999999999.0
diff_alerta = now - alerta_at_last
if diff_alerta.seconds > 10*60:                    # "at least 10 minutes since last alert"
    if float(value_current_sell) > value_max or float(value_current_sell) < value_min:
        change_perc = abs((float(value_current_sell / value_last_alert) - 1.0)*100)
        if change_perc > 0.5:
            send_alerta_mobile(value_current_sell, value_last_alert)
            cursor.execute("insert into alertas_dolar values(DEFAULT, CURRENT_TIMESTAMP, %s, %s)",
                           (value_current_buy, value_current_sell))
            connection.commit()
```

In words, an alert fires when **all three** hold:

1. Cooldown: more than 10 minutes since the last alert (but see the bug below).
2. Breakout: current blue sell (rounded median of latest) is **strictly above the max or strictly below the min** of the per-minute means in the window (6 h ago, 15 min ago).
3. Size: `|current_sell / last_alert_sell − 1| × 100 > 0.5` (strict). The comparison base is the sell value of the **last alert**, not the previous sample.

Then: push first, insert the alert row second (`alert_at = CURRENT_TIMESTAMP` UTC, with the current rounded buy and sell).

Consequences worth knowing:

- Empty window (first run of the day at 10:00 UTC; the previous samples are > 6 h old): sentinels make the breakout false, so **no alert can fire on the first run of a day**. An overnight gap is detected at 10:15 UTC at the earliest, and only if the 10:15 value is outside the 10:00 mean.
- Comparing a rounded median against unrounded means lets rounding alone satisfy "outside" (e.g. mean 1667.5, rounded median 1668).
- **`.seconds` bug** (`timedelta.seconds` is the 0–86,399 remainder, days are dropped): the test is really "(time since last alert) mod 24 h > 600 s". Within the same day it behaves as intended. On later days it additionally suppresses alerts during the 10 minutes following the last alert's time of day. With a 15-minute cadence that is at most one run per day, so the real effect is an occasional 15-minute delay, never a lost alert.
- Crashes (uncaught) if `alertas_dolar` is empty (`now - None`) or `dolar_latest` has no blue row (`float(None)`). If the push succeeds and the insert fails, the next run sends the same alert again. If the push throws, nothing is recorded and the next run retries.

Worked example = the last production alert (`/v2/alerts`): at 2026-11-20 20:00:54 UTC current blue was 1635 / 1670 and the previous alert's sell was 1658 → `|1670/1658 − 1| = 0.72 % > 0.5 %` → fired; stored as alert 1885.

## E.3 The FCM message (alerts.py:82-120)

```python
change_val  = value_current - value_prev                       # Decimals (sell values)
change_perc = (float(value_current / value_prev) - 1.0)*100
title = 'Subió el Dólar Blue' if value_current > value_prev else 'Bajó el Dólar Blue'
body  = 'Venta: {:.2f} ({}{:.2f} / {}{:.2f}%)'.format(
            value_current,
            '+' if value_current > value_prev else '', change_val,
            '+' if value_current > value_prev else '', change_perc)
```

- Up example (the last real alert): title `Subió el Dólar Blue`, body `Venta: 1670.00 (+12.00 / +0.72%)`.
- Down example (1658 → 1640): title `Bajó el Dólar Blue`, body `Venta: 1640.00 (-18.00 / -1.09%)` (the minus sign comes from the number; no explicit sign is added).
- Numbers: dot decimal separator, two decimals, no thousands separator, no currency symbol.

Message object (firebase-admin `messaging.Message`), sent with `messaging.send(msg)` using the service-account file `/bluelytics-mobile-firebase-adminsdk.json` (Firebase project id `bluelytics-mobile`):

| Field | Value |
|---|---|
| `topic` | `alertas-blue` |
| `notification.title` / `.body` | as above |
| `android.collapse_key` | `dolar-blue` |
| `android.priority` | `high` |
| `android.ttl` | `1200` seconds (20 minutes) |
| `android.notification.title` / `.body` | same strings |
| `android.notification.color` | `#221199` |
| `android.notification.channel_id` | `Dolar Blue` (with the space and capitals) |
| `apns`, `webpush`, `data` | not set |

Equivalent FCM HTTP v1 payload:

```json
{"message":{"topic":"alertas-blue",
  "notification":{"title":"Subió el Dólar Blue","body":"Venta: 1670.00 (+12.00 / +0.72%)"},
  "android":{"collapse_key":"dolar-blue","priority":"high","ttl":"1200s",
    "notification":{"title":"Subió el Dólar Blue","body":"Venta: 1670.00 (+12.00 / +0.72%)","color":"#221199","channel_id":"Dolar Blue"}}}}
```

The mobile app subscribes/unsubscribes to exactly this topic (`bluelytics_mobile_v3/screens/SettingsScreen.js:49,56`), so topic, channel id and collapse key are a contract with installed apps.

## E.4 Suggested clean restatement (if the owner accepts J6–J8 fixes)

`fire = (now − last_alert_at > 10 min) AND (|sell_now / last_alert_sell − 1| > 0.5 %) AND (sell_now outside [min, max] of blue sell over (now−6h, now−15min))`, using the same statistic on both sides (e.g. the stored per-run latest sell), record-then-send with an idempotency key, and seed an initial alert row. Volume to expect: 1,885 alerts in about 1,700 trading days, roughly one per trading day.

---

# F. SOCIAL POST LOGIC

## F.1 Price-move posts (`bluescraper/src/updates.py`)

Trigger (updates.py:153-158), evaluated once per run, in this order, each network independently:

```python
if now.weekday() < 5 and now.hour >= 13 and now.hour < 22:     # UTC → Mon–Fri 10:00–18:59 ART
    social_network_update('twitter', 15)     # cooldown minutes
    social_network_update('instagram', 60)
    social_network_update('facebook', 60)
```

(LinkedIn is not called here.) An uncaught exception in one network aborts the following ones for that run.

Query per network (updates.py:13-54, abridged to the parts that matter):

```sql
with historical_value as (
  select min(value_sell) value_min, max(value_sell) value_max
  from dolar_evolution
  where dttm > current_date - 2 and dttm < current_date and tipo = 'Blue' ),      -- = yesterday only
current_value   as ( select value_buy, value_sell from dolar_latest where tipo = 'blue' ),
current_oficial as ( select value_buy, value_sell from dolar_latest where tipo = 'oficial' ),
last_update     as ( … newest row of actualizaciones_sociales where social_network = %s → value_sell, update_at )
select value_current_buy, value_current_sell, oficial_current_buy, oficial_current_sell,
       value_min, value_max, value_last_update, update_at_last
from current_value full join current_oficial on 1=1 full join historical_value on 1=1 full join last_update on 1=1
```

Decision (updates.py:67-85):

```python
if value_min is None: value_min = 0.0
if value_max is None: value_max = 9999999999999999.0
if update_at_last is None: update_at_last = datetime.datetime(2020, 5, 17)
diff_update = now - update_at_last
if diff_update.seconds > min_alert_minutes*60:
    if float(value_current_sell) > value_max or float(value_current_sell) < value_min:
        change_perc = abs((float(value_current_sell / value_last_update) - 1.0)*100)
        if change_perc >= 0.75:
            send_update(...)
```

A post goes out for a network when all hold:

1. Cooldown since that network's last post: Twitter 15 min, Instagram 60 min, Facebook 60 min (with the `.seconds` bug: also a daily blind window of the same length starting at the last post's time of day, on every later day).
2. Current blue sell is **different from yesterday's daily Blue sell**. The "previous day's min/max" collapses to a single row because the date filter selects exactly `current_date − 1`, so `min == max == yesterday's value`; the test is "strictly above or strictly below it".
3. `|current_sell / last_posted_sell − 1| × 100 >= 0.75` (note `>=`; alerts use `> 0.5`), relative to the value stored with that network's last post.

Latent bugs: no post on Mondays (yesterday = Sunday has no row → sentinels → never "outside"); `value_last_update` NULL for a brand-new network → TypeError; a crash for Twitter blocks Instagram and Facebook.

`send_update` (updates.py:89-150):

1. `locale.setlocale(locale.LC_TIME, "es_AR.UTF-8")` (reset to `C` in `finally`).
2. `shutil.copytree('alerts', '/tmp/<network>')`, then write `/tmp/<network>/out.html` = `alerts/update_template.html` with replacements:
   - `%Blue_Compra%` → `'{:.2f}'.format(value_current_buy)` e.g. `1635.00`
   - `%Blue_Venta%` → `1670.00`
   - `%Oficial_Compra%` → `1548.00`
   - `%Oficial_Venta%` → `'{:.2f}'.format(oficial_current_sell*Decimal(1.75))` e.g. `2801.75`
   - `%FECHA%` → `datetime.datetime.now(tz=buenos_aires).strftime('%c')` e.g. `vie 20 nov 2026 16:45:55`
3. Render: `wkhtmltoimage --width W --height H /tmp/<network>/out.html /tmp/<network>.jpg`, then `jpegoptim /tmp/<network>.jpg`.

   | network | width | height | aspect |
   |---|---|---|---|
   | facebook | 960 | 720 | 4:3 |
   | instagram | 960 | 720 | 4:3 |
   | twitter | 1350 | 706 | 1.91:1 |
   | linkedin | 1200 | 628 | 1.91:1 |

4. Upload to S3: key `<network>/<YYYY-MM-DD>-<uuid4>.jpg` (UTC date), `boto3.client('s3').upload_file(outName, S3_BUCKET, key)` with no `ExtraArgs` (so no ACL and no `ContentType`; public readability must come from the bucket policy). On failure the `except ClientError` clause itself raises `NameError`.
5. Caption, with `action = "subio"` if `value_current_sell > value_last_update` else `"bajo"` (no accents) and `{:.2f}` of the blue sell:

   | network | template |
   |---|---|
   | instagram | `El Dolar Libre/Blue {} a {:.2f} \n\n\n #dolar #dolarblue #argentina #economia` |
   | facebook | `El Dolar Libre/Blue {} a {:.2f} - Visita https://bluelytics.com.ar para mantenerte al día!` |
   | twitter | same as facebook |

   Example: `El Dolar Libre/Blue subio a 1670.00 - Visita https://bluelytics.com.ar para mantenerte al día!`
6. `status = send_post(network, caption, key)` (F.3). On non-200 it only prints `Error sending update!`.
7. **Always** (even after a failed post): `insert into actualizaciones_sociales values(DEFAULT, <network>, CURRENT_TIMESTAMP, value_current_buy, value_current_sell)`. This row is both the cooldown clock and the comparison base for the next post.

## F.2 Weekly chart post (`bluescraper/src/weekly.py`)

Trigger (weekly.py:113-119): `now.weekday() == 4 and now.hour >= 21` UTC (Friday 18:00–20:59 ART), for `twitter`, `instagram`, `facebook`, `linkedin` in that order.

Per network:

1. Already sent? `select extract(days from current_timestamp - coalesce(max(sent_at), '2020-05-01')) from actualizaciones_sociales_weekly where social_network = %s`; if `< 5` → print `Already sent`, return. So one post per network per Friday, on the first run at or after 21:00 UTC.
2. Data:
   ```sql
   select dttm, extract(dow from dttm) day_of_week, value_sell
   from dolar_evolution
   where date_trunc('week', dttm) = date_trunc('week', current_date)
     and extract(dow from dttm) between 1 and 5 and tipo = 'Blue'
   order by dttm
   ```
   = this ISO week's Mon–Fri **daily Blue sell** values (whole pesos). Friday's value is the still-running median at ~21:00 UTC.
3. Derived numbers (weekly.py:39-53):
   - `arrayData = [{"x": mapDays[dow], "y": '{:.2f}'.format(value_sell)}]` with `mapDays = {1:"Lunes", 2:"Martes", 3:"Miércoles", 4:"Jueves", 5:"Viernes"}` (y is a **string**).
   - `firstRes = res[0]`, `lastRes = res[4]` (hard-coded index → IndexError with fewer than 5 rows).
   - `changeAbs = last − first`; `plusChange = '+'` if `last > first` else `''`; `changePerc = round((changeAbs / firstValue) * 100, 2)`.
   - `firstDate`, `lastDate` = `strftime('%d %b %Y')` in `es_AR` (e.g. `16 nov 2026`, `20 nov 2026`).
4. Template `weekly_chart/weekly.html` replacements: `%Value_Inicio%` (`1600.00`), `%Value_Fin%` (`1665.00`), `%Delta_Value%` (`+65.00`), `%Delta_Percent%` (`+4.06`; the template appends `%`), `%Array_Data%` (JSON array), `%Fecha_Inicio%`, `%Fecha_Fin%`.
5. Render: `wkhtmltoimage --debug-javascript --javascript-delay 2000 --width W --height H /tmp/<network>/out.html /tmp/<network>.jpg` (same size table as F.1), `jpegoptim`.
6. Upload under key `<network>/<YYYY-MM-DD>-<uuid4>.png` (the bytes are JPEG).
7. Captions:

   | network | text |
   |---|---|
   | instagram | `Evolucion Dolar Blue de esta semana! \n\n\n #dolar #dolarblue #argentina #economia` |
   | facebook | `Evolucion Dolar Blue de esta semana! - Visita https://bluelytics.com.ar para mantenerte al día!` |
   | twitter, linkedin | `Evolucion Dolar Blue de esta semana! - Visita https://bluelytics.com.ar para mantenerte al día!\n #dolar #dolarblue #argentina #economia` |

8. `send_post`, then **always** `insert into actualizaciones_sociales_weekly values(DEFAULT, <network>, CURRENT_TIMESTAMP)`.

What the image shows: header "Resumen semanal Dólar Blue" with the logo; Monday value → arrow → Friday value; one line `+65.00 (+4.06%)`; a 5-point line chart (Lunes…Viernes on the x axis, no y axis) with each value printed inside a round badge on its point; footer `https://bluelytics.com.ar - Semana 16 nov 2026 / 20 nov 2026`.

## F.3 Posting and failure handling (`bluescraper/src/buffer.py`)

```python
payload = {
  'access_token': os.environ['BUFFER_API_KEY'],
  'text': msg,
  'profile_ids[]': os.environ['SN_PROFILE_{}'.format(social_network.upper())],
  'shorten': 'false', 'top': 'true', 'now': 'true',
  'media[photo]':     'https://{}.s3-us-west-2.amazonaws.com/{}'.format(os.environ['S3_BUCKET'], img),
  'media[thumbnail]': 'https://{}.s3-us-west-2.amazonaws.com/{}'.format(os.environ['S3_BUCKET'], img) }
r = requests.post("https://api.bufferapp.com/1/updates/create.json", data=payload)
```

- Form-encoded POST to Buffer's legacy v1 API; one profile per call; `now=true` publishes immediately; Buffer fetches the image from the public S3 URL.
- **Images are hosted on S3** (bucket from `S3_BUCKET`, region `us-west-2`, virtual-hosted URL), one object per post, never deleted.
- Failure handling: if `status_code != 200` → print the response and publish to a hard-coded AWS **SNS topic** (us-west-2; it e-mails the owner) with `Subject = "New update available for <network>"` and `Message = "<caption>\n\n<image URL>"`, i.e. a manual-posting fallback. The status code is returned; callers ignore it apart from a print. No retry.

## F.4 Older generation (`bluelytics_notifiy/update.py` + `blueimg/`), for reference only

- A Python 2 Django management command, `update <twitter|facebook|instagram|all>`, with no thresholds (it posted whenever cron invoked it).
- Blue = **mean** of the latest values of sources `ambito_financiero` and `invertir_online`; Oficial sell multiplied by `Decimal(1.3)` (the 30 % tax of 2020); strings formatted `%.2f`.
- Image: `blueimg/gen_image.sh` → `gen_image.py` fills `template.html` (`%Blue_Compra%`, `%Blue_Venta%`, `%Oficial_Compra%`, `%Oficial_Venta%`, `%FECHA%` = `strftime('%c')` in `es_AR.UTF-8`) and runs `wkhtmltoimage --width 504` → `out/facebook.png` (auto height 709), `--width 528` → `out/twitter.png` (709 high), `--width 960 --height 720` → `out/instagram.png`.
- The PNGs were served from fixed URLs `http://api.bluelytics.com.ar/social_img/{twitter,facebook,instagram}.png` and posted through the same Buffer endpoint with hard-coded profile ids. Captions: Twitter `Blue a %s, visita http://www.bluelytics.com.ar`; Facebook and Instagram `Blue a %s\n\nVisita http://www.bluelytics.com.ar`.
- `template_ig_story.html` is a 1080×1920 "story" variant (doubled font sizes) that no script references; `out.html` / `out_ig.html` are leftover renders from 2020-05-03.

---

# G. WHY THE CURRENT SOCIAL IMAGES ARE "BROKEN"

Reference material: the legacy sample renders `blueimg/out/{instagram,twitter,facebook}.png` (2020-05-03, real wkhtmltoimage output of the older template), and fresh renders I made of **copies** of the current templates with Friday's numbers in headless Chrome at the configured sizes, saved in `/tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/work_backend_spec/render/` (`update_instagram.png`, `update_twitter.png`, `update_linkedin.png`, `weekly_instagram.png`, `weekly_twitter.png`, `weekly_linkedin.png`). Chrome is not wkhtmltoimage's old WebKit, so those renders show the layout and content defects, which are engine-independent; engine-specific failures are listed separately as probable.

## G.1 The baseline design (what a designer has to beat)

Price-move image (`bluescraper/src/alerts/update_template.html`, 104 lines; near-identical to `blueimg/template.html`):

- Plain **white** background, no card, no border, no shadow.
- Header, pushed left of centre (`h2.bluetitle { font-size:45px; margin-top:75px; margin-left:20% }`): the logo (`img/logo.png`, a 192×192 RGBA PNG shown at 100 px: a ribbon mark in blue `#0163A4` and green `#449F46` (shaded to `#3E9444`), the dominant colours measured from the file, resembling a butterfly/dragonfly with a small dot "head") immediately followed, with no gap, by the word "Bluelytics" in dark grey (Bootstrap text colour `#333`).
- Block 1 in indigo **`#221199`**: centred title "Dólar Blue/Libre" (45 px), then two columns "Compra" / "Venta" (25 px) with the numbers below (50 px), e.g. `1635.00` and `1670.00`.
- Block 2 in green **`#229922`**: "Dólar Oficial", "Compra" / "Venta (+75%)" (the surcharge note is Bootstrap `<small>`, grey), numbers `1548.00` and `2801.75`.
- Footer, right-aligned, 15 px italic grey: "Actualización a la fecha: vie 20 nov 2026 16:45:55." and "Para mas información visita el sitio web: www.bluelytics.com.ar".
- Typeface: `'Noto Sans Light'` (thin strokes). The older `blueimg` template used the commercial face "GT Walsheim" from local font files (`blueimg/fonts/gtwalsheim.*`; its licence status is unknown, do not carry it over without checking).
- Layout engine: Bootstrap 3.1.1 grid (`.container`, `.row`, `.col-xs-6`).

Weekly image (`bluescraper/src/weekly_chart/weekly.html`, 168 lines): white background; centred `<h2>` with a 48 px logo and "Resumen semanal Dólar Blue"; a row "start value → end value" at 2.5 em around an inline SVG arrow; a centred steelblue line `+65.00 (+4.06%)` at 2 em; a d3 v5 line chart (SVG 800×450, margins 60, steelblue 2.5 px monotone curve, white-filled point markers, weekday names on the x axis at 20 px, no y axis or grid) where each point carries a d3-annotation "badge" (radius 35, colour `#66a2e4`) containing the value; small footer text right-aligned: `https://bluelytics.com.ar - Semana 16 nov 2026 / 20 nov 2026`. Bootstrap 4.5.0, jQuery 3.2.1, d3 5.16.0, d3-annotation, all local files.

## G.2 Defects that are certain (visible in the templates/code and in the renders)

Content:

1. **Wrong headline number.** `%Oficial_Venta%` is the official sell × 1.75 with the label "(+75%)" (`updates.py:102`, template line 82). That figure (30 % + 45 % on card/savings dollars, added in the "2022-07-29 75%" commit) is obsolete: Ámbito's own "dólar turista" quote today is 2080.00 against a Banco Nación sell of 1600.00, i.e. +30 % [FIXTURE]. The image currently claims an official sell of **2801.75** beside a blue of 1670.00, while the real official sell is 1601. The older template has the same idea with "(+30%)" and ×1.3. Any redesign should show the real official quote and drop the tax line.
2. Numbers are printed as `1670.00`: redundant `.00` (values are whole pesos), dot instead of the Argentine comma, no thousands separator, no `$`.
3. Captions are unaccented and unpolished ("Dolar", "subio", "bajo", "Evolucion"); the timestamp is the raw `%c` locale string.
4. The weekly delta line has the class `positive` hard-coded (`weekly.html:77`), so a falling week is still shown in blue; the `.negative` style (orangered) is never used.

Layout and sizing:

5. **Nothing is designed for a canvas.** The price template relies on Bootstrap 3's responsive `.container` (750 px wide for viewports ≥ 768, 970 px ≥ 992, 1170 px ≥ 1200). At 960 px the content is a 750 px column; at 1350 px (Twitter) the two number columns are 585 px apart with a sea of white between them; font sizes are fixed pixels and do not scale with the canvas.
6. **Content height ≈ 710–720 px regardless of output size**, but heights are 720 (Facebook/Instagram), **706** (Twitter) and **628** (LinkedIn). wkhtmltoimage crops at `--height`: Instagram/Facebook fit with almost no bottom margin, Twitter's footer sits on the bottom edge, and at LinkedIn's height the footer is cut off completely (same for the weekly image, whose inner container is fixed at `width:960px; height:720px` in every output).
7. Weekly chart: the outer block is fixed at 960×720 and merely centred on wider canvases (blank side bands on Twitter/LinkedIn); the title touches the top edge (no top margin); the SVG is left-aligned inside its container, so the chart is visibly off-centre relative to the header; x-axis labels fall back to the browser's default sans-serif instead of the page font.
8. **Badge overflow.** The badge was sized for 2020 values like `129.23`; today's `1665.00` (7 characters, bold, 1.2 em) is wider than the filled disc, so the first and last characters spill onto the white ring and become white-on-white. The badges also sit on top of the data points and hide the line joints.
9. Header not centred while everything else is (`margin-left:20%`); logo and wordmark touch.
10. **Aspect ratios are wrong for the platforms**: Instagram gets a 960×720 landscape 4:3 image (below the 1080 px width Instagram displays, and far from the 4:5 or 1:1 formats that fill the feed); X/Twitter gets 1350×706 (1.91:1, wider than the 16:9 that X shows uncropped); LinkedIn 1200×628 with cropped content. Everything is rendered at 1× device scale, so text is soft on high-density screens.
11. Light-weight font, small labels (25 px) and a 15 px italic footer on white: poor legibility at feed-thumbnail size, and JPEG compression (wkhtmltoimage default quality, then `jpegoptim`) adds ringing around thin text. Flat-colour graphics should be PNG.

Markup and pipeline:

12. Invalid HTML: every value is `<h5 class='rate'>…</h4>` (mismatched closing tag) and block `<div class="row">` elements are nested inside inline `<span style="color:…">` wrappers; rendering then depends on parser error recovery.
13. A **remote script** is loaded at render time (`https://ajax.googleapis.com/ajax/libs/jquery/1.11.0/jquery.min.js`, template line 100) plus `js/bootstrap.min.js`; neither is needed for a static picture, and the render blocks on (or fails with) the network.
14. Weekly image: file is written as JPEG (`/tmp/<network>.jpg`) but uploaded with a `.png` key; no `ContentType` is set on any S3 upload (boto3 default is `binary/octet-stream`). Consumers that trust the extension or the header get the wrong type.
15. The older generation overwrote three fixed URLs (`/social_img/twitter.png` …), so caches and Buffer could pick up a stale image.

## G.3 Probable runtime failures with wkhtmltoimage [INFERRED, not reproducible here]

- wkhtmltoimage is an unmaintained Qt WebKit build (the Debian "buster" package installed by the Dockerfile). `weekly.html` uses ES2015+ in its inline script (arrow functions, `const`, spread `[...badgeAnnotations]`, d3 `selection.join`) and Bootstrap 4's flexbox grid. On a build with the older patched Qt 4 WebKit the script does not parse and the image has **no chart at all**, and the three-column "start → end" row stacks vertically. The presence of `--debug-javascript --javascript-delay 2000` in the command shows the author already fought JavaScript problems there.
- `font-family:'Noto Sans Light'` only resolves if `fonts-noto-extra` is present and fontconfig exposes that legacy family name; otherwise text falls back to a default serif.
- The chart is drawn by JavaScript after load; if d3 takes longer than the fixed 2-second delay the capture is taken before it is drawn.
- The Buffer step needs the S3 object to be publicly fetchable; nothing in the code sets an ACL.

## G.4 What a replacement must cover

One deterministic renderer (no browser engine quirks), per-platform canvases with correct aspect ratios and safe margins, real values only (no tax multiplier), Argentine number formatting, an explicit up/down state (colour and arrow), 2× pixel density, PNG output with correct content type, fonts bundled with a clear licence, and a brand baseline of the existing logo plus indigo `#221199` / green `#229922` (to be re-tuned for a dark theme).

---

# H. ENVIRONMENT VARIABLES AND SECRETS (names only)

## H.1 API container (`bluelytics_api`, v2.go:21-48)

| Name | Required | Purpose |
|---|---|---|
| `PG_USER` | yes | Postgres user |
| `PG_DB` | yes | database name |
| `PG_PASSWORD` | optional (appended if non-empty) | Postgres password |
| `PG_HOSTNAME` | optional | Postgres host |
| `PG_SSLMODE` | optional | libpq `sslmode` |

Fixed in code: port 5432 (default), pool `pool_min_conns=5 pool_max_conns=15`, listen address `:8080`.

## H.2 Scraper/jobs container (`bluescraper`)

| Name | Used by | Purpose |
|---|---|---|
| `PG_USER`, `PG_PASSWORD`, `PG_HOSTNAME`, `PG_DB` | `database.py:4-8` (all required; port `"5432"` hard-coded) | Postgres connection |
| `PG_SSLMODE` | present in `.env`, **not read** by the Python code | – |
| `OPENEX_API_KEY` | `openexchange_values.py:4` | openexchangerates.org App ID |
| `BUFFER_API_KEY` | `buffer.py:6` | Buffer access token |
| `SN_PROFILE_TWITTER`, `SN_PROFILE_INSTAGRAM`, `SN_PROFILE_FACEBOOK`, `SN_PROFILE_LINKEDIN` | `buffer.py:8` (`SN_PROFILE_<NETWORK>`) | Buffer profile id per network |
| `S3_BUCKET` | `updates.py:119`, `weekly.py:83`, `buffer.py:12-13,21` | bucket for post images (public URL base) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | boto3 implicit (present in `.env`) | S3 upload and SNS publish; a region must also be available to boto3 for SNS (not in `.env`) |
| `RUN_ALWAYS` | four scrapers | presence-only flag to bypass the time guard (local testing) |
| `GOOGLE_APPLICATION_CREDENTIALS` | set in `Dockerfile:21` to `/bluelytics-mobile-firebase-adminsdk.json` | Firebase service account (the code also opens that path directly, `alerts.py:97`) |
| `PYTHONUNBUFFERED` | `Dockerfile:5` | log flushing |

Secret **files**:

- `bluescraper/bluelytics-mobile-firebase-adminsdk.json`: Firebase Admin service-account key (fields `type`, `project_id`, `private_key_id`, `private_key`, `client_email`, `client_id`, `auth_uri`, `token_uri`, `auth_provider_x509_cert_url`, `client_x509_cert_url`), copied into the image at `/`.
- `bluescraper/.env`: values for all of the above.
- `bluescraper/test.py`: hard-coded app id, app secret and access token for a Graph-API style client (`Api(app_id=…, app_secret=…)`), an abandoned direct-posting experiment.
- `bluelytics_vpn/`: OpenVPN client profile, CA certificate, server and client certificates **and private keys**.
- `bluelytics_notifiy/update.py`: hard-coded Buffer profile ids; imports `buffer_accesstoken` from a `buffer_apikeys` module that is not in the repo.

Hard-coded non-secret identifiers that the rewrite replaces: the AWS account id and region in the ECR URLs (`redeploy.sh`, `README.md`), an SNS topic ARN (`buffer.py:20`), the S3 URL style `https://<bucket>.s3-us-west-2.amazonaws.com/<key>`, FCM topic `alertas-blue`, Android channel `Dolar Blue`, Firebase project `bluelytics-mobile`.

**What the rewrite still needs**: the Firebase service account (or a new key for the same project, so existing app installs keep receiving the topic), a currency-rates source key if one is used, and new credentials for whatever replaces Buffer. Everything above should be treated as compromised-by-exposure and rotated.

---

# I. PROPOSED MINIMAL DATA MODEL FOR SQLITE (Cloudflare D1) AND BACKFILL

## I.1 Design rules that preserve API-visible behavior

- Money as **integers**: raw quotes in centavos (`numeric(30,2)` × 100), published values in whole pesos. Format output from integers (A.0.2).
- Timestamps as UTC ISO-8601 text with microsecond field, e.g. `2026-11-20T22:45:51.758024Z`, so `last_update` / `alert_at` can be re-emitted in the legacy shape (A.0.3). If the runtime only has millisecond clocks, that is still inside the legacy envelope (0–6 fractional digits).
- The two API-facing tables are tiny and change at most 52 times a day, so every response body can be pre-rendered on write and served as static bytes; `?days=N` is a prefix of the row list (`ORDER BY day DESC, tipo DESC LIMIT N`).

## I.2 Schema

```sql
-- Raw samples (replaces dolar_values). Needed for: latest per source, today's last-49 median, alert window.
CREATE TABLE quote_samples (
  id          INTEGER PRIMARY KEY,
  scraped_at  TEXT    NOT NULL,          -- UTC instant
  day         TEXT    NOT NULL,          -- 'YYYY-MM-DD' trading day (legacy: UTC date; identical to ART date in the legacy window)
  source      TEXT    NOT NULL,          -- 'ambito_financiero' | 'lanacion' | 'cronista' | 'oficial' | historical ids (C.6)
  tipo        TEXT    NOT NULL CHECK (tipo IN ('Oficial','Blue')),   -- 'Oficial' iff source = 'oficial'
  buy_cents   INTEGER NOT NULL,
  sell_cents  INTEGER NOT NULL
);
CREATE INDEX quote_samples_day_tipo ON quote_samples (day, tipo, scraped_at DESC);
CREATE INDEX quote_samples_source   ON quote_samples (source, scraped_at DESC);

-- Daily series (replaces matview dolar_evolution). Serves /v2/evolution.* and /v2/historical.
CREATE TABLE daily_rates (
  day        TEXT    NOT NULL,
  tipo       TEXT    NOT NULL CHECK (tipo IN ('Oficial','Blue')),
  buy        INTEGER NOT NULL,           -- whole pesos, exactly as published
  sell       INTEGER NOT NULL,
  updated_at TEXT,                       -- newest contributing sample (NULL for API-backfilled rows)
  origin     TEXT    NOT NULL DEFAULT 'live',   -- 'backfill_api' | 'backfill_csv' | 'live'
  PRIMARY KEY (day, tipo)
) WITHOUT ROWID;

-- Current values (replaces matview dolar_latest). Serves /v2/latest and /json/last_price.
CREATE TABLE latest_rates (
  tipo       TEXT PRIMARY KEY CHECK (tipo IN ('oficial','blue')),
  updated_at TEXT    NOT NULL,
  buy        INTEGER NOT NULL,
  sell       INTEGER NOT NULL,
  euro_buy   INTEGER NOT NULL,
  euro_sell  INTEGER NOT NULL
) WITHOUT ROWID;

-- Currencies (replaces currency_map + currency_values + matview currency_value_latest).
CREATE TABLE currencies (
  code             TEXT PRIMARY KEY,     -- ISO-ish 3 letters
  name             TEXT NOT NULL,        -- Spanish display name (Appendix 1)
  value_hundredths INTEGER,              -- units per 1 USD × 100, NULL = no current value (hidden from the API)
  value_date       TEXT,
  position         INTEGER               -- output order
) WITHOUT ROWID;

-- Push alerts (replaces alertas_dolar). Serves /v2/alerts.
CREATE TABLE alerts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,   -- must continue after 1885
  alert_at TEXT    NOT NULL,
  buy      INTEGER NOT NULL,
  sell     INTEGER NOT NULL
);

-- Social posts (replaces actualizaciones_sociales and actualizaciones_sociales_weekly).
CREATE TABLE social_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  network     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('update','weekly')),
  posted_at   TEXT NOT NULL,
  buy         INTEGER, sell INTEGER,     -- blue values at post time (cooldown/threshold baseline)
  status      TEXT NOT NULL,             -- 'sent' | 'failed' | ...
  external_id TEXT, error TEXT
);
```

Optional: a `rendered_responses(key TEXT PRIMARY KEY, body BLOB, content_type TEXT, updated_at TEXT)` table or KV entries for the pre-built bodies. `quote_samples` can be pruned (only the last ~4 days are functionally required) or kept; at 52 runs × 4 sources × ~260 days it grows by about 54k small rows per year.

Per-run write path (mirrors `entrypoint.sh`): insert samples → recompute `latest_rates` (C.1) → recompute today's two `daily_rates` rows (C.2) → re-render affected bodies → evaluate alert → evaluate social posts.

## I.3 Backfill

Everything API-visible can be seeded from public data plus files already in the repos, without touching the production database:

| Target | Source | Notes |
|---|---|---|
| `daily_rates` | `GET https://api.bluelytics.com.ar/v2/evolution.json` (9,365 rows, 4,683 dates, 2011-01-03 … 2026-11-20 as of today) | Gives **byte-exact** parity for `/v2/evolution.*` and `/v2/historical`. Keep the 2013-04-05 Blue-only row and the 649 weekend dates. Take it after the last run of a trading day (after 23:00 UTC) or on a weekend so "today" is final. |
| `quote_samples` (optional, 2011-01-03 … 2020-05-12) | `bluelytics_database/initial_load/dolar.csv` (7,816 rows `day,source,buy,sell`, with cents) | Lossless for that period (C.5). Load with `scraped_at = <day>T00:00:00Z`. Not needed for the API. |
| `alerts` | `GET /v2/alerts` | Insert two rows: id 1884 with the `previous` values (its real time is unknown; use any earlier instant) and id 1885 with `current` and `alert_at` (or whatever is latest at cutover). Then the autoincrement continues at the next id and `/v2/alerts` is identical. |
| `latest_rates` | `GET /v2/latest` at cutover | Overwritten by the first scrape anyway. |
| `currencies` | names: `initial_load/currency_map.csv` (177 rows, Appendix 1); values and order: `GET /data/json/currency.json` (169 rows) until a live rates source replaces them | The legacy numeric ids are not needed (only "22 = EUR" mattered). |
| `social_posts` | none available | Seed one `update` row per network with the blue values at cutover so the 0.75 % comparison has a base. |

**What is lost by backfilling only from the public API:**

1. **Cents.** Published values are whole pesos. Cents for 2011-01-03 … 2020-05-12 survive in `dolar.csv`; cents for 2020-05-13 onward exist only in the production `dolar_values` table.
2. **Per-source and intraday detail**: about 265k–354k timestamped samples since 2020-05-18 (which source quoted what, every 15 minutes). Needed only to recompute history under a different rule, to audit a source, or to draw intraday charts.
3. **Alert history**: 1,885 alerts with timestamps and values; only the last one and its predecessor's values are public.
4. **Social post history** (`actualizaciones_sociales*`): timestamps and values of every post.
5. **Historical currency rates**: `currency_values` (daily, ~170 currencies, 2014-03-01 to ~2023-05; the repo CSV covers up to 2020-05-12). Not exposed by any endpoint.
6. `updated_at` of each daily row, and the legacy numeric currency ids. Neither is exposed.

If the owner can run one export, the only table worth pulling from production is `dolar_values` from 2020-05-13 onward (plus `alertas_dolar` for completeness); the rest is reproducible.

Cutover cautions: do it outside the scrape window (weekend or after 23:00 UTC) so no day is half-computed by each system; `*_euro` and `currency.json` values will change the moment a live EUR rate replaces the frozen 0.92; restoring a third blue source changes the published blue (median of three instead of mean of two).

---

# Appendix 1. `currency_map.csv` in full (177 rows: code, legacy id, Spanish name)

Sorted by code here for lookup (the file itself is unordered). `EUR` is id 22, the id hard-coded in `dolar_latest`. Two names contain unusual characters that must be kept byte-for-byte for parity: `TOP` uses U+02BB (ʻ) and `VES` contains a zero-width space U+200B between "soberano" and " Venezolano" (shown below as `<U+200B>`). The 8 codes marked † are absent from today's API output.

```
AED	48	Dírham de los Emiratos Árabes Unidos
AFN	64	Afgani
ALL	27	Lek
AMD	57	Dram armenio
ANG	73	Florín antillano neerlandés
AOA	13	Kwanza
ARS	160	Peso argentino
AUD	102	Dólar australiano
AWG	20	Florín arubeño
AZN	130	Manat azerbaiyano
BAM	138	Marco convertible
BBD	106	Dólar de Barbados
BDT	68	Taka
BGN	5	Lev búlgaro
BHD	163	Dinar bareiní
BIF	143	Franco de Burundi
BMD	54	Dólar bermudeño
BND	34	Dólar de Brunéi
BOB	7	Boliviano
BRL	122	Real brasileño
BSD	98	Dólar bahameño
BTC	82	Bitcoin
BTN	83	Ngultrum
BWP	9	Pula
BYN	172	Rublo bielorruso
BYR†	26	Rubla Belorrusa
BZD	93	Dólar beliceño
CAD	140	Dólar canadiense
CDF	115	Franco congoleño
CHF	24	Franco suizo
CLF	105	Unidad de fomento
CLP	112	Peso chileno
CNH	174	Yuan chino (Offshore)
CNY	150	Yuan chino
COP	84	Peso colombiano
CRC	47	Colón costarricense
CUC	169	Peso convertible
CUP	104	Peso cubano
CVE	141	Escudo caboverdiano
CZK	80	Corona checa
DJF	30	Franco yibutiano
DKK	8	Corona danesa
DOP	95	Peso dominicano
DZD	1	Dinar argelino
EEK†	49	Kroon Estoniano
EGP	4	Libra egipcia
ERN	137	Nakfa
ETB	91	Birr etíope
EUR	22	Euro
FJD	90	Dólar fiyiano
FKP	156	Libra malvinense
GBP	129	Libra esterlina
GEL	62	Lari
GGP	167	Libra de Guernsey
GHS	3	Cedi ghanés
GIP	25	Libra de Gibraltar
GMD	109	Dalasi
GNF	134	Franco guineano
GTQ	111	Quetzal
GYD	153	Dólar guyanés
HKD	23	Dólar de Hong Kong
HNL	88	Lempira
HRK	29	Kuna
HTG	70	Gourde
HUF	53	Forinto
IDR	87	Rupia indonesia
ILS	94	Nuevo shéquel israelí
IMP	168	Libra de Manx
INR	78	Rupia india
IQD	136	Dinar iraquí
IRR	149	Rial iraní
ISK	35	Corona islandesa
JEP	101	Libra de Jersey
JMD	61	Dólar jamaiquino
JOD	19	Dinar jordano
JPY	164	Yen
KES	126	Chelín keniano
KGS	159	Som
KHR	14	Riel
KMF	107	Franco comorense
KPW	66	Won norcoreano
KRW	108	Won
KWD	142	Dinar kuwaití
KYD	16	Dólar de las Islas Caimán
KZT	117	Tenge
LAK	38	Kip
LBP	10	Libra libanesa
LKR	51	Rupia de Sri Lanka
LRD	74	Dólar liberiano
LSL	55	Loti
LTL†	114	Litas Lituaniano
LVL†	157	Lats Latviano
LYD	17	Dinar libio
MAD	40	Dírham marroquí
MDL	97	Leu moldavo
MGA	72	Ariary malgache
MKD	128	Denar
MMK	123	Kyat
MNT	56	Tugrik
MOP	77	Pataca
MRO†	28	Ouguiya Mauritaniana
MRU	175	Uguiya
MTL†	154	Lira Maltesa
MUR	86	Rupia de Mauricio
MVR	132	Rufiyaa
MWK	50	Kwacha
MXN	79	Peso mexicano
MYR	15	Ringgit malayo
MZN	41	Metical mozambiqueño
NAD	2	Dólar namibio
NGN	46	Naira
NIO	37	Córdoba
NOK	76	Corona noruega
NPR	44	Rupia nepalí
NZD	155	Dólar neozelandés
OMR	121	Rial omaní
PAB	6	Balboa
PEN	92	Sol
PGK	144	Kina
PHP	42	Peso filipino
PKR	52	Rupia pakistaní
PLN	124	Złoty
PYG	125	Guaraní
QAR	59	Rial catarí
RON	161	Leu rumano
RSD	162	Dinar serbio
RUB	118	Rublo ruso
RWF	75	Franco ruandés
SAR	21	Rial saudí
SBD	65	Dólar de las Islas Salomón
SCR	139	Rupia seychelense
SDG	165	Libra sudanesa
SEK	99	Corona sueca
SGD	146	Dólar de Singapur
SHP	63	Libra de Santa Elena
SLL	151	Leone
SOS	145	Chelín somalí
SRD	103	Dólar surinamés
SSP	173	Libra sursudanesa
STD	148	Dobra de Santo Tome y Principe
STN	176	Dobra
SVC	127	Colón Salvadoreño
SYP	39	Libra siria
SZL	31	Lilangeni
THB	32	Baht
TJS	81	Somoni tayiko
TMT	85	Manat turcomano
TND	152	Dinar tunecino
TOP	131	Paʻanga
TRY	67	Lira turca
TTD	120	Dólar de Trinidad y Tobago
TWD	96	Nuevo dólar taiwanés
TZS	11	Chelín tanzano
UAH	18	Grivna
UGX	58	Chelín ugandés
USD	158	Dólar estadounidense
UYU	36	Peso uruguayo
UZS	147	Som uzbeko
VEF†	110	Bolívar Fuerte Venezolano
VES	177	Bolívar soberano<U+200B> Venezolano
VND	12	Dong vietnamita
VUV	133	Vatu
WST	135	Tala
XAF	33	Franco CFA de África Central
XAG	119	Plata (una onza troy)
XAU	166	Oro (una onza troy)
XCD	116	Dólar del Caribe Oriental
XDR	60	Derechos especiales de giro
XOF	71	Franco CFA de África Occidental
XPD	170	Paladio (una onza troy)
XPF	89	Franco CFP
XPT	171	Platino (una onza troy)
YER	69	Rial yemení
ZAR	43	Rand
ZMK†	100	Kwacha Zambiana
ZMW	113	Kwacha zambiano
ZWL	45	Dólar zimbabuense
```

---

# Appendix 2. Open questions and how each was (or was not) verified

| Topic | Status |
|---|---|
| API bodies, headers, edge cases | Verified against the 27 golden captures plus about 55 live GET/HEAD/OPTIONS probes on 2026-11-22 (all listed inline as [LIVE]). |
| View definitions and half-even rounding | Verified numerically: 5,955 / 5,955 daily rows reproduced from `dolar.csv`; `/v2/latest` reproduced to the peso from today's source pages. |
| DB/container time zone = UTC | Inferred (C.4); every available data point agrees. Not read from the DB. |
| Run cadence = 15 minutes | Inferred (D.5). The scheduler definition is not in any repo. |
| Is the container launched outside the scrape window? | Unknown; irrelevant to data. |
| Cloudflare edge TTL | Lower bound only (> 36 min). The rule set lives in the Cloudflare account. |
| Does production run exactly the checked-out code? | Scraper HEAD is the 2024-09-03 commit; API HEAD 2023-11-03. Production output is consistent with both (including the v1 bug and the dead Cronista scraper). |
| Why the currency job stopped (~2023-05) | Unknown (key, quota or schedule). |
| Do social posts still go out, and what do the latest ones look like? | Not checked (would need the Buffer account or logged-in social sessions). The code path is intact but depends on Buffer's legacy v1 API, a public S3 bucket and wkhtmltoimage. |
| Exact raw rows since 2020-05-13 | Only in the production database; estimated 265k–354k. |

Decisions the owner has to make (everything else can be implemented from this document):

1. Fix `/json/last_price` blue values (A1)? Recommended: yes, announced.
2. Keep the legacy "last 49 samples" daily rule or switch new days to the closing value (D4)? Recommended: switch, freeze history.
3. Restore a third blue source (J1)? It changes the published blue from a mean of two to a median of three.
4. Accept the visible jump in `*_euro` and `currency.json` when live rates replace the 2023 snapshot (A14, A15)? Recommended: yes.
5. Preserve `?pretty` and the unsorted currency order, or simplify (A15, A17)?
