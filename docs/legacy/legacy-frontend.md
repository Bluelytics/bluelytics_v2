# Legacy web frontend (`bluelytics_frontend`): implementer spec

Scope: `/home/sicarul/dev/bluelytics/bluelytics_frontend` (read-only). Analysis date: 2026-11-22.
All `file:line` references are relative to that repo unless stated otherwise.

How this was verified: every file under `app/` was read, plus `Gruntfile.js`, `config/`, `build.sh`, `privacy.html`, `README.md`, `bower.json`, `package.json`, `dist/` (file list and sizes only) and the git log. Live behaviour was then cross-checked with public GETs against `https://bluelytics.com.ar` / `https://api.bluelytics.com.ar` and a headless-browser session on the live site (desktop 1366 px and mobile 390 px, timezone America/Buenos_Aires). Screenshots of the live site are in
`/tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/research/legacy-frontend-screenshots/` (`fe-audit-rates-es.png`, `fe-audit-calculator-es.png`, `fe-audit-calculator-mobile.png`, `fe-audit-evolution-es.png`, `fe-audit-evolution-mobile.png`, `fe-audit-gap-es.png`, `fe-audit-api-es.png`).

No secrets were found in this repo's tracked files (the only config values are API base URLs; a pattern scan for keys/tokens/passwords matched nothing but the licence text). `build.sh` relies on the developer's local `s3cmd` configuration, which is not in the repo.

---

## 0. Key facts (read this first)

1. **What is deployed is exactly `dist/`**: live `index.html` is byte-identical to `dist/index.html`; S3 `Last-Modified` is 2023-12-19, the date of the last commit (`67687eb Remove tax calculation`). Nothing has shipped for ~3 years.
2. It is a **client-rendered AngularJS 1.7.9 single-page app with hash routing**. Live URLs are `https://bluelytics.com.ar/#!/…` (hash-bang, the Angular ≥1.6 default). Until the 2020 upgrade from Angular 1.3 they were `/#/…`. Old `#/…` links now silently bounce to the home page.
3. **Six live pages**: rates (`#!/`), calculator, evolution, gap ("brecha"), API docs, about. A seventh route, `#!/analysis`, still exists in the router but is **broken** (calls an API wrapper that was deleted in 2020) and is not in the menu.
4. The frontend consumes exactly **three API URLs**: `GET /v2/latest`, `GET /v2/evolution.json` (entire history, 9,365 rows / 721 KB JSON), `GET /data/json/currency.json` (169 currencies). `currency.json` is **not documented** on the API page but is also used by the mobile app.
5. **SEO is effectively zero**: `<title>bluelytics</title>` on every route, `<meta name="description" content="">`, no `lang`, no canonical, no OG/Twitter tags, no JSON-LD, no sitemap, hash routes (one indexable URL), all content rendered after 1 MB of JS plus two XHRs.
6. **The API docs page is wrong in one important place**: it documents the evolution JSON items as `day` / `type`, but the live JSON uses `date` / `source` (only the CSV uses `day,type`). Fix the docs, never the API.
7. **Both store links look dead** (probed 2026-11-22): the Google Play listing `com.bluelytics.mobileapp` returns 404 (control app returns 200) and the App Store id `1637362540` returns 404 on every storefront and 0 results from the iTunes lookup API. Needs owner confirmation before any store badge is carried over.
8. **Calculator FX table is stale**: `currency.json` reports ARS = 232.41 per USD and EUR = 0.92 (mid-2023 levels; official ARS/USD is ~1,574 today), and BTC/XAU/XPD/XPT = 0.00 (division by zero gives `Infinity`).
9. **Analytics**: Universal Analytics `UA-322483-2` (hard-coded; UA stopped processing in July 2023). At runtime `analytics.js` also pulls GA4 `G-64QZCDRTRP`, and Cloudflare injects its Web Analytics beacon.
10. `privacy.html` lives at the **repo root, outside the build**; it was uploaded to the bucket by hand and is live at `https://bluelytics.com.ar/privacy.html`. Easy to lose in a rewrite.

---

## 1. Stack, build and deploy

| Item | Value | Source |
|---|---|---|
| Scaffold | Yeoman `generator-angular 0.9.8`, generated 2014-10-13 | `Gruntfile.js:1` |
| Framework | AngularJS `1.7.x` (deployed bundle reports `1.7.9`) | `bower.json:5`, `dist/scripts/vendor.*.js` |
| Router | `angular-ui-router ~0.2.13`, hash mode, no `html5Mode`, default hash prefix `!` | `bower.json:28`, `app/scripts/app.js:29-73` |
| UI kit | `angular-material` pinned to git commit `80d5731d…` (a pre-1.0 build from April 2015) **plus** Bootstrap 3.2 (sass and dist CSS) | `bower.json:27,8`, `app/styles/main.scss:3` |
| Charts | `n3-line-chart 1.1.12` on d3 (bundle has d3 `3.5.5`) | `bower.json:19` |
| Slider | `angular-bootstrap-slider ~0.1.28` (seiyria bootstrap-slider) | `bower.json:20` |
| i18n | `angular-translate ~2.18.1`, static JSON loader, localStorage persistence | `bower.json:23-26`, `app/scripts/app.js:81-91` |
| Analytics | `angulartics ~0.17.1` + inline `analytics.js` snippet | `bower.json:22`, `app/index.html:213-228` |
| Other bundled libs | jQuery 2.1.3, underscore 1.7.0, moment, SHA-1, waypoints, fastclick, json3, es5-shim, angular-strap, ui-select, animate.css, angular-motion | `app/index.html:29-88` |
| Module deps actually declared | `ngAnimate, ngCookies, ngResource, ngSanitize, ui.select, n3-line-chart, underscore, ui.bootstrap-slider, mgcrea.ngStrap, angulartics, angulartics.google.analytics, pascalprecht.translate, ngMaterial, ui.router` | `app/scripts/app.js:12-27` |
| License | AGPL v3 | `LICENSE` |
| Tests | Yeoman boilerplate only (they assert `scope.awesomeThings.length === 3` and reference a non-existent `Valorblue` service). No real tests. | `test/spec/**` |
| CI | `.travis.yml` with node 0.10. Dead. | `.travis.yml` |

Backend URL injection: `Gruntfile.js:12-15` reads `config/${ENV||'development'}.json` and the `template` task renders `config/backendUrl.js.tpl` into `.tmp/scripts/services/backendUrl.js` as an Angular constant.

- `config/development.json`: `{"url": "http://localhost:8080/"}`
- `config/production.json`: `{"url": "https://api.bluelytics.com.ar/"}`
- template (`config/backendUrl.js.tpl:10-11`): `angular.module('bluelyticsFrontendApp').constant('backendUrl', '<%- backendUrl %>');`

Build pipeline (`Gruntfile.js:444-462`): `clean:dist, wiredep, template, i18nextract, ngtemplates, useminPrepare, concurrent:dist (compass + imagemin), autoprefixer, concat, ngAnnotate, copy:dist, cssmin, uglify, filerev, usemin, htmlmin`. Notes:

- `ngtemplates` (`Gruntfile.js:403-412`) inlines all `app/views/*.html` into `app/scripts/views/templates.js` (`$templateCache`). That file is git-ignored but present in the working tree and in sync with the views. Consequence: `https://bluelytics.com.ar/views/main.html` is 404 on the live site; the views exist only inside `scripts.*.js`.
- `copy:dist` (`Gruntfile.js:319-346`) copies only `app/*.{ico,png,txt}`, `app/*.html`, `images/material-design/*.svg`, `locale/*.json`, and the Bootstrap glyphicon fonts. **`privacy.html` (repo root) is not part of the build.**
- Requires Ruby Compass for Sass. The toolchain is unbuildable on a modern machine without effort; do not try to resurrect it.

Deploy (`build.sh:1-5`):

```sh
#!/bin/sh
ENV=production grunt build
cd dist
s3cmd sync . s3://bluelytics.com.ar
cd ..
```

So: S3 bucket named `bluelytics.com.ar` behind Cloudflare. Live response headers confirm it (`server: cloudflare`, `x-amz-*`, `x-amz-meta-s3cmd-attrs`, `cf-cache-status: HIT`). `cache-control: max-age=7200` was returned for every object checked (`index.html`, the fingerprinted vendor bundle, the API JSON files), so even immutable fingerprinted assets are only cached for 2 hours. `s3cmd sync` is run without `--delete-removed`, so old fingerprinted bundles most likely still sit in the bucket (not verified; no bucket access was used). No security headers at all on `index.html` (no HSTS, CSP, X-Content-Type-Options, Referrer-Policy).

Timing note: the live vendor bundle's `Last-Modified` is 2020-05-17 and `index.html`'s is 2023-12-19, so the Angular 1.7 build was deployed in May 2020, a few months before it was committed (`5a9a3bc`, 2020-09-20).

Host behaviour observed: `http://bluelytics.com.ar/` 301 to https; `https://www.bluelytics.com.ar/*` 301 to the apex (path preserved); `http://www…` takes two hops. Unknown paths return the custom `404.html` with a real 404 status.

### 1.1 What is in `dist/` (= what is live)

Total 1,934,522 bytes in 43 files.

| File | Raw bytes | gzip -9 | Notes |
|---|---:|---:|---|
| `index.html` | 5,431 | 1,784 | app shell only, no content |
| `scripts/vendor.ef4435b8.js` | 1,012,868 | 313,170 | render-blocking in `<head>`; served brotli, ~314 KB on the wire |
| `scripts/scripts.c6476c1c.js` | 22,758 | 5,350 | app code + inlined templates |
| `scripts/oldieshim.cb7c5977.js` | 20,695 | 7,707 | only for IE < 9 (conditional comment) |
| `styles/vendor.33508c6d.css` | 364,543 | 43,356 | bootstrap + angular-material + animate.css + ui-select + slider + angular-motion |
| `styles/main.172199ce.css` | 107,635 | 17,624 | a **second full copy of Bootstrap 3.2** + 79 lines of site CSS |
| `locale/es_AR.json`, `locale/en_US.json` | 7,108 / 6,787 | | both are always fetched |
| `images/material-design/*.svg` (15 sprite sets) | 179,237 total | | 4 sets (~55 KB raw) fetched to draw 8 icons |
| `images/*.png`, `loading.gif` | ~55 KB | | `logo.png` and `loading.gif` are unused |
| `bower_components/bootstrap-sass-official/assets/fonts/bootstrap/glyphicons-*` | 147,862 | | glyphicons are never used |
| `404.html`, `robots.txt`, `favicon.ico` | 3,150 / 31 / 1,150 | | |

`privacy.html` is not in `dist/` but is live (see section 9).

---

## 2. App shell, navigation and i18n mechanics

### 2.1 Shell (`app/index.html`)

- `<html class="no-js">` with no `lang` attribute (`:2`). `<title>bluelytics</title>` (`:5`). `<meta name="description" content="">` (`:6`). `<meta name="viewport" content="width=device-width">` (`:7`, no `initial-scale`).
- `<body ng-app="bluelyticsFrontendApp" ng-controller="HeaderController" ng-cloak>` (`:93`): the whole body is hidden until Angular boots.
- **Top toolbar** (`:95-111`): hamburger button (only below 960 px, `hide-gt-md`), `<h1>` with the text `Bluelytics` followed by the butterfly icon (32 px icon on small screens, 57 px icon otherwise; there is a stray `</a>` at `:99`), then two flag buttons (`images/flag_ar.png` for `es_AR`, `images/flag_us.png` for `en_US`; the active one gets `md-raised`), then a "more" (three dots) button that opens the right drawer. Flags and logo images have no `alt`.
- **Left drawer / main menu** (`:116-140`): locked open at ≥ 960 px (`md-is-locked-open="$mdMedia('gt-md')"`), otherwise a slide-in drawer. Header "Menu" (`INDEX.MENU.TITLE`). Items come from `HeaderController.menuoptions` (`app/scripts/controllers/index.js:46-77`), in this order:

  | # | ui-router state | Label key | es_AR | en_US | Icon |
  |---|---|---|---|---|---|
  | 1 | `rates` | `INDEX.MENU.RATE` | Cotización | Rate | `editor:attach_money` |
  | 2 | `calculator` | `INDEX.MENU.CALCULATOR` | Calculadora | Calculator | `action:swap_horiz` |
  | 3 | `evolution` | `INDEX.MENU.EVOLUTION` | Evolución | Evolution | `action:assessment` |
  | 4 | `gap` | `INDEX.MENU.GAP` | Brecha | Gap | `action:settings_ethernet` |
  | 5 | `api` | `INDEX.MENU.API` | API | API | `file:cloud` |
  | 6 | `about` | `INDEX.MENU.ABOUT` | Acerca de | About bluelytics | `action:info` |

  Plus a "Cerrar / Close" item on small screens. Clicking an item calls `navigateTo(url)` which closes the drawer and does `$state.go(url)` (`index.js:41-44`). Menu labels render upper-case (Material button style).
  Bug: the template uses `ng-class="{ active: isActive(item.url)}"` (`index.html:124`) but `isActive` is not defined anywhere, so the current page is never highlighted.
- **Right drawer / "extra"** (`:148-209`), in order:
  1. Google Play badge linking `https://play.google.com/store/apps/details?id=com.bluelytics.mobileapp`; image URL comes from the translation key `INDEX.ANDROIDAPP_IMAGE` (hot-linked from `developer.android.com`).
  2. App Store badge (`images/ios.png`, width 129) linking `https://apps.apple.com/am/app/bluelytics/id1637362540` (note the `am` = Armenia storefront in the URL).
  3. Instagram icon linking `https://www.instagram.com/bluelytics_dolar`.
  4. Facebook icon linking `https://www.facebook.com/bluelytics`.
  5. Twitter icon linking `https://www.twitter.com/bluelytics`.
  6. Credit: "Creado por / Created by" + `Pablo Seibelt`, linking `https://sicarul.com`.
  7. Close.
  Bugs: the drawer title is `{{INDEX.EXTRA.TITLE}}` (`:150`), a scope expression rather than a translation, and the key does not exist, so the title bar is empty. `ng-src="{{'INDEX.ANDROIDAPP_IMAGE' | translate}}"` (`:159`) resolves to the literal key before translations load, producing a 404 request for `https://bluelytics.com.ar/INDEX.ANDROIDAPP_IMAGE` on every page load.
- **Content area**: `<div … ui-view>` (`:143`).
- Inline Universal Analytics snippet + FastClick attach (`:213-228`), Google Fonts links at the end of `<body>` (`:254-255`).

### 2.2 Routes (`app/scripts/app.js:29-73`)

```js
$urlRouterProvider.otherwise('/');
$stateProvider
  .state('rates',      { url: '/',           templateUrl: 'views/main.html',       controller: 'MainCtrl' })
  .state('about',      { url: '/about',      templateUrl: 'views/about.html',      controller: 'AboutCtrl' })
  .state('calculator', { url: '/calculator', templateUrl: 'views/calculator.html', controller: 'CalculatorCtrl' })
  .state('evolution',  { url: '/evolution',  templateUrl: 'views/evolution.html',  controller: 'EvolutionCtrl' })
  .state('gap',        { url: '/gap',        templateUrl: 'views/gap.html',        controller: 'GapCtrl' })
  .state('api',        { url: '/api',        templateUrl: 'views/api.html',        controller: 'ApiCtrl' })
  .state('analysis',   { url: '/analysis',   templateUrl: 'views/analysis.html',   controller: 'AnalysisCtrl' });
```

No `$locationProvider` configuration, so with Angular 1.7 the live URLs are `/#!/`, `/#!/calculator`, `/#!/evolution`, `/#!/gap`, `/#!/api`, `/#!/about`, `/#!/analysis`. Unknown routes go to `/#!/`. Verified live: requesting `/#/calculator` (the pre-2020 form) or `/#!/forecast` ends on `/#!/` showing the rates page.

### 2.3 i18n mechanics (`app/scripts/app.js:81-91`)

```js
$translateProvider.useStaticFilesLoader({ prefix: 'locale/', suffix: '.json' })
  .registerAvailableLanguageKeys(['es_AR', 'en_US'],
      {'en_*': 'en_US', 'es_*': 'es_AR', 'en': 'en_US', 'es': 'es_AR'})
  .determinePreferredLanguage()
  .useLocalStorage()
  .fallbackLanguage(['es_AR', 'en_US']);
```

- Two languages: `es_AR` and `en_US`. Initial language is taken from the browser language (any `es*` gives Spanish, any `en*` gives English, anything else falls back to Spanish).
- The choice is persisted in `localStorage` under `NG_TRANSLATE_LANG_KEY`. The flag buttons call `$translate.use(langKey)` (`index.js:13-15`). The URL does not change with the language: there are no per-language URLs.
- Both JSON files are always downloaded (fallback chain).
- No sanitisation strategy is configured (angular-translate logs a security warning). `ABOUT.DESC_2` and `ABOUT.DESC_3` contain raw `<a>` HTML that is injected as-is.
- Numbers are formatted with Angular's `number` filter and the default `en-us` `$locale` in **both** languages, so Spanish users see `1,652.50` rather than the Argentine `1.652,50`.
- Chart tooltips and tick labels are not localised (`dd/mm/yyyy` in both languages).
- Angular Material theme (`app.js:93-97`): `primaryPalette('light-blue')`, `accentPalette('amber')`.
- Icon sets (`app.js:98-117`): 16 Material Design SVG sprite sets registered from `../images/material-design/<set>-icons.svg`; the `icons` set file does not exist. Only `navigation`, `editor`, `action`, `file` are used.

---

## 3. Data layer (`app/scripts/services/blueapi.js`)

Base URL constant `backendUrl` = `https://api.bluelytics.com.ar/` in production.

| Wrapper | Request | Options | Used by |
|---|---|---|---|
| `last_price` / `extended_last_price(cb)` | `GET {backendUrl}v2/latest` | `isArray:false, cache:true` (`:21-23`) | rates, calculator, gap |
| `all_currencies` | `GET {backendUrl}data/json/currency.json` | `isArray:true, cache:true` (`:25-27`) | calculator |
| `graph_data` / `graph_evolution_data(cb)` / `graph_gap_data(cb)` | `GET {backendUrl}v2/evolution.json` (no `days` param: full history) | `isArray:true, cache:true` (`:29-31`) | evolution, gap |

No query parameters are ever sent. `cache:true` is the in-memory `$http` cache: each URL is fetched once per page load and never refreshed (no polling, no auto-refresh; a tab left open shows stale prices forever). There is no error handling anywhere: if a request fails the spinner stays forever.

`extended_last_price` is now a pass-through (`:77-83`); the "extended" computation of day-over-day differences was removed in 2020.

### 3.1 Live response shapes (sampled 2026-11-22)

`GET /v2/latest` (`content-type: application/json; charset=UTF-8`, `access-control-allow-origin: *`, `cf-cache-status: DYNAMIC`, no `cache-control`):

```json
{"oficial":{"value_avg":1574.50,"value_sell":1601.00,"value_buy":1548.00},"blue":{"value_avg":1652.50,"value_sell":1670.00,"value_buy":1635.00},"oficial_euro":{"value_avg":1712.00,"value_sell":1741.00,"value_buy":1683.00},"blue_euro":{"value_avg":1796.00,"value_sell":1815.00,"value_buy":1777.00},"last_update":"2026-11-20T19:45:51.758024-03:00"}
```

`GET /v2/latest?callback=foo` returns `foo({...}\n);` with `content-type: application/javascript; charset=UTF-8` (JSONP works).

`GET /v2/evolution.json` (`cache-control: max-age=7200`): array of 9,365 objects, **newest first**, one `Oficial` and one `Blue` row per day, 4,683 distinct days from 2011-01-03 to 2026-11-20 (weekends included). 721,233 bytes uncompressed, about 31 KB on the wire with brotli.

```json
[{"date":"2026-11-20","source":"Oficial","value_sell":1595.00,"value_buy":1543.00},{"date":"2026-11-20","source":"Blue","value_sell":1665.00,"value_buy":1615.00},{"date":"2026-11-19","source":"Oficial","value_sell":1586.00,"value_buy":1533.00}]
```

(That sample is the literal response to `?days=3`: three **rows**, not three days. See section 5.3.)

`GET /data/json/currency.json` (`cache-control: max-age=7200`): array of 169 objects `{"code","name","value"}`; `name` is in Spanish; `value` is units of that currency per 1 USD rounded to 2 decimals. Order is by Spanish name (first items: PAB "Balboa", BTC "Bitcoin", SVC "Colón Salvadoreño", …). Examples today: `{"code":"USD","name":"Dólar estadounidense","value":1.0}`, `{"code":"EUR","name":"Euro","value":0.92}`, `{"code":"BRL","name":"Real brasileño","value":5.0}`, `{"code":"ARS","name":"Peso argentino","value":232.41}`, and BTC/XAU/XPD/XPT with `value: 0.0`.

### 3.2 Daily series derivation used by both charts (`blueapi.js:35-69`)

```js
var dateFormat = d3.time.format.utc('%d/%m/%Y');          // :15

function groupGraphData(rawData){
    var transformRawData = function transformRawData(raw){
      return _.chain(raw).map(function(b){
        var tmp_date = new Date(b.date);
        b.epoch = tmp_date.getTime()/1000;
        b.datepart = dateFormat(tmp_date);
        return b;
      }).value();
    };
    var allData = transformRawData(rawData);
    var dataByDate = _.groupBy(allData, function(a){return a.datepart;});
    var finalGrouped = _.chain(dataByDate).map(function(d){
      var max_oficial = _.max(d, function(val){
        if (val.source === 'Oficial'){return val.value_sell;} else {return 0;}
      }).value_sell;
      var sum_blue = _.reduce(d, function(memo, sum){
        if (sum.source !== 'Oficial'){ return memo + sum.value_sell;} else {return memo;}
      }, 0);
      var count_blue = _.chain(d).filter(function(c) {
        return c.source !== 'Oficial';
      }).size().value();
      return {'date': dateFormat.parse(d[0].datepart), 'oficial': max_oficial, 'blue': sum_blue/count_blue};
    }).filter(function(d){
      return (d.oficial > 0 && d.blue > 0 && (d.oficial - d.blue) !== 0);
    }).sortBy(function(d){return d.date;}).value();
    return finalGrouped;
}
```

In words, per calendar day:

- `oficial` = max `value_sell` among rows with `source === 'Oficial'`.
- `blue` = arithmetic mean of `value_sell` among all rows whose source is not `'Oficial'` (historically several blue sources per day; today exactly one `Blue` row).
- `date` = that day at 00:00 **UTC**.
- A day is **dropped** unless `oficial > 0 && blue > 0 && oficial !== blue`.
- Result sorted ascending by date.

Both charts therefore plot **sell** values (`value_sell`), not the average. Replaying this on today's data: 4,683 days in, 3,550 points out; 1 day lacks a source and **1,132 days are dropped only because blue sell equals oficial sell** (for example 2025-06-26, 2025-10-07, 2026-05-28, 2026-05-29, 2026-06-19, 2026-10-08), leaving holes that the line simply bridges. First plotted point is 2011-11-01. There are 278 days where blue < oficial (negative gap), most recently 2026-11-11 to 2026-11-13.

Gap series (`blueapi.js:17-19, 100-114`):

```js
var percGap = function percGap(ofi, blue){ return (blue - ofi) / ofi; };
…
graph_gap_data = _.chain(groupGraphData(rawData)).map(function(d){
  return {'date': d.date, 'brecha': percGap(d.oficial, d.blue)*100};
}).value();
```

`brecha` (percent) = `(blue_sell − oficial_sell) / oficial_sell × 100`. Both derived arrays are memoised in the service for the life of the page.

---

## 4. Pages

Common to every data page: a centred `<h2>` title, and an indeterminate Material circular spinner while `loading` is true.

### 4.1 Rates / "Cotización" (home)

- URL `/#!/`; template `app/views/main.html`; controller `app/scripts/controllers/main.js`.
- Fetch: `GET /v2/latest` once.
- Controller (`main.js:12-21`):

  ```js
  $scope.loading = true;
  $scope.selectedIndex = 1;
  blueAPI.extended_last_price(function(value){
    $scope.loading = false;
    $scope.dolares = value;
    delete $scope.dolares.last_update;
    delete $scope.dolares.oficial_euro;
    delete $scope.dolares.blue_euro;
  });
  ```

- What the user sees: `<h2>` "Dólar en Argentina" / "Dollar in Argentina" (`RATE.TITLE`), then a two-tab strip built from the remaining response keys in JSON order: tab 0 **Oficial** / "Official", tab 1 **Dólar Blue** / "Blue Dollar" (labels via `'COMMON.DOLARES.' + key`). `selectedIndex = 1`, so **Blue is the default tab**. Each tab shows three rows (label right-aligned 40 %, value bold 1.7em):

  | Row label key | es_AR | en_US | Value |
  |---|---|---|---|
  | `RATE.BID` | Compra | Bid | `dolar.value_buy \| number:2` |
  | `RATE.AVG` | Intermedio | Average | `dolar.value_avg \| number:2` |
  | `RATE.ASK` | Venta | Ask | `dolar.value_sell \| number:2` |

  Live render (es_AR, 2026-11-22): Blue tab "Compra 1,635.00 / Intermedio 1,652.50 / Venta 1,670.00"; Oficial tab "1,548.00 / 1,574.50 / 1,601.00".
- No calculations; values are shown as the API returns them. No currency symbol, no units.
- **Not shown, although the API provides it**: `last_update` (deliberately deleted, so the user never sees how fresh the price is), the euro quotes (`oficial_euro`, `blue_euro`), any day-over-day variation.
- Dead code in the controller: `esOficial`, `esBlue`, `iconFor`, `classFor` (`main.js:23-53`) and the `.trend.up/.down/.neutral` and `.tax` CSS; they belonged to the removed "difference with yesterday" arrows and the removed tax surcharge (see section 12).

### 4.2 Calculator / "Calculadora Blue"

- URL `/#!/calculator`; template `app/views/calculator.html`; controller `app/scripts/controllers/calculator.js`.
- Fetch: `GET /v2/latest` and `GET /data/json/currency.json`.
- State and defaults (`calculator.js:14-18, 37`): `moneda = {}`, `calculo = { ars: 0, ext: 0 }`, `dolares_keys = ['blue', 'oficial']`. After currencies load, the selected currency is set to the entry with `code === 'USD'` (`:40-48`). After `/v2/latest` loads, `cambiarDolar('blue')` is called (`:32-35`).
- Formulas (`calculator.js:20-30, 51-55`), quoted exactly:

  ```js
  $scope.update_ars = function update_ars(){
      if($scope.valor_dolar && $scope.moneda.selected){
          $scope.calculo.ars =  parseFloat( (($scope.calculo.ext / $scope.moneda.selected.value) * $scope.valor_dolar).toFixed(2));
      }
  };
  $scope.update_ext = function update_ext(){
      if($scope.valor_dolar && $scope.moneda.selected){
          $scope.calculo.ext =  parseFloat( (($scope.calculo.ars / $scope.valor_dolar) * $scope.moneda.selected.value).toFixed(2));
      }
  };
  $scope.cambiarDolar = function cambiarDolar(newVal){
      $scope.dolar_activo = $scope.dolares[newVal];
      $scope.valor_dolar = $scope.dolar_activo.value_avg;
      $scope.update_ext();
  };
  ```

  So: `valor_dolar` = **`value_avg`** of the chosen dollar type (not buy, not sell); `moneda.selected.value` = units of the foreign currency per 1 USD.
  - foreign = `round2( ars / valor_dolar × fx )`
  - ars = `round2( foreign / fx × valor_dolar )`
  - Rounding: `toFixed(2)` then `parseFloat` (trailing zeros dropped in the input).
- UI, top to bottom (`calculator.html`):
  1. `<h2>` "Calculadora Blue" / "Blue Calculator".
  2. Tabs: **Dólar Blue** (default, index 0) and **Oficial**; selecting a tab calls `cambiarDolar(key)`, which keeps the ARS amount and recomputes the foreign amount.
  3. Label "Moneda Extranjera:" / "Foreign currency" and a searchable `ui-select` (min-width 300 px) of the 169 currencies; the selected item shows the Spanish `name`; options show `name (code)` with search highlighting; the placeholder "Seleccione la moneda" is hard-coded Spanish (`calculator.html:26`). Changing the currency calls `update_ext()` (ARS stays fixed).
  4. Two bold info lines (`calculator.html:37-38`): `{{valor_dolar | number:2}} ARS ≈ 1 USD` and `1 USD ≈ {{moneda.selected.value | number:2}} {{moneda.selected.code}}`. Live: "1,652.50 ARS ≈ 1 USD" and "1 USD ≈ 1.00 USD".
  5. Number input "Cantidad de pesos argentinos (ARS)" / "Amount in Argentinian Pesos (ARS)" bound to `calculo.ars` (`type=number min=0 step=any required`, `ng-change="update_ext()"`).
  6. Number input "Cantidad de moneda extranjera ({{code}})" / "Amount in foreign currency ({{code}})" bound to `calculo.ext` (`ng-change="update_ars()"`).
- Verified live with Blue avg 1652.5: 100,000 ARS gives 60.51 USD; with EUR (fx 0.92) gives 55.67 EUR; 100 EUR gives 179,619.57 ARS; switching to Oficial (1574.5) with 1,000 ARS gives 0.64 USD.
- Problems:
  - **FX table is stale** (EUR 0.92, ARS 232.41, BRL 5.00 are mid-2023 values) so every non-USD conversion is wrong today. The API also offers `blue_euro` / `oficial_euro` in `/v2/latest`, which the calculator ignores.
  - BTC, XAU, XPD, XPT have `value: 0.00`, so `update_ars` divides by zero and shows `Infinity`.
  - "Peso argentino (ARS)" appears in the foreign currency list with a meaningless value.
  - Currency names are Spanish only, even in English mode.
  - Race: `md-on-select="cambiarDolar(dolar)"` can fire before `/v2/latest` has resolved, throwing `Cannot read properties of undefined` (harmless, self-heals).

### 4.3 Evolution / "Evolución Dólar Blue"

- URL `/#!/evolution`; template `app/views/evolution.html`; controller `app/scripts/controllers/evolution.js`.
- Fetch: `GET /v2/evolution.json` (full history), transformed by `groupGraphData` (section 3.2).
- UI: `<h2>` "Evolucion Dólar Blue" / "Blue Dollar Evolution"; a 400 px-high line chart; below it a two-handle range slider with the tooltip "Cambiar el periodo a revisar" / "Change the time range here".
- Chart options (`evolution.js:46-67`), quoted exactly:

  ```js
  $scope.options = {
    axes: {
      x: {key: 'date', type: 'date', labelFunction: function(d){return dateFormat(d);}},
      y: {type: 'linear'},
    },
    series: [
      {y: 'blue', color: 'steelblue', axis:'y', type: 'line',thickness: '1px', label: 'Dolar Blue'},
      {y: 'oficial', color: 'green', axis:'y',  type: 'line', thickness: '1px', label: 'Dolar Oficial'}
    ],
    tooltip: {
      mode: 'scrubber',
      formatter: function (x, y) {
        return dateFormat(x) + ' : ' + y.toFixed(2);
      }
    },
    stacks: [],
    lineMode: 'linear',
    tension: 0.7,
    drawLegend: true,
    drawDots: false,
    columnsHGap: 5
  };
  ```

  with `dateFormat = d3.time.format.utc('%d/%m/%Y')` (`:14`). Series labels are replaced by the translations `COMMON.DOLARES.blue` and `COMMON.DOLARES.oficial` and re-translated on language change (`:70-83`).
  - X axis: time, key `date`, tick labels `dd/mm/yyyy`.
  - Y axis: linear, automatic domain, d3 default ticks with US thousands separators (rendered `0, 200, … 1,800` today).
  - Two 1 px lines: Blue in `steelblue` (#4682B4), Oficial in `green` (#008000). Both are **sell** prices.
  - Legend below the chart ("Dólar Blue", "Oficial"); n3-line-chart lets the user click a legend item to toggle that series.
  - Tooltip: scrubber mode; hovering shows `dd/mm/yyyy : value` with 2 decimals per series.
  - Chart text uses the library's monospace font; SVG is 1030×400 at a 1366 px viewport and 374×400 at 390 px.
- Range slider (`evolution.js:24-33`, `evolution.html:15`):

  ```js
  $scope.filter = {};
  $scope.filter.maxValue = 300;
  $scope.filter.value = [$scope.filter.maxValue - $scope.filter.maxValue/3,$scope.filter.maxValue];   // [200, 300]
  $scope.filterData = function(){
    var step = $scope.data.length / $scope.filter.maxValue;
    var start = Math.floor($scope.filter.value[0] * step);
    var end = Math.ceil($scope.filter.value[1] * step);
    $scope.filteredData = $scope.data.slice(start,end+1);
  };
  ```

  ```html
  <slider style="width:100%;" ng-model="filter.value" ng-change="filterData()" min="0" step="1" max="filter.maxValue" range="true" tooltip="hide">
  ```

  The slider is an abstract 0–300 scale mapped proportionally onto the array index; it is not date-aware and shows no labels. The chart is bound to `filteredData`.
- **Intended default vs actual default**: the code intends to show the last third of history (`[200, 300]`). Live, the slider directive resets the model to `[0, 300]` when it initialises, and what the chart shows depends on whether the data arrives before or after that reset:
  - Data arrives after the slider initialises (observed on a fresh load of the evolution page, where the JSON comes from the network): the chart shows the **entire history from 2011-11-01**, handles at 0 % and 100 %.
  - Data arrives before the reset (observed on the gap page opened after the evolution page, when the JSON was already in the in-memory HTTP cache): the chart shows the **last third** (1,184 of 3,550 points, starting mid-2022) while the handles still sit at 0 % and 100 %.

  Treat "default range" as undefined legacy behaviour and pick a deliberate default in v2.
- Mobile rule (`evolution.js:39-41`):

  ```js
  if($window.innerWidth < 768 && evData.length > 60){
    evData.splice(0, evData.length - 60);
  }
  ```

  Below 768 px wide only the **last 60 data points** are kept (verified at 390 px: 60 points starting 2026-08-28). This mutates the memoised array, so widening the window afterwards does not bring the history back.
- Markup bug: `<md-content>` is used as a closing tag (`evolution.html:18`).

### 4.4 Gap / "Brecha dólar blue"

- URL `/#!/gap`; template `app/views/gap.html`; controller `app/scripts/controllers/gap.js`.
- Fetch: `GET /v2/latest` (headline numbers) and `GET /v2/evolution.json` (chart).
- Headline calculator (`gap.js:16-27, 56-60`), quoted exactly:

  ```js
  $scope.valorCompare = 200;
  $scope.valorDolarBlue = 0;
  $scope.valorDolarOficial = 0;
  $scope.gap = function gap(ofi, blue){ return blue - ofi; };
  $scope.percGap = function percGap(ofi, blue){ return (blue - ofi) / ofi; };
  …
  blueAPI.extended_last_price(function(dolares){
    $scope.loading = false;
    $scope.valorDolarOficial = dolares.oficial.value_avg;
    $scope.valorDolarBlue = dolares.blue.value_avg;
  });
  ```

  Template (`gap.html:9-28`):
  - Number input labelled "¿Cuantos Dólares (USD) utilizar para la comparacion?" / "Dollars to compare", bound to `valorCompare`, default **200**, `min=1 step=any required`.
  - Sub-header "Oficial vs Dólar Blue" / "Official vs Blue Dollar".
  - Primary (light-blue) pill: `AR$ {{valorCompare * gap(valorDolarOficial, valorDolarBlue) | number:2}}` with tooltip "Diferencia absoluta (ARS)" / "Absolute gap in AR$".
  - Accent (amber) pill: `({{ percFormat(percGap(valorDolarOficial, valorDolarBlue)) }})` with tooltip "Diferencia relativa (%)" / "Relative gap in percentage"; `percFormat = d3.format('.02%')` (`gap.js:32`).

  So: absolute = `USD amount × (blue_avg − oficial_avg)`; relative = `(blue_avg − oficial_avg) / oficial_avg` as a percentage with 2 decimals. Both use **`value_avg`**. Live today: "AR$ 15,600.00" and "(4.95%)" (1652.5 vs 1574.5, 200 USD).
- Chart: `<h3>` "Evolución brecha cambiaria" / "Gap evolution chart", 400 px high. Options (`gap.js:75-94`), quoted exactly:

  ```js
  $scope.options = {
    axes: {
      x: {key: 'date', type: 'date', labelFunction: function(d){return dateFormat(d);}},
      y: {type: 'linear'},
    },
    series: [
      {y: 'brecha', color: 'red', axis:'y', type: 'line',thickness: '1px', label: 'Brecha'}
    ],
    tooltip: {
      mode: 'scrubber',
      formatter: function (x, y) {
        return dateFormat(x) + ' : ' + $scope.percFormat(y/100);
      }
    },
    stacks: [],
    lineMode: 'linear',
    drawLegend: true,
    drawDots: false,
    columnsHGap: 5
  };
  ```

  One red 1 px line, series `brecha` in percent (section 3.2, **sell-based**), label translated via `GAP.GAP` ("Brecha" / "Gap"). Y ticks are bare numbers without a `%` sign (today −20 … 200). Tooltip `dd/mm/yyyy : 4.39%`. Same 0–300 range slider, same mobile 60-point rule (`gap.js:43-52, 67-69`). All-time maximum in the plotted series: 198.9 % on 2023-10-23.
- Problems:
  - **Inconsistent definitions on one page**: the headline uses averages from `/v2/latest` (4.95 % today) while the chart uses sell prices from the daily series (last point 4.39 %).
  - **Dates are off by one day in Argentina**: this controller formats with local-time `d3.time.format('%d/%m/%Y')` (`gap.js:13, 31`) but the points are at 00:00 UTC, so in UTC−3 the point for 2026-11-20 is labelled `19/11/2026` (verified live). The evolution page uses the UTC formatter and is correct.
  - X tick labels overlap into an unreadable band at desktop width (see `fe-audit-gap-es.png`).
  - The slider is nested inside the fixed 400 px chart container (`gap.html:36-46`) and is pushed out of view; unclosed `<md-content>`.
  - Days with exactly zero gap are missing from the series (the `oficial !== blue` filter).

### 4.5 API docs

- URL `/#!/api`; template `app/views/api.html`; controller `app/scripts/controllers/api.js` (empty). Fully static. Reproduced in section 5.

### 4.6 About / "Acerca de Bluelytics"

- URL `/#!/about`; template `app/views/about.html`; controller empty. Static: `<h2>` `ABOUT.TITLE`, five centred paragraphs `ABOUT.DESC_1 … DESC_5` (max-width 1000 px), then the link `https://github.com/Bluelytics`.
- Rendered Spanish text: "Acerca de Bluelytics. Bluelytics es una herramienta de analisis vivo del Dólar Blue. Podes descargarte la aplicacion móvil para Android desde Google Play. Si tenes comentarios o queres seguir las novedades sin entrar en la pagina, te recomiendo sigas a Bluelytics en Facebook y Twitter. Esta aplicacion web fue creada por Pablo Seibelt, no tengo contacto con ninguna cueva, unicamente descargo los valores disponibles en otras paginas y los publico aqui. El codigo fuente del mismo es libre (AGPL) y esta disponible en: https://github.com/Bluelytics".
- Links inside the copy: Google Play (`…id=com.bluelytics.mobileapp`), `https://www.facebook.com/bluelytics`, `https://www.twitter.com/bluelytics`, `https://github.com/Bluelytics`.

### 4.7 Analysis / "Analisis de variables del BCRA" (dead)

- URL `/#!/analysis`; template `app/views/analysis.html`; controller `app/scripts/controllers/analysis.js`. Not in the menu.
- **Broken since the 2020 release**: the controller calls `blueAPI.analysis_data.query(…)` (`analysis.js:81`) but `analysis_data` was removed from the service in commit `5a9a3bc`. Live result: a TypeError, and the page shows the raw keys "ANALYSIS.TITLE ANALYSIS.DESCRIPTION". The old data URL `{backendUrl}data/graphs/bcra.json` now returns 404.
- What it used to do (for the record): a dropdown of 20 BCRA variables, default `Reservas`, one `steelblue` line per selected field over time, same slider and mobile rule. Fields (`analysis.js:36`): `CER, CambioRef, BADLAR, TasasInteres30Dias, TasasInteresEntrePrivadas, PrestamosAPrivados, OtrosDepositos, APlazo, CajasAhorro, CuentasCorrientes, DepositosFinancieras, LEBAC, DepositosBCRA, EfectivoFinanciero, BilletesPublico, Circulacion, BaseMonetaria, Asistencia, Reservas, DolarImplicito`. Input rows had an ISO `date` (`%Y-%m-%d`) plus one numeric property per field. Labels are in `ANALYSIS.VARIABLES.*` (appendices).

### 4.8 Static pages outside the SPA

- `app/404.html`: HTML5-Boilerplate 404 page, `<html lang="en">`, `<title>Page Not Found :(</title>`, body text in Spanish: `<h1><span>Error:</span> Pagina no encontrada</h1>`, "Lo siento, la pagina que esta buscando no se encuentra aqui.", link "Volver a Bluelytics" to `/`. Colours: text #737373 on #f0f0f0, card #fcfcfc. Served with a real 404 status.
- `privacy.html` (repo root): see section 9.2.

---

## 5. API docs page (`app/views/api.html`): exact content

This page is the only human-readable description of the public contract. Below is what it renders, in order, with both languages. Structure: everything is inside `.infopage` (max-width 1000 px, centred text); attribute tables are Bootstrap striped tables with nested bordered tables.

### 5.1 Header

| Element | es_AR | en_US |
|---|---|---|
| `<h3>` `API.TITLE` | API JSON Dólar Blue | API JSON Dolar Blue |
| Warn-coloured button linking to the rates page, `API.WARN` | Si usted no es un usuario tecnico, ignore esta pagina. | If you are a non-technical user, ignore this page. |
| `<p>` `API.DESCRIPTION` | La API que esta disponible a continuacion es de libre uso, no requiere autenticacion, es un simple JSON. | The API exposed has no use terms, and doesn't require authentication, it's a simple JSON response. |
| `<h3>` `API.V2` | API Actual (v2) | Current API (v2) |

### 5.2 "Ultimos valores" / "Latest values" (`<h4>` `API.LAST_PRICE_V2`)

- Link (text and href): `https://api.bluelytics.com.ar/v2/latest`
- `<h5>` `API.PARAMETERS`: "Parametros opcionales" / "Optional parameters"
- `API.PARAMETERS_TEXT`:
  - es: "La URL tal cual esta especificada devuelve una respuesta JSON, si necesita una respuesta JSONP (Por ejemplo para un widget) puede agregar ?callback=nombre, donde nombre es una cadena de caracteres arbitraria. Esto lo hace automaticamente por ejemplo jQuery al solicitar un JSONP."
  - en: "The URL as it is specified responds with a JSON object, if you need a JSONP response (For example to populate a widget) you can add ?callback=name, where name is any string. This is done automatically for example by jQuery when using the JSONP protocol."
- `API.FORMAT_TEXT`: "La respuesta es un objeto JSON con los siguientes atributos" / "The response is a JSON object with the following attributes"
- Attribute table:

  | Attribute | Sub-attribute | es_AR | en_US |
  |---|---|---|---|
  | `last_update` | | Ultima actualizacion del valor reportado | Latest update for reported values |
  | `oficial` | `value_buy` | Valor de compra del dólar oficial | Official Dollar buy value |
  | | `value_avg` | Valor promedio del dólar oficial | Official Dollar average value |
  | | `value_sell` | Valor de venta del dólar oficial | Official Dollar sell value |
  | `oficial_euro` | `value_buy` | Valor de compra del euro oficial | Official Euro buy value |
  | | `value_avg` | Valor promedio del euro oficial | Official Euro average value |
  | | `value_sell` | Valor de venta del euro oficial | Official Euro sell value |
  | `blue` | `value_buy` | Valor de compra del dólar blue | Blue Dollar buy value |
  | | `value_avg` | Valor promedio del dólar blue | Blue Dollar average value |
  | | `value_sell` | Valor de venta del dólar blue | Blue Dollar sell value |
  | `blue_euro` | `value_buy` | Valor de compra del euro blue | Blue Euro buy value |
  | | `value_avg` | Valor promedio del euro blue | Blue Euro average value |
  | | `value_sell` | Valor de venta del euro blue | Blue Euro sell value |

  The page lists the attributes in the order `last_update, oficial, oficial_euro, blue, blue_euro` and sub-attributes as `value_buy, value_avg, value_sell`. The live JSON key order is `oficial, blue, oficial_euro, blue_euro, last_update` with sub-keys `value_avg, value_sell, value_buy`.

### 5.3 "Valor historico de un dia especifico" / "Historical value for a specific day" (`<h4>` `API.HISTORICAL_PRICE_V2`)

- Link text: `https://api.bluelytics.com.ar/v2/historical?day=YYYY-MM-DD`; link href: `https://api.bluelytics.com.ar/v2/historical?day=2023-08-01`
- `API.FORMAT_TEXT` again, then a table with only `oficial` and `blue`, each with `value_buy`, `value_avg`, `value_sell` (same descriptions as above). No `last_update`, no euro.
- Live check: `{"oficial":{"value_avg":284.00,"value_sell":289.00,"value_buy":279.00},"blue":{"value_avg":557.50,"value_sell":560.00,"value_buy":555.00}}`. Matches the docs.

### 5.4 "Toda la data historica (JSON)" / "All historical data (JSON)" (`<h4>` `API.JSON_EVOLUTION_API`)

- Link: `https://api.bluelytics.com.ar/v2/evolution.json`
- `API.EVOLUTION.DAYS_PARAM`: "El parametro GET opcional 'days' te permite bajar los ultimos X dias en vez de toda la historia." / "Optional GET parameter 'days' allows you to get last X days instead of all history."
- Table, first column `API.ARRAY_ITEMS` ("Objetos de lista (array)" / "Array items"):

  | Field as documented | es_AR | en_US |
  |---|---|---|
  | `day` | Dia de este precio | Day for this exchange rate |
  | `type` | Tipo de tasa de cambio (Oficial o Blue) | Type of exchange rate (Oficial is the government rate, Blue is the free market) |
  | `value_sell` | Valor de venta, el valor promedio que pide un vendedor | Sell (ask) value, average rate asked for by sellers |
  | `value_buy` | Valor de compra, el valor promedio que ofrece un comprador | Buy (bid) value, average rate bidded for by buyers |

- **Docs errors found by comparing with the live API**:
  1. The live JSON items are `{"date": "YYYY-MM-DD", "source": "Oficial"|"Blue", "value_sell": n, "value_buy": n}`. The field names `day` and `type` exist only in the CSV header. The site's own chart code reads `b.date` and `b.source` (`blueapi.js:38, 51`), which proves `date`/`source` is the real JSON contract.
  2. `?days=3` returned **3 rows** (two for 2026-11-20, one for 2026-11-19), not three days. Either the parameter counts rows or the docs are imprecise; the v2 implementation must replicate today's behaviour and the docs should describe it accurately.
  3. Ordering (newest first) and the fact that weekends are present are not documented.
  4. The table markup is missing its opening `<tr>` (`api.html:164-165`).

### 5.5 "Toda la data historica (CSV)" / "All historical data (CSV)" (`<h4>` `API.CSV_EVOLUTION_API`)

- Link: `https://api.bluelytics.com.ar/v2/evolution.csv`, followed by the same `DAYS_PARAM` sentence. No field table.
- Live: `content-type: text/csv`; header row `day,type,value_buy,value_sell`; rows like `2026-11-20,Oficial,1543.00,1595.00` (note buy comes before sell, and the header uses `day`/`type`).

### 5.6 "API anterior (v1)" / "Old API (v1)" (`<h3>` `API.OLD_API`)

- `<h4>` `API.LAST_PRICE`: "Ultimo precio" / "Last price"; link `https://api.bluelytics.com.ar/json/last_price`. No format description.
- Live: an array of two objects `{"date","source","value_avg","value_sell","value_buy"}` with `source` `"oficial"` and `"blue"`. Observation for whoever owns the API rewrite: at the time of the check the `blue` entry carried exactly the same three values as the `oficial` entry (1574.50 / 1601.00 / 1548.00) while `/v2/latest` showed blue at 1652.50 / 1670.00 / 1635.00. Looks like a live bug in v1; decide consciously whether to reproduce or fix it.

### 5.7 "Bindings" (`<h3>` `API.BINDINGS`)

- `API.BINDINGS_DESCRIPTION`: "Estan disponibles los siguientes bindings para utilizar la API de Bluelytics" / "The following bindings are available for the Bluelytics API"
- Table headers `API.BINDINGS_TABLE.LANGUAGE` / `.URL`: "Tecnologia", "URL" / "Technology", "URL".

  | Technology (literal text) | Link text | href |
  |---|---|---|
  | Laravel (PHP) (API v1) | fedeisas/laravel-dolar-blue | `https://github.com/fedeisas/laravel-dolar-blue` |
  | NodeJS (Javascript) (API v1) | matiu/dolar-blue | `https://github.com/matiu/dolar-blue` |
  | Odoo (Python) (API v1) | morrillo/currency_usd_update | `https://github.com/morrillo/currency_usd_update` |

  All three GitHub URLs return 200 today. All three target the v1 endpoint, which is a strong reason to keep `/json/last_price` alive.

### 5.8 What the docs page does not document but consumers use

- `GET /data/json/currency.json` (web calculator and mobile app `bluelytics_mobile_v3/screens/CalculatorScreen.js:45`).
- JSONP is only mentioned under `/v2/latest`.
- CORS (`access-control-allow-origin: *`), caching, rate limits, update frequency, time zone of `last_update` (ISO-8601 with `-03:00` offset and microseconds), number format (2 decimals).
- No machine-readable spec (no OpenAPI), no code samples, no example response bodies.

---

## 6. SEO state today

| Aspect | Current state | Why it is a problem |
|---|---|---|
| Title | `<title>bluelytics</title>`, never changed per route | No keywords ("dólar blue hoy", "cotización"), identical for all pages |
| Meta description | `<meta name="description" content="">` | Empty |
| `lang` | none on `<html>`; `404.html` says `lang="en"` with Spanish text | Search engines must guess the language |
| Rendering | Body is an empty Angular shell behind `ng-cloak`; prices appear only after a 1 MB blocking script, a locale XHR and an API XHR | No price or text content in the HTML source; crawlers that do not run JS see only "Bluelytics" and link labels |
| Routing | Hash-bang routes (`/#!/calculator` …) | Fragments are not sent to servers and are ignored by crawlers: the whole site is **one URL**. The old `_escaped_fragment_` scheme is long dead. Path URLs like `/calculator` return 404 |
| Headings | Three `<h1>`s in the shell ("Bluelytics", "Menu", and an empty one), page title in `<h2>` rendered client-side | No meaningful `<h1>` |
| Canonical | none | |
| hreflang / language URLs | none; language is a localStorage preference on the same URL | English content is invisible to search |
| robots.txt | `# robotstxt.org` + `User-agent: *` and nothing else | Allows everything (fine) but has no `Sitemap:` line |
| Sitemap | none (`/sitemap.xml` is 404) | |
| Structured data | none (0 JSON-LD blocks) | No `ExchangeRateSpecification`, `WebSite`, `Organization`, `FAQPage`, `Dataset` |
| Social tags | no Open Graph, no Twitter Card | Shared links (WhatsApp, X, Telegram) show a bare title and no image |
| Icons / PWA | `favicon.ico` 16×16 only; four `apple-touch-icon`s; no manifest, no `theme-color` | |
| Images | logo and flags without `alt` | |
| Freshness signals | `last_update` is deleted before render; no dates on the page | Users and crawlers cannot tell how current the quote is |
| Content depth | Home page text is three numbers; no explanatory copy, no FAQ, no historical pages | Nothing to rank for long-tail queries ("dólar blue 1 de agosto 2023", "brecha cambiaria") |
| Internal links | Menu items are `<md-button ng-click>`; no `<a href>` | Not crawlable |
| Number format | `1,652.50` for Spanish users | Reads as foreign to the target audience |
| Mobile | `width=device-width` without `initial-scale`; FastClick still attached | |

### 6.1 Performance facts

- Dev `index.html` has **75 `<script>` tags** (60 Bower vendor scripts, 2 IE shims, 12 app scripts, 1 inline) and 9 stylesheet links (6 Bower, 1 app, 2 Google Fonts). Built `index.html` has 3 external scripts + 1 inline, 2 local stylesheets + 2 Google Fonts stylesheets.
- Render-blocking: `vendor.js` (1,012,868 B raw, about 314 KB compressed) sits in `<head>` with no `defer`; two CSS files total 472 KB raw (about 61 KB gzip).
- Measured in a real browser on the home page: about 35 requests, about 430 KB transferred from first-party hosts (plus GA, gtag, Cloudflare beacon); DOMContentLoaded 0.29 s and load 0.74 s on a fast desktop connection with a warm edge cache. The cost is CPU/parse on phones and the blank screen until Angular boots, not bytes on a good line.
- Dead weight shipped: Bootstrap CSS twice; Bootstrap JS twice (12 individual modules plus `bootstrap.js`); 17 angulartics vendor plugins (only GA is used); moment, SHA-1, waypoints, json3, es5-shim, angular-touch, angular-route, angular-cookies, animate.css, angular-motion, angular-strap (only its tooltip provider is configured); glyphicon fonts; 11 unused icon sprite files; `logo.png`, `loading.gif`.
- **Google Fonts `Ruda` and `Roboto Slab` are requested but referenced by no CSS rule.** The effective fonts are Bootstrap's `"Helvetica Neue", Helvetica, Arial, sans-serif` for content and Angular Material's `RobotoDraft, Roboto, 'Helvetica Neue', sans-serif` for Material components (RobotoDraft is not loaded, so it falls back).
- Every page load issues a guaranteed 404 (`/INDEX.ANDROIDAPP_IMAGE`) and downloads both Google Play badge images and both locale files.
- Evolution and gap download and regroup 721 KB of JSON in the browser to draw one chart.
- Caching: everything is `max-age=7200`, including fingerprinted bundles that could be immutable for a year; `/v2/latest` is uncached (`DYNAMIC`).
- Console on load: 4 "Possibly unhandled rejection" errors from ui-router 0.2 under Angular 1.7, 1 404, about 10 ARIA warnings (buttons without labels).

---

## 7. Brand assets worth carrying over

### 7.1 Logo and icons (all raster, all small)

| File | Type / size | Used? | Notes |
|---|---|---|---|
| `app/images/logo.png` | PNG 107×32 RGBA | **Unused** | Horizontal lockup: butterfly mark + lowercase "bluelytics" wordmark in blue |
| `app/images/mobile-icon-144.png` | PNG 144×144 RGBA | apple-touch-icon | Largest copy of the mark in this repo |
| `app/images/mobile-icon-114.png` | PNG 114×114 RGBA | apple-touch-icon | |
| `app/images/mobile-icon-72.png` | PNG 72×72 RGBA | apple-touch-icon | |
| `app/images/mobile-icon.png` | PNG 57×57 RGBA | toolbar logo (≥ 600 px) + apple-touch-icon | |
| `app/images/mobile-icon-32.png` | PNG 32×32 RGBA | toolbar logo (< 600 px) | |
| `app/favicon.ico` | ICO, single 16×16 32-bit image | favicon | |
| `app/images/flag_ar.png`, `flag_us.png` | PNG 24×24 RGBA | language switch | |
| `app/images/instagram.png`, `facebook.png`, `twitter.png` | PNG 45×45 RGBA | right drawer | Twitter bird is the pre-X logo |
| `app/images/ios.png` | PNG 240×80 RGBA | App Store badge | |
| `app/images/loading.gif` | GIF 128×128 | **Unused** | |
| `app/images/material-design/*.svg` | 15 SVG sprite sets | 4 used | Do not carry over; use inline SVG icons |

The mark is a stylised butterfly/dragonfly: two blue wings crossed by a green swoosh, with small antennae. Sampled colours: **blue ≈ `#0163A4`** (wordmark ≈ `#075B9A`) and **green ≈ `#439D45`**. There is **no vector source** in this repo. Larger rasters exist elsewhere in the legacy tree and should be preferred as the tracing source: `blueimg/img/logo.png` (192×192), `bluescraper/src/alerts/img/logo.png` (192×192), `bluelytics_mobile_v3/assets/images/icon.png` (192×192) and `bluelytics_mobile_v3/assets/images/splash.png` (1242×1242). A clean SVG redraw is needed for OG images, the favicon set and the new social post templates.

### 7.2 Colours

| Where | Value | Source |
|---|---|---|
| Material primary (toolbar, drawer headers, primary pill, active tab text) | light-blue 500 `#03A9F4`; white text | `app.js:95`, live computed `rgb(3,169,244)` |
| Material accent (tab ink bar, percent pill) | amber (`#FFC107` 500 / `#FFD740` A200) | `app.js:96` |
| Material warn (API page warning button text) | default red palette | `api.html:4` |
| Page background / text | `#FFFFFF` / Bootstrap `#333` | live |
| Chart: blue series | `steelblue` = `#4682B4` | `evolution.js:52` |
| Chart: oficial series | `green` = `#008000` | `evolution.js:53` |
| Chart: gap series | `red` = `#FF0000` | `gap.js:81` |
| Trend up (unused now) | `#087b02` | `main.scss:52` |
| Trend down (unused now) | `#7b0000` | `main.scss:56` |
| Trend neutral (unused now) | `#383838` | `main.scss:60` |
| Tax note (unused now) | `#707070` | `main.scss:42` |
| Logo blue / green | `#0163A4` / `#439D45` | sampled from PNGs |
| 404 page | text `#737373`, bg `#f0f0f0`, card `#fcfcfc`, selection `#b3d4fc` | `404.html:8-40` |

Observation: the site chrome (Material light-blue `#03A9F4` + amber) does not match the logo (deep blue `#0163A4` + green `#439D45`). The logo palette is the real brand; the Material palette was a framework default.

### 7.3 Typography and layout tokens (`app/styles/main.scss`)

- Requested fonts: Ruda, Roboto Slab (never applied). Effective: Helvetica Neue/Arial stack.
- `div.price > .name`: 1.3em, right-aligned. `div.price > .value_container > .value`: 1.7em bold. `.calc_rates > p`: 1.2em bold. `h2, h3, h4, h5` centred. `.infopage`: max-width 1000 px, centred paragraphs. `h1` 22 px below 768 px.
- Breakpoints in use: 600 px (logo size), 768 px (mobile chart truncation and `h1` size), 960 px (drawer locks open).

### 7.4 Links, IDs and credits

| Item | Value | Status on 2026-11-22 |
|---|---|---|
| Android app | `https://play.google.com/store/apps/details?id=com.bluelytics.mobileapp` | **404** (a control app returned 200 from the same client) |
| iOS app | `https://apps.apple.com/am/app/bluelytics/id1637362540` | **404** on `am`, `ar`, `us` and storefront-less URLs; iTunes lookup API returns 0 results |
| Google Play badge image (es) | `https://developer.android.com/images/brand/es-419_generic_rgb_wo_45.png` | 200 (hot-linked, legacy artwork) |
| Google Play badge image (en) | `https://developer.android.com/images/brand/en_app_rgb_wo_45.png` | 200 (hot-linked, legacy artwork) |
| Instagram | `https://www.instagram.com/bluelytics_dolar` | 200 |
| Facebook | `https://www.facebook.com/bluelytics` | redirects to login for anonymous clients (cannot verify) |
| Twitter / X | `https://www.twitter.com/bluelytics` | 301 to `twitter.com/bluelytics`; `https://x.com/bluelytics` 200 |
| GitHub org (About page) | `https://github.com/Bluelytics` | 200 |
| Backend repo (README) | `https://github.com/sicarul/bluelytics` | 200 |
| Frontend repo remote | `git@github.com:sicarul/bluelytics_frontend.git` | |
| Author credit | "Creado por / Created by Pablo Seibelt", linking `https://sicarul.com` | 301 to `https://www.sicarul.com/` |
| Google Analytics (hard-coded) | Universal Analytics `UA-322483-2`, with `ga('require', 'displayfeatures')` | UA is discontinued; hits are still sent |
| Google Analytics 4 (observed at runtime only) | `G-64QZCDRTRP`, loaded by `analytics.js` via gtag | active |
| Cloudflare Web Analytics | beacon injected at the edge (`static.cloudflareinsights.com/beacon.min.js`, `/cdn-cgi/rum`) | active |
| Page-view tracking | angulartics fires a virtual pageview on every ui-router state change | |
| Licence statement | "libre (AGPL)" in the About copy; `LICENSE` is AGPL v3 | |

---

## 8. Bugs and gotchas found (do not port these)

1. `#!/analysis` crashes (`blueAPI.analysis_data` undefined; data URL 404).
2. Gap chart dates are one day early in UTC−3 (local-time formatter on UTC-midnight dates, `gap.js:13,31`).
3. Default chart range depends on a race between the slider directive and data arrival (full history when the data comes from the network, last third with wrong handle positions when it is already cached).
4. Days where blue sell equals oficial sell are silently removed from both charts (1,132 days).
5. Evolution/gap charts plot sell prices while the gap headline and the calculator use averages; nothing on screen says which is which.
6. Below 768 px the charts are cut to the last 60 points with no way to see more.
7. `last_update` is deleted; the site never shows when the price was last updated. Prices never refresh without a reload.
8. Calculator FX table is stale; zero-valued currencies yield `Infinity`; ARS is offered as a foreign currency; currency names are not translated; placeholder is hard-coded Spanish.
9. Numbers use US formatting in Spanish.
10. Menu never highlights the active page (`isActive` undefined); right drawer title is empty (`{{INDEX.EXTRA.TITLE}}`).
11. A 404 request for `/INDEX.ANDROIDAPP_IMAGE` on every load.
12. Both store links return 404; the App Store URL uses the Armenian storefront.
13. API docs: wrong JSON field names (`day`/`type`), imprecise `days` semantics, table missing a `<tr>`.
14. Markup errors: stray `</a>` (`index.html:99`), `<md-content>` used as a closing tag (`evolution.html:18`, `gap.html:44`, `analysis.html:27`), slider nested inside the fixed-height chart box on the gap page.
15. Old `#/route` links (pre-2020) land on the home page instead of the requested page.
16. No error states: a failed API call leaves a spinner forever.
17. angular-translate has no sanitisation strategy while translations contain raw HTML.
18. Unused code and assets everywhere (see 6.1); tests are scaffolding only.

---

## 9. Inbound links that must keep working (redirect / compatibility list)

### 9.1 Hosts and server-visible paths

| Legacy URL | Today | Required in v2 |
|---|---|---|
| `https://bluelytics.com.ar/` | 200, SPA shell | Canonical home. Posted in every social update by `bluescraper/src/updates.py:131-132` and `bluescraper/src/weekly.py:90-92`, printed on weekly chart images (`bluescraper/src/weekly_chart/weekly.html:80`) |
| `http://bluelytics.com.ar/…` | 301 to https | keep |
| `https://www.bluelytics.com.ar/…`, `http://www.bluelytics.com.ar/…` | 301 to apex, path preserved | keep. `http://www.bluelytics.com.ar` is in old social posts (`bluelytics_notifiy/update.py:100-106`), `www.bluelytics.com.ar` is printed on every generated post image (`blueimg/template.html:102`, `blueimg/template_ig_story.html:102`, `bluescraper/src/alerts/update_template.html:96`), and the README links `https://www.bluelytics.com.ar` |
| `/index.html` | 200 | 301 to `/` |
| `/privacy.html` | 200 | **Must stay at exactly this path** (see 9.2) |
| `/robots.txt` | 200 | keep, add `Sitemap:` |
| `/favicon.ico` | 200 | keep |
| `/images/logo.png`, `/images/mobile-icon.png`, `/images/mobile-icon-32.png`, `/images/mobile-icon-72.png`, `/images/mobile-icon-114.png`, `/images/mobile-icon-144.png` | 200 | keep serving (cheap; may be hot-linked or cached as home-screen icons) |
| `/locale/es_AR.json`, `/locale/en_US.json`, `/scripts/*.js`, `/styles/*.css`, `/images/material-design/*.svg` | 200 | not a public contract; may disappear. Browsers holding a cached old `index.html` (edge TTL 2 h) will request the old bundles for a short while after cut-over; keeping the old fingerprinted files in place for a day avoids a broken transitional state |
| `/views/*.html`, `/calculator`, `/evolution`, `/gap`, `/api`, `/about`, `/sitemap.xml`, `/manifest.json`, `/ads.txt`, `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association` | 404 | free to define. There are no app deep-link association files to preserve |
| any other path | custom `404.html`, status 404 | keep a real 404 status |

### 9.2 `privacy.html`

- Source: `privacy.html` at the repo root (113 lines), added in commit `5a9a3bc` (2020-09-20), **not copied by the Grunt build**, uploaded to the bucket manually. Live at `https://bluelytics.com.ar/privacy.html` (200); `https://www.bluelytics.com.ar/privacy.html` 301s to it.
- It is the mobile app's privacy policy (generated with "App Privacy Policy Generator"): title "Privacy Policy", English only, sections: Privacy Policy, Information Collection and Use, Log Data, Cookies, Service Providers, Security, Links to Other Sites, Children's Privacy, Changes to This Privacy Policy ("This policy is effective as of 2020-04-28"), Contact Us (contact e-mail at `privacy.html:106`). Third-party list contains only "Google Play Services".
- The live copy is identical to the repo copy apart from Cloudflare's e-mail obfuscation script.
- It is almost certainly the privacy-policy URL registered in the Play Console and App Store Connect listings. Even though both listings currently return 404, keep the file at the same URL, verbatim, until the owner confirms otherwise. The policy text does not mention web analytics (GA, Cloudflare) and is out of date for the website; a v2 site-wide privacy page should be a separate, new document.

### 9.3 Hash routes (client-side only)

The server never sees the fragment, so these can only be handled by a small inline script on the new home page (`/` and `/index.html`). Every form below has existed publicly at some point:

| Legacy URL (both `#!/x` and `#/x` forms) | Period | What it showed | Suggested v2 target |
|---|---|---|---|
| `/#!/`, `/#/`, `/#` | always | rates | home |
| `/#!/calculator`, `/#/calculator` | 2014 to now | calculator | calculator page |
| `/#!/evolution`, `/#/evolution` | 2014 to now | evolution chart | evolution page |
| `/#!/gap`, `/#/gap` | 2014 to now | gap | gap page |
| `/#!/api`, `/#/api` | 2014 to now | API docs | API docs page |
| `/#!/about`, `/#/about` | 2014 to now | about | about page |
| `/#!/analysis`, `/#/analysis` | 2015 to now (broken since 2020) | BCRA variables | evolution page or home |
| `/#/forecast` | 2014 to 2020 | forecast chart and table | evolution page or home |
| `/#/wordcloud` | 2014 to April 2020 | media word clouds | home |
| `/#/dolar/:dolar_name` | Oct 2014 only | per-source quote | home |

Today the `#!/…` forms work and the `#/…` forms already bounce to home, so mapping both forms to the right page is an improvement, not just parity. Example shim (target paths are placeholders for whatever v2 chooses):

```html
<script>
(function () {
  if (!location.hash) return;
  var key = location.hash.replace(/^#!?\/?/, '').split(/[\/?]/)[0];
  var map = { calculator: '/calculadora', evolution: '/evolucion', gap: '/brecha',
              api: '/api', about: '/acerca', analysis: '/evolucion', forecast: '/evolucion' };
  if (map[key]) { location.replace(map[key]); }
  else { history.replaceState(null, '', location.pathname + location.search); }
})();
</script>
```

Also migrate the stored language preference if a per-language URL scheme is adopted: `localStorage['NG_TRANSLATE_LANG_KEY']` is `"es_AR"` or `"en_US"`.

### 9.4 API URLs referenced from the site and its siblings

These are on `api.bluelytics.com.ar` and belong to the API contract, but they are linked from this site and must keep resolving:

- `https://api.bluelytics.com.ar/v2/latest` (also with `?callback=`)
- `https://api.bluelytics.com.ar/v2/historical?day=YYYY-MM-DD`
- `https://api.bluelytics.com.ar/v2/evolution.json` (also `?days=`)
- `https://api.bluelytics.com.ar/v2/evolution.csv` (also `?days=`)
- `https://api.bluelytics.com.ar/json/last_price` (v1; three third-party bindings depend on it)
- `https://api.bluelytics.com.ar/data/json/currency.json` (undocumented; used by the live web calculator and by the mobile app)

Already dead, no need to preserve: `…/api/last_price`, `…/data/graphs/evolution.json`, `…/data/graphs/bcra.json`, `…/data/forecast/*.json`, `…/social_img/{twitter,facebook,instagram}.png` (all 404 today).

---

## 10. Feature-parity checklist for the rewrite

### Must keep

| Feature | Reasoning |
|---|---|
| Home page with Blue and Oficial buy / average / sell, Blue most prominent | The product. Blue is the default tab today |
| Spanish (default) and English copy | Both locale files are complete; English serves expats/tourists and API consumers. Give each language its own URL |
| Calculator ARS ⇄ USD at Blue or Oficial, two-way inputs, 2-decimal rounding, average rate as the basis | Second most-used tool; the formulas in 4.2 are simple and exact |
| Evolution chart Blue vs Oficial over time with a range control | Core content and an SEO asset; make the range date-aware with presets instead of the abstract slider |
| Gap page: current gap in % and in ARS for a chosen USD amount (default 200), plus gap history chart | "Brecha" is a searched term in Argentina and a distinctive page |
| API documentation page with the exact endpoints and wording in section 5 (corrected) | Public contract description; third parties link to it |
| About page: what the site is, the "no contact with any cueva, values are collected from other sites" disclaimer, author credit and link, open-source statement | Trust and legal positioning |
| `/privacy.html` verbatim at the same URL | Store listing dependency |
| Legacy hash-route shim (9.3), www/http redirects, real 404 | Inbound links from years of social posts |
| Social links (Instagram `bluelytics_dolar`, X `bluelytics`, Facebook `bluelytics`) | Audience channels; the automated posts point back to the site |
| Analytics continuity | Move to GA4 (`G-64QZCDRTRP` is already receiving data) and/or Cloudflare Web Analytics; drop the UA snippet |
| Brand mark and name | Recognition; needs a vector redraw |

### Nice to have (cheap wins the legacy site lacks)

| Feature | Reasoning |
|---|---|
| "Last updated" timestamp on every quote | The API already returns `last_update`; the old UI throws it away |
| Day-over-day variation with up/down colouring | Existed until 2020 (`#087b02` / `#7b0000`), was dropped only because the v2 API lacked yesterday's values; derivable from the daily series |
| Euro quotes (blue and oficial) | Already in `/v2/latest`, never displayed; also gives a correct EUR calculator without the stale FX table |
| Historical lookup by date | `/v2/historical?day=` exists but the site never used it; static per-day pages are a strong long-tail SEO play |
| CSV / JSON download buttons on the evolution page | The endpoints exist |
| Argentine number formatting in Spanish (`1.652,50`), dates localised | Audience expectation |
| Server-rendered or pre-rendered pages with real titles, descriptions, OG images, JSON-LD, sitemap, hreflang | Fixes everything in section 6 |
| Dark theme | Matches the requested new visual direction for social posts |
| Explanatory copy / FAQ ("¿Qué es el dólar blue?", how values are computed, buy vs sell vs average) | Content depth for search and to explain the definitions that are implicit today |
| Multi-currency calculator | Keep only if a fresh FX source is wired in; otherwise restrict to USD and EUR. The 169-currency list with 2023 rates is worse than nothing |
| Embeddable widget / copyable snippet | JSONP was added "for example for a widget"; a small official embed would replace ad-hoc ones |
| Error and stale-data states, auto-refresh | None today |

### Drop

| Feature | Reasoning |
|---|---|
| BCRA analysis page (`#!/analysis`) | Dead since 2020, data source gone, not in the menu. Redirect the route |
| Forecast and word-cloud pages, and their leftover strings (`INDEX.MENU.PREDICTION`, `INDEX.MENU.COVERAGE`) | Removed in 2020 |
| Tax surcharge on the official rate and `RATE.TAX_PAIS` "(+75%)" | Removed from the UI in Dec 2023 "changing too often"; the percentage is obsolete |
| Legacy quote-source labels (`COMMON.DOLARES.oficial_20/30/35`, `dolarblue.net`, `ambito_financiero`, `la_nacion`, `elcronista`, `invertir_online`) | The API no longer exposes per-source quotes |
| The 60-point mobile truncation and the abstract 0–300 slider | Workarounds for an old chart library |
| The "drop days where blue equals oficial" filter | A zero gap is real data |
| Hot-linked Google Play badge, App Store link with the `am` storefront | Replace with self-hosted official badges and correct URLs, and only if the apps are actually published |
| AngularJS, Angular Material, Bootstrap, jQuery, d3 v3, n3-line-chart, Grunt, Bower, Compass, IE shims, FastClick, Material icon sprites, unused Google Fonts | Entire toolchain is end-of-life |
| Universal Analytics snippet | Service discontinued |
| Client-side-only language switching on a single URL | Bad for SEO; replace with URL-based locales (may still remember the preference) |

---

## 11. Product history (from `git log`, 69 commits, 2014-10-13 to 2023-12-19)

- **Oct 2014**: Yeoman boilerplate; main page with dollar values; calculator; evolution (nvd3, then n3-charts on 2014-10-23); gap; word cloud; forecast; API page; a short-lived `/dolar/:dolar_name` route. Mobile adaptations, animate.css experiments.
- **Nov 2014**: range filter for graphs (`8cf605d`), build script, mobile app link, navigation changes, default view of graphs widened.
- **Dec 2014**: Google Analytics page tracking via angulartics; English translation and locale files; templates inlined into JS (`49989bc`, `11ed622`).
- **Jan–Feb 2015**: logo update (`080552e`), daily forecast, `build.sh` syncs to S3 (`a47a205`), BCRA analysis page and "implicit dollar".
- **Mar–Apr 2015**: Material Design redesign (`bc74258`, `b5ced90`), angular-material pinned to a git commit.
- **Dec 2015**: "Remove obsolete dollars".
- **Apr 2020** (`1c47b0a`): word cloud removed; dependency refresh.
- **Sep 2020** (`5a9a3bc` "New version"): Angular 1.3 to 1.7 (hash prefix becomes `#!`), switched from `api/last_price` to `v2/latest`, API base URL to https, forecast and BCRA data sources removed (analysis route left behind, broken), day-over-day arrows removed, `.htaccess` deleted, Instagram link and `privacy.html` added, official sell shown with a tax multiplier of `× 1.65` labelled "(+30%)".
- **Apr 2021** (`846c41d` "Last tax"): label corrected to "(+65%)".
- **Jun 2021** (`2701f40` "New API"): charts move from `data/graphs/evolution.json` (`value`) to `v2/evolution.json` (`value_sell`); evolution endpoints added to the API page.
- **Jul 2022** (`069b16c` "New tax"): multiplier `× 1.75`, label "(+75%)".
- **Aug 2023** (`2bd07eb` "Add new endpoint"): `/v2/historical` documented; iOS App Store badge added.
- **Dec 2023** (`67687eb` "Remove tax calculation (Changing too often)"): tax surcharge removed; "Intermedio" row shown for Oficial as well. Last deploy.

Lessons for v2: anything tied to Argentine tax or regulatory percentages goes stale quickly, so keep such rules as data/config with a visible "as of" date or leave them out; features that depended on side data feeds (forecast, BCRA, word cloud, FX table) rotted when the feed stopped, so every data dependency needs a freshness check and a graceful empty state.

---

## 12. Copy deck audit (what is outdated or wrong in the locale files)

Full files are reproduced verbatim in Appendices A and B. Issues to fix when the copy is ported:

### 12.1 Unused keys (safe to drop)

| Key | Why unused |
|---|---|
| `COMMON.DOLARES.oficial_20`, `oficial_30`, `oficial_35` | Old tax-adjusted official variants. Also inconsistent between languages: es "Oficial Ahorro / Solidario / Tarjeta" vs en "Official +20% / +30% / +35%" |
| `COMMON.DOLARES.dolarblue.net`, `ambito_financiero`, `la_nacion`, `elcronista`, `invertir_online` | Per-source quotes no longer exist |
| `RATE.TAX_PAIS` ("Impuestos (+75%)" / "Taxes (+75%)") | Tax display removed Dec 2023; percentage obsolete |
| `RATE.DIFFERENCE` | Day-over-day arrows removed 2020 (worth reviving, see section 10) |
| `INDEX.MENU.COVERAGE`, `INDEX.MENU.PREDICTION`, `INDEX.MENU.ANALYSIS` | Menu entries removed |
| `INDEX.LANGUAGE` | Never rendered; also "Lenguaje" should be "Idioma" |
| `API.FORMAT`, `API.METHODS` | Never rendered |
| `ANALYSIS.*` | Only reachable through the broken route; mentions LEBAC (instrument discontinued in 2018) |

Missing key: `INDEX.EXTRA.TITLE` is referenced by the template but defined nowhere.

### 12.2 Wrong or outdated content

| Key | Problem |
|---|---|
| `ABOUT.DESC_2` (both) | Mentions only Android / Google Play; the link returns 404 today; iOS not mentioned |
| `ABOUT.DESC_3` (both) | Mentions Facebook and Twitter only; Instagram missing; Twitter is now X |
| `ABOUT.DESC_5` (both) | Claims the source is AGPL and available on GitHub; confirm this still holds for v2 before repeating it |
| `INDEX.ANDROIDAPP_IMAGE` (both) | A URL inside a translation file, hot-linking legacy badge art |
| `API.EVOLUTION.DAY`, `API.EVOLUTION.TYPE` | Describe fields named `day` and `type`; the JSON uses `date` and `source` |
| `API.EVOLUTION.DAYS_PARAM` | Says "last X days"; observed behaviour is last X rows |
| `API.DESCRIPTION` (en) | "has no use terms" is awkward; intended meaning is "free to use" |
| `API.TITLE` (en) | "API JSON Dolar Blue" is untranslated word order |
| `ANALYSIS.VARIABLES.EfectivoFinanciero` (en) | Typo: "Financial cas" |
| `ABOUT.DESC_4` (en) | Lower-case "i" twice |
| `GAP.TITLE` (en) | Just "Gap"; es is "Brecha dólar blue" |
| `CALCULATOR.FOREIGN_CURR` | es has a trailing colon, en does not |
| `EVOLUTION.TITLE` (es) | "Evolucion" without accent while the menu says "Evolución" |

### 12.3 Spanish orthography

The Spanish file was written largely without accents. Words to correct when porting include: analisis, aplicacion, pagina/paginas, codigo, esta (está), aqui, unicamente, comparacion, ¿Cuantos, Dolar (in `CambioRef`, `DolarImplicito`), Republica, evolucion, interes, dias, Prestamos, Depositos, publico, Circulacion, Ultimos/Ultima/Ultimo, actualizacion, Parametros/parametro, automaticamente, autenticacion, continuacion, tecnico, historico/historica, especifico, Dia, Metodos, Tecnologia, Estan, mediatica, Prediccion, Menu, Ambito, Nacion, and the voseo forms Podes / tenes / queres (Podés / tenés / querés). `404.html` has the same issue ("Pagina", "esta buscando", "aqui").

---

## 13. Open questions for the owner

1. Are the Android and iOS apps intentionally unpublished? Both store URLs return 404. This decides whether store badges, the About sentence and `privacy.html` stay.
2. Which privacy-policy URL is registered in the store consoles (assumed `https://bluelytics.com.ar/privacy.html`)?
3. Is GA4 property `G-64QZCDRTRP` the one to keep, or should v2 rely on Cloudflare Web Analytics only (no cookies, no consent banner)?
4. Should v2 stay AGPL/open source as the About page states?
5. Canonical definitions to show users: is "the blue price" the sell value (what charts use), or the average (what the calculator and gap headline use)?
6. Is the Facebook page still maintained (cannot be checked anonymously)?
7. Should the 169-currency calculator survive, and if so from which live FX source?
8. Is there a vector original of the logo anywhere outside these repos?

---

## Appendix A. `app/locale/es_AR.json` (verbatim, 151 lines)

```json
{
    "COMMON": {
        "DOLARES": {
            "blue": "Dólar Blue",
            "oficial": "Oficial",
            "oficial_20": "Oficial Ahorro",
            "oficial_30": "Oficial Solidario",
            "oficial_35": "Oficial Tarjeta",
            "dolarblue": {
                "net": "DolarBlue.net"
            },
            "ambito_financiero": "Ambito Financiero",
            "la_nacion": "La Nacion",
            "elcronista": "El Cronista",
            "invertir_online": "Invertir Online"
        },
        "SLIDER": "Cambiar el periodo a revisar",
        "CLOSE": "Cerrar"
    },
    "GAP": {
        "GAP": "Brecha",
        "TITLE": "Brecha dólar blue",
        "ABS_VALUE": "Diferencia absoluta (ARS)",
        "PERC_VALUE": "Diferencia relativa (%)",
        "EVOLUTION_TITLE": "Evolución brecha cambiaria",
        "COMPARE": "¿Cuantos Dólares (USD) utilizar para la comparacion?"
    },
    "ABOUT": {
        "TITLE": "Acerca de Bluelytics",
        "DESC_1": "Bluelytics es una herramienta de analisis vivo del Dólar Blue.",
        "DESC_2": "Podes descargarte la aplicacion móvil para Android desde <a href=\"https://play.google.com/store/apps/details?id=com.bluelytics.mobileapp\">Google Play</a>",
        "DESC_3": "Si tenes comentarios o queres seguir las novedades sin entrar en la pagina, te recomiendo sigas a Bluelytics en <a href=\"https://www.facebook.com/bluelytics\">Facebook</a> y <a href=\"https://www.twitter.com/bluelytics\">Twitter</a>",
        "DESC_4": "Esta aplicacion web fue creada por Pablo Seibelt, no tengo contacto con ninguna cueva, unicamente descargo los valores disponibles en otras paginas y los publico aqui.",
        "DESC_5": "El codigo fuente del mismo es libre (AGPL) y esta disponible en:"
    },
    "ANALYSIS": {
        "TITLE": "Analisis de variables del BCRA",
        "DESCRIPTION": "Seleccione una variable de la lista para ver su evolucion. Estos datos son oficiales del Banco Central de la Republica Argentina.",
        "VARIABLES": {
            "Reservas": "Reservas",
            "CER": "CER",
            "CambioRef": "Dolar referencia BCRA",
            "BADLAR": "BADLAR",
            "TasasInteres30Dias": "Tasas de interes a 30 dias",
            "TasasInteresEntrePrivadas": "Tasas de interes entre privadas",
            "PrestamosAPrivados": "Prestamos a privados",
            "OtrosDepositos": "Otros depositos",
            "APlazo": "A plazo",
            "CajasAhorro": "Cajas de ahorro",
            "CuentasCorrientes": "Cuentas corrientes",
            "DepositosFinancieras": "Depositos de financieras",
            "LEBAC": "LEBAC",
            "DepositosBCRA": "Depositos BCRA",
            "EfectivoFinanciero": "Efectivo financiero",
            "BilletesPublico": "Efectivo en poder publico",
            "Circulacion": "Circulacion de efectivo",
            "BaseMonetaria": "Base monetaria",
            "Asistencia": "Asistencia",
            "DolarImplicito": "Dolar Implicito"
        }
    },
    "API": {
        "TITLE": "API JSON Dólar Blue",
        "WARN": "Si usted no es un usuario tecnico, ignore esta pagina.",
        "DESCRIPTION": "La API que esta disponible a continuacion es de libre uso, no requiere autenticacion, es un simple JSON.",
        "V2": "API Actual (v2)",
        "LAST_PRICE_V2": "Ultimos valores",
        "PARAMETERS": "Parametros opcionales",
        "PARAMETERS_TEXT": "La URL tal cual esta especificada devuelve una respuesta JSON, si necesita una respuesta JSONP (Por ejemplo para un widget) puede agregar ?callback=nombre, donde nombre es una cadena de caracteres arbitraria. Esto lo hace automaticamente por ejemplo jQuery al solicitar un JSONP.",
        "FORMAT_TEXT": "La respuesta es un objeto JSON con los siguientes atributos",
        "LATEST_API": {
            "LAST_UPDATE": "Ultima actualizacion del valor reportado",
            "OFICIAL": {
                "VALUE_BUY": "Valor de compra del dólar oficial",
                "VALUE_AVG": "Valor promedio del dólar oficial",
                "VALUE_SELL": "Valor de venta del dólar oficial"
            },
            "OFICIAL_EURO": {
                "VALUE_BUY": "Valor de compra del euro oficial",
                "VALUE_AVG": "Valor promedio del euro oficial",
                "VALUE_SELL": "Valor de venta del euro oficial"
            },
            "BLUE": {
                "VALUE_BUY": "Valor de compra del dólar blue",
                "VALUE_AVG": "Valor promedio del dólar blue",
                "VALUE_SELL": "Valor de venta del dólar blue"
            },
            "BLUE_EURO": {
                "VALUE_BUY": "Valor de compra del euro blue",
                "VALUE_AVG": "Valor promedio del euro blue",
                "VALUE_SELL": "Valor de venta del euro blue"
            }
        },
        "HISTORICAL_PRICE_V2": "Valor historico de un dia especifico",
        "JSON_EVOLUTION_API": "Toda la data historica (JSON)",
        "EVOLUTION": {
            "DAYS_PARAM": "El parametro GET opcional 'days' te permite bajar los ultimos X dias en vez de toda la historia.",
            "DAY": "Dia de este precio",
            "TYPE": "Tipo de tasa de cambio (Oficial o Blue)",
            "SELL": "Valor de venta, el valor promedio que pide un vendedor",
            "BUY": "Valor de compra, el valor promedio que ofrece un comprador"
        },
        "ARRAY_ITEMS": "Objetos de lista (array)",
        "CSV_EVOLUTION_API": "Toda la data historica (CSV)",
        "OLD_API": "API anterior (v1)",
        "LAST_PRICE": "Ultimo precio",
        "BINDINGS": "Bindings",
        "BINDINGS_DESCRIPTION": "Estan disponibles los siguientes bindings para utilizar la API de Bluelytics",
        "BINDINGS_TABLE": {
            "LANGUAGE": "Tecnologia",
            "URL": "URL"
        },
        "FORMAT": "Formato de la respuesta",
        "METHODS": "Metodos"
    },
    "CALCULATOR": {
        "TITLE": "Calculadora Blue",
        "FOREIGN_CURR": "Moneda Extranjera:",
        "VALUE_LOCAL": "Cantidad de pesos argentinos (ARS)",
        "VALUE_FOREIGN": "Cantidad de moneda extranjera ({{code}})"
    },
    "EVOLUTION": {
        "TITLE": "Evolucion Dólar Blue"
    },
    "RATE": {
        "TITLE": "Dólar en Argentina",
        "BID": "Compra",
        "AVG": "Intermedio",
        "ASK": "Venta",
        "TAX_PAIS": "Impuestos (+75%)",
        "DIFFERENCE": "Diferencia con el valor de ayer"
    },
    "INDEX": {
        "ANDROIDAPP": "Disponible en Google Play",
        "ANDROIDAPP_IMAGE": "https://developer.android.com/images/brand/es-419_generic_rgb_wo_45.png",
        "IOSAPP": "Disponible en App Store",
        "MENU": {
            "TITLE": "Menu",
            "RATE": "Cotización",
            "CALCULATOR": "Calculadora",
            "EVOLUTION": "Evolución",
            "GAP": "Brecha",
            "COVERAGE": "Cobertura mediatica",
            "PREDICTION": "Prediccion",
            "ANALYSIS": "Análisis",
            "API": "API",
            "ABOUT": "Acerca de"
        },
        "CREDIT": "Creado por",
        "LANGUAGE": "Lenguaje"
    }
}
```

## Appendix B. `app/locale/en_US.json` (verbatim, 151 lines)

```json
{
    "COMMON": {
        "DOLARES": {
            "blue": "Blue Dollar",
            "oficial": "Official",
            "oficial_20": "Official +20%",
            "oficial_30": "Official +30%",
            "oficial_35": "Official +35%",
            "dolarblue": {
                "net": "DolarBlue.net"
            },
            "ambito_financiero": "Ambito Financiero",
            "la_nacion": "La Nacion",
            "elcronista": "El Cronista",
            "invertir_online": "Invertir Online"
        },
        "SLIDER": "Change the time range here",
        "CLOSE": "Close"
    },
    "GAP": {
        "GAP": "Gap",
        "TITLE": "Gap",
        "ABS_VALUE": "Absolute gap in AR$",
        "PERC_VALUE": "Relative gap in percentage",
        "EVOLUTION_TITLE": "Gap evolution chart",
        "COMPARE": "Dollars to compare"
    },
    "ABOUT": {
        "TITLE": "About Bluelytics",
        "DESC_1": "Bluelytics is a tool for live analysis of the Blue Dollar in Argentina.",
        "DESC_2": "You can download the mobile app from <a href=\"https://play.google.com/store/apps/details?id=com.bluelytics.mobileapp\">Google Play</a>",
        "DESC_3": "If you have feedback or want to follow the updates you can follow Bluelytics on <a href=\"https://www.facebook.com/bluelytics\">Facebook</a> and <a href=\"https://www.twitter.com/bluelytics\">Twitter</a>",
        "DESC_4": "This web app was created by Pablo Seibelt, i have no contact with any underground traders, i only scrape the dollar values available at other websites and then publish them on this web app.",
        "DESC_5": "This is free software (AGPL) and it's available on github:"
    },
    "ANALYSIS": {
        "TITLE": "BCRA Variables analysis",
        "DESCRIPTION": "Choose a variable from the list to see its evolution. This is official data from the central bank of Argentina (Banco Central de la Republica Argentina).",
        "VARIABLES": {
            "Reservas": "Reserves",
            "CER": "CER",
            "CambioRef": "Reference USD Rate",
            "BADLAR": "BADLAR",
            "TasasInteres30Dias": "Interest rate 30 days",
            "TasasInteresEntrePrivadas": "Interest rate private sector",
            "PrestamosAPrivados": "Loan to privates",
            "OtrosDepositos": "Other deposits",
            "APlazo": "Term deposits",
            "CajasAhorro": "Savings accounts",
            "CuentasCorrientes": "Current accounts",
            "DepositosFinancieras": "Financial companies deposits",
            "LEBAC": "LEBAC",
            "DepositosBCRA": "BCRA Deposits",
            "EfectivoFinanciero": "Financial cas",
            "BilletesPublico": "Cash in public",
            "Circulacion": "Cash circulation",
            "BaseMonetaria": "Monetary base",
            "Asistencia": "Assistance",
            "DolarImplicito": "Implicit Dollar"
        }
    },
    "API": {
        "TITLE": "API JSON Dolar Blue",
        "WARN": "If you are a non-technical user, ignore this page.",
        "DESCRIPTION": "The API exposed has no use terms, and doesn't require authentication, it's a simple JSON response.",
        "V2": "Current API (v2)",
        "LAST_PRICE_V2": "Latest values",
        "PARAMETERS": "Optional parameters",
        "PARAMETERS_TEXT": "The URL as it is specified responds with a JSON object, if you need a JSONP response (For example to populate a widget) you can add ?callback=name, where name is any string. This is done automatically for example by jQuery when using the JSONP protocol.",
        "FORMAT_TEXT": "The response is a JSON object with the following attributes",
        "LATEST_API": {
            "LAST_UPDATE": "Latest update for reported values",
            "OFICIAL": {
                "VALUE_BUY": "Official Dollar buy value",
                "VALUE_AVG": "Official Dollar average value",
                "VALUE_SELL": "Official Dollar sell value"
            },
            "OFICIAL_EURO": {
                "VALUE_BUY": "Official Euro buy value",
                "VALUE_AVG": "Official Euro average value",
                "VALUE_SELL": "Official Euro sell value"
            },
            "BLUE": {
                "VALUE_BUY": "Blue Dollar buy value",
                "VALUE_AVG": "Blue Dollar average value",
                "VALUE_SELL": "Blue Dollar sell value"
            },
            "BLUE_EURO": {
                "VALUE_BUY": "Blue Euro buy value",
                "VALUE_AVG": "Blue Euro average value",
                "VALUE_SELL": "Blue Euro sell value"
            }
        },
        "HISTORICAL_PRICE_V2": "Historical value for a specific day",
        "JSON_EVOLUTION_API": "All historical data (JSON)",
        "EVOLUTION": {
            "DAYS_PARAM": "Optional GET parameter 'days' allows you to get last X days instead of all history.",
            "DAY": "Day for this exchange rate",
            "TYPE": "Type of exchange rate (Oficial is the government rate, Blue is the free market)",
            "SELL": "Sell (ask) value, average rate asked for by sellers",
            "BUY": "Buy (bid) value, average rate bidded for by buyers"
        },
        "ARRAY_ITEMS": "Array items",
        "CSV_EVOLUTION_API": "All historical data (CSV)",
        "OLD_API": "Old API (v1)",
        "LAST_PRICE": "Last price",
        "BINDINGS": "Bindings",
        "BINDINGS_DESCRIPTION": "The following bindings are available for the Bluelytics API",
        "BINDINGS_TABLE": {
            "LANGUAGE": "Technology",
            "URL": "URL"
        },
        "FORMAT": "Response format",
        "METHODS": "Methods"
    },
    "CALCULATOR": {
        "TITLE": "Blue Calculator",
        "FOREIGN_CURR": "Foreign currency",
        "VALUE_LOCAL": "Amount in Argentinian Pesos (ARS)",
        "VALUE_FOREIGN": "Amount in foreign currency ({{code}})"
    },
    "EVOLUTION": {
        "TITLE": "Blue Dollar Evolution"
    },
    "RATE": {
        "TITLE": "Dollar in Argentina",
        "BID": "Bid",
        "AVG": "Average",
        "ASK": "Ask",
        "TAX_PAIS": "Taxes (+75%)",
        "DIFFERENCE": "Difference with yesterday's value"
    },
    "INDEX": {
        "ANDROIDAPP": "Available on Google Play",
        "ANDROIDAPP_IMAGE": "https://developer.android.com/images/brand/en_app_rgb_wo_45.png",
        "IOSAPP": "Available on App Store",
        "MENU": {
            "TITLE": "Menu",
            "RATE": "Rate",
            "CALCULATOR": "Calculator",
            "EVOLUTION": "Evolution",
            "GAP": "Gap",
            "COVERAGE": "Media Coverage",
            "PREDICTION": "Prediction",
            "ANALYSIS": "Analysis",
            "API": "API",
            "ABOUT": "About bluelytics"
        },
        "CREDIT": "Created by",
        "LANGUAGE": "Language"
    }
}
```

## Appendix C. Flattened copy deck, side by side

Generated from the two files above. 110 keys in es_AR, 110 in en_US; keys only in es_AR: none; keys only in en_US: none. "Status" says whether the current templates/controllers reference the key: `used`, `UNUSED`, or `dead route only` (reachable solely through the broken `#!/analysis` page). `{{code}}` is an interpolation placeholder for the selected currency code. Values are shown literally, including embedded HTML.

| Key | es_AR | en_US | Status |
|---|---|---|---|
| `COMMON.DOLARES.blue` | `Dólar Blue` | `Blue Dollar` | used |
| `COMMON.DOLARES.oficial` | `Oficial` | `Official` | used |
| `COMMON.DOLARES.oficial_20` | `Oficial Ahorro` | `Official +20%` | UNUSED |
| `COMMON.DOLARES.oficial_30` | `Oficial Solidario` | `Official +30%` | UNUSED |
| `COMMON.DOLARES.oficial_35` | `Oficial Tarjeta` | `Official +35%` | UNUSED |
| `COMMON.DOLARES.dolarblue.net` | `DolarBlue.net` | `DolarBlue.net` | UNUSED |
| `COMMON.DOLARES.ambito_financiero` | `Ambito Financiero` | `Ambito Financiero` | UNUSED |
| `COMMON.DOLARES.la_nacion` | `La Nacion` | `La Nacion` | UNUSED |
| `COMMON.DOLARES.elcronista` | `El Cronista` | `El Cronista` | UNUSED |
| `COMMON.DOLARES.invertir_online` | `Invertir Online` | `Invertir Online` | UNUSED |
| `COMMON.SLIDER` | `Cambiar el periodo a revisar` | `Change the time range here` | used |
| `COMMON.CLOSE` | `Cerrar` | `Close` | used |
| `GAP.GAP` | `Brecha` | `Gap` | used |
| `GAP.TITLE` | `Brecha dólar blue` | `Gap` | used |
| `GAP.ABS_VALUE` | `Diferencia absoluta (ARS)` | `Absolute gap in AR$` | used |
| `GAP.PERC_VALUE` | `Diferencia relativa (%)` | `Relative gap in percentage` | used |
| `GAP.EVOLUTION_TITLE` | `Evolución brecha cambiaria` | `Gap evolution chart` | used |
| `GAP.COMPARE` | `¿Cuantos Dólares (USD) utilizar para la comparacion?` | `Dollars to compare` | used |
| `ABOUT.TITLE` | `Acerca de Bluelytics` | `About Bluelytics` | used |
| `ABOUT.DESC_1` | `Bluelytics es una herramienta de analisis vivo del Dólar Blue.` | `Bluelytics is a tool for live analysis of the Blue Dollar in Argentina.` | used |
| `ABOUT.DESC_2` | `Podes descargarte la aplicacion móvil para Android desde <a href="https://play.google.com/store/apps/details?id=com.bluelytics.mobileapp">Google Play</a>` | `You can download the mobile app from <a href="https://play.google.com/store/apps/details?id=com.bluelytics.mobileapp">Google Play</a>` | used |
| `ABOUT.DESC_3` | `Si tenes comentarios o queres seguir las novedades sin entrar en la pagina, te recomiendo sigas a Bluelytics en <a href="https://www.facebook.com/bluelytics">Facebook</a> y <a href="https://www.twitter.com/bluelytics">Twitter</a>` | `If you have feedback or want to follow the updates you can follow Bluelytics on <a href="https://www.facebook.com/bluelytics">Facebook</a> and <a href="https://www.twitter.com/bluelytics">Twitter</a>` | used |
| `ABOUT.DESC_4` | `Esta aplicacion web fue creada por Pablo Seibelt, no tengo contacto con ninguna cueva, unicamente descargo los valores disponibles en otras paginas y los publico aqui.` | `This web app was created by Pablo Seibelt, i have no contact with any underground traders, i only scrape the dollar values available at other websites and then publish them on this web app.` | used |
| `ABOUT.DESC_5` | `El codigo fuente del mismo es libre (AGPL) y esta disponible en:` | `This is free software (AGPL) and it's available on github:` | used |
| `ANALYSIS.TITLE` | `Analisis de variables del BCRA` | `BCRA Variables analysis` | dead route only |
| `ANALYSIS.DESCRIPTION` | `Seleccione una variable de la lista para ver su evolucion. Estos datos son oficiales del Banco Central de la Republica Argentina.` | `Choose a variable from the list to see its evolution. This is official data from the central bank of Argentina (Banco Central de la Republica Argentina).` | dead route only |
| `ANALYSIS.VARIABLES.Reservas` | `Reservas` | `Reserves` | dead route only |
| `ANALYSIS.VARIABLES.CER` | `CER` | `CER` | dead route only |
| `ANALYSIS.VARIABLES.CambioRef` | `Dolar referencia BCRA` | `Reference USD Rate` | dead route only |
| `ANALYSIS.VARIABLES.BADLAR` | `BADLAR` | `BADLAR` | dead route only |
| `ANALYSIS.VARIABLES.TasasInteres30Dias` | `Tasas de interes a 30 dias` | `Interest rate 30 days` | dead route only |
| `ANALYSIS.VARIABLES.TasasInteresEntrePrivadas` | `Tasas de interes entre privadas` | `Interest rate private sector` | dead route only |
| `ANALYSIS.VARIABLES.PrestamosAPrivados` | `Prestamos a privados` | `Loan to privates` | dead route only |
| `ANALYSIS.VARIABLES.OtrosDepositos` | `Otros depositos` | `Other deposits` | dead route only |
| `ANALYSIS.VARIABLES.APlazo` | `A plazo` | `Term deposits` | dead route only |
| `ANALYSIS.VARIABLES.CajasAhorro` | `Cajas de ahorro` | `Savings accounts` | dead route only |
| `ANALYSIS.VARIABLES.CuentasCorrientes` | `Cuentas corrientes` | `Current accounts` | dead route only |
| `ANALYSIS.VARIABLES.DepositosFinancieras` | `Depositos de financieras` | `Financial companies deposits` | dead route only |
| `ANALYSIS.VARIABLES.LEBAC` | `LEBAC` | `LEBAC` | dead route only |
| `ANALYSIS.VARIABLES.DepositosBCRA` | `Depositos BCRA` | `BCRA Deposits` | dead route only |
| `ANALYSIS.VARIABLES.EfectivoFinanciero` | `Efectivo financiero` | `Financial cas` | dead route only |
| `ANALYSIS.VARIABLES.BilletesPublico` | `Efectivo en poder publico` | `Cash in public` | dead route only |
| `ANALYSIS.VARIABLES.Circulacion` | `Circulacion de efectivo` | `Cash circulation` | dead route only |
| `ANALYSIS.VARIABLES.BaseMonetaria` | `Base monetaria` | `Monetary base` | dead route only |
| `ANALYSIS.VARIABLES.Asistencia` | `Asistencia` | `Assistance` | dead route only |
| `ANALYSIS.VARIABLES.DolarImplicito` | `Dolar Implicito` | `Implicit Dollar` | dead route only |
| `API.TITLE` | `API JSON Dólar Blue` | `API JSON Dolar Blue` | used |
| `API.WARN` | `Si usted no es un usuario tecnico, ignore esta pagina.` | `If you are a non-technical user, ignore this page.` | used |
| `API.DESCRIPTION` | `La API que esta disponible a continuacion es de libre uso, no requiere autenticacion, es un simple JSON.` | `The API exposed has no use terms, and doesn't require authentication, it's a simple JSON response.` | used |
| `API.V2` | `API Actual (v2)` | `Current API (v2)` | used |
| `API.LAST_PRICE_V2` | `Ultimos valores` | `Latest values` | used |
| `API.PARAMETERS` | `Parametros opcionales` | `Optional parameters` | used |
| `API.PARAMETERS_TEXT` | `La URL tal cual esta especificada devuelve una respuesta JSON, si necesita una respuesta JSONP (Por ejemplo para un widget) puede agregar ?callback=nombre, donde nombre es una cadena de caracteres arbitraria. Esto lo hace automaticamente por ejemplo jQuery al solicitar un JSONP.` | `The URL as it is specified responds with a JSON object, if you need a JSONP response (For example to populate a widget) you can add ?callback=name, where name is any string. This is done automatically for example by jQuery when using the JSONP protocol.` | used |
| `API.FORMAT_TEXT` | `La respuesta es un objeto JSON con los siguientes atributos` | `The response is a JSON object with the following attributes` | used |
| `API.LATEST_API.LAST_UPDATE` | `Ultima actualizacion del valor reportado` | `Latest update for reported values` | used |
| `API.LATEST_API.OFICIAL.VALUE_BUY` | `Valor de compra del dólar oficial` | `Official Dollar buy value` | used |
| `API.LATEST_API.OFICIAL.VALUE_AVG` | `Valor promedio del dólar oficial` | `Official Dollar average value` | used |
| `API.LATEST_API.OFICIAL.VALUE_SELL` | `Valor de venta del dólar oficial` | `Official Dollar sell value` | used |
| `API.LATEST_API.OFICIAL_EURO.VALUE_BUY` | `Valor de compra del euro oficial` | `Official Euro buy value` | used |
| `API.LATEST_API.OFICIAL_EURO.VALUE_AVG` | `Valor promedio del euro oficial` | `Official Euro average value` | used |
| `API.LATEST_API.OFICIAL_EURO.VALUE_SELL` | `Valor de venta del euro oficial` | `Official Euro sell value` | used |
| `API.LATEST_API.BLUE.VALUE_BUY` | `Valor de compra del dólar blue` | `Blue Dollar buy value` | used |
| `API.LATEST_API.BLUE.VALUE_AVG` | `Valor promedio del dólar blue` | `Blue Dollar average value` | used |
| `API.LATEST_API.BLUE.VALUE_SELL` | `Valor de venta del dólar blue` | `Blue Dollar sell value` | used |
| `API.LATEST_API.BLUE_EURO.VALUE_BUY` | `Valor de compra del euro blue` | `Blue Euro buy value` | used |
| `API.LATEST_API.BLUE_EURO.VALUE_AVG` | `Valor promedio del euro blue` | `Blue Euro average value` | used |
| `API.LATEST_API.BLUE_EURO.VALUE_SELL` | `Valor de venta del euro blue` | `Blue Euro sell value` | used |
| `API.HISTORICAL_PRICE_V2` | `Valor historico de un dia especifico` | `Historical value for a specific day` | used |
| `API.JSON_EVOLUTION_API` | `Toda la data historica (JSON)` | `All historical data (JSON)` | used |
| `API.EVOLUTION.DAYS_PARAM` | `El parametro GET opcional 'days' te permite bajar los ultimos X dias en vez de toda la historia.` | `Optional GET parameter 'days' allows you to get last X days instead of all history.` | used |
| `API.EVOLUTION.DAY` | `Dia de este precio` | `Day for this exchange rate` | used |
| `API.EVOLUTION.TYPE` | `Tipo de tasa de cambio (Oficial o Blue)` | `Type of exchange rate (Oficial is the government rate, Blue is the free market)` | used |
| `API.EVOLUTION.SELL` | `Valor de venta, el valor promedio que pide un vendedor` | `Sell (ask) value, average rate asked for by sellers` | used |
| `API.EVOLUTION.BUY` | `Valor de compra, el valor promedio que ofrece un comprador` | `Buy (bid) value, average rate bidded for by buyers` | used |
| `API.ARRAY_ITEMS` | `Objetos de lista (array)` | `Array items` | used |
| `API.CSV_EVOLUTION_API` | `Toda la data historica (CSV)` | `All historical data (CSV)` | used |
| `API.OLD_API` | `API anterior (v1)` | `Old API (v1)` | used |
| `API.LAST_PRICE` | `Ultimo precio` | `Last price` | used |
| `API.BINDINGS` | `Bindings` | `Bindings` | used |
| `API.BINDINGS_DESCRIPTION` | `Estan disponibles los siguientes bindings para utilizar la API de Bluelytics` | `The following bindings are available for the Bluelytics API` | used |
| `API.BINDINGS_TABLE.LANGUAGE` | `Tecnologia` | `Technology` | used |
| `API.BINDINGS_TABLE.URL` | `URL` | `URL` | used |
| `API.FORMAT` | `Formato de la respuesta` | `Response format` | UNUSED |
| `API.METHODS` | `Metodos` | `Methods` | UNUSED |
| `CALCULATOR.TITLE` | `Calculadora Blue` | `Blue Calculator` | used |
| `CALCULATOR.FOREIGN_CURR` | `Moneda Extranjera:` | `Foreign currency` | used |
| `CALCULATOR.VALUE_LOCAL` | `Cantidad de pesos argentinos (ARS)` | `Amount in Argentinian Pesos (ARS)` | used |
| `CALCULATOR.VALUE_FOREIGN` | `Cantidad de moneda extranjera ({{code}})` | `Amount in foreign currency ({{code}})` | used |
| `EVOLUTION.TITLE` | `Evolucion Dólar Blue` | `Blue Dollar Evolution` | used |
| `RATE.TITLE` | `Dólar en Argentina` | `Dollar in Argentina` | used |
| `RATE.BID` | `Compra` | `Bid` | used |
| `RATE.AVG` | `Intermedio` | `Average` | used |
| `RATE.ASK` | `Venta` | `Ask` | used |
| `RATE.TAX_PAIS` | `Impuestos (+75%)` | `Taxes (+75%)` | UNUSED |
| `RATE.DIFFERENCE` | `Diferencia con el valor de ayer` | `Difference with yesterday's value` | UNUSED |
| `INDEX.ANDROIDAPP` | `Disponible en Google Play` | `Available on Google Play` | used |
| `INDEX.ANDROIDAPP_IMAGE` | `https://developer.android.com/images/brand/es-419_generic_rgb_wo_45.png` | `https://developer.android.com/images/brand/en_app_rgb_wo_45.png` | used |
| `INDEX.IOSAPP` | `Disponible en App Store` | `Available on App Store` | used |
| `INDEX.MENU.TITLE` | `Menu` | `Menu` | used |
| `INDEX.MENU.RATE` | `Cotización` | `Rate` | used |
| `INDEX.MENU.CALCULATOR` | `Calculadora` | `Calculator` | used |
| `INDEX.MENU.EVOLUTION` | `Evolución` | `Evolution` | used |
| `INDEX.MENU.GAP` | `Brecha` | `Gap` | used |
| `INDEX.MENU.COVERAGE` | `Cobertura mediatica` | `Media Coverage` | UNUSED |
| `INDEX.MENU.PREDICTION` | `Prediccion` | `Prediction` | UNUSED |
| `INDEX.MENU.ANALYSIS` | `Análisis` | `Analysis` | UNUSED |
| `INDEX.MENU.API` | `API` | `API` | used |
| `INDEX.MENU.ABOUT` | `Acerca de` | `About bluelytics` | used |
| `INDEX.CREDIT` | `Creado por` | `Created by` | used |
| `INDEX.LANGUAGE` | `Lenguaje` | `Language` | UNUSED |

Totals: UNUSED = 16, dead route only = 22, used = 72.

Strings that are hard-coded in templates rather than in the locale files: brand text `Bluelytics` (`app/index.html:99`), author name `Pablo Seibelt` (`app/index.html:195`), `alt` texts `Instagram` / `Facebook` / `Twitter` (`app/index.html:174,181,188`), ui-select placeholder `Seleccione la moneda` (`app/views/calculator.html:26`), the literals `ARS ≈ 1 USD` and `1 USD ≈` (`app/views/calculator.html:37-38`), `vs` (`app/views/gap.html:18`), `AR$` (`app/views/gap.html:22`), chart series fallback labels `Dolar Blue`, `Dolar Oficial`, `Brecha` (`app/scripts/controllers/evolution.js:52-53`, `gap.js:81`), every URL and attribute name on the API page, the bindings rows (`app/views/api.html:214-223`), and the whole of `404.html` and `privacy.html`.

## Appendix D. Site-specific CSS (`app/styles/main.scss`, verbatim, 79 lines)

Lines 1-4 import all of bootstrap-sass; everything else is the site's own styling.

```scss
$icon-font-path: "../bower_components/bootstrap-sass-official/assets/fonts/bootstrap/";
// bower:scss
@import "bootstrap-sass-official/assets/stylesheets/bootstrap.scss";
// endbower


h1 {
  margin-left:10px;
}
@media (max-width: 768px) {
  h1{
    font-size:22px;
  }
}

div.price{
  margin-bottom:10px;
  margin-top:10px;
}

div.price > .name{
  font-size:1.3em;
  text-align:right;
  margin-top:auto;
  margin-bottom:auto;
}

div.price > .value_container{
  font-weight:bold;
  padding-left:15px;
}

div.price > .value_container > .value {
  font-size:1.7em;
}


div.price > .value_container > .tax {
  font-size:1.4em;
  margin-top:auto;
  margin-bottom:auto;
  color:#707070;
}

div.price > .value_container > .trend {
  font-size:1.4em;
  margin-top:auto;
  margin-bottom:auto;
}

div.price > .value_container > .trend.up  {
  color:#087b02;
}

div.price > .value_container > .trend.down  {
  color:#7b0000;
}

div.price > .value_container > .trend.neutral  {
  color:#383838;
}

.calc_rates > p{
  font-size:1.2em;
  font-weight:bold;
}

h2, h3, h4, h5{
  text-align:center;
}

.infopage p {
  text-align:center;
}

.infopage {
  max-width: 1000px;
  margin:auto;
}
```
