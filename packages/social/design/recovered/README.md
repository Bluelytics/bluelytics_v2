# bluelytics cards: "Editorial Bold", final

Built on b-editorial, the variant the judges scored highest. One huge neutral hero in **Chivo Black** sits on a deep brand-blue field crossed by a tapered **blade** taken from the logo's swept strokes. The blade, its thin sliver (green, red or grey) and the glow (teal dawn at the top for up, wine dusk at the bottom for down) carry the direction. The number stays white, so a bad day never turns into a wall of red. The delta is a solid **slab** with dark ink (about 10:1 up, 6:1 down), an SVG ▲/▼, the sign, the pesos and the percent. Its free end is cut on the diagonal of the move. Unchanged reads "= sin cambios" in grey.

**Blade routing (new).** Each layout registers the box of every text it places, plus the logo, the tag and the chart. Then the router searches the routes near the preferred one for each size and direction, trying thinner blades if needed. It keeps the first route where the sliver touches nothing and the body edge cuts no text. Only the hero digits and the opaque slab may be crossed. Long kickers, 6-digit prices and year-crossing weeks get a different route instead of a collision. When no clean route exists, the sliver is dropped. Sliver thickness, opacity and glow scale with √|move| (0,06 % is quiet, ≥ 3 % is full).

**Tokens** (`TOKENS` in card.mjs): ink `#040A14`, navy `#06203D`, brand blue `#0069AC`/`#005E9D`, lift `#1C7FD6`, chart line `#7DBEFF`, text `#F4F8FC`, soft `#C3D6EA` (keys), muted `#93A9C2` (notes), ghost `#6F87A2` (days without a close, ≥ 4.5:1), slab ink `#03121F`, up `#2FD67B`, down `#FF5D5D`, flat `#A9B8CA`. Glow: up `#08607E`, down `#3A2148`.

**Type, three tiers.**
- Loud: Chivo 900 hero (≤ 300 px; fitted to width, so 6 digits shrink instead of clipping; superior "$" at 46 % in soft) and slab.
- Labels: Chivo 700 caps with +8 % tracking (kicker, stat keys); values in Chivo 700, fitted per row.
- Quiet: Chivo Mono 500, sentence case, no tracking, for chart notes, axis values, day labels, "vs. cierre anterior", the timestamp and the domain.

Both families are OFL, from Omnibus-Type in Buenos Aires. Total WOFF2 is 40 KB. Minimum text size is 34 px on 1600-wide cards and 30 px elsewhere.

**Kinds**
- `update`: "DÓLAR BLUE · VENTA", hero, slab and "vs. cierre anterior", then the 30-day chart. The chart has its period above it ("30 ruedas · 12 oct – 20 nov", or just "20 nov" for a single point), the real max and min on dotted guides with mono values in a right gutter, the last segment and end dot in the move colour, and a minimum span of 4 % of the price. Below it: Compra, Oficial, Brecha, timestamp (ART) and domain.
- `weekly`: a white "RESUMEN SEMANAL" tag and "DÓLAR BLUE · <range>", the last close against the previous week, and a day-cell chart: "previo" (last week's close as a ghost point plus a dotted reference level), then lun–vie with "lun 16" labels. Days without a close are hatched and never bridged by a line; only adjacent days are joined. The span is at least 2 %. Below it: Mínimo, Máximo, Oficial, Brecha.
- `og`: "DÓLAR BLUE HOY", hero, slab, lockup and domain. No small print, everything inside the 1200x600 band.

**Layouts.** Landscape has a main column (hero, chart) and a sidebar (a two-row slab with a tall arrow, set cap-to-baseline with the hero, then stat rows), sharing one mono notes row. Portrait and story use one column with 72 px side margins (safe in the 3:4 grid crop). The story hero block sits inside y 270–1248.

**Grafted from the other variants.**
- From a-terminal: the minimum chart span; a mono technical footer and notes (here Chivo Mono, so it stays in the Chivo family); forced es-AR grouping (`useGrouping: 'always'`).
- From c-chart: the weekly day-cell table with "previo", hatched empty days and dated weekday labels; the last chart segment in the move colour; "1 point" grammar handled.

**Exports.**
- `renderCardHtml`, `computeCardFacts` (`deltaAbs`, `deltaPct`, `direction`, `gapPct`, `min`, `max`, `intensity`, …) and `cardAltText` (one Spanish sentence, at most 420 characters, ASCII minus, "hora de Argentina").
- Formatters: `formatPesos`, `formatSignedPesos`, `formatPercent` (adds a decimal rather than print "+0,00%"), `formatGap`, `formatTimestamp`, `formatDateRange` (`prose` option), `plainText`, and `TOKENS`.

**Files.**
- `build-fonts.mjs` (`--download` fetches the pinned Fontsource 5.3.0 files) writes `fonts.mjs`. Licences are in `fonts/OFL-*.txt`.
- `extra-scenarios.mjs` and `render-extra.mjs` cover 50 stress renders (6 digits, ±1 peso, −7 %, 1, 3 and flat series, negative brecha, one-day, holiday and year-crossing weeks) and write them to `out-extra/`. `--main` also checks the harness matrix. The checks cover safe areas, text overlap, a dot touching text, the blade crossing text, NaN, and alt-text length.
- `tools/sheets.mjs` rebuilds `out/_contact.jpg`, `_thumbs.jpg` and `_grid.jpg` with inlined images, because the harness sheets come out blank.

**Limits.**
- Widths come from a measured glyph table, not live measurement, so a font change needs `tools/metrics.mjs` to be re-run.
- When the router has to move the blade far from its preferred route (for example on the long weekly kickers in story), the blade can end up mostly in a corner and read as less dramatic.
- Mono notes at 34 px are wide; the landscape weekly card is the densest layout.
- The slab assumes moves fit in about 8 characters ("+$ 8.125"). Larger strings shrink the slab text, with a floor of 40 px.
