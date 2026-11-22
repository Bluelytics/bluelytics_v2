# bluelytics_v2 — data sources: live check, extraction recipes, survey, recommendation

Observed on **Sunday 2026-11-22, 14:43–15:00 UTC (11:43–12:00 ART)**. Markets are closed, so every quote below is **Friday 2026-11-20's close**.
All requests were made with `curl` from a developer workstation in Argentina (Cloudflare edge `EZE`), **not** from Cloudflare Workers IPs. Anti-bot behaviour from Workers egress is therefore *not verified* (see §7).

Companion files:

| What | Path |
|---|---|
| Raw response fixtures (54 files) | `/tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/fixtures/sources/` |
| Runnable, dependency-free JS implementation of every recipe in §2 (verified with node 20 and bun against the fixtures) | `/tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/research/sources_recipes.mjs` |
| Live API value used for the sanity check | `/tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/golden/v2_latest.body` |

Run the recipes: `node /tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/research/sources_recipes.mjs /tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/fixtures/sources`

---

## 0. TL;DR

1. **Production is running on 2 blue sources, not 3.** `scrape_cronista.py` is **BROKEN** (El Cronista migrated to Arc XP; the legacy XPath matches 0 nodes → `IndexError`, no row inserted). The live blue value `1635 / 1670` is exactly `median{Ámbito 1655/1675, La Nación 1615.05/1665}` = `(1635.025, 1670)`.
2. **La Nación is a low-quality source**: its blue *buy* is synthetic (`1665 × 0.97 = 1615.05` exactly) and its *sell* (1665) was stale versus the other five sources checked (all 1675). With only two sources the "median" is an average, so La Nación currently drags the published blue ~20 pesos (buy) / 5 pesos (sell) below market consensus.
3. **Ámbito (blue + oficial) WORKS** unchanged, with any User-Agent or none.
4. **Currency rates are stale in production since roughly mid-2023** (`/v2/currency` returns `ARS 232.41`, `TRY 19.81`, `EGP 30.86`; today ARS ≈ 1576–1580). `oficial_euro`/`blue_euro` in `/v2/latest` are therefore computed with a ~2023 EUR rate (0.92 instead of ~0.911).
5. Five more blue sources were verified live and have working no-DOM recipes: **dolarhoy, Cronista (new markup / embedded JSON), Infobae, Infodolar**, plus aggregators **criptoya** and **dolarapi** (fallback only).
6. Official: Ámbito's "oficial" **is BCRA's "tipo de cambio minorista (promedio vendedor)"** (BCRA API variable 4 = 1601.32 = Ámbito venta 1601,32). **BNA** (1550/1600) is the other official definition and is scrapeable directly.
7. Currencies: recommended **primary = fawazahmed0 currency-api (CC0, keyless, 340 symbols, only `CLF` missing vs the legacy 169)**, **fallback = Frankfurter v2 (keyless, 200 quotes vs USD)**. `open.er-api.com` forbids redistribution, which is what `/v2/currency` does.

Values observed today (Friday close):

| Source | Blue buy | Blue sell | Source timestamp |
|---|---|---|---|
| Ámbito `/dolar/informal/variacion` | 1655,00 | 1675,00 | `20/11/2026 - 18:55` ART |
| Cronista (page + content API) | 1655 | 1675 | `/Date(1795209913970)/` = 2026-11-20 18:25:13 ART |
| La Nación | 1615,05 | 1665,00 | none exposed |
| dolarhoy | 1.655,00 | 1.675,00 | only page render time |
| Infodolar | 1.655,00 | 1.675,00 | `2026-11-20T18:00:00-03:00` |
| Infobae | 1655 | 1675 | `2026-11-20T19:05:16.000Z` (16:05 ART) |
| criptoya (aggregator) | 1655 (bid) | 1675 (ask) | poll time, not quote time |
| dolarapi (aggregator) | 1655 | 1675 | poll time, not quote time |
| dolarito (aggregator, re-publishes Ámbito) | 1655 | 1675 | 1795211700000 = Ámbito's 18:55 ART |
| **Live bluelytics `/v2/latest`** | **1635.00** | **1670.00** | `last_update 2026-11-20T19:45:51-03:00` |

| Source | Oficial buy | Oficial sell | Definition |
|---|---|---|---|
| Ámbito `/dolar/oficial/variacion` | 1548,41 | 1601,32 | average of banks (= BCRA retail average) |
| BCRA API variable 4 | — | 1601.32 | "Tipo de cambio minorista (promedio vendedor)" |
| BNA billete (`bna.com.ar/Personas`) | 1550,00 | 1600,00 | Banco Nación counter rate |
| Ámbito `/dolarnacion/variacion`, Cronista `ARS`, Infobae `ARS=BNAR`, criptoya, dolarapi | 1550 | 1600 | BNA (re-published) |
| La Nación "Dólar oficial" | 1548,00 | 1612,00 | undocumented |
| **Live bluelytics `/v2/latest`** | **1548.00** | **1601.00** | = Ámbito oficial, rounded |

---

## 1. Legacy behaviour (what must be reproduced)

### 1.1 Scraper code

All four dollar scrapers share the same guard and User-Agent:

```python
now = datetime.datetime.today()
if now.weekday() < 5 and now.hour >= 10 and now.hour < 23 or 'RUN_ALWAYS' in os.environ:
```
(`/home/sicarul/dev/bluelytics/bluescraper/src/scrape_ambito.py:4-5`, identical in `scrape_oficial.py:4-5`, `scrape_cronista.py:5-6`, `scrape_lanacion.py:5-6`.)

* `datetime.today()` is naive container-local time. The image is `python:3.8-buster` with no `TZ` set (`/home/sicarul/dev/bluelytics/bluescraper/Dockerfile:1`), i.e. **UTC**. The effective window is therefore **Mon–Fri 10:00–22:59 UTC = 07:00–19:59 ART**. This is consistent with the live `last_update` of `2026-11-20T19:45:51-03:00` (22:45 UTC, the last slot before 23:00 UTC).
* Operator precedence: `A and B and C or RUN_ALWAYS` — `RUN_ALWAYS` (a key present in `bluescraper/.env`) bypasses the window entirely.
* Public holidays are not considered.
* User-Agent sent by all four: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36`.
* `requests.get` follows redirects by default (matters for Cronista, §1.3).
* `entrypoint.sh` (`bluescraper/src/entrypoint.sh:5-8`) runs `scrape_ambito.py`, `scrape_oficial.py`, `scrape_cronista.py`, `scrape_lanacion.py` sequentially with no `set -e`: a crashing scraper does not stop the others.

| Legacy file | URL | Parse | `source` value written |
|---|---|---|---|
| `scrape_ambito.py:6-13` | `https://mercados.ambito.com/dolar/informal/variacion` | `r.json()`; `data['compra'].replace(',', '.')`, `data['venta'].replace(',', '.')` | `ambito_financiero` |
| `scrape_oficial.py:6-12` | `https://mercados.ambito.com/dolar/oficial/variacion` | same | `oficial` |
| `scrape_cronista.py:7-17` | `https://www.cronista.com/MercadosOnline/moneda.html?id=ARSB` | XPath `//span[contains(@class, 'buy')]/div[contains(@class, 'val')]` (first match) and the same with `'sell'`; text → `.replace('$','').replace(',00','').replace('.','')` → `float()` | `cronista` |
| `scrape_lanacion.py:7-17` | `https://www.lanacion.com.ar/tema/dolar-blue-tid67294/` | XPath `//ul[contains(@class, 'dolar-subgroup')]/li/div[contains(@class, 'currency-data')]/p/strong`; **positional**: `[2]` = buy, `[3]` = sell; text → `.replace('$','').replace(',00','').replace('.','').replace(',','.')` | `lanacion` |

Insert (`bluescraper/src/database.py:14`):
```sql
insert into dolar_values (scraped_at, source, value_buy, value_sell) values(current_timestamp, %s, %s, %s)
```
Table: `dolar_values(scraped_at timestamp, source varchar(20), value_buy numeric(30,2), value_sell numeric(30,2))` (`/home/sicarul/dev/bluelytics/bluelytics_database/schema/core.sql:14-19`). A row is inserted on **every run**, even when the value has not changed.

Latent legacy parsing bugs (do not port):
* Ámbito: `.replace(',', '.')` breaks if Ámbito ever adds a thousands separator (`"1.655,00"` → `"1.655.00"`). Today the dollar endpoints send `"1655,00"` (no thousands separator), but other items on the same API do use it (Merval `"2.848.945,27"` in `/home/general`).
* Cronista: integer-only assumption (`float("1655,50")` would raise).
* La Nación: positional indexes `[2]`/`[3]` silently pick a different currency if the list order changes.

### 1.2 Aggregation ("median across fresh sources")

`/home/sicarul/dev/bluelytics/bluelytics_database/schema/views.sql:9-34`:

```sql
create materialized view dolar_latest as
with rnked as (
    select *, row_number() over(partition by source order by scraped_at desc) rnk
    from dolar_values
    where scraped_at >= current_date - 3
), last_euro as (
    select value, row_number() over (order by scraped_dt desc) rnk
    from currency_values
    where currency_id = 22
)
select
  case when source = 'oficial' then 'oficial' else 'blue' end as tipo,
  max(scraped_at) as updated_at,
  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_buy))::numeric(30,2) as value_buy,
  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_sell))::numeric(30,2) as value_sell,
  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_buy)/avg(last_euro.value))::numeric(30,2) as euro_buy,
  round(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value_sell)/avg(last_euro.value))::numeric(30,2) as euro_sell
from rnked r
left join last_euro on last_euro.rnk = 1
where r.rnk = 1
group by 1;
```

Rules implied:
* One vote per `source`: its **latest row within `scraped_at >= current_date - 3`** (so a dead source keeps voting with its last value for up to 3 days, then silently disappears).
* Every source other than `'oficial'` is "blue".
* Buy and sell are aggregated independently with `PERCENTILE_CONT(0.5)` (linear interpolation: with an even number of sources it is the **mean of the two middle values**), then `round()` to an **integer**, shown as `xxxx.00`.
* Euro values = median ÷ latest `currency_values.value` for `currency_id = 22` (EUR per USD; `22,EUR,Euro` in `bluelytics_database/initial_load/currency_map.csv:35`), rounded to integer.
* `updated_at` = `max(scraped_at)` of the voting rows = time of the **last scrape run**, not of the last value change.

`dolar_evolution` (`views.sql:50-70`) is a different statistic: per calendar day and type, median over the **latest 49 rows of that day across all sources** (`rnk < 50`), again rounded to integer. Live example today: evolution for 2026-11-20 says Blue `1615 / 1665`, Oficial `1543 / 1595`, while `/v2/latest` says `1635 / 1670` and `1548 / 1601`.

### 1.3 Sanity check of legacy parsers against today's fixtures

Executed with python3 + lxml 6.1.3 (throw-away venv outside the repos), re-implementing the exact legacy expressions:

| Legacy scraper | Result on today's fixture | Verdict |
|---|---|---|
| `scrape_ambito.py` | `insertBlue('ambito_financiero', '1655.00', '1675.00')` | **WORKS** |
| `scrape_oficial.py` | `insertBlue('oficial', '1548.41', '1601.32')` | **WORKS** |
| `scrape_cronista.py` | XPath matches `buy=0 sell=0` → `IndexError: list index out of range` | **BROKEN** (markup changed; the only class containing `buy`/`sell` now is `markets-online__card markets-online__card--sell` on a `<div>`, there is no `<span class="...buy...">`) |
| `scrape_lanacion.py` | 10 `<strong>` matches: `[0]$1548,00 [1]$1612,00 [2]$1615,05 [3]$1665,00 [4]$2095,60 [5]$1772,35 [6]$1649,43 [7]$1580,00 [8]$1710,00 [9]$1790,00` → `insertBlue('lanacion', '1615.05', '1665')` | **WORKS** (indexes 2/3 are still the "Dólar blue" row) |

Cross-check with the live API (`golden/v2_latest.body`):
```json
{"oficial":{"value_avg":1574.50,"value_sell":1601.00,"value_buy":1548.00},"blue":{"value_avg":1652.50,"value_sell":1670.00,"value_buy":1635.00},"oficial_euro":{"value_avg":1712.00,"value_sell":1741.00,"value_buy":1683.00},"blue_euro":{"value_avg":1796.00,"value_sell":1815.00,"value_buy":1777.00},"last_update":"2026-11-20T19:45:51.758024-03:00"}
```
* blue buy = `round((1655.00 + 1615.05) / 2) = round(1635.025) = 1635` ✔; blue sell = `round((1675 + 1665) / 2) = 1670` ✔ → exactly two blue sources are voting (Ámbito + La Nación). Cronista has contributed nothing for at least 3 days.
* oficial = `round(1548.41) = 1548`, `round(1601.32) = 1601` ✔.
* `oficial_euro.value_buy = 1683` ⇒ `1548.41 / 1683 ≈ 0.9200` EUR per USD, which is the stale 2023 value (see §5.1), not today's ≈ 0.911.

---

## 2. Current sources — live status and NO-DOM recipes

### 2.0 How the checks were run

```bash
# "chrome" variant = legacy User-Agent
curl -sS -L --compressed --max-time 30 -D headers.txt -o <fixture> \
  -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36' \
  -w '%{http_code}|%{content_type}|%{size_download}|%{time_total}|%{num_redirects}|%{url_effective}|%{remote_ip}' '<URL>'
# "none" variant  : replace -A ... with  -H 'User-Agent:'      (header removed entirely)
# "bot" variant   : replace -A ... with  -A 'bluelytics-bot'
```
`size_download` is the compressed on-the-wire size; "decoded" is the fixture file size. The very first pass on the four legacy URLs was run without `-L` (that is how the Cronista 301 was noticed), then repeated with `-L`.

URLs requested for the four legacy sources (each with the three UA variants):
```
https://mercados.ambito.com/dolar/informal/variacion      -> fixtures/sources/ambito_informal.json
https://mercados.ambito.com/dolar/oficial/variacion       -> fixtures/sources/ambito_oficial.json
https://www.cronista.com/MercadosOnline/moneda.html?id=ARSB -> fixtures/sources/cronista.html
https://www.lanacion.com.ar/tema/dolar-blue-tid67294/     -> fixtures/sources/lanacion.html
```

| Source | HTTP | Content-Type | Wire / decoded size | Time (s) | CDN / protection seen | chrome UA | no UA | `bluelytics-bot` UA |
|---|---|---|---|---|---|---|---|---|
| Ámbito informal | 200 | `application/json` | 112 B (br) / 141 B | 0.03–0.25 | Cloudflare (`cf-cache-status: HIT`, sets `__cf_bm` + `_cfuvid` cookies = Bot Management present), `cache-control: public, max-age=30`, `x-ratelimit-limit: 100`, `access-control-allow-origin: *` | 200 | 200 | 200 |
| Ámbito oficial | 200 | `application/json` | 116 B (br) / 141 B | 0.02–0.03 | same | 200 | 200 | 200 |
| Cronista | 301 → 200 | `text/html; charset=utf-8` | 78,191 B (gzip) / 415,494 B | 0.09–0.14 | Akamai (`server: AkamaiGHost` on the 301, `x-akamai-transformed`, `server-timing: ak_p`), origin `openresty` (Arc XP), `cache-control: private, max-age=60`. No challenge, no Akamai bot cookies (`_abck`/`bm_sz`) observed | 200 | 200 | 200 |
| La Nación | 200 | `text/html; charset=utf-8` | 63,835 B (gzip) / 402,463 B | 0.07–0.71 | Akamai + `openresty` (Arc XP), `cache-control: private, max-age=60`. No challenge | 200 | 200 | 200 |

Identical bodies (same values) were returned for all three UA variants on all four sources. **No User-Agent requirement and no captcha/challenge was observed from this network.**

`robots.txt` observations:
* `https://www.ambito.com/robots.txt`: `User-agent: *` with no `Disallow` lines. `https://mercados.ambito.com/robots.txt` → HTTP 404 (a JSON error body with a PHP Slim stack trace; the backend is a Slim app, header `x-thinkindot-l3`).
* `https://www.cronista.com/robots.txt`: `Allow: /` and **`Disallow: /pf/api/v3/*`**, `/preview/*`, `/files/*`, `/engine/*`, `/portal/ajax/*`, `/tools/*` … → the HTML page is allowed; the JSON content API (§2.2 option B) is disallowed for crawlers.
* `https://www.lanacion.com.ar/robots.txt`: `/tema/...` is not disallowed; `Disallow: /pf/api/`, `/widgets/`, `/pf/resources/` etc.

### 2.1 Ámbito Financiero — blue and oficial — **WORKS**

Raw bodies (complete):

`ambito_informal.json`
```json
{"compra":"1655,00","venta":"1675,00","fecha":"20\/11\/2026 - 18:55","variacion":"2,13%","class-variacion":"up","valor_cierre_ant":"1640,00"}
```
`ambito_oficial.json`
```json
{"compra":"1548,41","venta":"1601,32","fecha":"20\/11\/2026 - 16:46","variacion":"0,75%","class-variacion":"up","valor_cierre_ant":"1589,35"}
```

Recipe:
1. `GET` the URL, `Accept: application/json`. Require HTTP 200 and a `content-type` starting with `application/json` (the 404 handler also returns JSON: `{"error":"404","trace":...}` — so also require the keys).
2. `JSON.parse`. Require `typeof compra === 'string' && typeof venta === 'string'`.
3. `buy = parseNum(compra, 'ar')`, `sell = parseNum(venta, 'ar')` (§2.5).
4. `asOf`: `fecha` matches `^(\d{2})\/(\d{2})\/(\d{4})(?:\s*-\s*|\s+)(\d{2}):(\d{2})$` (the dollar endpoints use `DD/MM/YYYY - HH:MM`; the euro endpoints use `DD/MM/YYYY HH:MM` without the dash; `riesgopais` uses `DD-MM-YYYY`). Interpret as `America/Argentina/Buenos_Aires` (fixed UTC−3) → `new Date(`${y}-${mo}-${d}T${h}:${mi}:00-03:00`)`.
5. Optional extras: `valor_cierre_ant` (previous close), `variacion` (`"2,13%"`), `class-variacion` (`up`/`down`/…).
6. Validate (§2.6).

Verified output: `{"buy":1655,"sell":1675,"asOf":"2026-11-20T21:55:00.000Z"}` and `{"buy":1548.41,"sell":1601.32,"asOf":"2026-11-20T19:46:00.000Z"}`.

Other Ámbito endpoints on the same host (all HTTP 200 with `bluelytics-bot` UA, same JSON shape, each 100–160 B on the wire; fixtures `ambito_*.json`):

| Path | Meaning | Value today (compra / venta) | `fecha` |
|---|---|---|---|
| `/dolar/informal/variacion` | blue | 1655,00 / 1675,00 | 20/11/2026 - 18:55 |
| `/dolar/oficial/variacion` | oficial (bank average = BCRA retail) | 1548,41 / 1601,32 | 20/11/2026 - 16:46 |
| `/dolarnacion/variacion` | Banco Nación | 1550,00 / 1600,00 | 20/11/2026 - 18:55 |
| `/dolar/mayorista/variacion` | wholesale | 1571,00 / 1580,00 | 20/11/2026 - 16:44 |
| `/dolarrava/mep/variacion` | MEP (extra keys `ultimo`, `valor`) | 1701,05 / 1701,05 | 20/11/2026 - 19:55 |
| `/dolarrava/cl/variacion` | CCL | 1799,14 / 1799,14 | 20/11/2026 - 19:55 |
| `/dolarcripto/variacion` | crypto dollar (updates on weekends) | 1764,01 / 1764,01 | 22/11/2026 - 11:45 |
| `/dolarturista/variacion` | tarjeta/turista (extra `valor`, `data-valor-descripcion`) | 1550,00 / 2080,00 | 20/11/2026 - 18:55 |
| `/dolarahorro/variacion` | ahorro | 1548,41 / 3202,64 | 20/11/2026 - 16:46 |
| `/dolarfuturo/variacion` | futures | 1584,00 / 1584,50 | 20/11/2026 - 17:51 |
| `/euro/informal/variacion` | blue euro | 1822,32 / 1844,34 | 20/11/2026 17:00 |
| `/euro/variacion` | official euro | 1698,09 / 1798,07 | 20/11/2026 16:49 |
| `/mercados/monedas` | **array, 9 items in one call**: Dólar BNA, Dólar Informal, Dólar Tarjeta, Dólar Importador, Dólar Mep, Dólar Mayorista, Dólar Cripto, Euro, Euro Informal (key `nombre`) — 438 B on the wire | see `ambito_mercados_monedas.json` | per item |
| `/home/general` | array, 15 items: Dólar Oficial, Dólar Informal, Dólar Tarjeta, Dólar Ahorro, Dólar Importador, Dólar Mayorista, Merval, Riesgo País, Euro, Petróleo, Soja, Maíz, Trigo, Oro, Índice Bolsa (some entries stale: Oro `03-04-2025`, Índice Bolsa `13-12-2024`) | see `ambito_home_general.json` | per item |
| `/dolar/informal/historico-general/2026-11-16/2026-11-22` | `[["Fecha","Compra","Venta"],["20/11/2026","1655,00","1675,00"],["20/11/2026","1620,00","1640,00"],["19/11/2026","1610,00","1630,00"],…]` (dates can repeat) | — | — |
| `/dolar/informal/historico-cierre` | adds `maximo`, `fecha_maximo`, `minimo`, `fecha_minimo` | — | — |
| `/dolar/informal/grafico/semanal` | `[["fecha","Dólar Informal"],["17/11/2026",1600],…]` | — | — |

`/dolares` → 404. Note `nombre` values in the arrays contain HTML entities (`"Ma&iacute;z"`, `"Petr&oacute;leo"`, `"variacion-nombre":"Variaci&oacute;n $"`).

### 2.2 El Cronista — blue — legacy **BROKEN**, source itself **WORKS** with a new recipe

What changed: the URL `…/MercadosOnline/moneda.html?id=ARSB` now answers `301 Location: https://www.cronista.com/MercadosOnline/moneda/ARSB/`, and the page is an Arc XP ("Fusion") server-rendered React page. Use the final URL directly.

**Option A (recommended, robots-allowed): the HTML page** `GET https://www.cronista.com/MercadosOnline/moneda/ARSB/`

The values appear twice in the HTML:

(a) Embedded JSON inside `<script>… Fusion.contentCache={…}`. Two occurrences (content sources `markets-list` and `markets-general`), char offsets 167,377 and 169,048 of 413,799 in the fixture:
```
"VariacionPorcentual":2.13414,"VariacionNeta":15,"Compra":1655,"Venta":1675,"Ultimo":1655,"ValorCierreAnterior":1640,"Icono":"dolar.png","Pais":"Argentina","Tipo":"","Ric":"ARSB=","UltimaActualizacion":"/Date(1795209913970)/","Nombre":"Dólar Blue","UrlId":"ARSB","Id":2,"historico":[{"Compra":1475,"Venta":1495,"Ric":"ARSB=","Fecha":"/Date(1769050800000)/","Id":1085008},{"Compra":1465,"Venta":1485,"Ric":"ARSB=","Fecha":"/Date(1769137200000)/","Id":1085187}, …
```
(the `markets-general` entry also carries `historico`: 202 daily `{Compra,Venta,Ric,Fecha,Id}` rows from 22/01/2026.)

(b) Rendered markup, char offset 68,397:
```html
<div class="markets-online__table" style="--color-accent:#30CC90"><div class="markets-online__table__header"><span class="markets-online__table__name">Dólar Blue</span><button class="markets-online__card__button false">Seguir</button></div><div class="markets-online__table__body"><div class="markets-online__card markets-online__card--sell"><div class="markets-online__card__title">Valor de venta</div><div>$<!-- --> <!-- -->1.675</div></div><div class="markets-online__card markets-online__card--percentage"><div class="markets-online__card__title">Variación</div><div>2.13<!-- -->%</div></div><div class="markets-online__card"><div class="markets-online__card__title">Valor anterior</div><div>$<!-- --> <!-- -->1.640</div></div><div class="markets-online__card"><div class="markets-online__card__title">Valor de compra</div><div>$<!-- --> <!-- -->1.655</div></div></div><div class="markets-online__table__footer"><div>Fecha y hora actualización:<!-- --> <!-- -->20/11/26 21:25</div></div></div>
```

Recipe:
1. Primary regex on the whole body (numbers are plain JSON numbers, no localisation):
   ```
   /"Compra":(\d+(?:\.\d+)?),"Venta":(\d+(?:\.\d+)?),"Ultimo":[^{}]{0,300}?"Ric":"ARSB=","UltimaActualizacion":"\\?\/Date\((\d{13})\)\\?\/"/
   ```
   group 1 = buy, group 2 = sell, group 3 = epoch **milliseconds UTC** (`1795209913970` → `2026-11-20T21:25:13.970Z` = 18:25:13 ART). The `"Ultimo"` literal right after `"Venta"` keeps the regex from matching the `historico` rows (those go `"Venta":…,"Ric":…`).
2. Fallback when (1) does not match: slice a 900-char window starting at `indexOf('<div class="markets-online__table__body">')` and apply
   ```
   sell: /Valor de venta<\/div>\s*<div>\$(?:\s|<!-- -->)*([\d.,]+)<\/div>/
   buy : /Valor de compra<\/div>\s*<div>\$(?:\s|<!-- -->)*([\d.,]+)<\/div>/
   ```
   then `parseNum(x, 'ar')` (`"1.675"` → 1675). Guard that `<span class="markets-online__table__name">Dólar Blue</span>` precedes the window.
3. Do **not** use the footer "Fecha y hora actualización: 20/11/26 21:25" as local time: it is the UTC time printed without conversion (the epoch says 18:25 ART).

Verified output: `{"buy":1655,"sell":1675,"asOf":"2026-11-20T21:25:13.970Z","via":"embedded-json"}`; forced fallback: `{"buy":1655,"sell":1675,"via":"rendered-markup"}`.

**Option B (works, but disallowed by robots.txt `Disallow: /pf/api/v3/*`): Arc content API returning pure JSON.**
```bash
curl -sS -L --compressed -A 'bluelytics-bot' \
 'https://www.cronista.com/pf/api/v3/content/fetch/markets-list?query=%7B%22tokenList%22%3A%22%5B%7B%5C%22tokenValue%5C%22%3A%5C%22ARSB%5C%22%2C%5C%22tokenType%5C%22%3A%5C%22monedas%5C%22%2C%5C%22currencySymbol%5C%22%3A%5C%22%24%5C%22%7D%5D%22%7D&_website=el-cronista'
```
i.e. `query={"tokenList":"[{\"tokenValue\":\"ARSB\",\"tokenType\":\"monedas\",\"currencySymbol\":\"$\"}]"}` (the `tokenList` value is itself a JSON string). HTTP 200, `application/json; charset=utf-8`, 335 B gzip / 457 B, 0.58–0.99 s, `cache-control: max-age=300`, worked with chrome and `bluelytics-bot` UA. Body (`cronista_api_markets_list_ARSB.json`):
```json
[{"VariacionPorcentual":2.13414,"VariacionNeta":15,"Compra":1655,"Venta":1675,"Ultimo":1655,"ValorCierreAnterior":1640,"Icono":"dolar.png","Pais":"Argentina","Tipo":"","Ric":"ARSB=","UltimaActualizacion":"/Date(1795209913970)/","Nombre":"Dólar Blue","UrlId":"ARSB","Id":2,"alternative_name":"","currency_symbol":"$","token_prefix_url":"","token_value":"ARSB","token_type":"monedas","_id":"13b79800b3a563596df7547f90dcdde3fc6cb684e5b7fb33027db716a1e102bf"}]
```
Multi-token works in one call (`cronista_api_markets_list_multi.json`). Valid `tokenValue`s seen: `ARS` (Dólar BNA 1550/1600), `ARSB` (Blue 1655/1675), `ARSMEP` (1694.4806/1700.7161), `ARSTAR` (Tarjeta 2015/2080), `ARSCONT` ("Dólar CCL (GD30, 48 hs)" 1784.83/1851.4827), `ARSTUR` (Turista 2015/2080), `ARSVHM` (Mayorista), `EUR`, `ARSBYMACCL`, `ARSBYMA`. Unknown tokens come back as stub objects without `Compra`/`Venta`/`UrlId` — filter on `UrlId`.
Because of the robots rule, treat option B as an engineering fallback that needs the owner's explicit decision, not as the default.

### 2.3 La Nación — blue — **WORKS** (but see quality caveat)

`GET https://www.lanacion.com.ar/tema/dolar-blue-tid67294/`. The values exist only in server-rendered markup (the page's `Fusion.contentCache` holds navigation only). One `<ul class="dolar-subgroup` in the page, char offset 280,215 of 401,846; the complete element (2,417 chars):

```html
<ul class="dolar-subgroup --odd --minusOne"><li><div class=" currency-data"><a href="https://www.lanacion.com.ar/dolar-hoy/" title="Dólar oficial" class="com-link link-container-currency-data"><h2 class="dolar-title --fourxs">Dólar oficial</h2></a><p class="com-text --sixxs"><span>Compra</span><strong class="--fourxs">$<!-- -->1548,00</strong><span>Venta</span><strong class="--fourxs">$<!-- -->1612,00</strong></p></div></li><li><div class=" currency-data"><a href="https://www.lanacion.com.ar/tema/dolar-blue-tid67294/" title="Dólar blue" class="com-link link-container-currency-data"><h2 class="dolar-title --fourxs">Dólar blue</h2></a><p class="com-text --sixxs"><span>Compra</span><strong class="--fourxs">$<!-- -->1615,05</strong><span>Venta</span><strong class="--fourxs">$<!-- -->1665,00</strong></p></div></li><li><div class=" currency-data"><a href="https://www.lanacion.com.ar/tema/dolar-tarjeta-tid50462/" title="Dólar tarjeta" class="com-link link-container-currency-data"><h2 class="dolar-title --fourxs">Dólar tarjeta</h2></a><p class="com-text --sixxs"><span>Venta</span><strong class="--fourxs">$<!-- -->2095,60</strong></p></div></li><li><div class=" currency-data"><a href="https://www.lanacion.com.ar/tema/dolar-ccl/" title="Dólar CCL" class="com-link link-container-currency-data"><h2 class="dolar-title --fourxs">Dólar CCL</h2></a><p class="com-text --sixxs"><span>Venta</span><strong class="--fourxs">$<!-- -->1772,35</strong></p></div></li><li><div class=" currency-data"><a href="https://www.lanacion.com.ar/tema/dolar-mep/" title="Dólar MEP" class="com-link link-container-currency-data"><h2 class="dolar-title --fourxs">Dólar MEP</h2></a><p class="com-text --sixxs"><span>Venta</span><strong class="--fourxs">$<!-- -->1649,43</strong></p></div></li><li><div class=" currency-data"><span class="com-text link-container-currency-data"><h2 class="dolar-title --fourxs">Dólar mayorista</h2></span><p class="com-text --sixxs"><span>Venta</span><strong class="--fourxs">$<!-- -->1580,00</strong></p></div></li><li><div class=" currency-data"><a href="https://www.lanacion.com.ar/tema/euro-hoy-tid66142/" title="Euro" class="com-link link-container-currency-data"><h2 class="dolar-title --fourxs">Euro</h2></a><p class="com-text --sixxs"><span>Compra</span><strong class="--fourxs">$<!-- -->1710,00</strong><span>Venta</span><strong class="--fourxs">$<!-- -->1790,00</strong></p></div></li></ul>
```

Recipe (label-anchored, replaces the fragile positional `[2]`/`[3]`):
1. `win = html.slice(i, i + 3000)` with `i = html.indexOf('<ul class="dolar-subgroup')`; fail if `i < 0`.
2. Regex on `win`:
   ```
   /<h2[^>]*>D[oó]lar blue<\/h2>[\s\S]{0,200}?<span>Compra<\/span><strong[^>]*>\$(?:<!-- -->)?([\d.,]+)<\/strong><span>Venta<\/span><strong[^>]*>\$(?:<!-- -->)?([\d.,]+)<\/strong>/
   ```
   group 1 = buy, group 2 = sell → `parseNum(x, 'ar')`. (`$<!-- -->1615,05`: the `<!-- -->` is a React text-node separator; make it optional.)
3. No timestamp is available → `asOf = null`.
4. Same pattern with `D[oó]lar oficial` gives 1548 / 1612; single-value rows (`<span>Venta</span>` only) for `D[oó]lar tarjeta` 2095.6, `D[oó]lar CCL` 1772.35, `D[oó]lar MEP` 1649.43, `D[oó]lar mayorista` 1580.

Verified output: `{"buy":1615.05,"sell":1665,"asOf":null}`.

Quality caveats (observed today):
* Buy is derived: `1665,00 × 0.97 = 1615,05` exactly — a fixed 3 % spread, not a surveyed quote. Every other source shows a 20-peso spread (1655/1675).
* Sell 1665 ≠ 1675 shown by Ámbito, Cronista, dolarhoy, Infodolar, Infobae, criptoya, dolarapi. Infobae's hourly series for 20/11 shows 1665 was the value at 17:00 UTC (14:00 ART) and 1675 from 19:00 UTC: La Nación's figure looks like a lagging intraday value.
* No timestamp → staleness cannot be detected from the source itself.

### 2.4 Summary of the four legacy sources

| Source | Today | Why / action |
|---|---|---|
| Ámbito informal (`ambito_financiero`) | **WORKS** | keep; JSON recipe §2.1 |
| Ámbito oficial (`oficial`) | **WORKS** | keep; JSON recipe §2.1 |
| Cronista (`cronista`) | **BROKEN in legacy code** (XPath matches nothing after the Arc XP migration; also a 301 to a new URL) | source is alive; new recipe §2.2 |
| La Nación (`lanacion`) | **WORKS** | new label-anchored recipe §2.3; demote in the consensus (§4) |

### 2.5 Number normalisation (shared)

Do not auto-detect the format; each recipe declares it.

```ts
/** 'ar': Argentine format ('.' thousands, ',' decimals)  "$ 1.655,00" | "1548,41" | "$1.675" | "$<!-- -->1615,05"
 *  'en': '.' decimals, no thousands separator             "1571.0000" (BNA divisas table)                         */
export function parseNum(raw: string, fmt: 'ar' | 'en'): number {
  let s = String(raw).replace(/<!--[\s\S]*?-->/g, '').replace(/&nbsp;/g, '').replace(/[^\d.,-]/g, '');
  if (fmt === 'ar') s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`unparseable number: ${JSON.stringify(raw)}`);
  return Number(s);
}
```
Unit cases verified: `"$ 1.655,00"`→1655, `"1548,41"`→1548.41, `"$1.675"`→1675, `"$<!-- -->1615,05"`→1615.05, `"24600,00"`→24600, `"1.234.567,89"`→1234567.89 (all `'ar'`); `"1571.0000"`→1571 (`'en'`).
JSON-number sources (Cronista JSON, Infobae, criptoya, dolarapi, BCRA) need no normalisation — use `Number` and `Number.isFinite`.
Store what the source says (2 decimals); rounding to integers happens only in the consensus step (legacy `round()` in SQL).

### 2.6 Validation bounds (shared)

Per observation `{buy, sell}`:
* both finite, `> 0`; hard sanity range `100 < x < 1_000_000` (configurable; today's level is ~1,500–1,700);
* `sell >= buy`;
* relative spread `(sell − buy) / sell <= 0.10` (observed today: blue 1.2 %, La Nación 3.0 %, BNA 3.1 %, Ámbito oficial 3.3 %; single-value types such as MEP/CCL have spread 0);
* jump guard versus the last **published** consensus for the same type: reject the observation (keep it in the raw log, flag it) if `|x − last| / last > 0.15`; if **all** fresh sources agree on the jump, accept it (genuine devaluation days do happen) and raise an alert;
* cross-type guard: `blue.sell >= 0.8 × oficial.sell` (blue has been close to or above official; a blue far below official means a mis-labelled row).

A parse failure, a non-200, a non-JSON body for JSON sources, a missing anchor, or a failed validation = "source failed this run". Never write a fallback value of 0 or reuse a partially parsed pair.

### 2.7 Scanning large HTML cheaply in a Worker

Bodies are 100 KB–760 KB decoded. The verified approach is `const html = await res.text()`, then `indexOf(anchor)` → `slice` a 0.6–3 KB window → run the regex on the window only. Measured in node 20 on the fixtures: 0.2–2.7 ms per source (window variants 0.2–1.0 ms). Anchor offsets in today's fixtures (useful for an optional streaming reader that cancels the body early): La Nación 280,215 / 401,846 chars; Cronista markup 68,397 and JSON 167,377 / 413,799; dolarhoy 102,548 / 126,823; Infodolar ≈ 43,500 / 101,953; Infobae 103,635 / 763,073; BNA 38,165 / 115,665.
`HTMLRewriter` is a valid alternative for La Nación / dolarhoy / Infodolar / BNA (element + text handlers), but it cannot read the Cronista/Infobae embedded-JSON scripts as conveniently as a regex, and regex recipes are unit-testable in plain node against the fixtures.

---

## 3. Additional candidate sources (all checked live today)

Unless stated, requests used `-A 'bluelytics-bot'`; the HTML sources were also retried with the chrome UA and with no UA, with identical status.

### 3.1 Primary / editorial sources for the blue

#### dolarhoy.com — **WORKS**, primary-like (own tables)
* `GET https://dolarhoy.com/cotizaciondolarblue` → 200 `text/html`, 28,565 B (zstd) / 126,944 B, 0.05–0.24 s. Cloudflare (`cf-cache-status: HIT`, `cache-control: public, s-maxage=60, …`), `x-powered-by: Express`. 200 with all three UA variants. Fixture `dolarhoy_blue.html`; home page `dolarhoy_home.html` (293,806 B).
* robots.txt (`# Last updated: 24/10/2025`): `Allow: /`, `Disallow: /buscar/, /i/cotizaciones/, /registro, /iframeElecciones, /service/, /*.pdf$, /*?utm_*`, **`Crawl-delay: 10`**. The blue page is allowed; one request per scrape run respects the delay.
* Snippet (offset 102,548):
  ```html
  <div class="tile cotizacion_value"><div class="tile is-parent is-4"><div class="tile is-child title">Dólar Libre</div></div><div class="tile is-parent is-8"><div class="tile is-child"><div class="topic">Compra</div><div class="value">$1.655,00</div></div><div class="tile is-child"><div class="topic">Venta</div><div class="value">$1.675,00</div></div></div></div><div class="tile update"><div class="tile is-parent"><div class="tile is-child"><span>Actualizado por última vez: 22/11/26 11:44 AM</span></div></div></div>
  ```
* Recipe: window of 600 chars from `indexOf('<div class="tile cotizacion_value">')`; regex
  ```
  /<div class="topic">Compra<\/div>\s*<div class="value">\$?\s*([\d.,]+)<\/div>[\s\S]{0,160}?<div class="topic">Venta<\/div>\s*<div class="value">\$?\s*([\d.,]+)<\/div>/
  ```
  → `parseNum(x,'ar')`. Verified: `{"buy":1655,"sell":1675}`.
* "Actualizado por última vez: 22/11/26 11:44 AM" is the **page render time** (it showed the current minute on a Sunday) → not a quote timestamp; set `asOf = null`.
* Home page also has Dólar Oficial `$1.550 / $1.600` (BNA-like), MEP, CCL, "Dólar Digital (USDC)", Tarjeta `$2.080` inside `class="titleText"` blocks (layout differs per block; write separate recipes if wanted).

#### infodolar.com — **WORKS**, claims own survey
* `GET https://www.infodolar.com/cotizacion-dolar-blue.aspx` → 200 `text/html`, 14,393 B (zstd) / 103,760 B, 0.19–0.50 s. Cloudflare in front of ASP.NET (`x-powered-by: ASP.NET`, `cf-cache-status: DYNAMIC`, `cache-control: private`, sets `ASP.NET_SessionId`). 200 with all three UA variants. Fixture `infodolar_blue.html`.
* robots.txt: only Cloudflare's "content signals" comment preamble, no directives seen.
* Snippet (table `id="CompraVenta"`, first data row):
  ```html
  <table class="cotizaciones" id="CompraVenta">
      <thead> … <th class="dolar-blue">Compra</th> <th class="dolar-blue">Venta</th> … </thead>
          <tr>
              <td class="colNombre">
                  <span class="nombre"><a href="/cotizacion-dolar-blue.aspx">Dólar Blue</a></span>
              </td>
              <td class="colCompraVenta" data-order="$ 1.655,00">
                  $ 1.655,00
                  <span class="variacionCompraVenta"><span class="alza"><i class="fa fa-arrow-up"></i> $ 35,00</span></span>
              </td>
              <td class="colCompraVenta" data-order="$ 1.675,00">
                  $ 1.675,00
                  <span class="variacionCompraVenta"><span class="alza"><i class="fa fa-arrow-up"></i> $ 35,00</span></span>
              </td>
              <td class="colVariacion" data-order="0,0213414634146341463414634146">
                  <span class="variacion"><span class="alza"><i class="fa fa-arrow-up"></i> 2,13 %</span></span>
              </td>
              <td class="colSpread">
                  $ 20,00
              </td>
              <td class="colFecha">
                  <abbr class="timeago date" itemprop="datePublished" datetime="2026-11-20T18:00:00-03:00" title="2026-11-20T18:00:00-03:00">viernes, 20 de noviembre de 2026 18:00 Argentina</abbr>
              </td>
          </tr>
  ```
* Recipe: window of 3,000 chars from `indexOf('<table class="cotizaciones" id="CompraVenta">')`; regex
  ```
  /<a href="\/cotizacion-dolar-blue\.aspx">D[oó]lar Blue<\/a>[\s\S]{0,400}?class="colCompraVenta" data-order="\$?\s*([\d.,]+)"[\s\S]{0,600}?class="colCompraVenta" data-order="\$?\s*([\d.,]+)"[\s\S]{0,1500}?datetime="([^"]+)"/
  ```
  group 1 buy, 2 sell (`'ar'`), 3 ISO timestamp with offset. Verified: `{"buy":1655,"sell":1675,"asOf":"2026-11-20T21:00:00.000Z"}`.
* Same page also lists per-entity rows (Nexo 1.661,31/1.694,87, Global66) and a per-province blue table `id="cotizacionesBlueProvincias"` (24 provinces, e.g. Córdoba 1.660/1.692, Tierra del Fuego 1.655/1.701) plus a row "Relevamiento propio 1.655,00 / 1.675,00" — possible future feature ("blue por provincia").

#### infobae.com — **WORKS** (embedded JSON, real timestamp, hourly series)
* `GET https://www.infobae.com/economia/divisas/dolar-libre/` → 200 `text/html`, 106,345 B (gzip) / 763,452 B, 0.07–0.28 s. Akamai + Arc XP (`x-akamai-transformed`, `server: openresty`, `cache-control: private, max-age=60`). robots.txt: only `Disallow: /buscador`. Fixtures `infobae_dolar_libre.html`, `infobae_dolar_hoy.html` (hub `https://www.infobae.com/economia/divisas/dolar-hoy/`, same data).
* Snippet (first of 5 identical occurrences, offset 103,635; it is the cached response of their internal `https://currencies-data.infobae.com/timeSeriesV2` POST):
  ```
  "ric":"ARSB=","sellValue":1675,"buyValue":1655,"closeValue":1675,"diff":0,"utcDate":"2026-11-20T19:05:16.000Z","series":[{"x":"2026-11-20T14:00:00+00:00","y":1640,"z":1620},{"x":"2026-11-20T15:00:00+00:00","y":1640,"z":1630},{"x":"2026-11-20T16:00:00+00:00","y":1650,"z":1635},{"x":"2026-11-20T17:00:00+00:00","y":1665,"z":1645},{"x":"2026-11-20T18:00:00+00:00","y":1670,"z":1650},{"x":"2026-11-20T19:00:00+00:00","y":1675,"z":1655},{"x":"2026-11-20T20:00:00+00:00","y":1675,"z":1655}]
  ```
  (`y` = sell, `z` = buy per hour.) The summary list item `{"ric":"ARSB=","title":"Dólar blue","order":3,"buy":"","sell":1675,…}` has an **empty buy** — do not use it.
* Recipe (whole body or any window containing it):
  ```
  /"ric":"ARSB=","sellValue":(\d+(?:\.\d+)?),"buyValue":(\d+(?:\.\d+)?),"closeValue":[^,{}]*,"diff":[^,{}]*,"utcDate":"([^"]+)"/
  ```
  group 1 = **sell**, group 2 = **buy** (note the order), group 3 = ISO UTC. Verified: `{"buy":1655,"sell":1675,"asOf":"2026-11-20T19:05:16.000Z"}`.
* Other RICs in the same page with the same shape: `ARS=BNAR` (BNA 1550/1600), `ARSVHM=BNAR` (mayorista 1571/1580), `ARSMEP=` (1694.4806/1700.7161), `ARUSDCEDEAR=` (CCL 1789.238/1794.1839), `ARST=`/`ARSTAR=` (tarjeta 2015/2080), and FX pairs (`EUR=X`, `BRL=X`, …).
* **Independence flag:** Infobae and Cronista both key the blue as RIC `ARSB=` and agree to the decimal on MEP (1694.4806/1700.7161) → same market-data vendor feed. Count them as **one** vote.

### 3.2 Aggregators (fallback only — they re-publish the above)

| Source | URL | Result today | Notes |
|---|---|---|---|
| **criptoya** | `https://criptoya.com/api/dolar` | 200 `application/json`, 466 B / 1,721 B, 0.03 s, Cloudflare HIT, `cache-control: max-age=30, public, no-store`, `x-ratelimit-limit: 120`, `x-ratelimit-remaining: 119`, CORS `*`. robots: `Disallow:` (empty). Keyless. | `blue: {ask:1675, bid:1655, variation:2.13, timestamp:1795357439}` — **ask = venta/sell, bid = compra/buy**; `timestamp` is epoch **seconds** of their last poll (2026-11-22T14:23:59Z on a Sunday), not the quote time. Also `oficial {price, ask:1600, bid:1550}`, `mayorista {price:1580}`, `ahorro`, `tarjeta {price:2080}`, `cripto.{ccb,usdt,usdc}.{ask,bid}`, `mep.{al30,gd30,letras,bpo27}.{24hs,ci}.price`, `ccl.{…}`. **Stale sub-series present**: `mep.gd30` timestamp 1782504011 = 2026-06-26 → always check per-leaf timestamps; use `al30`. Blue provenance not stated in the payload. Fixture `criptoya_dolar.json`. |
| **dolarapi.com** | `https://dolarapi.com/v1/dolares`, `/v1/dolares/blue`, `/v1/dolares/oficial`, `/v1/ambito/dolares` | 200 `application/json`, 310 B / 1,223 B, 0.04 s, Cloudflare DYNAMIC, `cache-control: public, max-age=0, must-revalidate`, CORS `*`. robots: `Allow: /`. Keyless. Docs: "proyecto de código abierto que brinda datos de fuentes públicas", "Licencia MIT". | `/v1/dolares`: array of `{moneda:"USD", casa, nombre, compra, venta, fechaActualizacion}` for `oficial` 1550/1600, `blue` 1655/1675, `bolsa` 1682.6/1743.1, `contadoconliqui` 1801.4/1806.2, `mayorista` 1571/1580, `cripto` 1761.75/1768.85, `tarjeta` 2015/2080. `/v1/ambito/dolares` is an explicit **re-publication of Ámbito** (`oficial` 1548.41/1601.32, `blue`, `bolsa` 1701.05, `contadoconliqui` 1799.14, `mayorista`, `cripto`, `tarjeta`, `bna`, plus `variacion`). **Timestamps are unreliable**: blue says `2026-11-22T11:59:00.000Z` on a Sunday (poll time), and Ámbito-derived rows carry Ámbito's ART wall-clock time labelled `Z` (`2026-11-20T18:55:00.000Z` for a quote Ámbito stamps 18:55 ART). Fixtures `dolarapi_*.json`. |
| **argentinadatos.com** | `https://api.argentinadatos.com/v1/cotizaciones/dolares/blue` and `…/blue/2026/11/20` | 200 `application/json`, 25,257 B / 527,205 B (5,803 daily rows since 2011-01-03), 0.30 s, Cloudflare, `cache-control: public, max-age=60`, CORS `*`. Keyless, "gratuita y sin límites", MIT. | Daily history only: `{casa:"blue", compra, venta, fecha}`. **Not a close series**: `2026-11-20` → 1620/1640 (the morning value = previous close per Ámbito's `valor_cierre_ant` 1640), while Friday's close 1655/1675 appears under `2026-11-21` and `2026-11-22`. Useful for back-fill cross-checks only, with a one-day shift caveat. Fixtures `argentinadatos_*.json`. |
| **dolarito.ar** | `https://www.dolarito.ar/` | Home 200, 76,748 B / 903,075 B, Cloudflare. `https://www.dolarito.ar/api/frontend/quotations/dolar` → **403 "Attention Required! \| Cloudflare" ("Sorry, you have been blocked")** with the bot UA; robots.txt `Disallow: /api/`. | Data is embedded only as an escaped Next.js RSC payload: `\"informal\":{\"name\":\"dolar blue\",\"buy\":1655,\"sell\":1675,\"timestamp\":1795211700000,\"variation\":2.13,…}`. The timestamp (2026-11-20T21:55:00Z = 18:55 ART) and variation (2.13) are identical to Ámbito's → **re-publisher of Ámbito**. Hashed Chakra CSS classes, 900 KB page, blocked API. **Do not use.** Fixture `dolarito_home.html`. |
| monedapi.ar | `https://monedapi.ar/api/usd/bna` | 200 JSON: `{"moneda":"USD","nombre":"Dólar Banco Nación","origen":"BNA","compra":1550,"venta":1600,"actualizado":"2026-11-20T16:10:56.940-03:00"}` | Aggregator of BNA; not surveyed further. |
| comparadolar.ar | `https://api.comparadolar.ar/usd` | 200 JSON, array of bank/fintech quotes `{slug, bid, ask, usdType:"Oficial"\|"CCL"…, lastSeenAt, stale}` (logos hosted on argentinadatos) | Not blue; possible future "where to buy official dollars" feature. |
| bluelytics itself | `https://api.bluelytics.com.ar/v2/latest` | 200 | Any aggregator that re-publishes bluelytics would create a feedback loop; none of the ones above showed bluelytics' distinctive 1635/1670 today. |

Other probes, for the record: `https://www.dolarsi.com/api/api.php?type=valoresprincipales` and `https://www.paralelohoy.com.ar/` → DNS does not resolve; `https://www.clarin.com/economia/divisas-acciones-bonos.html` → 404; `https://www.pagina12.com.ar/cotizacion-dolar` → 404; `https://www.perfil.com/seccion/dolar-hoy` → 410; `https://www.rava.com/cotizaciones/dolares` → 200 but none of today's values in the static HTML (client-rendered); `https://www.iprofesional.com/dolar-hoy`, `https://www.cotizacion-dolar.com.ar/`, `https://www.finanzasargy.com/`, `https://www.valordolarblue.com.ar/` → 200, not analysed further (unknown provenance, low value).

### 3.3 Official rate sources

#### Banco Nación (BNA) — **WORKS**, PRIMARY for the BNA counter rate
* `GET https://www.bna.com.ar/Personas` → 200 `text/html; charset=utf-8`, **115,665 B uncompressed** (no `content-encoding` even with `--compressed`), fronted by **F5 Distributed Cloud** (`Server: volt-adc`, `x-volterra-location: b-sp4-sao`, cookies `TS01dc4fc6`, `BNA_Cookie`, `_AnonId_`). 200 with all three UA variants. robots.txt: `User-agent: *` / `Allow: /`.
* **Latency is erratic**: 19.1 s on the first request (`x-envoy-upstream-service-time: 12423`), then 0.5–1.3 s. Use a ≥ 20 s timeout and treat BNA as best-effort.
* Snippet (offset 38,165; whitespace collapsed):
  ```html
  <div class="tab-pane fade in active" id="billetes">
      <table class="table cotizacion">
          <thead>
              <tr>
              <th class="fechaCot">20/11/2026</th>
              <th>Compra</th>
              <th>Venta</th>
              </tr>
          </thead>
          <tbody>
                  <tr>
                  <td class="tit">Dolar U.S.A</td>
                  <td>1550,00</td>
                  <td>1600,00</td>
                  </tr>
                  <tr>
                  <td class="tit">Euro</td>
                  <td>1695,00</td>
                  <td>1805,00</td>
                  </tr>
                  <tr>
                  <td class="tit">Real *</td>
                  <td>24600,00</td>
                  <td>27600,00</td>
                  </tr>
          </tbody>
          </table>
          <a href="#" class="link-cotizacion" data-toggle="modal" data-target="#modalHistorico" id="buttonHistoricoBilletes" >Ver histórico</a>
          <div class="legal">Hora Actualización: 17:03</div>
          <div class="legal">(*) cotización cada 100 unidades.</div>
  </div>
  <div class="tab-pane fade" id="divisas">
      <table class="table cotizacion"> … <td class="tit">Dolar U.S.A</td> <td>1571.0000</td> <td>1580.0000</td> …
  ```
* Recipe (billetes = retail): window of 2,500 chars from `indexOf('id="billetes"')`; regex
  ```
  /id="billetes"[\s\S]{0,400}?<th class="fechaCot">(\d{1,2})\/(\d{1,2})\/(\d{4})<\/th>[\s\S]{0,400}?<td class="tit">Dolar U\.S\.A<\/td>\s*<td>([\d.,]+)<\/td>\s*<td>([\d.,]+)<\/td>[\s\S]{0,1500}?Hora Actualizaci[oó]n:\s*(\d{1,2}):(\d{2})/
  ```
  groups: day, month, year, buy, sell (`'ar'`), hour, minute (ART). Verified: `{"buy":1550,"sell":1600,"asOf":"2026-11-20T20:03:00.000Z"}`.
* Divisas tab (wholesale-type "divisa" rate) uses **`'en'` format with 4 decimals**: `/id="divisas"[\s\S]{0,900}?<td class="tit">Dolar U\.S\.A<\/td>\s*<td>([\d.]+)<\/td>\s*<td>([\d.]+)<\/td>/` → 1571 / 1580 (equals the mayorista quote). The small fragment `https://www.bna.com.ar/Cotizador/MonedasHistorico` (2,696 B, fixture `bna_monedas_historico.html`) contains only the divisas table (`<td class="dest">1571.0000</td>`).
* "Real *" is quoted per 100 units; Euro billete 1695/1805.

#### BCRA public API — **WORKS**, PRIMARY for reference/wholesale and for the retail average (sell side only)
* Host `api.bcra.gob.ar`, Cloudflare (`__cf_bm` cookie), keyless, JSON, TLS verified fine with default curl. `https://api.bcra.gob.ar/robots.txt` → 404.
* `GET https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/4?limit=1` → 200, 147 B on the wire, 0.06–0.10 s:
  ```json
  {"status":200,"metadata":{"resultset":{"count":4008,"offset":0,"limit":1}},"results":[{"idVariable":4,"detalle":[{"fecha":"2026-11-20","valor":1601.32000000000}]}]}
  ```
  Variable **4** = "Tipo de cambio minorista (promedio vendedor)" → **1601.32 = Ámbito oficial `venta` 1601,32**; the previous day (1589.35) equals Ámbito's `valor_cierre_ant`. So Ámbito's "oficial" is this BCRA statistic. Only the *sell* average is in the API (no buy).
* `…/Monetarias/5?limit=1` → variable **5** = "Tipo de cambio mayorista de referencia" (Com. A 3500): `{"fecha":"2026-11-20","valor":1575.95720000000}`.
* Range form used: `…/Monetarias/4?desde=2026-11-13&hasta=2026-11-22` (newest first). Catalog `…/v4.0/Monetarias` (4,022 variables, paginated `offset`/`limit` ≤ 1000); other FX-related ids seen: 84 "Tipo de cambio de valuación contable".
* **`v3.0` and `v2.0` are gone**: `…/estadisticas/v3.0/Monetarias` → HTTP 410 `{"status":410,"errorMessages":["Método correspondiente a la v3 ha sido deprecado."]}`; `…/v2.0/PrincipalesVariables` → 410. Expect version churn; pin `v4.0` behind a config value.
* `GET https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones` → 200, date `2026-11-20`, 39 currencies `{codigoMoneda, descripcion, tipoPase, tipoCotizacion}`: `USD` 1580.0, `REF` ("DOLAR REFERENCIA COM 3500") 1575.9572, `EUR` 1733.734, `BRL` 265.975355. `…/Cotizaciones/USD?fechadesde=2026-11-13&fechahasta=2026-11-22` gives the daily series (1580, 1565, 1559.5, 1552, 1551, …). `…/Maestros/Divisas` lists codes.
* Cadence: one value per business day, published after the close (the API already had 2026-11-20 on Sunday; intraday availability not observed).
* Fixtures `bcra_*.json`.

#### Others
* Ámbito `/dolarnacion/variacion` (BNA 1550/1600), `/dolar/mayorista/variacion` (1571/1580) — re-publications of BNA / wholesale, convenient because they share Ámbito's tiny JSON format.
* Cronista token `ARS` ("Dólar BNA", RIC `ARS=BNAR`) and Infobae `ARS=BNAR` — BNA re-published.

---

## 4. Recommended source set and consensus rules

### 4.1 Blue (informal)

| Prio | Source | Role | Format | Timestamp | Independence |
|---|---|---|---|---|---|
| 1 | **Ámbito** `/dolar/informal/variacion` | voter | JSON 141 B | yes (`fecha`, ART) | own survey; the de-facto market reference (aggregators copy it) |
| 2 | **dolarhoy** `/cotizaciondolarblue` | voter | HTML 127 KB | no | own tables |
| 3 | **Cronista** page `/MercadosOnline/moneda/ARSB/` | voter (vendor group "ARSB=") | HTML 415 KB, embedded JSON | yes (epoch ms) | vendor feed shared with Infobae |
| 3b | **Infobae** `/economia/divisas/dolar-libre/` | hot standby for #3 (votes only if Cronista failed) | HTML 763 KB, embedded JSON | yes (ISO UTC) | same vendor feed as Cronista |
| 4 | **Infodolar** `/cotizacion-dolar-blue.aspx` | voter | HTML 104 KB | yes (ISO with offset) | "Relevamiento propio" |
| 5 | **La Nación** `/tema/dolar-blue-tid67294/` | reserve voter (only when fewer than 3 voters are fresh) | HTML 402 KB | no | synthetic buy (sell × 0.97), lagging |
| 6 | **criptoya** `/api/dolar`, **dolarapi** `/v1/dolares/blue` | last-resort (only when fewer than 2 of the above are fresh; together they count as one vote) | JSON | poll time only | aggregators |

That is 4 independent votes in normal operation (Ámbito, dolarhoy, Cronista|Infobae, Infodolar). Today all four say 1655 / 1675.

**Consumer-visible effect at cut-over:** the published blue would move from `1635 / 1670` (legacy 2-source average distorted by La Nación) to `1655 / 1675`. That is a correction, but it is a visible step in the series; decide whether to announce it. If strict continuity with the legacy number is preferred for the first days, keep La Nación as a full voter — with 5 voters the median is still 1655/1675, so the step happens anyway as soon as Cronista is fixed.

### 4.2 Official

"Oficial" is a defined quantity, not a market consensus; mixing definitions in a median produces a hybrid series. Use a **priority chain with cross-validation**, not a median:

| Prio | Source | What it is | Use |
|---|---|---|---|
| 1 | **Ámbito** `/dolar/oficial/variacion` | bank average = BCRA "minorista" (buy and sell) | publish (continuity with the legacy `oficial` series: 1548.41/1601.32 → 1548/1601) |
| 2 | **BNA** `https://www.bna.com.ar/Personas` (billetes) | Banco Nación counter rate, 1550/1600 | publish if #1 failed or is stale; always scrape for cross-validation |
| V1 | **BCRA** `…/v4.0/Monetarias/4?limit=1` | retail average, sell only (1601.32) | validator: once the day's value exists, `|ambito.sell − bcra.valor| <= 0.5 %` |
| V2 | Ámbito `/dolarnacion/variacion`, Cronista `ARS`, Infobae `ARS=BNAR`, criptoya `oficial`, dolarapi `oficial` | BNA re-published | fallback for #2 when bna.com.ar is slow/blocked |

Cross-check: reject #1 if it differs from BNA by more than 3 % (today: 0.1 %).
If the product prefers "official = BNA" (what most apps show), swap #1 and #2 — but that changes the historical definition by ~1–2 pesos; flag it as a product decision.

### 4.3 Run algorithm (replaces "median of latest row per source within 3 days")

1. Trigger: cron every 5–15 min inside the legacy window (Mon–Fri 10:00–22:59 UTC = 07:00–19:59 ART). Observed last-update stamps today: Ámbito blue 18:55 ART, Cronista 18:25, Infodolar 18:00, BNA 17:03, Ámbito oficial 16:46, Infobae 16:05. Optional: one low-frequency run on weekends for liveness and for the crypto dollar.
2. Fetch all sources concurrently (`Promise.allSettled`), per-source timeout 8 s (BNA 20 s), honest UA such as `bluelytics-bot/2.0 (+https://bluelytics.com.ar)`. One request per source per run (respects dolarhoy `Crawl-delay: 10`, Ámbito `max-age=30`, criptoya 120-limit).
3. Parse + validate (§2.5–2.6). Store **every** observation (source, buy, sell, source `asOf`, fetched_at, http status, ok/error) — this is the audit trail and replaces `dolar_values`.
4. A source is **fresh** when its latest *successful* observation is from the current run or from the last 60 minutes. (Legacy kept a dead source voting with its last value for 3 days; do not port that.) Sources with a real timestamp are additionally **stale** if `asOf` is older than 4 calendar days (covers long weekends) while other sources have newer `asOf`.
5. Build the voter list per §4.1 (vendor-group de-duplication, reserve and last-resort tiers).
6. Disagreement handling:
   * ≥ 3 voters: consensus = per-side **median** (`PERCENTILE_CONT(0.5)` semantics: mean of the two middle values when the count is even), then `Math.round` to integer pesos — identical to legacy. Additionally log any voter deviating > 2 % from the median of the others (monitoring signal: the source is lagging or mis-parsed).
   * exactly 2 voters: if they differ by ≤ 1 % take the mean (legacy behaviour); if they differ by more, take the higher-priority one and alert (this is precisely today's Ámbito-vs-La Nación case).
   * exactly 1 voter: publish it only if it is Ámbito (priority 1) or if the value equals the last published consensus; otherwise hold.
   * 0 voters: hold the last published value, do not touch `last_update`, alert after N consecutive empty runs.
7. Publish only when the rounded consensus (blue or oficial) changed, or on the first successful run of a day; this is what makes the API cacheable. (Open point for the API spec: legacy `last_update` = time of the last scrape run, which changes every run even when values do not.)
8. Alerts worth wiring from day one: a source failing > 6 consecutive runs (this would have caught the Cronista breakage), a voter deviating > 2 % for > 1 h, fewer than 3 voters, currency refresh older than 48 h (this would have caught §5.1).

### 4.4 Extra dollar types available "for free" from the same responses

| Type | Cheapest capture | Also available in |
|---|---|---|
| MEP ("bolsa") | Ámbito `/mercados/monedas` item "Dólar Mep" (1701,05) | Cronista `ARSMEP`, Infobae `ARSMEP=`, La Nación row "Dólar MEP" (1649,43), criptoya `mep.al30.{ci,24hs}.price`, dolarapi `bolsa` |
| CCL | Ámbito `/dolarrava/cl/variacion` (1799,14) — **not** in `/mercados/monedas` | Cronista `ARSCONT`, Infobae `ARUSDCEDEAR=`, La Nación "Dólar CCL" (1772,35), criptoya `ccl.al30`, dolarapi `contadoconliqui` |
| Cripto | Ámbito `/mercados/monedas` "Dólar Cripto" (1763,65; live on weekends) | criptoya `cripto.{usdt,usdc,ccb}.{ask,bid}`, dolarapi `cripto` |
| Mayorista | Ámbito `/mercados/monedas` "Dólar Mayorista" (1571/1580) | BCRA variable 5 (A3500 1575.9572), BNA divisas tab, Infobae `ARSVHM=BNAR`, criptoya `mayorista.price`, dolarapi `mayorista`, La Nación |
| Tarjeta / turista | Ámbito `/mercados/monedas` "Dólar Tarjeta" (venta 2080,00) | Cronista `ARSTAR`/`ARSTUR`, Infobae `ARST=`, criptoya `tarjeta.price`, dolarapi `tarjeta`, La Nación (2095,60), dolarhoy home |
| BNA | Ámbito `/mercados/monedas` "Dólar BNA" | everything in §4.2 |
| Blue euro / official euro | Ámbito `/mercados/monedas` "Euro Informal" (1822,32/1844,34), "Euro" (1698,09/1798,07) | BNA billete Euro 1695/1805 |
| Ahorro, Importador, Futuro, Riesgo país, Merval | Ámbito `/home/general`, `/dolarfuturo/variacion`, `/riesgopais/variacion` | — |
| Blue per province | Infodolar table `cotizacionesBlueProvincias` | — |
| Intraday blue (hourly) | Infobae `series` (`x`,`y`=sell,`z`=buy) | Cronista `historico` (daily, ~10 months) |

Sources disagree noticeably on MEP/CCL (MEP 1649–1743, CCL 1772–1851 today) because they use different bonds/settlement terms — store the source and instrument with each value; do not median across them blindly.

Recommendation: add **one** extra request per run, `GET https://mercados.ambito.com/mercados/monedas` (438 B), and persist all nine items into the raw observation log from day one, even before any feature uses them.

---

## 5. Currency rates (~170 currencies vs USD)

### 5.1 Legacy and its current state

* `openexchange.py:4-9`: `GET https://openexchangerates.org/api/currencies.json` (no key); inserts **only new** codes into `currency_map(id, code, name)` with `max(id)+1` (`database.py:21-37`). Existing names are never updated (the map holds Spanish names such as "Dírham marroquí"; OXR returns English names).
* `openexchange_values.py:4-12`: `GET https://openexchangerates.org/api/latest.json?app_id=<OPENEX_API_KEY>`; for each `rates[code]` (units per 1 USD) deletes today's row and inserts `currency_values(scraped_dt = current_date, currency_id, value)` (`database.py:40-56`), then `REFRESH MATERIALIZED VIEW CONCURRENTLY currency_value_latest` (`refresh_currencies.py`).
* **Live state:** `GET https://api.bluelytics.com.ar/v2/currency` (golden `currency.body`, 169 entries) returns values that are years old: `ARS 232.41`, `EUR 0.92`, `JPY 137.97`, `BRL 5.0`, `TRY 19.81`, `VES 25.78`, `EGP 30.86`, `NGN 461.5`. Today: ARS ≈ 1576–1580, JPY ≈ 158.6, BRL ≈ 5.94, EUR ≈ 0.9116. The currencies job has evidently not written data since about mid-2023 (inferred from the values; the cause — expired key, removed schedule — was not investigated and the key was not used).
* Consequence: `oficial_euro` / `blue_euro` in `/v2/latest` use EUR = 0.92 instead of ≈ 0.9116 (≈ 0.9 % low today: e.g. blue_euro sell would be `1670 / 0.9116 ≈ 1832` instead of 1815).

### 5.2 openexchangerates.org

* `GET https://openexchangerates.org/api/currencies.json` → 200, keyless, 173 codes with English names (`Last-Modified: Tue, 22 Jul 2025`). Versus the live 169: adds `SLE`, `VEF`, `XCG`, `ZWG`; nothing missing. Fixture `oxr_currencies.json`.
* `GET https://openexchangerates.org/api/latest.json` without key → **403** `{"error":true,"status":403,"message":"missing_app_id",…}` (fixture `oxr_latest_nokey.json`).
* Plans as shown today on `https://openexchangerates.org/signup` and `/signup/free` (fixtures `oxr_signup_plans.html`, `oxr_signup_free.html`):
  * **"Forever Free Plan": hourly rate updates, 1,000 API requests per month, limited tech support**; "hourly updates (with base currency USD)".
  * Developer $12/month: hourly, 10,000 requests, all base currencies. Enterprise $47/month: 30-minute updates, 100,000 requests, time-series. Unlimited $97/month: 5-minute updates, unlimited requests, conversion.
* Fits the legacy need (1–2 calls/day ≪ 1,000/month) but requires a secret and an account that currently appears not to be delivering data.

### 5.3 Keyless alternatives (all checked live; "missing" = legacy codes absent, out of the 169 in `/v2/currency`)

| API | URL | Status / size | Codes | Missing vs legacy 169 | ARS today | Cadence observed | Terms observed |
|---|---|---|---|---|---|---|---|
| **fawazahmed0 currency-api** (jsDelivr) | `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json` | 200, 2,702 B / 7,519 B, 0.02 s, `x-jsd-version: 2026.11.22`, `cache-control: public, max-age=604800, s-maxage=43200`, CORS `*` | 340 keys (fiat + crypto + metals), lower-case | only `CLF` | 1579.6945753 | daily (`"date":"2026-11-22"`, published on a Sunday) | repo licence **CC0-1.0**; README: "No Rate limits", "Daily Updated", "Please include Fallback mechanism" |
| same, Cloudflare Pages mirror | `https://latest.currency-api.pages.dev/v1/currencies/usd.json` | 200, 0.08 s, `cache-control: public, max-age=0, must-revalidate` | byte-identical JSON to jsDelivr today | — | — | — | — |
| names list | `…/currency-api@latest/v1/currencies.json` | 200, 340 names (English) | — | — | — | — | — |
| **Frankfurter v2** | `https://api.frankfurter.dev/v2/rates?base=USD` | 200, 1,756 B / 12,641 B, 0.6 s (cache MISS), `cache-control: public, max-age=32967, stale-if-error=86400` | 200 quotes, array of `{date, base, quote, rate}` | `BGN, CLF, CUC, HRK, SLL, STD, ZWL` | 1569.15 | "Rates update throughout the day"; rows dated 2026-11-22 (144), 11-21 (35), 11-20 (21) | "free exchange rate API for 219 currencies and 39 other assets from 112 central banks and official sources", "You don't need an API key", open source / self-hostable; "reference rates, not live market quotes" |
| Frankfurter v1 | `https://api.frankfurter.dev/v1/latest?base=USD` | 200, 437 B | 29 (ECB set) | no ARS and ~140 others | — | ECB working days (`"date":"2026-11-20"`) | — |
| **open.er-api.com** (ExchangeRate-API open access) | `https://open.er-api.com/v6/latest/USD` | 200, 1,665 B / 2,961 B, 0.05 s, `cache-control: public, max-age=3600` | 166 | `BTC, CUC, KPW, STD, SVC, XAG, XAU, XPD, XPT` | 1575.9572 (= BCRA A3500) | once per day (`time_last_update_utc: Sun, 22 Nov 2026 00:02:32`, next `Mon, 23 Nov 2026 00:23:42`) | docs: "requires attribution", caching allowed, "**not allowed to re-distribute it**", rate limited (HTTP 429 for 20 minutes) |
| exchangerate-api v4 | `https://api.exchangerate-api.com/v4/latest/USD` | 200 | 166 | same as above | 1575.96 | daily | body carries `WARNING_UPGRADE_TO_V6` (legacy endpoint) |
| floatrates | `https://www.floatrates.com/daily/usd.json` | 200, 25,044 B, 1.1 s, no caching | 146 | 24 (incl. `USD` itself, `BTC`, metals, `XDR`, `CNH`, `BMD`…) | 1566.157 | daily (item dates `Fri, 20 Nov 2026 23:59:00 GMT`) | none seen |
| vatcomply | `https://api.vatcomply.com/rates?base=USD` | 200 | 30 (ECB) | no ARS | — | ECB days | — |
| ECB | `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` | 200, 1,547 B, `Last-Modified: Fri, 20 Nov 2026 14:56:39 GMT` | ~30, EUR base | — | — | TARGET working days | public reference rates |

Fixtures: `fawazahmed0_*.json`, `frankfurter_*.json`, `erapi_latest_usd.json`, `exchangerate_api_v4_usd.json`, `floatrates_usd.json`, `vatcomply_usd.json`, `ecb_eurofxref_daily.xml`.

### 5.4 Recommendation

* **Primary: fawazahmed0 currency-api** — `GET https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json`, on failure the mirror `https://latest.currency-api.pages.dev/v1/currencies/usd.min.json` (the project itself asks for this fallback). Shape: `{"date":"YYYY-MM-DD","usd":{"ars":1579.69,"eur":0.9116,…}}`; upper-case the keys; value = units per 1 USD, the same semantics as OXR `rates`. CC0, keyless, covers 168 of the 169 legacy codes. jsDelivr's `@latest` is edge-cached up to 12 h (`s-maxage=43200`), which is fine for a once-a-day job; the dated URL `…/currency-api@2026-11-22/v1/…` can be used to force a specific day.
* **Fallback: Frankfurter v2** — `GET https://api.frankfurter.dev/v2/rates?base=USD`; central-bank reference rates, 162 of 169 legacy codes. The seven it lacks are defunct/unit codes (`BGN`, `HRK`, `SLL`, `STD`, `ZWL`, `CUC`, `CLF`).
* Do **not** use open.er-api.com for `/v2/currency`: its terms forbid redistribution, and that endpoint re-publishes the rates.
* Keep OXR only if the owner wants exact continuity and confirms the app id still works; otherwise drop the secret.
* Schedule: once per day is enough (both recommended sources are daily); optionally a second run for retry. Store `(date, code, value, provider)`.
* Guards: require ≥ 150 codes and `0.5 < EUR < 1.5`; reject any code moving > 30 % day-over-day unless the fallback provider agrees; cross-check EUR (it drives `oficial_euro`/`blue_euro`) between the two providers (< 1 % apart; today 0.91158 vs 0.91023); alert when the newest stored date is > 48 h old.
* Codes missing from every provider (`CLF` today, plus defunct ones): keep serving the last stored value so the `/v2/currency` list does not shrink, and mark them internally as frozen.
* Names: seed `currency_map` (Spanish names, ids — EUR must stay resolvable where the legacy SQL hard-codes `currency_id = 22`) from the production database; do not depend on OXR `currencies.json` any more. New codes can take English names from fawazahmed0 `currencies.json` until translated.
* The legacy API rounds values to 2 decimals (`BTC 0.00`, `XAU 0.00`, `GBP 0.8`); whether to preserve that is an API-compat decision outside this document.

---

## 6. Fixture index

Directory: `/tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/fixtures/sources/`

| File(s) | Request |
|---|---|
| `ambito_informal.json`, `ambito_oficial.json` | legacy URLs, chrome UA |
| `ambito_mayorista.json`, `ambito_dolarnacion.json`, `ambito_dolarturista.json`, `ambito_mep.json`, `ambito_ccl.json`, `ambito_cripto.json`, `ambito_futuro.json`, `ambito_euro_informal.json`, `ambito_euro_oficial.json`, `ambito_mercados_monedas.json`, `ambito_home_general.json`, `ambito_informal_historico_general.json`, `ambito_informal_historico_cierre.json` | `https://mercados.ambito.com/<path>` per §2.1, bot UA |
| `cronista.html` | `https://www.cronista.com/MercadosOnline/moneda.html?id=ARSB` followed to `/MercadosOnline/moneda/ARSB/`, chrome UA |
| `cronista_api_markets_list_ARSB.json`, `cronista_api_markets_list_multi.json` | Arc content API (§2.2 option B), bot UA |
| `lanacion.html` | `https://www.lanacion.com.ar/tema/dolar-blue-tid67294/`, chrome UA |
| `dolarhoy_blue.html`, `dolarhoy_home.html` | `https://dolarhoy.com/cotizaciondolarblue`, `https://dolarhoy.com/` |
| `infodolar_blue.html` | `https://www.infodolar.com/cotizacion-dolar-blue.aspx` |
| `infobae_dolar_libre.html`, `infobae_dolar_hoy.html` | `https://www.infobae.com/economia/divisas/dolar-libre/`, `…/dolar-hoy/` |
| `dolarito_home.html` | `https://www.dolarito.ar/` |
| `criptoya_dolar.json` | `https://criptoya.com/api/dolar` |
| `dolarapi_dolares.json`, `dolarapi_blue.json`, `dolarapi_ambito_dolares.json` | `https://dolarapi.com/v1/dolares`, `/v1/dolares/blue`, `/v1/ambito/dolares` |
| `argentinadatos_dolares_blue.json`, `argentinadatos_dolares_blue_2026-11-20.json` | `https://api.argentinadatos.com/v1/cotizaciones/dolares/blue[/2026/11/20]` |
| `bna_personas.html`, `bna_monedas_historico.html` | `https://www.bna.com.ar/Personas`, `https://www.bna.com.ar/Cotizador/MonedasHistorico` |
| `bcra_cotizaciones.json`, `bcra_cotizaciones_usd.json`, `bcra_monetarias_var4_minorista.json`, `bcra_monetarias_var5_mayorista_a3500.json`, `bcra_monetarias_var4_limit1.json`, `bcra_monetarias_var5_limit1.json`, `bcra_monetarias_catalog_page1.json` | BCRA URLs in §3.3 |
| `oxr_currencies.json`, `oxr_latest_nokey.json`, `oxr_signup_plans.html`, `oxr_signup_free.html` | §5.2 |
| `fawazahmed0_usd_jsdelivr.json`, `fawazahmed0_usd_pagesdev.json`, `fawazahmed0_currencies.json`, `frankfurter_v1_latest_usd.json`, `frankfurter_v2_rates_usd.json`, `erapi_latest_usd.json`, `exchangerate_api_v4_usd.json`, `floatrates_usd.json`, `vatcomply_usd.json`, `ecb_eurofxref_daily.xml` | §5.3 |

Expected parse results for tests (from `sources_recipes.mjs`):

```
ambito informal (blue)        {"buy":1655,"sell":1675,"asOf":"2026-11-20T21:55:00.000Z"}
ambito oficial                {"buy":1548.41,"sell":1601.32,"asOf":"2026-11-20T19:46:00.000Z"}
ambito mayorista              {"buy":1571,"sell":1580,"asOf":"2026-11-20T19:44:00.000Z"}
ambito dolarnacion (BNA)      {"buy":1550,"sell":1600,"asOf":"2026-11-20T21:55:00.000Z"}
cronista html (embedded json) {"buy":1655,"sell":1675,"asOf":"2026-11-20T21:25:13.970Z"}
cronista html (markup)        {"buy":1655,"sell":1675,"asOf":null}
cronista api ARSB             {"buy":1655,"sell":1675,"asOf":"2026-11-20T21:25:13.970Z"}
cronista api multi ARS (BNA)  {"buy":1550,"sell":1600,"asOf":"2026-11-20T21:25:13.970Z"}
lanacion blue                 {"buy":1615.05,"sell":1665,"asOf":null}
lanacion oficial              {"buy":1548,"sell":1612,"asOf":null}
lanacion MEP/CCL/mayor/tarj.  [1649.43,1772.35,1580,2095.6]
dolarhoy blue                 {"buy":1655,"sell":1675,"asOf":null}
infodolar blue                {"buy":1655,"sell":1675,"asOf":"2026-11-20T21:00:00.000Z"}
infobae blue                  {"buy":1655,"sell":1675,"asOf":"2026-11-20T19:05:16.000Z"}
bna billete                   {"buy":1550,"sell":1600,"asOf":"2026-11-20T20:03:00.000Z"}
bna divisa                    {"buy":1571,"sell":1580}
bcra var4 minorista vendedor  {"date":"2026-11-20","value":1601.32}
bcra var5 A3500               {"date":"2026-11-20","value":1575.9572}
criptoya                      blue {"buy":1655,"sell":1675}  oficial {"buy":1550,"sell":1600}
dolarapi                      blue {"buy":1655,"sell":1675}  oficial {"buy":1550,"sell":1600}
```

---

## 7. Risks, limits of this check, open questions

**Not verified**
* Nothing was requested from Cloudflare Workers egress IPs. What was seen from an Argentine residential/office IP: no source required a browser UA, none challenged. From Workers: Ámbito, dolarhoy, Infodolar, criptoya, dolarapi, argentinadatos and the BCRA API are themselves Cloudflare zones (Ámbito and BCRA set `__cf_bm`, i.e. Bot Management is active; Worker subrequests are identifiable to them via the `CF-Worker` header); Cronista, La Nación and Infobae sit behind Akamai; BNA sits behind F5 Distributed Cloud with a `TS…` cookie, served from a São Paulo PoP, and was the slowest and most erratic (0.5–19 s). **Run a one-off probe Worker against every URL before committing to the set**, and keep a non-Workers fallback path (e.g. a scheduled GitHub Action posting observations to the Worker) for any source that blocks datacenter ranges.
* Rate limits: only headers were observed (Ámbito `x-ratelimit-limit: 100`, window unknown; criptoya `x-ratelimit-limit: 120`). One request per source per run is far below either.
* Intraday behaviour (how quickly each source follows a move, weekday availability of BCRA's same-day value) cannot be observed on a Sunday.
* The OXR app id from `bluescraper/.env` was not used; whether it still works is unknown.
* One follow-up probe was not executed: re-requesting dolarito's blocked `/api/…` with browser-like headers was stopped by the session's permission policy. The 403 with a plain UA is the recorded result and the source is rejected anyway.

**Gotchas for implementers**
* Cronista's JSON content API is `Disallow`ed in robots.txt; the HTML page is the compliant route. dolarito's `/api/` is disallowed and blocked. dolarhoy asks for `Crawl-delay: 10`.
* Cronista's rendered footer time is UTC printed as if local; use the epoch in the embedded JSON.
* Infobae regex groups are (sell, buy) — reversed relative to every other recipe.
* criptoya: `ask` = sell, `bid` = buy; timestamps are poll times in epoch *seconds*; some sub-series are months stale.
* dolarapi `fechaActualizacion` mixes true UTC poll times with ART wall-clock times labelled `Z`.
* argentinadatos daily rows are shifted (morning value / previous close), not closes.
* BNA: billetes use `'ar'` numbers (`1550,00`), divisas use `'en'` with 4 decimals (`1571.0000`); response is uncompressed 116 KB.
* Ámbito: the 404 handler returns JSON too (with a stack trace) — check for the `compra`/`venta` keys, not just the content type.
* Arc XP sites (Cronista, La Nación, Infobae) emit React comment separators (`<!-- -->`) inside numbers' parent nodes and can re-order widgets on redesigns; the recipes anchor on labels, not positions. Expect one of them to break roughly once a year (Cronista already did) — hence the per-source failure alert.
* MEP/CCL differ by 3–5 % between sources because of different instruments; never median them across sources.

**Open questions for the owner**
1. Accept the corrected blue (`1655/1675` instead of `1635/1670` today) at cut-over, i.e. demote La Nación? (Recommended: yes.)
2. Should "oficial" stay as Ámbito's bank average (legacy, 1548.41/1601.32) or switch to BNA (1550/1600)?
3. May the scraper use Cronista's robots-disallowed JSON endpoint as a fallback, or HTML only?
4. Should `last_update` keep meaning "last scrape run" (changes every run) or become "last value change"?
5. Is the OXR key still valid / wanted, or do we move fully to keyless currency sources?
6. What is the production cron cadence of the legacy scraper task (not present in the repo; the `:45:51` stamp suggests a 5- or 15-minute schedule)?
