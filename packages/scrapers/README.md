# @bluelytics/scrapers

Source adapters for the jobs Worker (ARCHITECTURE §8): one GET per source per run, a pure parser over
the response text, and the daily currency providers. Workers-compatible: global `fetch`,
`AbortSignal.timeout`, no `node:` imports in `src/` (`tsconfig.src.json` type-checks it against
`@cloudflare/workers-types` only). Recipes, anchors and expected values come from
`docs/research/sources.md` and `docs/research/sources_recipes.mjs`, hardened like the legacy fix in
`bluescraper/src/scrape_*.py` (label anchors, row-scoped regexes, strict number formats, JSON/markup
cross-check, 7-day staleness).

```ts
import { TICK_SOURCES, fetchAll, ambitoExtras, fetchExtras, fetchCurrencies } from '@bluelytics/scrapers';

const observations = await fetchAll(TICK_SOURCES, { now: runAt });   // Observation[] → insertObservationsStatements
const { observation, rates } = await fetchExtras(ambitoExtras, { now: runAt }); // daily: ExtraRate[]
const currencies = await fetchCurrencies({ now: runAt });            // daily: first provider passing the guards
```

## Sources

| id | kind | URL | Format | Numbers | `sourceTs` | Role (ARCHITECTURE §2, §4) |
|---|---|---|---|---|---|---|
| `ambito` | blue | `mercados.ambito.com/dolar/informal/variacion` | JSON | `ar` strings | `fecha` (ART) | primary |
| `ambito_oficial` | oficial | `mercados.ambito.com/dolar/oficial/variacion` | JSON | `ar` strings | `fecha` (ART) | oficial, first in chain |
| `dolarhoy` | blue | `dolarhoy.com/cotizaciondolarblue` | HTML, first `cotizacion_value` tile titled "Dólar Libre" | `ar` | none (the page time is render time) | primary |
| `cronista` | blue | `www.cronista.com/MercadosOnline/moneda/ARSB/` | HTML: embedded JSON `"Ric":"ARSB="` with the `"Ultimo"` guard; markup fallback; both present → must agree within 1 % | JSON numbers / `ar` | `UltimaActualizacion` (epoch ms) | primary (not the robots-disallowed `/pf/api`) |
| `infodolar` | blue | `www.infodolar.com/cotizacion-dolar-blue.aspx` | HTML, "Dólar Blue" row of `#CompraVenta`, both cells within that `<tr>` | `ar` | row `datetime` | primary |
| `lanacion` | blue | `www.lanacion.com.ar/tema/dolar-blue-tid67294/` | HTML, `<li>` labelled "Dólar blue" in `dolar-subgroup` | `ar` | none | reserve |
| `infobae` | blue | `www.infobae.com/economia/divisas/dolar-libre/` | HTML, embedded `"ric":"ARSB=","sellValue"…` (sell before buy) | JSON numbers | `utcDate` | standby for cronista (same vendor feed) |
| `bna` | oficial | `www.bna.com.ar/Personas` | HTML, billetes tab "Dolar U.S.A" row | `ar` | table date + "Hora Actualización" (ART) | oficial fallback; 20 s timeout |
| `criptoya` | blue | `criptoya.com/api/dolar` | JSON `blue.bid`/`blue.ask` | JSON numbers | `blue.timestamp` (their poll time, s) | last resort |
| `ambito_extras` | extra | `mercados.ambito.com/mercados/monedas` + `/dolarrava/cl/variacion` | JSON | `ar` strings | per item `fecha` | daily `extra_rates` |

`TICK_SOURCES` = every row but `ambito_extras`, in that order. Timeouts: 8 s, BNA 20 s.
User-Agent: `bluelytics-bot/2.0 (+https://bluelytics.com.ar)` (`USER_AGENT`).

`extra_rates` codes from `ambito_extras` (`source: 'ambito'`): `bna`, `tarjeta`, `importador`, `mep`,
`mayorista`, `cripto`, `euro`, `euro_blue`, `ccl`. Items Ámbito marks as sell-only
(`data-valor-descripcion: "Venta"`: tarjeta, importador) have `buyCents: null`. "Dólar Informal" is
skipped (it is the `ambito` source).

## API

| Export | Semantics |
|---|---|
| `Source` | `{ id, kind, url, format: 'json' \| 'html', timeoutMs, parse(text): Quote }`. |
| `Quote` | `{ buyCents, sellCents, sourceTs }`: integer centavos; `sourceTs` storage-form UTC or `null`. |
| `fetchSource(source, { fetch?, now, timeoutMs? }): Promise<Observation>` | GET (bot UA, `AbortSignal.timeout` over headers and body, redirects followed), parse, staleness check. **Never throws**: any failure is `ok: false`, prices and `sourceTs` `null`, `error` set. `runAt = toStoredUtc(now)`; `durationMs` covers fetch + parse. |
| `fetchAll(sources, deps): Promise<Observation[]>` | All sources in parallel (`Promise.allSettled`), results in input order. |
| `fetchExtras(source, deps): Promise<{ observation, rates: ExtraRate[] }>` | The daily capture: requests are independent; a failed request or an item dated > 7 days ago drops only its rates and is listed in `observation.error`. `ok` = at least one rate. `updatedAt = runAt`. |
| `TICK_SOURCES`, `ambito`, `ambitoOficial`, `dolarhoy`, `cronista`, `infodolar`, `lanacion`, `infobae`, `bna`, `criptoya`, `ambitoExtras` | Descriptors. |
| `parseAmbitoVariacion`, `parseAmbitoItem`, `parseDolarhoy`, `parseCronista`, `parseInfodolar`, `parseLanacion`, `parseInfobae`, `parseBna`, `parseCriptoya`, `parseAmbitoMonedas`, `parseAmbitoCcl` | The pure parsers. |
| `parsePriceCents(raw, 'ar' \| 'en')`, `jsonPriceCents(value, field)` | Strict number parsing → centavos (see below). |
| `assertFresh(sourceTs, now)`, `MAX_SOURCE_AGE_MS` (7 days), `MAX_SOURCE_SKEW_MS` (6 h) | Staleness rule. |
| `ParseError` (`code`: `anchor`, `number`, `timestamp`, `inverted`, `mismatch`, `stale`, `json`, `guard`), `FetchError` (`timeout`, `http`, `network`), `describeError(e)` | Typed failures; `observations.error` is `describeError` output: `parse.anchor: …`, `fetch.timeout: …`, one line, ≤ 300 chars. |
| `CURRENCY_SOURCES` | fawazahmed0 `usd.min.json` on jsDelivr, the same on `latest.currency-api.pages.dev`, then Frankfurter v2 `/v2/rates?base=USD`. |
| `fetchCurrencies(deps, sources?)` | First source passing every guard: `{ ok: true, result: CurrencyRates, failures }` or `{ ok: false, failures }`. |
| `fetchCurrencySource(source, deps): Promise<CurrencyRates>` | One provider (throws); use it to ask Frankfurter for a second opinion. |
| `CurrencyRates` | `{ provider: 'fawazahmed0' \| 'frankfurter_v2', url, date, rates: Record<CODE, unitsPerUsd> }` (floats; convert with core `numberToHundredths`). |
| `parseFawazahmed0(text, today)`, `parseFrankfurterV2(text, today)`, `assertPlausibleRates`, `assertRecentDate`, `CURRENCY_GUARDS` | Guards of ARCHITECTURE §7: ≥ 150 codes, `0.5 < EUR < 1.5`, `ARS > 100`, `USD = 1` when present, provider date within 3 days of the UTC date of `now` (Frankfurter: rows older than that are dropped, the table is dated by its newest row). |

The per-code "jump ≤ 30 % unless both providers agree" guard needs the stored values, so it belongs to
the jobs Worker: compare `fetchCurrencies` with `fetchCurrencySource(CURRENCY_SOURCES[2], deps)`.

## Rules every parser follows

- **Never a guessed number.** A missing anchor, a label that is not the expected instrument, a
  number not in the source's declared format, sell below buy (swapped labels), an impossible date or
  a page whose copies disagree throws `ParseError`; `fetchSource` turns it into a failed observation.
- **Numbers**: `ar` = `^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$` after removing `$`, spaces, `&nbsp;` and
  `<!-- -->` (so `1655.50` is rejected, not read as 165550); `en` = `^\d+(\.\d+)?$`. Conversion to
  centavos is exact decimal arithmetic (core `decimalToHundredths`, half away from zero beyond two
  decimals). JSON numbers go through core `numberToHundredths`.
- **Anchors**: `indexOf` + a 0.6–3 KB window + a small regex; labels, never positions. Row-scoped
  regexes (`(?:(?!</tr>)…)`, `(?:(?!</li>)…)`) keep cells from leaking from a neighbouring row.
- **Staleness**: a source date more than 7 days before the run, or more than 6 hours after it, fails
  the observation (`parse.stale`). Sources without a date are not checked; consensus freshness is
  by run time anyway.
- Range, spread and jump limits are **not** applied here: core `computeConsensus` rejects (and
  records) those per observation, so there is one place for the thresholds.

## Tests

`pnpm --filter @bluelytics/scrapers test`. `test/fixtures/` holds trimmed copies (a few KB around the
values) of the pages saved on 2026-11-22 (`cronista.html` joins its three relevant excerpts with a
`bluelytics fixture: trimmed` comment); the JSON fixtures are complete. Each parser is tested
against the documented values and against mutations (missing anchor, swapped labels or values,
wrong-format number, another instrument in place of the expected one, malformed dates), which must
throw a `ParseError` with the right code.
