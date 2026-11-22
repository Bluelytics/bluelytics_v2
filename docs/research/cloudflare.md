# Cloudflare platform research for bluelytics_v2

Research date: 2026-11-22. Every claim carries its source URL and that page's `dateModified` (taken from the JSON-LD of `https://developers.cloudflare.com/<path>/index.md`) or the npm publish date. Raw copies of every page read are in `/tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/research/cf_raw/`.

Labels:

- **[V]** verified: read verbatim in a primary source on 2026-11-22.
- **[I]** inferred: follows from verified facts but no primary source states it outright.
- **[U]** unverified: no primary source found; must be tested live before relying on it.

Placeholders: `API_HOST` = the public API hostname (for example `api.<zone>`), `ZONE_ID`, `ACCOUNT_ID`, `BUCKET` = the R2 bucket holding pre-rendered API responses.

---

## 0. Bottom line

1. **A Worker in front of the JSON always costs one billed request per hit, cache HIT or not.** Workers run before the zone cache. The 2026 "Workers Cache" feature does not change that (a HIT still bills a request, and it makes normally-free static-asset requests billable). Snippets (which would be free per request) are not available on the Free zone plan. [V]
2. **The cheapest correct design is static-first:** the cron Worker writes the finished JSON bodies to R2; `API_HOST` is an R2 custom domain with a Cache Rule; the zone CDN serves them. No Worker runs on the hot path, so 3M, 30M or 300M requests/month all cost $0 in request fees. A Worker route is added only for paths that cannot be pre-rendered. [V for each building block, I for the combination]
3. **Realistic total: $0/month if the scraper fits the Free plan's 10 ms CPU per cron invocation, otherwise a flat $5/month (Workers Paid), independent of traffic.** The 10 ms cap applies to scheduled handlers too. [V]
4. **Three things must be tested live before committing** (section 14): Free-plan Edge TTL floor (2 hours) versus short origin `max-age`; Worker-route precedence on an R2 custom-domain hostname; URL-rewrite-to-R2-key mapping for `?day=` style paths.
5. **Post images:** on Free, render with Browser Run Quick Actions through the Worker binding (`env.BROWSER.quickAction("screenshot", ...)`, native JPEG output, 10 browser-minutes/day free). satori + resvg needs far more than 10 ms CPU, so it is a Paid-plan-only option. [V limits, I for CPU cost]

---

## 1. Workers Free vs Paid

Sources: https://developers.cloudflare.com/workers/platform/pricing/ (2026-11-18), https://developers.cloudflare.com/workers/platform/limits/ (2026-11-19), https://developers.cloudflare.com/workers/platform/spend-management/ (2026-11-13). All [V].

| Item | Free | Paid (Standard) |
| --- | --- | --- |
| Price | $0 | $5/month minimum per account |
| Requests | 100,000/day, account-wide, resets 00:00 UTC | 10M/month included, then $0.30 per million |
| CPU billing | n/a | 30M CPU-ms/month included, then $0.02 per million CPU-ms |
| CPU per HTTP request | 10 ms | 5 min max, default 30 s (`limits.cpu_ms`) |
| CPU per Cron Trigger invocation | **10 ms** | 5 min (default 30 s) when interval < 1 h; 15 min when interval >= 1 h |
| Wall time | HTTP unlimited; Cron 15 min; `waitUntil` 30 s after response | same |
| Memory | 128 MB per isolate | 128 MB |
| Subrequests per invocation | 50 external; 1,000 to Cloudflare services (D1, R2, KV) | 10,000 default, configurable to 10M |
| Simultaneous open connections | 6 | 6 |
| Worker size | 64 MiB uncompressed (no separate compressed limit) | 64 MiB |
| Startup time | 1 s | 1 s |
| Env vars | 64, 5 KB each | 128, 5 KB each |
| Workers per account | 100 | 500 |
| **Cron Triggers per account** | **5** | 1,000 |
| Cache API calls per request | 50 | 1,000 |
| Routes per zone / custom domains per zone | 1,000 / 100 | same |
| Duration charge / egress | none / none | none / none |

- Over the Free daily limit: Error 1027. Per route, "fail open" bypasses the Worker and sends the request to the origin; "fail closed" returns the 1027 page. [V]
- CPU time excludes time waiting on network (`fetch`, D1, R2). "Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit"; consistent overruns are terminated. [V]
- Billing rule: "Only requests that hit a Worker will count against your limits and your bill. Since Cloudflare Workers runs before the Cloudflare cache, the caching of a request still incurs costs." [V]
- Service-binding calls between Workers add no request fee. [V]
- Cloudflare's own example: 100M requests at 7 ms CPU = $45.40/month; same with Workers Caching at 80% hit ratio = $34.20 (CPU saved, requests still billed). [V]
- Spending limit (Paid): account-wide cap on Workers request and CPU charges after included usage; when hit, new invocations are rejected (HTTP 1103), **including Cron Triggers**; static assets served without the Worker keep working; "not an exact maximum bill". A test Worker can exhaust the shared limit and stop production. [V]

Implications for this project:

- The scraper's 10 ms CPU budget on Free is the tightest constraint. Parsing several HTML pages per run is likely to exceed it. [I] Measure with `wrangler tail` / Workers Logs (`cpuTime` per invocation) before deciding Free vs Paid.
- 5 cron expressions per account on Free: use one `*/5` expression and branch on time inside the handler rather than one expression per job.

---

## 2. Workers Static Assets

Sources: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (2026-11-12), https://developers.cloudflare.com/workers/static-assets/routing/worker-script/ (2026-11-12), https://developers.cloudflare.com/workers/static-assets/direct-upload/ (2026-11-12), https://developers.cloudflare.com/workers/wrangler/configuration/ (2026-11-12). All [V] unless marked.

- "Requests to static assets are free and unlimited." No storage charge. Requests that reach the Worker script are billed normally.
- Default order: asset match first; the Worker's `fetch()` runs only when no asset matches. `assets.run_worker_first: true | string[]` (max 100 patterns, `!/x/*` negations) forces the Worker to run, and those requests are billed. On Free, once the daily limit is exceeded, `run_worker_first` paths return 429 instead of falling back to assets.
- Limits: 20,000 files per version on Free, 100,000 on Paid (Wrangler >= 4.34.0); 25 MiB per file; `_headers` 100 rules; `_redirects` 2,000 static + 100 dynamic.
- Default response headers: `Content-Type` by extension at upload, `Cache-Control: public, max-age=0, must-revalidate`, `ETag`. `_headers` can override; it does not apply to Worker-generated responses.
- `Range` requests return `200` with the full body (no `206`).
- **Assets are immutable per Worker version.** Changing one file means a new version. Programmatic path (Direct Upload, 3 calls):
  1. `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{script_name}/assets-upload-session` with `{"manifest": {"/path": {"hash": "<32 hex>", "size": <bytes>}, ...}}` listing **all** files. Returns a JWT and the buckets of hashes still to upload.
  2. `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/assets/upload?base64=true` (multipart, `Authorization: Bearer <upload JWT>`; each part's `Content-Type` is what gets served). Returns a completion JWT valid 1 hour.
  3. `PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{script_name}` with metadata `{"main_module": "main.js", "assets": {"jwt": "<completion JWT>", "config": {...}}, "compatibility_date": "..."}` (or `"keep_assets": true` to reuse the previous set).
  "The deployment change takes time to reach every location."
- **Trap:** enabling Workers Cache on a Worker makes its static-asset requests billed at the standard request rate (https://developers.cloudflare.com/workers/cache/, 2026-11-18).

Verdict: ideal for the Astro site (rebuilt by CI), wrong tool for JSON that changes every 5 minutes (a full version deploy per refresh). [I]

Astro: `@astrojs/cloudflare` 14.4.9 with `astro` 7.4.13 (npm, 2026-11-22). Fully pre-rendered site needs only `{"name": "...", "compatibility_date": "...", "assets": {"directory": "./dist"}}` (https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/, 2026-11-05). [V]

**CORRECTED 2026-11-22 (independent verification):** for SSR the Wrangler entry is `"main": "@astrojs/cloudflare/entrypoints/server"` plus `"assets": {"directory": "./dist", "binding": "ASSETS"}`, not `dist/_worker.js/index.js`. The Astro adapter docs state: "Previously, the `main` field ... pointed to the built worker file (e.g. `dist/_worker.js/index.js`). With Astro 6, this has changed to point to a new unified entrypoint provided by the Cloudflare adapter: `@astrojs/cloudflare/entrypoints/server`" (https://docs.astro.build/en/guides/integrations-guide/cloudflare/ and https://docs.astro.build/en/guides/deploy/cloudflare/, read from the `withastro/docs` repo `main` branch on 2026-11-22). The published package confirms it: `@astrojs/cloudflare@14.4.9` `exports` contains `./entrypoints/server` and its peer dependencies are `astro ^7.4.0`, `wrangler ^4.125.0` (npm registry, 2026-11-22). The "Generated configuration" panel in Cloudflare's own framework guide still shows `main: dist/_worker.js/index.js`; that panel is stale relative to the adapter. [V]

---

## 3. The key question: CDN cache in front of dynamic JSON

### 3a. Can the zone cache answer without invoking a Worker?

**No, when the Worker is on a route or custom domain for that URL.** [V]

- "Cloudflare Workers run before the cache" — https://developers.cloudflare.com/workers/reference/how-the-cache-works/ (2026-10-29).
- "Since Cloudflare Workers runs before the Cloudflare cache, the caching of a request still incurs costs." — pricing page (2026-11-18).
- Cache Rules act on the Worker's outgoing `fetch()` subrequest, not on the incoming request: "Cloudflare computes the cache key on the subrequest that the Snippet or Worker sends with fetch()" — https://developers.cloudflare.com/rules/simulator/limitations/ (2026-11-19).

**Workers Cache (new in 2026)** — https://developers.cloudflare.com/workers/cache/ and `/workers/cache/limitations/` (2026-11-18), `/workers/cache/configuration/` (2026-10-30). [V]

- Enable: `"cache": {"enabled": true}` in wrangler config (Wrangler >= 4.69.0); per-entrypoint override through `exports` (Wrangler >= 4.107.0). `ctx.cache.purge()` always uses the Free-tier purge rate limits, whatever the plan.
- Cache is checked before the Worker runs; tiered by default; request collapsing; only `Cache-Control` from the Worker configures it (zone Cache Rules do not apply); GET/HEAD only; `Set-Cookie`/`Authorization` bypass; purge with `ctx.cache.purge({tags: [...]})`.
- **Billing: a cache HIT is charged the standard request fee with no CPU charge, and "every request to your Worker is charged ... including requests that are normally free: static asset requests and worker-to-worker invocations".** It reduces CPU cost only.

**Snippets** would run without a per-request fee but are **not available on Free** (Pro 25, Business 50, Enterprise 300) — https://developers.cloudflare.com/rules/snippets/ (2026-08-14). [V]

### 3b. R2 custom domain + CDN cache (the free path)

Sources: https://developers.cloudflare.com/r2/buckets/public-buckets/ (2026-11-12), https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/ (2026-05-07), https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ (2026-09-14), https://developers.cloudflare.com/r2/platform/limits/ (2026-10-30).

- A bucket custom domain puts the zone cache in front of R2 ("requests ... go through Cloudflare's cache instead of hitting R2 directly every time"). The zone must be in the same account. `r2.dev` URLs are rate-limited, uncached and not for production. [V]
- **Default caching is by file extension, not MIME type, and the list excludes `.json` and `.html`.** "HTML and JSON are not cached unless you create a Cache Rule." Extensionless keys such as `v2/latest` are therefore uncached by default. [V] `.csv` **is** on the default list, so `/v2/evolution.csv` is cached for the 120-minute default even with no rule; cover it with the same Cache Rule and purge. [V, added by verification 2026-11-22]
- Default edge TTL when the origin sends no `Cache-Control`: 200/206/301 = 120 min; 302/303 = 20 min; 404/410 = 3 min. [V]
- R2 object keys may be extensionless; `Content-Type` and `Cache-Control` come from the object's `httpMetadata` (section 6). [V]
- R2 limits: 1 write per second to the same key; 100 custom domains per bucket; key length 1,024 bytes. [V]
- Public buckets do not list contents at the root. [V] The body and content type of the 404 for a missing key are not documented. [U]

Cache Rule making the API paths cacheable (Free: 10 cache rules) — https://developers.cloudflare.com/cache/how-to/cache-rules/ (2026-08-14), `/cache/how-to/cache-rules/settings/` (2026-10-15), `/cache/how-to/cache-rules/create-api/`. [V for field names]

```bash
# Phase entry point ruleset: kind=zone, phase=http_request_cache_settings.
# PUT replaces ALL rules in the ruleset.
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/$RULESET_ID" \
  --request PUT \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "rules": [{
      "description": "cache pre-rendered API JSON from R2",
      "expression": "(http.host eq \"API_HOST\")",
      "action": "set_cache_settings",
      "action_parameters": {
        "cache": true,
        "edge_ttl": { "mode": "override_origin", "default": 7200 },
        "browser_ttl": { "mode": "override_origin", "default": 60 },
        "cache_key": {
          "ignore_query_strings_order": true
        }
      }
    }]
  }'
```

Edge TTL facts — https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/ (2026-08-14):

- **Minimum Edge Cache TTL: Free 2 hours, Pro 1 hour, Business and Enterprise 1 second.** [V]
- `edge_ttl.mode`: `respect_origin` (follow origin `Cache-Control`, default behaviour otherwise), `override_origin` (ignore it, use `default`), `bypass_by_default`. `status_code_ttl` entries accept `0` (no-cache) and `-1` (no-store). [V]
- Origin Cache Control is on by default for Free/Pro/Business and cannot be disabled, so origin `max-age` / `s-maxage` are honoured under `respect_origin`. [V]
- **Whether the Free 2-hour floor also raises a shorter origin `max-age` under `respect_origin` is not stated anywhere.** [U] Design so the answer does not matter: long edge TTL plus purge on write (below).
- **Browser TTL trap:** the zone default Browser Cache TTL is 4 hours, and Cloudflare overrides the origin header when "the value of the `Expires` or `Cache-Control` header from the origin web server is less than the Browser Cache TTL Cloudflare setting". Without an explicit `browser_ttl` in the cache rule, API consumers' browsers would be told to cache for 4 hours. Minimum Browser TTL via cache rules is 1 second on all plans. [V]

Purge on write — https://developers.cloudflare.com/cache/how-to/purge-cache/ (2026-09-29), https://developers.cloudflare.com/api/resources/cache/methods/purge/. [V]

```bash
# Token permission: "Cache Purge" (zone scoped).
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  --request POST \
  --header "Authorization: Bearer $CF_PURGE_TOKEN" \
  --json '{"prefixes": ["API_HOST/v2/"]}'
# Alternatives: {"hosts": ["API_HOST"]}, {"tags": ["latest"]}, {"files": ["https://API_HOST/v2/latest"]}
```

- All purge types are available on Free. Limits per account: hostname / tag / prefix / everything = **5 requests per minute on Free, token bucket of 25**, 100 operations per request; single-file = 800 URLs per second on Free, 100 per request. One purge per 5-minute scrape cycle is well inside the limit. The limit is per account and shared by every zone on the same plan in that account, and invalidation requests draw from the same bucket. [V]
- A `200` only means the request was accepted; verify with `CF-Cache-Status` no longer `HIT`. With Tiered Cache on, the first request after a prefix / hostname / tag purge can show `EXPIRED` instead of `MISS`. [V]
- Failure mode of "long edge TTL + purge": a purge that silently fails leaves stale data for up to the edge TTL (2 hours). Have the cron re-issue the purge on the next cycle whenever the stored body's `generatedAt` is newer than what the public URL returns. [I]
- **Prefer prefix/host/tag purge over single-file purge.** The default cache key includes the client's `Origin` header, so browser consumers on different sites get separate cache entries, and single-file purge only clears the variant whose headers are sent in the purge request. [V for the mechanism, I for the recommendation]
- With a URL-rewriting Transform Rule in place, single-file purge must use the original end-user URL, not the rewritten one. [V] (`/cache/how-to/purge-cache/purge-by-single-file/`, 2026-09-29)
- **CORRECTED 2026-11-22: prefix purge is the opposite.** "If you have a Transform Rule in place that is modifying part of a URL path, you must use the post-transformed (origin) URL when performing a prefix purge" (https://developers.cloudflare.com/cache/how-to/purge-cache/purge_by_prefix/, 2026-08-21). For the `?day=` rewrite in 3d this means the prefix to purge is `API_HOST/v2/historical/` (rewritten form), not `API_HOST/v2/historical`. Prefixes take no scheme, query string or fragment, at most 31 path separators, and a prefix purge clears every query-string variant under it. Safest: send both the pre- and post-rewrite prefixes in the same request (up to 100 prefixes per request, still one request against the rate limit). [V for the rule, I for the recommendation]
- A Cache Rule whose expression matches only `http.request.method eq "GET"` does not match purge requests; match on host/path only. [V]
- `POST /zones/{zone_id}/invalidate_cache` marks content stale for revalidation instead of deleting it; same limits. [V]
- Cache tags for R2 responses can be added by a Cache Response Rule (Free, 10 rules, phase `http_response_cache_settings`), which can also rewrite origin `Cache-Control` and strip `ETag`/`Set-Cookie`/`Last-Modified` (https://developers.cloudflare.com/cache/how-to/cache-response-rules/, 2026-10-28). [V]

Tiered Cache with Smart topology is available on Free and recommended in front of R2 (https://developers.cloudflare.com/cache/how-to/tiered-cache/). [V] Pulumi: `cloudflare.TieredCache` / `ArgoTieredCaching`.

R2 cost of a cache MISS: one `GetObject` = one Class B operation. That a cache HIT performs no R2 operation follows from the cache docs but is not stated in the R2 pricing page. [I]

### 3c. Mixing: static paths from R2, Worker only on some paths

Sources: https://developers.cloudflare.com/workers/configuration/routing/routes/ (2026-10-18), https://developers.cloudflare.com/rules/cloud-connector/ (2026-11-20), `/rules/cloud-connector/create-api/` and `/rules/cloud-connector/providers/` (2026-08-18).

- Worker Routes are path patterns (`API_HOST/v2/historical*`); the most specific pattern wins; requests that match no route go to the origin. A route with no script attached exempts a path from a broader route. The hostname needs a proxied DNS record. [V]
- "Routes can `fetch()` Custom Domains and take precedence if configured on the same hostname." [V] This sentence is about Worker Custom Domains. R2's docs say custom domains let you "mutate content via Cloudflare Workers", which implies Worker Routes also work on an R2 custom-domain hostname, but no page states the precedence explicitly. [I, test live]
- **Documented alternative with no ambiguity: Cloud Connector.** Free plan 10 rules. A rule sends matching requests on any proxied hostname to an R2 bucket that is exposed on its own custom domain (`r2.dev` not supported). It runs in the last request phase and does not configure caching (add a Cache Rule). [V]
  - Added by verification 2026-11-22: the overview page is self-contradictory on status. Its first sentence reads "Cloud Connector (Beta)", its Availability section reads "generally available to all customers" (https://developers.cloudflare.com/rules/cloud-connector/, 2026-11-20). Treat as GA-with-caveat. [V both texts]
  - "The custom domain must be defined in the same zone where you are configuring the Cloud Connector rule" (`/rules/cloud-connector/providers/`, 2026-08-18). So `BUCKET_CUSTOM_DOMAIN` has to be a hostname of the same zone as `API_HOST`. [V]
  - Cloud Connector rewrites the `Host` header to the bucket's custom domain. Cache Response Rules "evaluate the request as it is sent to your origin", so a Cache Response Rule for these paths must match on `BUCKET_CUSTOM_DOMAIN`, while the Cache Rule still matches on `API_HOST` (https://developers.cloudflare.com/cache/how-to/cache-response-rules/, 2026-10-28, stated there for Origin Rules host rewrites). Which hostname a prefix / hostname purge must name in that setup is not documented: purge both `API_HOST/...` and `BUCKET_CUSTOM_DOMAIN/...` in one request until tested. [V for the quote, I/U for the purge host]

```bash
# Token permission: Zone > Cloud Connector > Write. PUT replaces ALL rules.
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/cloud_connector/rules" \
  --request PUT \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '[{
    "expression": "http.host eq \"API_HOST\" and http.request.uri.path in {\"/v2/latest\" \"/v2/evolution.json\" \"/v2/evolution.csv\"}",
    "provider": "cloudflare_r2",
    "description": "static API responses from R2",
    "parameters": { "host": "BUCKET_CUSTOM_DOMAIN" }
  }]'
```

  Pulumi resource: `cloudflare.CloudConnectorRules` (`zoneId`, `rules[]`). In the 6.24.0 typings the per-rule provider field is named `cloudConnectorRulesProvider` (value `"cloudflare_r2"`), not `provider`; the others are `expression`, `description`, `enabled`, `parameters.host`. [V typings, added 2026-11-22] Cloud Connector is also the cleanest cutover tool (section 9) because it needs no DNS change and is reversible by disabling the rule.

### 3d. Rule order and URL rewrites

Source: https://developers.cloudflare.com/ruleset-engine/reference/phases-list/ (2026-11-12). [V]

Request phases in order: Single Redirects (`http_request_dynamic_redirect`) → URL normalization → **URL Rewrite Rules (`http_request_transform`)** → Configuration Rules → Origin Rules → WAF / rate limiting → Bulk Redirects → Request Header Transform (`http_request_late_transform`) → **Cache Rules (`http_request_cache_settings`)** → Snippets → **Cloud Connector**. Response phases include Custom Errors (`http_custom_errors`), Cache Response Rules (`http_response_cache_settings`) and Response Header Transform (`http_response_headers_transform`).

- Workers do not appear in the phase list. Cloudflare's 2021 launch post says rewrites apply "immediately as it enters the Cloudflare edge", before Firewall Rules, Page Rules and Workers (https://blog.cloudflare.com/introducing-transform-rules-with-url-rewriting-at-the-edge/, 2021-04-08). Whether Worker Route matching sees the rewritten path is therefore [I], from a five-year-old source.
- Transform Rules on Free: 10 active rules, "Regex support: No" (Business and Enterprise only). The functions reference lists no plan restriction for `concat()`, `len()`, `lower()`, `substring()` or `wildcard_replace()` (https://developers.cloudflare.com/ruleset-engine/rules-language/functions/). `concat()`, `regex_replace()` and `wildcard_replace()` may each appear only once in a rewrite expression. `http.request.uri.args` is a `Map<Array<String>>` with undecoded values, accessed as `http.request.uri.args["day"][0]`. Rewrite expressions may reference `http.request.uri.*` and `http.request.headers.*` only; expression max 4,096 characters (https://developers.cloudflare.com/rules/transform/, 2026-08-14; `/rules/transform/url-rewrite/reference/fields-functions/`, 2026-08-25). [V]
- Cloudflare documents the exact pattern "URL rewrite rule, then Cloud Connector to an object storage bucket" (https://developers.cloudflare.com/rules/transform/examples/rewrite-path-object-storage/, 2025-10-13). [V]

Query-parameter endpoint mapped onto a pre-rendered R2 object, with no Worker in the path:

```bash
# Phase http_request_transform. PUT replaces ALL rules in the ruleset.
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/$REWRITE_RULESET_ID" \
  --request PUT \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "rules": [{
      "description": "historical?day=YYYY-MM-DD -> R2 object",
      "expression": "(http.host eq \"API_HOST\" and http.request.uri.path eq \"/v2/historical\" and len(http.request.uri.args[\"day\"][0]) eq 10)",
      "action": "rewrite",
      "action_parameters": {
        "uri": {
          "path":  { "expression": "concat(\"/v2/historical/\", http.request.uri.args[\"day\"][0])" },
          "query": { "value": "" }
        }
      }
    }]
  }'
```

Status: field syntax is [V]; the end-to-end behaviour (R2 receives the rewritten path; cache key uses the original URL including `?day=`) is [I]. Limitation: a missing day returns R2's own 404, not the API's JSON error shape. Custom Errors, which could replace it, are **not available on Free** (https://developers.cloudflare.com/rules/custom-errors/, 2026-11-03). [V] If the exact error body matters to consumers, keep a Worker route for that path instead.

Live reference, measured 2026-11-22 against the legacy API: `GET https://api.bluelytics.com.ar/v2/historical?day=2013-02-12` returns `404`, `content-type: application/json; charset=UTF-8`, body `{"error":"Error: day not found"}`, with `cache-control: max-age=7200`. An R2 404 cannot reproduce that body, so option (C) changes observable behaviour for this endpoint. [V by request]

### 3e. Cache keys on Free

Source: https://developers.cloudflare.com/cache/how-to/cache-keys/ (2026-10-30). [V]

- Default key: full URL including query string, the client's `Origin` header, `x-http-method-override` / `x-http-method` / `x-method-override`, and `x-forwarded-host` / `x-host` / `x-forwarded-scheme` / `x-original-url` / `x-rewrite-url` / `forwarded`.
- Available on all plans including Free: cache deception armor, cache by device type, **Ignore query string**, **Sort query string**. Enterprise only: include/exclude specific query parameters, headers (including excluding `Origin`), cookies, host, user features.
- API: `cache_key.ignore_query_strings_order: true` (sort); ignore-all is `cache_key.custom_key.query_string.exclude` = all (Pulumi: `cacheKey.customKey.queryString.exclude.all = true`, from `@pulumi/cloudflare` 6.24.0 typings). [V for typings]
- Use two cache rules: "ignore query string" for fixed endpoints (defeats `?nocache=123` cache-busting), "sort query string" for parameterised ones.

CORS with R2 behind the cache — https://developers.cloudflare.com/r2/buckets/cors/ (2026-09-23). [V]

- A bucket CORS policy makes the custom domain return CORS headers, but **only for requests carrying an `Origin` header** that matches `AllowedOrigins` (`*` allowed). Because `Origin` is part of the cache key, each origin gets its own correctly-headed cache entry.
- After changing the CORS policy, purge the hostname.
- Simpler alternative: a Response Header Transform Rule that sets `Access-Control-Allow-Origin: *` on every response of `API_HOST` (Transform Rules are on Free, 10 active rules; response header rules run after caching decisions) — https://developers.cloudflare.com/rules/transform/response-header-modification/ (2026-09-04). [V]
- Pulumi: `cloudflare.R2BucketCors`; Wrangler: `npx wrangler r2 bucket cors set <BUCKET> --file cors.json`.
- Added by verification 2026-11-22, measured on the legacy API: `GET /v2/latest` returns `access-control-allow-origin: *` and `vary: Origin` **whether or not the request has an `Origin` header**, and `OPTIONS /v2/latest` with `Origin` + `Access-Control-Request-Method: GET` returns `204` with `access-control-allow-origin: *` and `access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE`. To keep that contract use **both** mechanisms: the Response Header Transform Rule (covers requests without `Origin`, which R2 CORS does not) and an R2 CORS policy with `AllowedOrigins: ["*"]`, `AllowedMethods: ["GET","HEAD"]`, `AllowedHeaders: ["*"]` (answers preflights, which a response-header rule alone does not guarantee). Whether R2 answers `OPTIONS` on a public custom domain exactly like the legacy `204` is untested. [V for the legacy behaviour, I for the combination, U for R2 preflight status]

---

## 4. D1

Sources: https://developers.cloudflare.com/d1/platform/pricing/ (2026-10-30), https://developers.cloudflare.com/d1/platform/limits/ (2026-11-20), https://developers.cloudflare.com/d1/best-practices/read-replication/, https://developers.cloudflare.com/d1/configuration/data-location/. All [V] unless marked.

| Item | Free | Paid |
| --- | --- | --- |
| Rows read | 5M/day | 25B/month, then $0.001 per million |
| Rows written | 100,000/day | 50M/month, then $1.00 per million |
| Storage | 5 GB total | 5 GB, then $0.75 per GB-month |
| Databases | 10 | 100,000 included (hard cap 1,000,000; $0.10/month each above 100,000) |
| Max database size | 500 MB | 10 GB |
| Time Travel | 7 days | 30 days |
| Queries per Worker invocation | 50 | 1,000 |

- Free daily limits reset at 00:00 UTC; when exceeded, queries return errors until reset.
- Rows read = rows **scanned**, so index every lookup column; each index adds one written row per insert.
- `db.batch([...])` counts as one query and runs as a transaction.
- Limits: 100 bound parameters per query, 100 KB SQL statement, 2 MB per row/string/BLOB, 100 columns, 30 s per query, 50 MB result (since 2026-11-04), 5 GB import. One database is single-threaded.
- Location hints: `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`. **No South America region.** Choose `enam`.
- Read replication: free, opt in via dashboard or API (`read_replication.mode: "auto"`), requires the Sessions API: `env.DB.withSession("first-unconstrained")`. Not needed if the hot path never touches D1.
- Time Travel is always on: `npx wrangler d1 time-travel info <DB>`, `npx wrangler d1 time-travel restore <DB> --timestamp=<unix|RFC3339>`.
- Export: `npx wrangler d1 export <DB> --remote --output=./db.sql [--table=<t>] [--no-data|--no-schema]` (blocks the database while running).
- Import: `npx wrangler d1 execute <DB> --remote --file=./dump.sql`. There is no `d1 import` command. Strip `BEGIN TRANSACTION` / `COMMIT` from dumps and split very long `INSERT`s.
- Migrations: `npx wrangler d1 migrations create|list|apply <DB> [--remote]`; config keys `migrations_dir`, `migrations_pattern`.
- Extensions documented: FTS5, JSON, math. Window functions are not mentioned in D1's docs (SQLite has them natively). [U]
- Pulumi: `cloudflare.D1Database` (`accountId`, `name`, `primaryLocationHint`, `readReplication`).

Sizing: a 5-minute scrape of ~15 sources writes about 4,300 rows/day against a 100,000/day allowance. [I]

---

## 5. Where to keep the hot tiny JSON

| Store | Read cost | Write cost | Freshness | Global? | Use here |
| --- | --- | --- | --- | --- | --- |
| R2 object behind zone cache | Class B only on cache MISS (10M/month free, then $0.36/M) | Class A, 1M/month free, then $4.50/M | Strong on write; cache controlled by TTL + purge | Yes | **Serving layer** |
| Workers Static Assets | Free, unlimited | New Worker version per change | Deploy propagation | Yes | Website only |
| KV | Free 100,000/day; Paid 10M/month then $0.50/M | Free **1,000/day**; Paid 1M/month then $5/M | Eventually consistent, "up to 60 seconds or more"; min `cacheTtl` 30 s | Yes | Avoid as the hot path |
| D1 | Rows scanned (5M/day free) | Rows written | Strong at primary | Single region (+ replicas) | **Source of truth** |
| Cache API (`caches.default`) | Free; counts toward 50 calls/request on Free | Free | Per data center only; no tiered cache; no `stale-while-revalidate` | No | Worker-side memo for parameterised paths |
| Isolate global variable | Free | Free | Per isolate, lost on eviction | No | Micro-cache in front of the above |

Sources: https://developers.cloudflare.com/kv/platform/pricing/ and `/kv/platform/limits/` (2026-10-30), https://developers.cloudflare.com/kv/concepts/how-kv-works/ (2026-04-21), https://developers.cloudflare.com/workers/runtime-apis/cache/ (2026-10-29), https://developers.cloudflare.com/r2/pricing/ (2026-10-30). [V]

- KV's Free write quota (1,000/day) is consumed by a 5-minute cadence as soon as more than 3 keys are written per run (288 runs × 4 keys = 1,152). [V arithmetic]
- Cache API: works on custom domains and routes; `cache.put` "is not compatible with tiered caching"; `cache.delete` only purges the local data center; not available behind Cloudflare Access. [V]

---

## 6. R2

Sources: https://developers.cloudflare.com/r2/pricing/ (2026-10-30), https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ (2026-11-04), https://developers.cloudflare.com/r2/buckets/object-lifecycles/, https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/custom/methods/create/. All [V].

- Free per month: 10 GB-month storage, 1M Class A, 10M Class B. Beyond: $0.015 per GB-month, $4.50 per million Class A, $0.36 per million Class B. Egress free. `DeleteObject` free. Usage rounds up to the next billing unit.
- Class A includes `PutObject`, `ListObjects`, `CopyObject`; Class B includes `GetObject`, `HeadObject`.
- R2 must be added to the account through a checkout step before the first bucket can be created (https://developers.cloudflare.com/r2/get-started/, 2026-11-12). [V] Expect to need a payment method on file even for free-tier usage. [I]
- Writing with headers from a Worker:

```ts
await env.BUCKET.put("v2/latest", body, {
  httpMetadata: {
    contentType: "application/json; charset=utf-8",
    cacheControl: "public, max-age=60",
  },
  customMetadata: { generatedAt: new Date().toISOString() },
});
```

  `R2HTTPMetadata` fields: `contentType`, `contentLanguage`, `contentDisposition`, `contentEncoding`, `cacheControl`, `cacheExpiry`. `put` also accepts `onlyIf` (conditional), checksums and `storageClass`.
- Attach a custom domain: `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom` with `{"domain": "API_HOST", "zoneId": "<ZONE_ID>", "enabled": true, "minTLS": "1.2"}` (`minTLS` defaults to 1.0 if omitted). Pulumi: `cloudflare.R2CustomDomain` (`accountId`, `bucketName`, `domain`, `zoneId`, `enabled`, `minTls`).
- Lifecycle rules (expire generated post images): prefix-scoped, up to 1,000 rules, objects removed typically within 24 h of expiry. `npx wrangler r2 bucket lifecycle add <BUCKET>`; Pulumi `cloudflare.R2BucketLifecycle`.
- Wrangler binding: `"r2_buckets": [{"binding": "BUCKET", "bucket_name": "<name>"}]`.

---

## 7. Rendering post images: Browser Run vs satori

"Browser Rendering" was renamed **Browser Run**; docs moved to `/browser-run/`.

Sources: https://developers.cloudflare.com/browser-run/pricing/ (2026-11-20), `/browser-run/limits/` (2026-10-14), `/browser-run/quick-actions/` (2026-11-13), `/browser-run/quick-actions/screenshot-endpoint/` (2026-09-26), `/browser-run/features/custom-fonts/` (2026-09-26), `/browser-run/reference/wrangler/` (2026-11-13), `/browser-run/reference/browser-binding-api/` (2026-11-20), `/browser-run/faq/`. All [V] unless marked.

| Item | Workers Free | Workers Paid |
| --- | --- | --- |
| Browser time | 10 minutes/day | 10 hours/month, then $0.09 per browser-hour |
| Concurrent browsers (Browser Sessions only) | 3 | limit 200; 10 included in price (monthly average of daily peak), then $2.00 each |
| Quick Actions rate | 1 request per 10 seconds | 30 requests per second |
| New browser instances (Browser Sessions only) | 1 per 20 seconds | 3 per second |
| Browser idle timeout | 60 seconds | 60 seconds |

- Quick Actions are billed by browser time only; response header `X-Browser-Ms-Used` reports usage; failed `waitForTimeout` actions are not charged. Daily Free quota exhausted → `429 ... Browser time limit exceeded for today` until the next UTC day.

REST call:

```bash
# Token permission: "Browser Run - Edit" (API reference label: "Browser Run Write").
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/browser-run/screenshot" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<!doctype html><html>...</html>",
    "viewport": { "width": 1080, "height": 1350, "deviceScaleFactor": 1 },
    "screenshotOptions": { "type": "jpeg", "quality": 90 },
    "gotoOptions": { "waitUntil": "networkidle0", "timeout": 30000 },
    "addStyleTag": [{ "content": "@font-face{font-family:Inter;src:url(data:font/woff2;base64,...)}" }]
  }' \
  --output post.jpg
```

- Body: one of `url` or `html` is required. `viewport` default 1920×1080. `screenshotOptions`: `type` `png|jpeg|webp`, `quality` (not with png, else 400), `fullPage`, `omitBackground`, `clip`, `encoding` `binary|base64`. Also `selector`, `waitForSelector`, `waitForTimeout` (max 120000), `addScriptTag`, `setExtraHTTPHeaders`, `userAgent`, `rejectResourceTypes`, `bestAttempt`. Query `cacheTTL` (default 5 s, 0 disables, max 86400).
- Response body is the binary image; rate limit → `429` with `Retry-After` and `{"success":false,"errors":[{"code":2001,"message":"Rate limit exceeded"}]}`. The legacy path `/browser-rendering/screenshot` still appears in the API reference.
- From a Worker, no API token needed (`compatibility_date` >= `2026-03-24`):

```jsonc
// wrangler.jsonc
{ "browser": { "binding": "BROWSER" } }
```

```ts
const res = await env.BROWSER.quickAction("screenshot", {
  html,
  viewport: { width: 1080, height: 1350 },
  screenshotOptions: { type: "jpeg", quality: 90 },
});
await env.BUCKET.put(key, await res.arrayBuffer(), {
  httpMetadata: { contentType: "image/jpeg" },
});
```

  The docs example returns the `quickAction()` result directly from `fetch()`, so it is a `Response`. [V by example] Under `wrangler dev` the binding drives a local Chrome unless `"remote": true`.
- Fonts: preinstalled set includes Arial, Helvetica, Open Sans, Roboto, DejaVu, Liberation, Noto Color Emoji, Noto CJK. Any other font: inject `@font-face` through `addStyleTag` (URL or base64 data URI).
- Worker CPU cost is negligible because the rendering happens in the browser, so this works inside the Free plan's 10 ms CPU. [I]
- Added by verification 2026-11-22: on Free, Quick Actions are limited to 1 request every 10 seconds, so a cron run that renders several formats (for example one image for X and one for Instagram) must space the calls by at least 10 s or retry on `429` using `Retry-After`; the 15-minute cron wall limit leaves room. [V limit, I consequence] The Quick Actions pages document `env.BROWSER.quickAction()` (typed `BrowserRun`), but the method table in `/browser-run/reference/browser-binding-api/` (2026-11-20) does not list it; the Quick Actions pages are the reference. [V]

Browser-less alternative (npm registry, queried 2026-11-22):

| Package | Version (published) | Notes |
| --- | --- | --- |
| `satori` | 0.63.2 (2026-10-20) | JSX/HTML subset → SVG; flexbox only, no CSS grid |
| `@resvg/resvg-wasm` | 2.6.2 (2024-03-26) | SVG → **PNG only**; ~2.5 MB |
| `@cf-wasm/og` | 0.5.0 (2026-08-01) | satori + resvg packaged for workerd; warns it does not follow semver |
| `@cf-wasm/photon` | 0.4.0 (2026-08-01) | image ops, can encode JPEG/WebP |
| `@jsquash/jpeg` | 1.6.0 (2025-05-12) | MozJPEG WASM encoder (RGBA → JPEG) |
| `workers-og` | 0.0.27 (2025-06-12) | stale |
| `takumi-js` / `@takumi-rs/wasm` | 2.22.1 (2026-11-20) | Rust renderer, JSX/HTML → PNG/JPEG/WebP directly; ~4.7 MB WASM; its docs index lists a Cloudflare Workers guide |
| `@vercel/og` | 1.0.3 (2026-09-22) | WASM bundling differs on Workers per `workers-og` README |

- All fit the 64 MiB Worker size limit. [V sizes]
- CPU time of satori + resvg for a 1080×1350 image on Workers is not published by Cloudflare or the libraries. Expect well above 10 ms, which rules it out on Free. [U, measure]
- Instagram needs JPEG; resvg outputs PNG, so the satori path needs a second encoder. Browser Run and takumi output JPEG directly. [V for output formats]

Recommendation: Browser Run Quick Action via the binding. Full CSS (grid, gradients, blur, web fonts) makes the "modern dark design" trivial to build and preview as a normal HTML page; 4 images per day at ~3 s each is ~2% of the Free daily allowance. [I]

---

## 8. Cron Triggers

Sources: https://developers.cloudflare.com/workers/configuration/cron-triggers/ (2026-11-18), https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/ (2026-10-17), https://developers.cloudflare.com/workers/wrangler/commands/workers/ (2026-10-26). All [V] unless marked.

- 5-field expressions, 1-minute granularity, **always UTC**. Extensions `L`, `W`, `#`. Day-of-week numbering is 1 = Sunday … 7 = Saturday; use names (`MON-FRI`) to avoid mistakes.
- Config: `"triggers": {"crons": ["*/5 13-21 * * MON-FRI"]}`. Omitting the key leaves existing triggers untouched; `"crons": []` removes them.
- Argentina is UTC-3 with no DST, so market hours 10:00–18:00 ART = 13:00–21:00 UTC. [I]
- Handler: `async scheduled(controller, env, ctx)`; `controller.cron` equals the configured string exactly; `controller.scheduledTime` is epoch ms; `controller.noRetry()` exists. The runtime awaits the returned promise up to the 15-minute wall limit.
- Changes take up to 15 minutes to propagate and "Scheduled invocations can be missed until propagation completes". No delivery guarantee or retry policy is documented. [U] Make each run idempotent and self-healing (compute from "latest stored" rather than "this tick").
- Limits: 5 cron expressions per account on Free, 1,000 on Paid; CPU 10 ms on Free (section 1). The dashboard keeps the last 100 invocations under Cron Events.
- Local testing:

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json&cron=*/5+13-21+*+*+MON-FRI&time=1745856238000"
# -> {"outcome":"ok","noRetry":false}
```

  Local Explorer (Wrangler >= 4.139.0): `http://localhost:8787/cdn-cgi/local/explorer`; `POST /cdn-cgi/local/explorer/api/local/scheduled?worker=<name>` with `{"cron": "...", "scheduled_time": <ms>}`. The older `/__scheduled` path is no longer documented.
- Pulumi: `cloudflare.WorkersCronTrigger` (`accountId`, `scriptName`, `schedules`). If Wrangler owns deploys, let Wrangler own triggers too, otherwise the two will overwrite each other. [I]

---

## 9. Custom Domains vs Routes, and cutover

Sources: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ (2026-11-12), https://developers.cloudflare.com/workers/configuration/routing/routes/ (2026-10-18). [V] unless marked.

| | Custom Domain | Route |
| --- | --- | --- |
| Scope | Whole hostname, all paths; Worker is the origin | Path pattern in front of an origin |
| DNS | Cloudflare creates the record and certificate | Needs an existing **proxied** record |
| Constraint | "You cannot create a Custom Domain on a hostname with an existing CNAME DNS record" | Unmatched paths fall through to the origin |
| Wrangler | `{"pattern": "www.example.com", "custom_domain": true}` | `{"pattern": "API_HOST/v2/historical*", "zone_name": "<zone>"}` |
| Pulumi | `cloudflare.WorkersCustomDomain` (`accountId`, `hostname`, `service` required; `zoneId` optional) | `cloudflare.WorkersRoute` (`zoneId`, `pattern`, `script`) |

- Originless placeholder records for route-only hostnames: proxied `A 192.0.2.0` or `AAAA 100::`.
- Documented migration from route to custom domain: delete the DNS record, add the custom domain, delete the route. This leaves a brief window with no record.

Zero-downtime cutover for the API hostname (assumes the zone is already on Cloudflare and the current record can be proxied): [I, built from verified parts]

1. Create bucket `BUCKET`, attach it to a new hostname (`BUCKET_CUSTOM_DOMAIN`), deploy the cron Worker, let it populate objects. Compare bodies against the live API offline.
2. Add the Cache Rule and CORS handling for `API_HOST`.
3. Add Cloud Connector rules for one path at a time on `API_HOST` (existing DNS record untouched). Rollback = disable the rule.
4. Add Worker Routes for parameterised paths.
5. When every path is served by Cloudflare, replace the legacy origin record with `AAAA 100::` proxied (or attach the bucket directly as an R2 custom domain) and decommission the old server.

If the hostname is currently DNS-only (grey cloud), turning the proxy on is the first and riskiest step: confirm the edge certificate is active first. [I]

Live state, measured 2026-11-22 (independent verification): `api.bluelytics.com.ar` is **already proxied** (`server: cloudflare`, `cf-ray: ...-EZE`), so the grey-cloud step does not apply. The zone already has caching configuration that this plan must take over rather than duplicate: `/v2/latest` returns `cf-cache-status: DYNAMIC`, while `/v2/evolution.json?days=2` returns `HIT` and `/v2/historical?day=...` returns `MISS`, both with `cache-control: max-age=7200`; the site root returns `HIT` with the same header. JSON and extensionless paths are not cached by default, so an existing Page Rule, Cache Rule or Worker makes them eligible (which one is not visible from outside). Inventory the zone's Page Rules, Cache Rules, Worker routes and zone-level Browser Cache TTL before Pulumi creates the new rulesets (a `PUT` on a phase entry point replaces every rule in it). "If you have Page Rules implemented for caching on the same path, Cache Rules will take precedence by design" (https://developers.cloudflare.com/cache/how-to/cache-rules/order/). [V by request and quote; the zone's plan and rule list were not visible to this check]

---

## 10. Observability and alerting at $0

Sources: https://developers.cloudflare.com/observability/pricing/ (2026-11-11), https://developers.cloudflare.com/workers/observability/logs/workers-logs/, https://developers.cloudflare.com/workers/observability/issues/ (2026-10-12), `/workers/observability/issues/automations/` (2026-10-10), https://developers.cloudflare.com/notifications/monitors/ (2026-10-21), https://developers.cloudflare.com/workers/observability/logs/real-time-logs/ (2026-06-25), https://developers.cloudflare.com/analytics/analytics-engine/pricing/ (2026-04-23). All [V].

- **Workers Logs pricing changes on 2026-12-01.** Until 2026-11-30: Free 200,000 log events/day, 3-day retention; Paid 20M/month then $0.60 per million, 7-day retention. From 2026-12-01 (Cloudflare Observability): Free 0.5 GB/day ingestion, 7-day retention, ingestion stops at the limit; Paid 50 GB per cycle then $0.25/GB, plus 10 GB-month storage then $0.10 per GB-month.
- Config:

```jsonc
"observability": {
  "enabled": true,
  "head_sampling_rate": 1,
  "logs": { "invocation_logs": true },
  "issues": { "enabled": true }      // Wrangler >= 4.134.0
}
```

- **Workers Issues** (open beta, free): groups uncaught exceptions, failed invocations, 5xx and `console.error(error)`. Automations (50 per account) fire on first occurrence, an occurrence threshold, or recurrence after inactivity, and deliver to a generic webhook, chat tools, incident tools or coding agents. This is the free "cron is failing" alert: throw from `scheduled()` on failure.
- **Monitors** (Alerts > Monitors): scheduled SQL API query returning one numeric `value`; threshold, anomaly or SLO detection; destinations email (up to 20), webhook (all plans), PagerDuty (Business+). Usable for "no successful scrape in N minutes" if the dataset is available to the account. Dataset availability per plan is not enumerated. [U]
- `wrangler tail` / dashboard real-time logs: free, max 10 concurrent viewers, sampled under high volume.
- Logpush: Paid only. Analytics Engine: Free 100,000 data points/day and 10,000 read queries/day; "Currently, you will not be billed".
- No built-in notification type for "Worker cron failed" was found in the notifications catalogue. [V that none is listed]
- A dead-man's-switch outside Cloudflare (the cron pings an external heartbeat URL) is the only way to detect "cron never ran". [I]

---

## 11. Secrets

Sources: https://developers.cloudflare.com/workers/configuration/secrets/ (2026-11-21), https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/update/, https://developers.cloudflare.com/secrets-store/ (2026-08-14), https://developers.cloudflare.com/secrets-store/integrations/workers/ (2026-10-12), https://developers.cloudflare.com/workers/platform/infrastructure-as-code/ (2026-11-19). All [V] unless marked.

Per-Worker secrets:

- `npx wrangler secret put <KEY>` (creates and deploys a new version); `npx wrangler secret bulk <file>`; `npx wrangler deploy --secrets-file .env.production` (up to 100 secrets; secrets not in the file are preserved); `npx wrangler versions secret put <KEY>` for gradual deployments.
- "Wrangler will not delete your secrets ... unless you run `wrangler secret delete <key>`", so secrets survive `wrangler deploy`.
- Declare required names so deploys fail fast and types are generated without `.dev.vars`: `"secrets": {"required": ["X_API_KEY", "IG_TOKEN"]}`.
  - Added by verification 2026-11-22: with `secrets.required` set, `wrangler deploy` and `wrangler versions upload` fail unless every listed secret is already configured on the Worker, and local dev loads **only** the listed keys from `.dev.vars` / `.env` (others are dropped). [V] Consequence for the very first deploy: set the secrets first or pass them with `--secrets-file` in the same command. [I]
- A variable and a secret cannot share a name; deploying a `vars` entry with a secret's name silently replaces and deletes the secret.
- Local: `.dev.vars` or `.env` next to the config (not both); per-environment `.dev.vars.<env>`.
- REST: `PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{script_name}/secrets` with `{"name": "X_API_KEY", "text": "<value>", "type": "secret_text"}`; permission `Workers Scripts Write`; creates a new version. A "Patch multiple script secrets" endpoint exists for bulk changes.

Secrets Store (account-level, **open beta**):

- Create: `npx wrangler secrets-store store create <name> --remote`; `npx wrangler secrets-store secret create <STORE_ID> --name MY_SECRET --scopes workers --remote`. REST: `POST /accounts/$ACCOUNT_ID/secrets_store/stores/$STORE_ID/secrets` with `[{"name", "value", "scopes": ["workers"], "comment"}]`, permission `Secrets Store Write`.
- Bind: `"secrets_store_secrets": [{"binding": "X_KEY", "store_id": "<STORE_ID>", "secret_name": "MY_SECRET"}]`.
- Read is asynchronous: `const key = await env.X_KEY.get()`.
- Production values are not readable in local dev.
- Pulumi: `cloudflare.SecretsStore`, `cloudflare.SecretsStoreSecret`.

With Pulumi (`@pulumi/cloudflare` 6.24.0, 2026-11-12; resource list read from the package typings): [V names, I for the division of labour]

- Cloudflare documents the split "use just the `cloudflare_worker` resource and seamlessly use Wrangler or your own deployment tools for Versions or Deployments". In Pulumi that is `cloudflare.Worker` (`accountId`, `name`, `observability`).
- Recommended ownership: Pulumi owns `Worker` shells, `D1Database`, `R2Bucket`, `R2CustomDomain`, `R2BucketCors`, `R2BucketLifecycle`, `Ruleset` (cache, rewrite, response headers), `CloudConnectorRules`, `DnsRecord`, `TieredCache`, scoped `ApiToken`s. Wrangler owns code, bindings, routes, crons. Pulumi exports IDs (D1 `database_id`, bucket name) that are written into `wrangler.jsonc`.
- If Pulumi must own code too: `cloudflare.WorkersScript` with `bindings: [{type: "secret_text", name, text: pulumi.secret(...)}]`, `keepBindings`, `bindingsInherit: "strict"`; bundle first with `wrangler deploy --dry-run --outdir build`. A later `wrangler deploy` would overwrite those bindings.
- `Ruleset` typings match the API: `actionParameters.edgeTtl {mode, default, statusCodeTtls}`, `actionParameters.cacheKey.customKey.queryString.exclude.all`, `actionParameters.uri.path.expression`.

Rotating credentials: a Worker cannot rewrite its own secret without calling the Cloudflare API and creating a new version. Keep tokens that rotate at runtime (OAuth refresh tokens, long-lived social tokens) in D1, encrypted with a static key held as a secret. [I]

---

## 12. Wrangler v4 configuration

Sources: https://developers.cloudflare.com/workers/wrangler/configuration/ (2026-11-12), `/workers/wrangler/commands/workers/` (2026-10-26), https://developers.cloudflare.com/workers/configuration/compatibility-dates/ (2026-04-23), https://developers.cloudflare.com/workers/runtime-apis/nodejs/ (2026-08-12), npm registry (2026-11-22). All [V].

| Package | Version | Published / note |
| --- | --- | --- |
| `wrangler` | 4.166.0 | 2026-11-20; Node >= 22.12.0 |
| `@pulumi/cloudflare` | 6.24.0 | 2026-11-12 |
| `astro` / `@astrojs/cloudflare` | 7.4.13 / 14.4.9 | Astro needs Node >= 22.23.4 |
| `@cloudflare/vite-plugin` | 1.70.1 | |
| `@cloudflare/vitest-pool-workers` | 0.23.0 | docs mention a successor `@cloudflare/vitest-plugin` |
| `@cloudflare/workers-types` | 5.20261121.1 | prefer `wrangler types` |
| `cf` (new Cloudflare CLI) | 1.0.0-rc.2 | 2026-11-19; release candidate, `cloudflare.config.ts`; do not mix with a Wrangler project |

- `wrangler.jsonc` is the recommended format; "some newer Wrangler features will only be available to projects using a JSON config file".
- `compatibility_date`: set to today. From `2026-08-04` onward `nodejs_compat` is on by default; omit the flag in new configs.
- Required keys: `name`, `main`, `compatibility_date` (`main` optional for assets-only Workers).
- Bindings are **not inherited** by `env.<name>` blocks; repeat them per environment. `wrangler types` generates `worker-configuration.d.ts` for all environments; `wrangler types --check` in CI.
- Wrangler v4 commands default to local; add `--remote` to touch real resources.
- Automatic provisioning: a binding without an ID makes `wrangler deploy` create the KV/R2/D1 resource and write the ID back. Do not use it when Pulumi owns those resources.
- Bundle size check: `npx wrangler deploy --dry-run --outdir dist-worker` prints `Total Upload: ... / gzip: ...`.
- Routes or crons edited in the dashboard are overwritten on the next deploy.

Reference config for the API/cron Worker:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "bluelytics-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-22",
  "upload_source_maps": true,
  "workers_dev": false,
  "routes": [
    { "pattern": "API_HOST/v2/historical*", "zone_name": "<zone>" }
  ],
  "triggers": { "crons": ["*/5 * * * *"] },
  "d1_databases": [
    { "binding": "DB", "database_name": "bluelytics", "database_id": "<from pulumi>", "migrations_dir": "migrations" }
  ],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "<from pulumi>" }],
  "browser": { "binding": "BROWSER" },
  "secrets": { "required": ["CF_PURGE_TOKEN", "CF_ZONE_ID", "TOKEN_ENC_KEY"] },
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "issues": { "enabled": true }
  }
  // Paid plan only: "limits": { "cpu_ms": 30000 }
}
```

---

## 13. Cost model for the API hostname

Assumptions: 95% of requests hit one tiny JSON endpoint, 5% hit parameterised paths; Worker CPU about 1 ms per request; scrape every 5 minutes (at most 8,640 writes per object per month). Prices from sections 1, 5, 6.

| Monthly requests | (A) Worker on every request | (B) R2 custom domain + CDN cache; Worker only for the 5% | (C) Fully static: R2 + cache + URL-rewrite rules, no Worker on the request path |
| --- | --- | --- | --- |
| **3M** | Free only if no day exceeds 100,000 requests (3M/month averages exactly the cap, so it will be exceeded). Paid: **$5.00** | Worker sees 150k/month (5k/day). **$0** on Free | **$0** on Free |
| **30M** | Not possible on Free. Paid: $5 + 20M × $0.30 = **$11.00** | Worker sees 1.5M/month (50k/day average). **$0** on Free while daily peaks stay under 100k account-wide, else **$5.00** | **$0** on Free |
| **300M** | Not possible on Free. Paid: $5 + 290M × $0.30 = $92.00, plus CPU (270M ms over × $0.02/M = $5.40 at 1 ms) = **about $97** | Worker sees 15M/month (500k/day): needs Paid, $5 + 5M × $0.30 = **$6.50** | **$0** on Free |

Notes:

- (A) also pays for the snapshot read if it is fetched per request from KV ($0.50/M beyond 10M: +$145 at 300M) or R2 ($0.36/M beyond 10M: +$104 at 300M). Memoise in an isolate global plus `caches.default`, or read from D1 (rows are within the 25B/month allowance). [V prices]
- (A) with Workers Cache enabled: request fees unchanged, CPU fee near zero. About $92 at 300M. [V]
- (B) and (C) R2 cost: Class A writes are 8,640 per object per month against 1M free. Class B reads happen only on cache MISS: at most one per edge location (or per upper tier with Tiered Cache) per purge. Even 300 locations × 288 purges/day × 30 days = 2.6M/month for the hot object, under the 10M free allowance. [I]
  - Caveat added by verification 2026-11-22: that bound is per cache-key **variant**. The default key includes the client's `Origin` header (3e), so every distinct website calling the API from a browser creates its own entry and its own MISS after each purge; the real multiplier is (distinct Origins + 1), not 1. Class B operations can never exceed total requests, so 3M requests/month stays free in every case, but at 30M+ the hit ratio decides whether the 10M allowance holds. Two mitigations that cost nothing: write to R2 and purge **only when the rendered body actually changed** (the rates move a few times a day, not every 5 minutes), and enable Smart Tiered Cache so a MISS is per upper tier rather than per data center. [I]
- Even with caching misconfigured, 3M requests/month straight to R2 stay inside the 10M free Class B operations; 30M uncached would cost 20M × $0.36 = $7.20. [V arithmetic]
- (C) depends on the rewrite-to-R2 mapping working as inferred and on accepting R2's 404 body for missing parameters.
- Not in the table: the cron Worker itself. $0 if each run stays within 10 ms CPU and 50 external subrequests; otherwise Workers Paid at $5/month, which then also covers 10M Worker requests/month for (B).

**Recommended: (B) as the baseline, moving individual parameterised paths to (C) where the response set is finite and the error body does not matter.** Total platform cost is $0 to $5 per month and does not grow with traffic.

---

## 14. Must-test-live list

| # | Question | How to test | Fallback if the answer is bad |
| --- | --- | --- | --- |
| 1 | On a Free zone, does `edge_ttl.mode = respect_origin` with origin `max-age=60` expire after 60 s, or is it floored to 2 hours? | Put a test object, request twice, watch `CF-Cache-Status` and `Age` for 3 minutes | Already the default design: `override_origin` 7200 s + purge by prefix after each write |
| 2 | Does a Worker Route on a hostname that is an R2 custom domain take precedence for its pattern? | Deploy a trivial Worker on `API_HOST/test*` | Use Cloud Connector on a normal proxied hostname instead of an R2 custom domain |
| 3 | Does the URL-rewrite rule deliver the rewritten path to R2, and is the cache key the original URL? | Create the rule, request `?day=...`, check body and `CF-Cache-Status` on repeat | Keep a Worker route for that path |
| 4 | Does a Worker Route pattern match the original or the rewritten path? | Route on the rewritten path only, observe | Do not combine rewrites and routes on the same path |
| 5 | R2 public 404: status, body, content type, and is it cached for 3 minutes? | Request a missing key | `status_code_ttl` for 404 in the cache rule; Worker route if a JSON error body is required |
| 6 | Cron scraper CPU per invocation on Free | `wrangler tail` or Workers Logs `cpuTime` | Workers Paid ($5) |
| 7 | Purge latency after R2 write | Timestamp in body, poll after purge | Purge by tag or hostname |
| 8 | Does a cache HIT ever show as an R2 Class B operation? | R2 metrics after a day of traffic | None needed at these volumes |
| 9 | Missed cron invocations in practice | Log `scheduledTime` gaps | External heartbeat monitor |
| 10 | (added 2026-11-22) Does a Cache Rule with `cache: true` actually produce `HIT` for extensionless JSON on this zone's plan, and is an `override_origin` value below 7200 s rejected or silently ignored on Free? One 2026 community report describes a Free zone staying `DYNAMIC` under Cache Rules with a 1-hour override until a "Cache Everything" Page Rule with a 2-hour Edge TTL was used (https://dev.to/doodoolove/why-cloudflares-free-plan-cache-rules-dont-cache-your-html-and-the-page-rules-fix-that-does-24d4, 2026-05-07; anecdote, not documentation) | Deploy the rule from 3b on one test path, request twice, expect `MISS` then `HIT` | Keep the value at 7200 s; if still `DYNAMIC`, use a Page Rule "Cache Level: Cache Everything" + Edge Cache TTL 2 hours for the API paths |
| 11 | (added 2026-11-22) With Cloud Connector in front of R2, does a prefix / hostname purge need `API_HOST` or `BUCKET_CUSTOM_DOMAIN`? With the `?day=` rewrite, is the post-rewrite prefix really the one that clears the entry? | Purge one form at a time and watch `CF-Cache-Status` | Send every form (both hosts, pre- and post-rewrite paths) in one request; it is still one rate-limit token |
| 12 | (added 2026-11-22) Can a Cache Response Rule (`set_cache_control` with `s-maxage`, `cloudflare_only`) give a sub-2-hour edge TTL on Free? The docs example shows it overriding a 7200 s Cache Rule down to 3600 s but does not mention plan floors (https://developers.cloudflare.com/cache/how-to/cache-response-rules/, 2026-10-28) | Rule with `s-maxage=300` on a test path, watch `Age` / `CF-Cache-Status` past 5 minutes | Not needed if purge-on-write works |
| 13 | (added 2026-11-22) Does the R2 custom domain answer a CORS preflight (`OPTIONS`) the way the legacy API does (`204`, `access-control-allow-origin: *`)? | `curl -X OPTIONS -H "Origin: https://example.org" -H "Access-Control-Request-Method: GET"` against the bucket domain | Worker route for `OPTIONS`, or accept the difference (simple `GET`s do not preflight) |

---

## 15. Conflicts and undated material

- Cache key "Ignore query string": the cache-keys page lists it as available on Free; the cache-rules settings page lists it under Enterprise options with the note "also available for Pay-as-you-go customers". Read together they agree (self-serve plans have it). [V both texts]
- Browser Run token permission is called "Browser Run - Edit" in the guide and "Browser Run Write" in the API reference.
- The API reference still shows `/browser-rendering/screenshot`; the guide uses `/browser-run/screenshot`.
- `https://developers.cloudflare.com/cache/plans/` returned HTML only and was not used. `fundamentals/concepts/traffic-sequence` returned 404.
- The only source for "URL rewrites run before Workers" is a 2021 blog post.
- API reference pages (`/api/resources/...`) carry no `dateModified`.
- The takumi documentation site could not be fetched beyond its `llms.txt`; its Workers support is taken from that index and the npm README only.
- (added 2026-11-22) Astro SSR entry point: Cloudflare's framework guide shows `main: dist/_worker.js/index.js`; Astro's adapter docs and the published `@astrojs/cloudflare@14.4.9` package say `@astrojs/cloudflare/entrypoints/server`. The adapter is authoritative (section 2).
- (added 2026-11-22) Cloud Connector is called "(Beta)" in the first sentence of its overview and "generally available" in the same page's Availability section.
- (added 2026-11-22) Purge and Transform Rules: single-file purge wants the end-user URL, prefix purge wants the post-transform URL. Both statements are current docs; they are not a contradiction but are easy to mix up.
- (added 2026-11-22) R2 public-buckets page says caching everything needs "a Cache Everything page rule"; the cache/R2 interaction page says "create a Cache Rule". Both work; Cache Rules win when both match.

---

## Independent verification (2026-11-22)

Method: a second researcher re-fetched every page below directly from `https://developers.cloudflare.com/<path>/index.md` (plus the API reference, the npm registry, the `withastro/docs` repository and the `@pulumi/cloudflare@6.24.0` typings and schema) on 2026-11-22 and compared the text with this file. Copies are in `/tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/research/verify_cf/`. Ten read-only `GET` / `OPTIONS` requests were also made to the live legacy API and site to record their current headers. Nothing was deployed, so every item this file marks "test live" is still untested.

### Confirmed (text read in the primary source)

1. **Worker billed on every request, cache HIT included.** "Since Cloudflare Workers runs before the Cloudflare cache, the caching of a request still incurs costs" and footnote 4 "requests served from the Worker's cache are billed at the same per-request rate" (`/workers/platform/pricing/`); "Cloudflare Workers run before the cache" (`/workers/reference/how-the-cache-works/`); billing table HIT = "Standard rate / Not billed [CPU]", static-asset requests become billed (`/workers/cache/`).
2. **R2 custom domain is served through the zone cache; JSON needs a rule.** "requests for your stored files go through Cloudflare's cache instead of hitting R2 directly every time"; "HTML and JSON are not cached unless you create a Cache Rule" (`/cache/interaction-cloudflare-products/r2/`); extension list and "only caches based on file extension and not by MIME type" (`/cache/concepts/default-cache-behavior/`). That no Worker request is billed on this path is not stated in one sentence anywhere; it follows from the Workers pricing rule "Only requests that hit a Worker will count".
3. **Free: minimum Edge Cache TTL 2 hours; all purge types; 5 requests/minute, bucket 25, 100 operations per request, per account** (`/cache/how-to/edge-browser-cache-ttl/`, `/cache/how-to/purge-cache/`). One purge per 5 minutes uses 4% of the refill rate.
4. **Free: 10 ms CPU per Cron Trigger invocation; 5 Cron Triggers per account** (1,000 on Paid) (`/workers/platform/limits/`, 2026-11-19).
5. **Static asset requests "free and unlimited"; assets are attached per Worker version** via manifest → upload → script/version upload (`/workers/static-assets/billing-and-limitations/`, `/workers/static-assets/direct-upload/`).
6. **Snippets: Free "No", 0 snippets. Custom Errors: Free "No". Cache Rules 10, Transform Rules 10 (no regex), Cache Response Rules 10, Cloud Connector 10 on Free** (the four product pages).
7. **R2 free tier: 10 GB-month, 1M Class A, 10M Class B per month, egress free**; `PutObject` is Class A, `GetObject` Class B (`/r2/pricing/`). 12 writes/hour × 24 × 30 = 8,640 (8,928 in a 31-day month).
8. **Browser Run Free: 10 minutes/day, Quick Actions 1 request every 10 seconds; `env.BROWSER.quickAction("screenshot", {...})` documented, needs `compatibility_date` >= 2026-03-24; `screenshotOptions.type` is `"png" | "jpeg" | "webp"`** (`/browser-run/limits/`, `/browser-run/quick-actions/`, `/browser-run/quick-actions/screenshot-endpoint/`, API reference).
9. **D1 Free: 5M rows read/day, 100,000 rows written/day, 500 MB per database, 5 GB total, 10 databases; hints `wnam enam weur eeur apac oc`; "not currently supported for South America (`sam`)"** (`/d1/platform/pricing/`, `/d1/platform/limits/`, `/d1/configuration/data-location/`).
10. **Default cache key includes "Origin header sent by client"; header customisation (including excluding `Origin`) is Enterprise only; dashboard single-file purge does not clear entries cached with an `Origin` header, and the API can only clear a variant whose header values are sent** (`/cache/how-to/cache-keys/`, `/cache/how-to/purge-cache/purge-by-single-file/`).

Additional statements checked and confirmed:

- Request phase order exactly as in 3d, Single Redirects before URL normalization, Cloud Connector last (`/ruleset-engine/reference/phases-list/`).
- Cloud Connector API: `PUT /zones/{zone_id}/cloud_connector/rules`, array body, required `expression`, `provider`, `parameters.host`; `provider` values `cloudflare_r2`, `aws_s3`, `azure_storage`, `gcp_storage`, `oci_storage`; permission Zone > Cloud Connector > Write.
- Rewrite expressions may only use `http.request.uri.*`, `http.request.headers.*`, `http.request.accepted_languages`; `concat()` once per expression; 4,096 characters combined.
- Purge API `POST /zones/{zone_id}/purge_cache` with `files` / `tags` / `hosts` / `prefixes` / `purge_everything`, permission `Cache Purge`; `POST /zones/{zone_id}/invalidate_cache` exists.
- R2 custom domain API `POST /accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom` with `domain`, `enabled`, `zoneId`, optional `minTLS` (default 1.0) and `ciphers`.
- Worker size 64 MiB uncompressed with "no compressed size limit"; Cache API 50 / 1,000 calls; subrequests 50 (1,000 internal) / 10,000.
- Workers Cache needs Wrangler >= 4.69.0; `nodejs_compat` default from compatibility date 2026-08-04; KV minimum `cacheTtl` 30; D1 50 MB result limit from 2026-11-04; Observability pricing from 2026-12-01 with the quoted numbers; Workers Issues open beta, Wrangler >= 4.134.0, 50 automations.
- npm versions and publish dates in sections 7 and 12 all match the registry on 2026-11-22. `@cloudflare/vitest-plugin` exists (latest 1.9.0).
- Pulumi 6.24.0 has every resource named in this file (`Worker`, `WorkersScript`, `WorkerVersion`, `WorkersDeployment`, `WorkersCronTrigger`, `WorkersCustomDomain`, `WorkersRoute`, `R2Bucket`, `R2CustomDomain`, `R2BucketCors`, `R2BucketLifecycle`, `Ruleset`, `CloudConnectorRules`, `DnsRecord`, `TieredCache`, `ArgoTieredCaching`, `ApiToken`, `D1Database`, `SecretsStore`, `SecretsStoreSecret`) and the `Ruleset` fields `edgeTtl.{mode,default,statusCodeTtls}`, `cacheKey.customKey.queryString.exclude.all`, `uri.path.expression`. `TieredCache.value` = Smart Tiered Cache on/off; `ArgoTieredCaching.value` = Tiered Cache on/off.

### Corrected (edited in place above)

| Where | Was | Now | Source |
| --- | --- | --- | --- |
| Section 2, Astro | SSR `main: dist/_worker.js/index.js` | `main: "@astrojs/cloudflare/entrypoints/server"` for `@astrojs/cloudflare` on Astro 6 and later | Astro adapter and deploy guides; package `exports` of 14.4.9 |
| Section 3b, purge + Transform Rule | Only the single-file rule (use the end-user URL) | Prefix purge needs the **post-transform** URL; purge both forms | `/cache/how-to/purge-cache/purge_by_prefix/` (2026-08-21) |
| Section 3c, Cloud Connector | "GA", no zone constraint | Page says both "(Beta)" and "generally available"; bucket custom domain must be in the same zone; Cache Response Rules match the rewritten host | `/rules/cloud-connector/`, `/rules/cloud-connector/providers/`, `/cache/how-to/cache-response-rules/` |
| Section 3c, Pulumi | Rule field implied to be `provider` | `cloudConnectorRulesProvider` | `@pulumi/cloudflare@6.24.0` `types/input.d.ts` |
| Section 9, Pulumi | `WorkersCustomDomain` (`hostname`, `service`, `zoneId`) | `accountId`, `hostname`, `service` required; `zoneId` optional | provider schema 6.24.0 |
| Section 9, cutover | "If the hostname is currently DNS-only" left open | `api.bluelytics.com.ar` is already proxied and already has caching rules returning `max-age=7200` | live request 2026-11-22 |
| Section 13, Class B estimate | One MISS per location per purge | One MISS per location **per `Origin` variant** per purge; purge only on change | follows from `/cache/how-to/cache-keys/` |
| Sections 3a, 3b, 3d, 3e, 7, 11 | (omissions) | `.csv` is cached by default; legacy CORS and 404 contract recorded; Quick Action spacing on Free; `secrets.required` deploy behaviour; per-entrypoint cache override needs Wrangler 4.107.0 | pages cited inline |

None of the ten decision-critical claims was refuted. The corrections change implementation details, not the recommended architecture.

### Still uncertain (no primary source; needs the live tests in section 14)

- Whether Free's 2-hour floor also overrides a shorter origin `max-age` / `s-maxage` under `respect_origin`, and whether `override_origin` below 7200 s is rejected or ignored. The docs give the floor and the modes but not their interaction. Design already avoids depending on it. (tests 1, 10, 12)
- Whether Cache Rules reliably cache extensionless JSON on this zone's plan. Docs say yes; one dated community report says a Free zone needed a Page Rule. The live zone already returns `HIT` for `/v2/evolution.json`, so some mechanism works there today. (test 10)
- Worker Route precedence on a hostname that is an R2 custom domain, and whether route matching sees the pre- or post-rewrite path. Only a 2021 blog post speaks to rewrite order. (tests 2, 4)
- End-to-end behaviour of "URL rewrite → R2 object" and which URL form the cache key and purge use, especially behind Cloud Connector's host rewrite. (tests 3, 11)
- R2 public-bucket 404 body and content type, and R2's answer to a CORS preflight. (tests 5, 13)
- That a cache HIT causes no R2 Class B operation: implied by the cache docs, not stated by R2 pricing. (test 8)
- Scraper CPU per cron run versus the 10 ms Free limit, and satori/resvg CPU cost: unmeasured. (test 6)
- Cron delivery guarantees and retry policy: not documented. (test 9)
- The plan of the bluelytics.com.ar zone and its existing Page Rules / Cache Rules: not visible without account access.
