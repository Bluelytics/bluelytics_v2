# bluelytics v2 — deliberate behaviour changes

For API consumers and the site owner. bluelytics.com.ar and `api.bluelytics.com.ar` move to a new system
on **____ (planned date, published at least a week ahead; replaced by the actual date after the switch)**. The API keeps the same URLs, fields,
key order, number format (`1670.00`), JSONP wrapper, CORS headers, error bodies and status codes as before.
The changes below are intentional. Unless a paragraph says otherwise, each one is visible from the first
update after the cutover. Past history is not recalculated.

**1. More sources for the blue rate.** The blue rate is now the median of four main sources: Ámbito,
dolarhoy, El Cronista and Infodolar. La Nación only counts when fewer than three of those are available, and
criptoya only when almost nothing else is. Before, the value came from Ámbito and La Nación only, because the
El Cronista reader had stopped working. *What you will see:* the blue buy and sell values can move by a few
pesos at the cutover. For example, at the close on 2026-11-20 the old method gave 1635 / 1670 and the new one
would have given 1655 / 1675. After that, values follow the market consensus more closely. The official rate
still comes from Ámbito's bank average. Banco Nación's rate is used only while Ámbito is unavailable, so the
official value can differ by a few pesos during an Ámbito outage.

**2. A source that stops updating no longer counts.** A source counts only if it was read successfully in
the current run or in the last 30 minutes. If no source is fresh, the last published value stays as it is.
Before, a source that had failed kept counting with its old value for up to three days. *What you will see:*
during a source outage the published value no longer drifts toward stale numbers. `last_update` in
`/v2/latest` and `/json/last_price` now advances only while at least one blue source is fresh, so you can use
it to spot stale data.

**3. The daily value is the day's close.** For each Argentine calendar day, the daily row in
`/v2/evolution.json`, `/v2/evolution.csv` and `/v2/historical` is the last value published that day. Before,
it was the median of the day's last 49 samples, so it could differ from the final `/v2/latest` of the same
day. *What you will see:* this applies to the cutover day and every day after it. Every earlier row stays
exactly as it was published, byte for byte.

**4. `/json/last_price` returns blue values in its `blue` entry.** The old v1 endpoint had a copy-paste bug:
its `"source":"blue"` entry carried the official rates. That entry now carries the blue rates. *What you
will see:* higher numbers in the `blue` entry (for example, on 2026-11-20, sell 1675.00 under the new
source set instead of 1601.00).
The `oficial` entry, the field order and the format do not change. If you had worked around the bug, read the
`blue` entry directly now, or move to `/v2/latest`. The owner can bring the old behaviour back with a server
setting (`LEGACY_V1_BLUE_BUG=true`). Whether that is done is announced together with the cutover date.

**5. Currency rates are current again.** `/data/json/currency.json` had not updated since about May 2023
(it still showed ARS = 232.41 per USD). It is now refreshed daily from free public sources (the fawazahmed0
currency-api, with Frankfurter as a fallback). The `oficial_euro` and `blue_euro` values in `/v2/latest`
now use the current euro rate instead of a frozen 0.92. *What you will see:* from the moment of the cutover,
most currency values jump to current levels, and the euro values in `/v2/latest` move a little. The list of codes, their names and their order stay the same. A code that no source quotes any more
keeps its last value.

**6. Push alerts follow a consistent rule.** Alerts compare the same number on both sides: the published
blue sell of each run. They measure real elapsed time. When the last six hours contain no data, they compare
with the previous close, so a move at the opening can now trigger an alert. Before, that case could never
fire. *What you will see in the app:* the same notification title and text format, the same topic and the
same Android settings. An alert may now arrive at the start of the trading day. In `/v2/alerts`, `alert_id`
continues from the last number the old system issued.

**7. Social posts on Mondays, and failures handled honestly.** "Previous day" for automatic posts now means
the previous trading day, so posts can go out on Mondays. Before, a quirk meant posts never went out on a
Monday. Each post's status is recorded before it is sent, and a failed post is retried at most twice instead
of being logged as sent. *What you will see:* posts on X and Instagram (the connected channels) with a new
card design, now also on Mondays. The weekly chart is still posted on Friday evening and works for short
weeks too.

**8. Updates every 5 minutes.** Rates are read every 5 minutes during the trading window, Monday to Friday
07:00–19:59 Argentine time. Before, they were read every 15 minutes. *What you will see:* `last_update` and
the values react to moves sooner, and today's daily row is updated more often during the day.

**9. Additive HTTP improvements.** `HEAD` requests now work. Responses carry an `ETag`, and a request with
a matching `If-None-Match` gets `304 Not Modified`. Every response states its own `Cache-Control`:
`max-age=30` for `/v2/latest`, `/json/last_price` and `/v2/alerts`; 300 seconds for the evolution files and
`currency.json`; one day for a past date in `/v2/historical`; 60 seconds for today's row and for 404s.
Before, `/v2/latest` had no caching header and every other path was cached for 2 hours. The JSONP `callback`
name must now match `[A-Za-z0-9_$.\[\]]` and be 1–128 characters long. Anything else gets an HTTP 400 JSON
error instead of being echoed back. *What you will see:* fresher data on endpoints that used to be cached for
2 hours. Clients that only send `GET` notice no other difference. If you use JSONP, check that your callback
name fits the pattern.
