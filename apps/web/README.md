# @bluelytics/web

The bluelytics.com.ar website: Astro 7 on Cloudflare Workers (`@astrojs/cloudflare` 14), reading D1
through `@bluelytics/db`. Design: `docs/ARCHITECTURE.md` §10; platform details:
`docs/research/astro-seo.md`.

## Commands

```sh
pnpm --filter @bluelytics/web seed:local   # local D1 (apps/web/.wrangler) ← goldens + synthetic recent data
pnpm --filter @bluelytics/web dev          # astro dev (workerd, local D1)
pnpm --filter @bluelytics/web build        # wrangler types && astro build → dist/
pnpm --filter @bluelytics/web preview      # astro preview: the built Worker in workerd, local D1
pnpm --filter @bluelytics/web typecheck    # wrangler types && astro check && tsc (tests, scripts)
pnpm --filter @bluelytics/web test         # vitest
pnpm deploy:web [-- <flags>]               # wrangler types && astro build && wrangler deploy (flags reach wrangler, e.g. -- --dry-run)
```

`seed:local` applies the migrations (`wrangler d1 migrations apply bluelytics --local`), empties the
tables, loads the legacy goldens with `@bluelytics/db/testing` `seedFromGoldens` (daily history
2011-01-03 to 2026-11-20, currencies, alerts, latest rates), then adds deterministic synthetic
weekdays up to today, `extra_rates` (MEP, CCL, cripto, tarjeta, mayorista) and 24 h of source
observations (with one failing source, so `/estado` shows an alert). It writes through wrangler's
`getPlatformProxy`, i.e. the same `.wrangler/state` that `astro dev`/`astro preview` use. Re-run it at
any time; it never touches a remote database.

## Structure

| Path | What |
|---|---|
| `src/worker.ts` | Worker entry. `Site` (cached by Workers Cache) renders Astro; the default export is the uncached gateway |
| `src/lib/gateway.ts` | Gateway: drops tracking query params, `X-Robots-Tag: noindex` on every host but `PRODUCTION_HOSTNAME`, legacy `/index.html` (301) and `/privacy.html` (byte-identical legacy policy) |
| `src/i18n/routes.ts` | Route manifest: es/en paths → nav, canonical, hreflang (`es`, `en`, `x-default`), sitemaps |
| `src/i18n/ui.ts` | Shared copy; `pick(locale, es, en)` for page copy |
| `src/pages/**` | Thin wrappers: load data, set the cache policy, render a view. English under `src/pages/en/` |
| `src/views/*.astro` | One view per page, shared by both locales |
| `src/lib/` | Pure helpers (format, chart, series, sitemap, seo, calc, history) + D1 loaders (`data.ts`, `pages.ts`, `history-pages.ts`) |
| `src/client/` | Vanilla enhancers: chart hover/range presets, `<bl-calc>`, `<bl-gap>` |
| `scripts/seed-local.ts` | Local seed (above) |

## Routes

| es | en | Rendering / cache (edge `maxAge`/`swr`, browser `max-age`) |
|---|---|---|
| `/` | `/en` | SSR, 60 s / 240 s |
| `/dolar-oficial`, `/euro-blue`, `/brecha`, `/calculadora`, `/estado` | `/en/official-dollar`, `/en/blue-euro`, `/en/gap`, `/en/calculator`, `/en/status` | SSR, 60 s |
| `/evolucion`, `/historico` | `/en/evolution`, `/en/history` | SSR, 300 s / 3600 s |
| `/historico/YYYY[/MM[/DD]]` | `/en/history/…` | SSR; closed periods 1 day / 7 days, current ones 60–300 s; no data → 404 (never cached at the edge) |
| `/api`, `/acerca` | `/en/api`, `/en/about` | prerendered |
| `/sitemap.xml` (index), `/sitemap-pages.xml`, `/sitemap-history.xml` | | SSR, 1 h; hand-written with real `lastmod` and `xhtml:link` alternates |
| `/robots.txt`, `/llms.txt`, `/embed.js` | | prerendered |
| `/widget` (`?lang=en`, `?theme=dark\|light`) | | SSR 60 s, `noindex`, iframe target of `/embed.js` |
| `/data/series.json` | | SSR 300 s; full daily sell series for the chart range presets |
| `/privacy.html`, `/index.html` | | gateway (see above) |

Legacy hash URLs (`/#!/calculator`, `/#/gap`, …; `docs/legacy/legacy-frontend.md` §9.3) are forwarded
on the client by the home page script (`src/lib/legacy-hash.ts`), honouring the old
`NG_TRANSLATE_LANG_KEY` English preference.

## Configuration

- `wrangler.jsonc` vars: `PRODUCTION_HOSTNAME` (no `noindex` there), `MEDIA_ORIGIN` (the R2 public
  host; `og:image` = `${MEDIA_ORIGIN}/og/latest.jpg?v=<last change>`). D1 `database_id` is written by
  `pnpm infra:sync-ids`.
- Build-time public env (optional, unset = off): `PUBLIC_CF_BEACON_TOKEN` (embed the Cloudflare Web
  Analytics beacon; without it the zone's automatic injection applies), `PUBLIC_GA4_ID`,
  `PUBLIC_ANDROID_URL` / `PUBLIC_IOS_URL` (store badges hidden unless set).

## Design notes

- Tokens in `src/styles/global.css`: the dark theme is the social-card palette
  (`docs/research/social-channels-specs.md` §6.4); light keeps the logo hues. Theme follows the OS,
  toggle stored in `localStorage`. Moves always carry an arrow and a sign, not just colour.
- Inter variable (OFL, `@fontsource-variable/inter`), self-hosted, preloaded, with a metric-matched
  Arial fallback; CSS inlined into each page; no framework runtime.
- Charts: HTML + stretched SVG rendered on the server (`src/lib/chart.ts`), fixed CSS height (no
  layout shift); the client redraws with the same code for range presets and hover.
- Numbers are formatted from integers without `Intl` (es-AR: `$ 1.675`, `4,3 %`, 24-hour clock).
