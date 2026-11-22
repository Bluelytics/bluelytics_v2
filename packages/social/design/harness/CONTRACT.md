# Card contract

A card implementation is a directory containing:

- `card.mjs` — `export function renderCardHtml(kind, size, data)` returning ONE self-contained HTML document (string).
  - `kind`: `'update' | 'weekly' | 'og'`; `size`: `'landscape'` 1600x900, `'portrait'` 1080x1350, `'story'` 1080x1920, `'og'` 1200x630
    (update and weekly in landscape/portrait/story; og only in og).
  - `data`: the CardData shape at the top of `harness/scenarios.mjs` (whole pesos; the card derives delta, percent, gap, labels and dates).
  - Portable to a Cloudflare Worker: plain ESM, no `node:` imports, no filesystem or network, no dependencies, deterministic
    (no Date.now/random). `Intl` with `es-AR` is available.
  - HTML: inline `<style>`, inline SVG (logo, arrows, charts), fonts as base64 `@font-face` (WOFF2, OFL only), NO `<script>`,
    NO external URLs. `<html lang="es">`. Body margin 0; exactly the canvas size, no scrolling.
- `fonts.mjs` — base64 font data as string exports, generated from `fonts/` (keep files + licence texts). Total ≤ 250 KB WOFF2.

Render and self-check: `node packages/social/design/harness/render-all.mjs <dir>` (Node 24; uses /usr/bin/google-chrome-stable and
playwright-core from packages/social/node_modules) → `<dir>/out/*.jpg`, `out/_contact.jpg`, `out/_thumbs.jpg` (125 px: Instagram grid test).

Content rules:
- Spanish (Argentina), correct accents. es-AR numbers: `$ 1.675`, `+0,90%`, `20 nov 2026, 15:45` + `(ART)`, 24-hour clock, America/Argentina/Buenos_Aires.
- `update`: "DÓLAR BLUE · VENTA"; hero = blue sell; change vs previous close (pesos and percent, arrow + sign, never colour alone);
  Compra, Oficial (official sell), Brecha (blue sell / official sell − 1, one decimal); sparkline of `series` with honest period label;
  timestamp; `bluelytics.com.ar`; logo.
- `weekly`: "Resumen semanal" + week range; hero = last close; change vs previous week's close; chart of the week's daily closes with weekday
  labels and values (1–5 points); week min/max; Oficial and Brecha; timestamp; domain; logo.
- `og`: "Dólar blue hoy", hero, change chip (unchanged: grey, "sin cambios"), logo, domain; essential content inside the central 1200x600 band.
- No tax/surcharge lines, hashtags, sentences or emoji.
- Safe areas: landscape 64 px; portrait 64 px left/right, 56 px top/bottom; story nothing essential above y=270 or below y=1580, hero block
  between y=270 and y=1248; og 48 px.
- Must not break with five- or six-digit prices, ±7 % moves, +1 peso moves, September ("sept"), one- or two-day weeks, flat series, negative brecha.
