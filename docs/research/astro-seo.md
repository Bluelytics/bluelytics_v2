# Astro 7 on Cloudflare Workers + SEO for bluelytics.com.ar — research notes

Research date: 2026-11-22. Everything below was read from primary sources on that day or run in a
local sandbox. Evidence labels used throughout:

- **[DOC]** read in an official doc / changelog / package source (URL + page date given).
- **[SANDBOX]** observed by building and running a throwaway project locally
  (`/tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/astro-sandbox/site`).
- **[UNVERIFIED]** inferred, from memory, or not testable without a deployed Cloudflare account.

Versions exercised in the sandbox: node 24.22.3, pnpm 12.22.0, astro 7.4.13, @astrojs/cloudflare 14.4.9,
wrangler 4.166.0, @astrojs/sitemap 3.7.6, @astrojs/check 0.9.12, typescript 6.0.3 (7.0.2 fails, see 1.7),
vite 8.3.8, @cloudflare/vite-plugin 1.70.1, workerd 1.20261119.1.

Release dates (npm registry `time`, 2026-11-22): astro 6.0.0 = 2026-03-10, 7.0.0 = 2026-06-22,
7.4.13 = 2026-11-18; @astrojs/cloudflare 13.0.0 = 2026-03-10, 14.0.0 = 2026-06-22, 14.4.9 = 2026-11-18;
wrangler 4.166.0 = 2026-11-20.

---

## 0. Bottom line

1. Astro 7 + `@astrojs/cloudflare` 14 targets **Workers only** (Pages support was removed in adapter v13).
   Keep `output: 'static'` and opt individual pages into SSR with `export const prerender = false`.
2. Cloudflare's **zone cache does not cache Worker responses**. The thing that does is **Workers Cache**
   (launched 2026-07-06, wrangler `cache.enabled`), and Astro 7 has a stable route-caching API
   (`Astro.cache.set()`, `routeRules`) with a Cloudflare provider (`cacheCloudflare()`) that drives it.
   This is the recommended way to serve price pages: correct prices in the HTML, Worker runs about once
   per minute per page instead of once per visit.
3. **Cost catch:** with Workers Cache on, *every* request is billed as a Worker request, including
   static-asset requests that are otherwise free, and cache hits. That is fine on Workers Paid
   ($5/month, 10M requests included) and tight on Workers Free (100,000 requests/day, 10 ms CPU).
   If the account must stay on Free, use the Cache API middleware variant in 3.6 instead.
4. `astro check` does not run on TypeScript 7.0. Pin `typescript@~6.0.3` in the web package.
5. Google removed FAQ rich results (2026-05-07), uses Dataset markup only in Dataset Search, removed the
   sitelinks search box (2024-11), shows breadcrumbs on desktop only, and ignores llms.txt. No Google
   rich result exists for exchange rates. Structured data is therefore a small, cheap extra; the ranking
   work is server-rendered prices, real URLs, titles, internal links and speed.
6. The old `/#/calculator` style URLs are all the single URL `/` to Google, so there is nothing to
   redirect server-side and no ranking to lose; a small client script forwards human visitors.

---

## 1. Project setup: Astro 7 + Cloudflare Workers

### 1.1 Commands that were run, and results [SANDBOX]

```sh
export PATH=/home/sicarul/.nvm/versions/node/v24.22.3/bin:$PATH
pnpm create astro@latest site --template minimal --install --no-git --yes --skip-houston   # OK, create-astro 5.3.2, astro ^7.4.13
cd site
pnpm astro add cloudflare --yes
#   -> runs: pnpm add --allow-build=workerd @astrojs/cloudflare@^14.4.9 wrangler@^4.166.0
#   -> FAILED: ERR_PNPM_IGNORED_BUILDS "Ignored build scripts: esbuild@0.28.2"
#      (packages were installed, but astro.config.mjs was NOT updated)
```

Fix for pnpm 12: approve build scripts in `pnpm-workspace.yaml`, then configure by hand:

```yaml
# pnpm-workspace.yaml  (in the monorepo root this is the same file that lists packages)
allowBuilds:
  workerd: true
  esbuild: true
  sharp: true
```

```sh
pnpm add @astrojs/sitemap                       # 3.7.6
pnpm add -D @astrojs/check typescript@^6 @types/node
pnpm wrangler types                             # writes worker-configuration.d.ts (633 kB)
pnpm wrangler d1 migrations apply <db-name> --local
pnpm astro build                                # ~3 s for the sandbox
pnpm astro preview --port 4399                  # workerd; daemonises, stop with `astro preview stop`
pnpm astro dev --background --port 4398         # workerd; `astro dev stop|status|logs`
pnpm astro check                                # 0 errors with TS 6.0.3
pnpm wrangler deploy --dry-run                  # Total Upload: 488 KiB / gzip 130 KiB
```

`astro --help` lists: add, build, check, create-key, dev, docs, info, preview, sync, preferences, telemetry.
There is **no `astro deploy`**; deployment is `astro build && wrangler deploy` [SANDBOX + DOC
https://docs.astro.build/en/guides/deploy/cloudflare/].

Requirements [DOC npm registry]: astro 7.4.13 `engines.node >=22.23.4`; @astrojs/cloudflare 14.4.9 peers
`astro ^7.4.0`, `wrangler ^4.125.0`.

### 1.2 Output modes

`output` is `'static' | 'server'`, default `'static'` (`'hybrid'` no longer exists). `'static'` prerenders
everything unless a page exports `prerender = false`; `'server'` only flips the default
[DOC https://docs.astro.build/en/reference/configuration-reference/#output,
https://docs.astro.build/en/guides/on-demand-rendering/]. The docs' own advice: stay on `'static'` unless
most pages are on-demand. The sandbox build logs `output: "static"`, `mode: "server"`.

### 1.3 Adapter options (complete list in 14.4.9)

[DOC https://docs.astro.build/en/guides/integrations-guide/cloudflare/ ; confirmed in
`node_modules/@astrojs/cloudflare/dist/index.d.ts`]

| Option | Type / default | Notes |
|---|---|---|
| `imageService` | `'passthrough' \| 'cloudflare' \| 'cloudflare-binding' \| 'compile' \| 'custom' \| { build, runtime? }`, default `'cloudflare-binding'` | Default auto-provisions a Cloudflare Images binding on deploy. Use `'compile'` (sharp at build for prerendered pages, passthrough at runtime) to avoid the binding. |
| `sessionKVBindingName` | string, default `SESSION` | A KV namespace is auto-provisioned unless `session: false` in Astro config. |
| `imagesBindingName` | string, default `IMAGES` | |
| `prerenderEnvironment` | `'workerd' \| 'node'`, default `'workerd'` | Prerendering runs in workerd, so prerendered pages can use bindings. |
| `auxiliaryWorkers`, `configPath`, `inspectorPort`, `persistState`, `remoteBindings` | passed to `@cloudflare/vite-plugin` | |

Gone: `platformProxy`, `workerEntryPoint`, `cloudflareModules`, `Astro.locals.runtime`, Cloudflare Pages
support (all removed in adapter v13 / Astro 6).

### 1.4 Wrangler config: what you write vs what the build generates

You write a minimal `wrangler.jsonc`; the adapter fills in `main`, `assets`, `compatibility_date`,
and (when `cacheCloudflare()` is configured) `cache.enabled`. Source of those defaults:
`node_modules/@astrojs/cloudflare/dist/wrangler.js` [SANDBOX read].

```jsonc
// apps/web/wrangler.jsonc (hand-written)
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "bluelytics-web",
  "compatibility_date": "2026-11-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "routes": [{ "pattern": "bluelytics.com.ar", "custom_domain": true }],
  "observability": { "enabled": true },
  "assets": { "binding": "ASSETS", "not_found_handling": "404-page" },
  "d1_databases": [
    { "binding": "DB", "database_name": "bluelytics", "database_id": "<from Pulumi>", "migrations_dir": "migrations" }
  ]
}
```

Build output [SANDBOX]:

```
dist/client/                 static assets: prerendered *.html, _astro/*, _headers, _redirects, robots.txt, sitemap-*.xml
dist/client/.assetsignore    contains "wrangler.json" and ".dev.vars"
dist/server/entry.mjs        Worker entry (284 kB) + dist/server/chunks/*.mjs
dist/server/wrangler.json    GENERATED config: "main":"entry.mjs", "assets":{"binding":"ASSETS","directory":"../client"},
                             "no_bundle":true, "cache":{"enabled":true}, plus your bindings
.wrangler/deploy/config.json {"configPath":"../../dist/server/wrangler.json", ...}  <- `wrangler deploy` follows this
```

There is no `dist/_worker.js` any more. `wrangler deploy` run from the project root picks up the generated
config through `.wrangler/deploy/config.json` (dry run confirmed: it read 18 files from `dist/client` and
listed `env.DB`, `env.ASSETS`).

- Static assets are served directly, without invoking the Worker, when the path matches a file; anything
  else falls through to the Worker [DOC adapter page "Routes"]. The adapter writes
  `/_astro/*  Cache-Control: public, max-age=31536000, immutable` into `dist/client/_headers` [SANDBOX].
  Other static files get Cloudflare's default `cache-control: public, max-age=0, must-revalidate` + `etag`.
- `public/_headers` and `public/_redirects` apply to static assets only, never to Worker responses
  [DOC adapter page]. Limit: 100 header rules [DOC
  https://developers.cloudflare.com/workers/static-assets/headers/, 2026-11-12].
- Environments are chosen at **build** time: `CLOUDFLARE_ENV=production astro build && wrangler deploy`
  [DOC adapter page, "Deploy to Cloudflare Environment"].
- Custom Worker entry (needed for a `scheduled` handler, named entrypoints, Durable Objects): set
  `"main": "./src/worker.ts"` and call `handle` from `@astrojs/cloudflare/handler` [DOC + SANDBOX, builds
  and runs]:

```ts
// src/worker.ts
import { handle } from '@astrojs/cloudflare/handler';
export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
  async scheduled(controller, env, ctx) { /* cron work */ },
} satisfies ExportedHandler<Env>;
```

### 1.5 Local development

`astro dev` and `astro preview` both run the site inside **workerd** through the Cloudflare Vite plugin
[DOC adapter page; SANDBOX]. Observed locally: `Astro.request.cf?.country` returned `AR`, D1 queries hit
the local Miniflare database under `.wrangler/state`, `Astro.cache.enabled` was `false` in dev and `true`
in preview. CSP is not applied in dev [DOC]. The new CLI daemon flags (`--background`, `stop`, `status`,
`logs`) come from the generated `AGENTS.md` and worked.

### 1.6 Astro 6 → 7 changes that affect this project

[DOC https://docs.astro.build/en/guides/upgrade-to/v6/ and /v7/]

- v7: Vite 8; Rust compiler is the only compiler and **fails the build on unclosed tags / invalid nesting**;
  `compressHTML` default is `'jsx'` (whitespace between inline elements on *different lines* is dropped,
  add `{" "}`); `src/fetch.ts` is a reserved filename (advanced routing); `cache` and `routeRules` are
  stable top-level config; `@astrojs/db` removed; Sätteri replaces remark as default Markdown processor.
- v6: Node 22+; Zod 4 (`astro/zod`); `<ViewTransitions />` removed (use `<ClientRouter />`); `Astro.glob()`
  removed; CSP and Fonts API stable; `import.meta.env` values are always inlined strings;
  `i18n.routing.redirectToDefaultLocale` defaults to `false`; endpoints with a file extension
  (`sitemap.xml`) cannot be requested with a trailing slash.

### 1.7 TypeScript 7 and `astro check` [SANDBOX]

With `typescript@7.0.2`:

```
[ERROR] [check] astro check does not currently support TypeScript 7.0. To continue using astro check, install TypeScript 6 instead.
astro check will be deprecated in a future Astro release. Experimental support for type-checking Astro files
with TypeScript 7.1+ is available through @astrojs/ts-content-mapper.
```

`@astrojs/check@0.9.12` peers `typescript ^5.0.0 || ^6.0.0`. With `typescript@6.0.3`: `0 errors`.
TypeScript 7.1 is still `beta` on npm (`7.1.0-beta`); `@astrojs/ts-content-mapper` is 0.2.0.
Use TS 6.0.3 in `apps/web`; other packages in the monorepo can use TS 7.

---

## 2. Bindings, env vars, types

### 2.1 Runtime access [DOC adapter page; SANDBOX]

| Need | Astro 7 / adapter 14 | Removed API |
|---|---|---|
| Bindings and vars | `import { env } from 'cloudflare:workers'` → `env.DB`, `env.MY_KV` | `Astro.locals.runtime.env` |
| Typed env schema | `import { X } from 'astro:env/server'` also works | |
| Request metadata | `Astro.request.cf` / `context.request.cf` | `Astro.locals.runtime.cf` |
| ExecutionContext | `Astro.locals.cfContext` (`.waitUntil()`, `.exports`) | `Astro.locals.runtime.ctx` |
| Cache API | global `caches` | `Astro.locals.runtime.caches` |

Works identically in `.astro` pages, endpoints, middleware and plain `.ts` modules:

```ts
// src/lib/rates.ts  (type-checks and runs in the sandbox)
import { env } from 'cloudflare:workers';
export async function latest() {
  const { results } = await env.DB.prepare(
    'SELECT date, source, buy, sell FROM rates WHERE date = (SELECT MAX(date) FROM rates)',
  ).all<{ date: string; source: string; buy: number; sell: number }>();
  return results;
}
```

Secrets: `wrangler secret put KEY`; local values in `.dev.vars` [DOC].

### 2.2 Types

`wrangler types` generates `worker-configuration.d.ts` declaring `Cloudflare.Env` / `Env` from
`wrangler.jsonc`; rerun after every config change (`"build": "wrangler types && astro check && astro build"`)
[DOC]. With it, `env.DB`, `Astro.request.cf`, `Astro.cache` and `cache` from `cloudflare:workers` all
type-check [SANDBOX]. Two type gaps hit in the sandbox:

- `caches.default` → `Property 'default' does not exist on type 'CacheStorage'` (DOM lib wins). Workaround:
  `(caches as unknown as { default: Cache }).default`.
- `ctx.cache` is typed optional. Use `import { cache } from 'cloudflare:workers'` instead.

### 2.3 Bindings at build time (prerendered pages)

Prerendering runs in workerd, so a prerendered page can call `env.DB` during `astro build`. In the sandbox a
prerendered page printed rows from D1 at build time, **but they came from the local Miniflare database**,
not from production [SANDBOX]. To reach real resources, mark the binding `"remote": true` in wrangler
config (or use the adapter's `remoteBindings` option) [DOC
https://developers.cloudflare.com/workers/development-testing/]. Whether `remote: true` is honoured during
`astro build` prerendering specifically, and what credentials CI needs, is **[UNVERIFIED]**.

Recommendation: do not let any prerendered page depend on live data. Pages that show prices are SSR +
cached; prerendered pages are pure content (API docs, about, privacy).

---

## 3. Rendering and caching for a rates site

### 3.1 Does Cloudflare cache Worker responses on a custom domain?

Not through the zone cache. "Cloudflare Workers run before the cache" and to cache a Worker's own output
"so that Cloudflare returns the cached response without executing the Worker" you need Workers Cache
[DOC https://developers.cloudflare.com/workers/reference/how-the-cache-works/, 2026-10-29]. Cache Rules,
Page Rules and the default-extension list do not apply to it [DOC
https://developers.cloudflare.com/workers/cache/, 2026-10-30]. A `Cache-Control` header set from an Astro
page therefore only reaches browsers unless Workers Cache is enabled or the code uses the Cache API.

### 3.2 Workers Cache facts

[DOC https://developers.cloudflare.com/workers/cache/ (2026-10-30), /configuration/ (2026-10-30),
/cache-keys/ (2026-11-18), /purge/ (2026-11-21), /limitations/ (2026-11-18); launch post
https://blog.cloudflare.com/workers-cache/ dated 2026-07-06]

- Enable: `"cache": { "enabled": true }` in wrangler config (wrangler ≥ 4.69.0). Optional
  `"cross_version_cache": true` and per-entrypoint `"exports": { "<name>": { "type": "worker", "cache": { "enabled": bool } } }`
  need wrangler ≥ 4.107.0.
- Only `GET`/`HEAD` on the `fetch` handler. Cron, queue, RPC methods and Durable Objects are never cached.
- Tiered (lower tier near the visitor, shared upper tier) and **request-collapsing** by default.
- Header precedence: `Cloudflare-CDN-Cache-Control` (stripped before the client) > `CDN-Cache-Control` >
  `Cache-Control`. `stale-while-revalidate` and `stale-if-error` are honoured, **but any of `s-maxage`,
  `must-revalidate`, `proxy-revalidate` disables stale serving**. Use `max-age`, not `s-maxage`.
- A `200` with **no** `Cache-Control` is cached for 2 hours (heuristic freshness); `404` for 3 minutes.
  Opt out explicitly with `no-store` or `private`.
- Bypass: response has `Set-Cookie`, request has `Authorization`, or `Cache-Control: private|no-store`.
  `520–526` and Worker-produced `206` are never stored.
- **Cache key = entrypoint + path + query string + Worker version (+ `ctx.props`). The host is not in the
  key.** Query-parameter order and trailing slashes matter; tracking parameters are not stripped.
- Because the version is in the key, **every deploy starts with a cold cache** unless
  `cross_version_cache: true`.
- Purge from code only: `ctx.cache.purge({ tags } | { pathPrefixes } | { purgeEverything: true })` or
  `import { cache } from 'cloudflare:workers'`. `invalidate()` is the soft variant. Scoped to the Worker
  **and to the entrypoint that calls it**; zone/API/dashboard purges do not touch it. Rate limit is always
  the Free tier: 5 purge requests/minute, bucket 25, 100 operations per request [DOC
  https://developers.cloudflare.com/cache/how-to/purge-cache/, 2026-09-29].
- No pre-warming API. Not exercised by local Vitest; test on a deployed Preview or Worker.
- Response size limit is the Free-plan cache limit (512 MB) for everyone at launch.

Pricing [DOC https://developers.cloudflare.com/workers/platform/pricing/, 2026-11-18, and the Workers
Cache page]:

| Request type (cache enabled) | Request charge | CPU charge |
|---|---|---|
| Cache HIT | standard | none |
| MISS / BYPASS | standard | billed |
| Static asset request | **standard (normally free)** | none |
| Worker-to-worker call (service binding, `ctx.exports`) | **standard (normally free)** | if it runs |

Workers Free: 100,000 requests/day (account-wide; on excess Error 1027 or fail-open per route), 10 ms CPU
per invocation, 5 Cron Triggers per account, 20,000 static files per version. Workers Paid: $5/month,
10M requests/month included then $0.30/M, 30M CPU-ms included then $0.02/M, 1,000 Cron Triggers, 100,000
static files [DOC https://developers.cloudflare.com/workers/platform/limits/, 2026-11-19]. Cloudflare's own
note on that page: SSR workloads "typically use 10-20 ms" CPU, which is at or over the Free limit.

### 3.3 Astro 7 route caching API

[DOC https://docs.astro.build/en/guides/caching/ ("Since 7.0.0"),
https://docs.astro.build/en/reference/cache-provider-reference/]

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';   // since adapter 14.0.0; docs call it "experimental"

export default defineConfig({
  adapter: cloudflare({ imageService: 'compile' }),
  cache: { provider: cacheCloudflare() },
  routeRules: {                      // same pattern syntax as file routes; no globs, use [...rest]
    '/historico/[period]': { maxAge: 86400, swr: 604800, tags: ['history'] },
  },
});
```

Per request (`Astro.cache` in pages, `context.cache` in endpoints and middleware):

| Member | Meaning |
|---|---|
| `cache.set({ maxAge, swr, tags, lastModified, etag })` | seconds; multiple calls merge (scalars last-write-wins, tags accumulate, latest `lastModified` wins) |
| `cache.set(false)` | opt this response out (overrides a matching route rule) |
| `cache.enabled` | `false` in dev or without a provider |
| `cache.options`, `cache.tags` | read-only merged state |
| `await cache.invalidate({ tags } \| { path })` | purge; `path` is exact-match |

What the Cloudflare provider does [SANDBOX read of `dist/cache/provider.js` + observed headers]:

- Adds `cache: { enabled: true }` to the generated wrangler config automatically.
- `cache.set({ maxAge: 60, swr: 600, tags: ['rates'], lastModified })` produced:
  `cloudflare-cdn-cache-control: public, max-age=60, stale-while-revalidate=600`,
  `cache-tag: rates,astro-path:/`, `last-modified: …`.
- Responses with no cache intent get `cloudflare-cdn-cache-control: no-store` (seen on redirects, 404s and
  uncached pages), so the 2-hour heuristic default never applies to Astro output.
- If a `CF_VERSION_METADATA` binding exists it also tags `astro-version:<id>` and emits a weak ETag.
- `invalidate()` calls `cache.purge({ tags })` from `cloudflare:workers` (path invalidation is a tag purge
  of `astro-path:<path>`).

Page pattern (ran in the sandbox):

```astro
---
// src/pages/index.astro
export const prerender = false;
import { latest } from '../lib/rates';
const rates = await latest();
Astro.cache.set({ maxAge: 60, swr: 600, tags: ['rates'], lastModified: new Date(rates.updatedAt) });
Astro.response.headers.set('Cache-Control', 'public, max-age=0');   // what browsers see
---
```

Setting response headers only works at page level, not inside components or layouts, because of streaming
[DOC on-demand rendering guide].

### 3.4 Gotchas found while testing [SANDBOX unless noted]

1. **Route rules also cache 404s.** With the rule above, `/historico/1999-01-01` returned 404 with
   `max-age=86400`. A request for tomorrow's date would pin a 404 for a day. Call `Astro.cache.set(false)`
   before returning `new Response(null, { status: 404 })` (that response renders `src/pages/404.astro`
   with status 404 and `no-store`).
2. **Set the browser `Cache-Control` yourself.** Pages that only call `cache.set()` are sent with no
   `Cache-Control` at all, and with `lastModified` they carry `Last-Modified`, which invites heuristic
   browser caching. Do not put `must-revalidate` or `s-maxage` there: per Cloudflare's doc those directives
   disable stale-while-revalidate. Whether that applies when they sit only in the lower-precedence
   `Cache-Control` header is **[UNVERIFIED]**; avoid them.
3. **Query strings fragment the cache.** `/?utm_source=x` is a different key and runs the Worker. Options:
   (a) accept it; (b) a zone Transform Rule that strips the query on HTML paths **[UNVERIFIED]** that it
   runs before the Workers Cache lookup; (c) the gateway entrypoint below.
4. **Purge cannot be tested locally.** Calling `cache.purge()` under `astro preview` broke the workerd RPC
   connection and returned 500. Wrap purge calls in try/catch and test on a deployed preview.
5. **Purge is entrypoint-scoped and Worker-scoped.** A separate scraper Worker cannot purge the site's
   cache. Either the site Worker hosts the cron handler, or the scraper calls the site through a service
   binding (RPC method or an authenticated `POST /internal/revalidate` that runs
   `context.cache.invalidate({ tags: ['rates'] })`).
6. **Host is not in the cache key.** Do not serve `api.bluelytics.com.ar` and the site from one Worker with
   overlapping paths; keep `workers_dev: false` so no second hostname shares or pollutes the cache.
7. **CSP + cached HTML** is fine: SSR pages get CSP as an HTTP header built from build-time hashes (see
   section 7), with no per-request nonce, so a cached response stays valid.

Gateway entrypoint that normalises URLs before the cached entrypoint (builds, type-checks, and serves pages
under `astro preview`; real cache behaviour **[UNVERIFIED]** without a deploy; it doubles billed requests
because the `ctx.exports` call is billed):

```ts
// src/worker.ts
import { handle } from '@astrojs/cloudflare/handler';
import { WorkerEntrypoint, cache } from 'cloudflare:workers';

export class Site extends WorkerEntrypoint<Env> {            // cached
  fetch(request: Request) { return handle(request, this.env, this.ctx); }
  purgeTags(tags: string[]) { return cache.purge({ tags }); } // RPC, runs inside the owning entrypoint
}
export default {                                              // not cached
  async fetch(request, _env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' || request.method === 'HEAD') url.search = '';
    return ctx.exports.Site.fetch(new Request(url, request));
  },
  async scheduled(_c, _env, ctx) { ctx.waitUntil(ctx.exports.Site.purgeTags(['rates'])); },
} satisfies ExportedHandler<Env>;
```

```jsonc
// wrangler.jsonc additions
"cache": { "enabled": true },
"exports": {
  "default": { "type": "worker", "cache": { "enabled": false } },
  "Site":    { "type": "worker", "cache": { "enabled": true } }
}
```

Start without the gateway. Add it only if Worker metrics show cache-busting traffic.

### 3.5 Other Astro features and why they are not the answer here

- **Server Islands (`server:defer`)**: the island's HTML is fetched by the browser after load with a `GET`
  carrying encrypted props [DOC https://docs.astro.build/en/guides/server-islands/]. The price would not be
  in the initial HTML, so do not use them for rates. Usable for non-SEO personalised fragments.
- **Sessions**: default driver on Cloudflare is KV, auto-provisioned. Not needed; set `session: false`
  (sandbox: generated config then has no KV namespace).
- **`memoryCache()`**: in-process LRU, wrong fit for isolates.
- **Advanced routing (`src/fetch.ts`, `astro/fetch`, `astro/hono`)**: lets you wrap or re-order the request
  pipeline; `@astrojs/cloudflare/fetch` exposes `cf()` and `finalize()` for custom Worker entries
  (adapter ≥ 13.6 / 14.3) [DOC]. Not needed for the base design.
- There is no ISR/prerender-on-demand primitive on Cloudflare beyond route caching.

### 3.6 Alternative without Workers Cache: Cache API in middleware

Use when the account stays on Workers Free, because static assets stay free and unbilled. Trade-offs
[DOC https://developers.cloudflare.com/workers/cache/limitations/]: the Worker still runs on every request
(billed request plus a little CPU), the cache is per data centre, no tiering, no request collapsing.

```ts
// src/middleware.ts  (MISS then HIT observed under astro preview; key ignores the query string)
import { defineMiddleware } from 'astro:middleware';

const TTL: Array<[RegExp, number]> = [[/^\/(en)?$/, 60], [/^\/(en\/)?historico\//, 86400]];

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const ttl = TTL.find(([re]) => re.test(url.pathname))?.[1];
  if (request.method !== 'GET' || context.isPrerendered || !ttl) return next();

  const key = new Request(new URL(url.pathname, url.origin), { method: 'GET' });
  const edge = (caches as unknown as { default: Cache }).default;
  const hit = await edge.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set('Cache-Control', 'public, max-age=0');      // do not leak s-maxage to browsers
    return res;
  }
  const response = await next();
  if (response.status === 200) {
    const copy = new Response(response.clone().body, response);
    copy.headers.set('Cache-Control', `public, s-maxage=${ttl}`); // Cache API TTL comes from this header
    context.locals.cfContext.waitUntil(edge.put(key, copy));
  }
  return response;
});
```

Remove `cache.provider` from `astro.config.mjs` in this variant (otherwise the adapter turns Workers Cache
on). Invalidation on price change is not practical (`cache.delete` is per data centre), so keep TTLs short.

### 3.7 Cost model

Let `P` = page views/month, `a` = static-asset requests per page view that miss the browser cache.

| Variant | Billed requests | CPU |
|---|---|---|
| A. Workers Cache via `cacheCloudflare()` | `P × (1 + a)` (× 2 on the HTML part with the gateway) | misses only |
| B. Cache API middleware | SSR page views only; prerendered pages and assets free | every SSR request (small on hits) |

Design to keep `a` near zero in variant A: inline CSS (`build.inlineStylesheets: 'always'`), small scripts
inlined by Astro, system fonts or one immutable woff2, SVG icons inline. On Workers Paid either variant is
far inside the included 10M requests for a site of this kind. On Workers Free, B stretches the 100k/day
further, and the 10 ms CPU cap makes SSR misses risky in both.

---

## 4. i18n: Spanish at `/`, English at `/en/`

[DOC https://docs.astro.build/en/guides/internationalization/,
https://docs.astro.build/en/reference/modules/astro-i18n/]

```js
i18n: { locales: ['es', 'en'], defaultLocale: 'es', routing: { prefixDefaultLocale: false } }
```

- Files: Spanish pages at `src/pages/*.astro`, English at `src/pages/en/*.astro`. Folder names must equal
  the locale (or its `path` when using `{ path, codes }`).
- `Astro.currentLocale` works on prerendered and SSR pages (sandbox: `es` at `/`, `en` under `/en`).
  `Astro.preferredLocale` is SSR-only; do not redirect on it (it would also vary cached HTML).
- **Astro has no built-in translated slugs.** Different slugs are just different filenames
  (`src/pages/calculadora.astro`, `src/pages/en/calculator.astro`); the pairing must live in your own route
  manifest. `getRelativeLocaleUrl('en', 'calculator')` → `/en/calculator`,
  `getAbsoluteLocaleUrl('es', 'calculadora')` → `https://bluelytics.com.ar/calculadora`,
  `getRelativeLocaleUrl('es', '')` → `/` [SANDBOX]. The helpers only add the prefix.
- `i18n.domains` and custom locale `path` mapping have restrictions (`output: 'server'`, no prerendered
  pages); not needed.

Route manifest as the single source for nav, canonical, hreflang and sitemap:

```ts
// src/i18n/routes.ts
export const routes = {
  home:       { es: '/',                  en: '/en' },
  euro:       { es: '/euro-blue',         en: '/en/blue-euro' },
  official:   { es: '/dolar-oficial',     en: '/en/official-dollar' },
  gap:        { es: '/brecha-cambiaria',  en: '/en/exchange-gap' },
  calculator: { es: '/calculadora',       en: '/en/calculator' },
  history:    { es: '/historico',         en: '/en/history' },
  api:        { es: '/api',               en: '/en/api' },
  about:      { es: '/acerca',            en: '/en/about' },
  privacy:    { es: '/privacidad',        en: '/en/privacy' },
} as const;
```

Head tags (pattern verified in the sandbox output):

```astro
<html lang={locale === 'en' ? 'en' : 'es-AR'}>
<link rel="canonical" href={new URL(path, Astro.site)} />
<link rel="alternate" hreflang="es" href={new URL(r.es, Astro.site)} />
<link rel="alternate" hreflang="en" href={new URL(r.en, Astro.site)} />
<link rel="alternate" hreflang="x-default" href={new URL(r.es, Astro.site)} />
```

Google's rules [DOC https://developers.google.com/search/docs/specialty/international/localized-versions,
2026-09-21]: each version lists itself and all others; URLs fully qualified; non-reciprocal pairs are
ignored; `x-default` for unmatched languages. Use `hreflang="es"` (not `es-AR`) so Spanish speakers outside
Argentina also get the Spanish page; `lang="es-AR"` and `og:locale=es_AR` describe the content itself
(judgement call).

**Canonical gotcha [SANDBOX]:** with `build.format: 'file'`, `Astro.url.pathname` is `/acerca.html` while
prerendering, so `new URL(Astro.url.pathname, Astro.site)` emitted a `.html` canonical. Build canonicals
from the route manifest, or strip: `Astro.url.pathname.replace(/\.html$/, '')`.

Trailing slashes [SANDBOX with `trailingSlash: 'never'` + `build.format: 'file'`]: SSR `/x/` → 301 `/x`;
static `/calculadora/` and `/calculadora.html` → 307 `/calculadora` (Cloudflare `html_handling` default
`auto-trailing-slash`). All URLs are slash-less and consistent.

---

## 5. Sitemaps

[DOC https://docs.astro.build/en/guides/integrations-guide/sitemap/ ; @astrojs/sitemap 3.7.6]

- The integration lists prerendered routes and **static** SSR routes (sandbox: `/` and `/en` with
  `prerender = false` were included). It "cannot generate sitemap entries for dynamic routes in SSR mode":
  `/historico/[period]` was absent.
- Output: `dist/client/sitemap-index.xml` + `sitemap-0.xml`. Options: `filter`, `customPages` (extra URLs),
  `customSitemaps` (extra entries in the index; verified), `entryLimit` (45,000), `serialize(item)` (set
  `lastmod`, `links`; return `undefined` to drop), `chunks`, `i18n`, `xslURL`, `filenameBase`, `namespaces`.
- The `i18n` option only pairs URLs whose paths are identical after the locale prefix. For translated slugs
  use `serialize()` and set `item.links = [{ lang, url }, …]` (verified: produced correct `xhtml:link`
  alternates including `x-default`).
- Its `lastmod` is fixed at build time, which is wrong for pages that change intraday.

Google [DOC https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap, 2026-07-08]:
max 50,000 URLs or 50 MB per file; "Google ignores `<priority>` and `<changefreq>`"; `<lastmod>` is used
only "if it's consistently and verifiably accurate".

**Recommended:** skip the integration and hand-write three small endpoints from the route manifest and D1,
so `lastmod` is the real last-change time:

```ts
// src/pages/sitemap-history.xml.ts  (pattern ran in the sandbox)
import type { APIRoute } from 'astro';
export const prerender = false;
export const GET: APIRoute = async ({ site, cache }) => {
  const dates = await allDates();                       // ~4,700 rows, one D1 query
  cache.set({ maxAge: 3600, swr: 86400, tags: ['sitemap'] });
  const urls = dates.map((d) => `<url><loc>${new URL(`/historico/${d}`, site).href}</loc><lastmod>${d}</lastmod></url>`);
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
```

Files: `/sitemap-index.xml` (lists the others), `/sitemap-pages.xml` (manifest routes with hreflang
`xhtml:link` and `lastmod` = last rate change for live pages), `/sitemap-history.xml` (one file is enough:
about 9,400 URLs for two languages). `robots.txt` (prerendered endpoint or `public/robots.txt`) points at
the index.

---

## 6. Client interactivity

### 6.1 Measured sizes

esbuild 0.28.2, `--bundle --minify --format=esm`, gzip -9 / brotli default, measured 2026-11-22 in
`…/scratchpad/chart-sizes` (script `measure.mjs`):

| Bundle | min | gzip | brotli |
|---|---|---|---|
| Vanilla custom-element calculator | 0.33 kB | 0.25 kB | 0.19 kB |
| Preact 11.2.0 calculator (`preact` + `preact/hooks` + component) | 13.3 kB | 5.7 kB | 5.1 kB |
| Hand-rolled SVG chart enhancer (range buttons + hover readout) | 1.1 kB | 0.67 kB | 0.59 kB |
| uPlot 1.6.32 (+ 1.9 kB CSS, 0.76 kB gzip) | 52.2 kB | 23.3 kB | 20.9 kB |
| lightweight-charts 5.3.0 (`createChart` + `LineSeries`) | 165.9 kB | 54.1 kB | 47.0 kB |
| Chart.js 4.6.1 tree-shaken line chart (no date adapter) | 171.2 kB | 60.3 kB | 52.7 kB |
| Chart.js 4.6.1 `chart.js/auto` | 206.2 kB | 71.0 kB | 61.4 kB |

Preact/Svelte/Solid islands additionally load Astro's island hydration runtime (size not measured).
Latest versions on npm: svelte 5.59.1, solid-js 2.0.3, @astrojs/preact 6.1.6.

### 6.2 Chart library comparison

| | Rendering | SSR / no-JS fallback | A11y | Maintenance / licence |
|---|---|---|---|---|
| Hand-rolled SVG | SVG in HTML | Native: the server emits the `<svg>` | You control `role="img"`, `<title>`, `<desc>`, data table | Own code |
| uPlot | Canvas | None; needs separate fallback | None built in | MIT; npm last modified 2025-03-14 (stable, slow-moving) |
| lightweight-charts | Canvas | None | None built in | Apache-2.0 with **attribution duty**: NOTICE text + link to tradingview.com (`attributionLogo` defaults to `true`) [DOC package README]; npm last modified 2026-11-10 |
| Chart.js | Canvas | None | Canvas fallback content only | MIT; npm last modified 2026-10-22; needs a date adapter for time scales |

### 6.3 Recommendation

- **Calculator:** vanilla custom element, authored as a normal `<script>` inside the `.astro` component.
  Astro bundles it and, when small, inlines it as `<script type="module">` (sandbox: inlined, no extra
  request). Rates come from `data-*` attributes rendered by the server, so the page works for crawlers and
  the default amount is already computed in the HTML. A `<form method="get">` fallback is optional.
- **Charts:** server-render an SVG line chart from a downsampled series (cap at roughly 600–800 points per
  series; ~4,700 raw points would put two ~55 kB path strings into the HTML) plus a visually hidden yearly
  summary table. A `<bl-chart>` custom element (~1 kB) then lazy-fetches the full series as JSON on
  visibility and redraws for range buttons and hover. Serve that JSON from one cached endpoint.
- If zoom/pan/cursor-sync are wanted without writing them: uPlot, dynamically imported on the history page
  only, keeping the SSR SVG as the fallback. The other two libraries cost 2–3× more bytes for no benefit here.
- No UI framework is needed for these two widgets.

---

## 7. Fonts, images, view transitions, prefetch, CSP, Core Web Vitals

**Fonts** [DOC https://docs.astro.build/en/guides/fonts/ ; SANDBOX]. Stable since Astro 6:

```js
import { defineConfig, fontProviders } from 'astro/config';
fonts: [{ provider: fontProviders.fontsource(), name: 'Inter', cssVariable: '--font-inter',
          weights: ['100 900'], styles: ['normal'], subsets: ['latin'], fallbacks: ['system-ui', 'sans-serif'] }]
```
```astro
import { Font } from 'astro:assets';
<Font cssVariable="--font-inter" preload />
```

Result in the sandbox: one self-hosted `/_astro/fonts/<hash>.woff2` (72.9 kB, immutable cache), inline
`@font-face` with `font-display: swap`, a metric-adjusted Arial fallback face (`size-adjust`,
`ascent-override`), a `<link rel="preload">`, and `font-src 'self'` added to the CSP. Providers: local,
fontsource, google, bunny, adobe, fontshare, npm. Cheapest option remains a system font stack with
`font-variant-numeric: tabular-nums` (zero requests); if a brand font is used, one variable latin file.

**Images.** `astro:assets` `<Image />` / `<Picture />`. With `imageService: 'compile'`, sharp optimises at
build for prerendered pages and SSR pages pass images through unchanged. The default
`'cloudflare-binding'` provisions a Cloudflare Images binding at deploy [DOC adapter page]. The site needs
almost no raster images; use inline SVG.

**View transitions.** `<ClientRouter />` (the renamed `<ViewTransitions />`) turns the site into a
client-routed app and is **not supported together with Astro CSP** [DOC config reference `security.csp`].
Use native cross-document transitions instead, zero JS:
`@view-transition { navigation: auto; }` in global CSS. Astro's docs themselves point to the native API
[DOC https://docs.astro.build/en/guides/view-transitions/].

**Prefetch** [DOC https://docs.astro.build/en/guides/prefetch/]. `prefetch: true` adds a ~2.5 kB script
(`/_astro/page.*.js`, 2,475 B in the sandbox) and enables `data-astro-prefetch` on links; strategies
`hover` (default), `tap`, `viewport`, `load`; `prefetchAll` for every link. Each prefetch of an SSR page is
a billed Worker request, so opt in per link (main nav only) rather than `prefetchAll`.

**CSP** [DOC config reference; SANDBOX]. `security.csp: true | { algorithm, directives, scriptDirective, styleDirective }`:

- Prerendered pages get `<meta http-equiv="content-security-policy">`; **SSR pages get a
  `content-security-policy` response header**. Hashes are computed at build for Astro-processed scripts and
  styles.
- **`<script is:inline>` is not hashed.** Its hash was absent from `script-src`, so the browser would block
  it. Use processed `<script>` tags, or add the hash to `security.csp.scriptDirective.hashes`.
- JSON-LD `<script type="application/ld+json">` is a data block and is not executed, so it should not need
  a hash **[UNVERIFIED in a browser]**.
- Not active in `astro dev`; test with build + preview. Build prints a Shiki incompatibility warning.
- Other security headers: `public/_headers` for static assets, middleware for SSR responses.

**Core Web Vitals.** Targets: LCP within 2.5 s, INP under 200 ms, CLS under 0.1 [DOC
https://developers.google.com/search/docs/appearance/core-web-vitals, 2025-12-10], assessed at the 75th
percentile of page loads, mobile and desktop separately [DOC https://web.dev/articles/vitals, 2024-10-31].
What gets this site there: HTML from the edge cache, price as text (LCP is a text node, no image), inline
CSS, no framework runtime, reserved dimensions for the chart container, `tabular-nums` so price changes do
not shift layout, no third-party scripts in the head.

---

## 8. SEO for an Argentine exchange-rate site

### 8.1 What Google does and does not use (status checked 2026-11-22)

Source for the dated items: Search Central "Latest documentation updates",
https://developers.google.com/search/updates (entries through 2026-11-18).

| Markup / file | Status | Source |
|---|---|---|
| FAQPage rich result | **Gone.** "This feature will no longer appear in Google Search starting May 7, 2026"; docs removed 2026-06-15 | updates page |
| Dataset | "only used by Dataset Search, and not Google Search" (2025-11) | updates page; https://developers.google.com/search/docs/appearance/structured-data/dataset |
| Sitelinks search box (`WebSite` + `SearchAction`) | Removed 2024-11 | updates page |
| BreadcrumbList | Supported, **desktop results only** (since 2025-01) | https://developers.google.com/search/docs/appearance/structured-data/breadcrumb (2026-09-08) |
| Organization, Software app, Article | Supported and listed in the gallery | https://developers.google.com/search/docs/appearance/structured-data/search-gallery |
| `WebSite` name / `alternateName` | Used for the site name | https://developers.google.com/search/docs/appearance/site-names (2025-12-10) |
| ExchangeRateSpecification / FinancialProduct | Valid schema.org (V30.1, 2026-09-16: `currency`, `currentExchangeRate` as `UnitPriceSpecification`, `exchangeRateSpread`), **no Google feature**; nothing finance-related in the gallery | https://schema.org/ExchangeRateSpecification |
| llms.txt | Google "ignores them"; "will neither harm nor help" | https://developers.google.com/search/docs/fundamentals/ai-optimization-guide (2026-07-10) |
| Structured data for AI features | "Structured data isn't required for generative AI search" | same guide |
| IndexNow | Not Google. Endpoints listed by indexnow.org: Amazon, Bing, Naver, Seznam.cz, Yandex, Yep, plus `api.indexnow.org` | https://www.indexnow.org/faq |

### 8.2 Structured data to ship

All values must match what is visible on the page [DOC
https://developers.google.com/search/docs/appearance/structured-data/sd-policies].

- Home (both languages): one `@graph` with `WebSite` (`name: "Bluelytics"`, `alternateName`, `url`,
  `inLanguage`), `Organization` (`name`, `url`, `logo`, `sameAs` → X and Instagram profiles), and `WebPage`
  with `dateModified` and `mainEntity` → `ExchangeRateSpecification`. The last part is for other consumers;
  expect nothing from Google.
- Inner pages: `BreadcrumbList` (Inicio › Histórico › 2024 › marzo …).
- `/historico`: `Dataset` (`name`, `description` 50–5,000 chars, `temporalCoverage: "2011-01-01/.."`,
  `variableMeasured`, `license`, `creator`, `isAccessibleForFree: true`, `distribution` → `DataDownload`
  with `contentUrl` of the CSV/JSON evolution endpoint and `encodingFormat`). Benefit: Dataset Search only.
- App page: `SoftwareApplication` / `MobileApplication` only with real, visible ratings and price.
- Visible FAQ text is still worth having for long-tail queries ("¿qué es el dólar blue?", "¿cómo se
  calcula la brecha?"); the markup no longer earns anything in Google.

```astro
<script is:inline type="application/ld+json" set:html={JSON.stringify(graph).replace(/</g, '\\u003c')} />
```

### 8.3 On-page structure

One indexable URL per intent, each with the live number in server-rendered text:

| Query family | URL | H1 |
|---|---|---|
| dólar blue hoy, dolar blue, dólar hoy, cotización dólar | `/` | Dólar blue hoy |
| euro blue | `/euro-blue` | Euro blue hoy |
| dólar oficial, cotización dólar oficial | `/dolar-oficial` | Dólar oficial hoy |
| brecha cambiaria | `/brecha-cambiaria` | Brecha cambiaria hoy |
| convertir dólares a pesos | `/calculadora` | Convertir dólares a pesos |
| dólar blue histórico | `/historico` (+ year, month, day pages) | Dólar blue histórico |

Page skeleton for `/`: H1; price block (compra / venta / promedio, variation vs previous close, visible
`<time datetime="…">Actualizado hoy 14:35</time>`); small table with oficial, euro and brecha linking to
their pages; 30-day sparkline linking to `/historico`; calculator teaser; two or three short explanatory
paragraphs; footer links to API, app, about.

Title and description patterns (keep the value, drop the date from the title so a stale index entry does
not show yesterday's date; judgement call, **[UNVERIFIED]** against live SERPs):

```
/                 Dólar blue hoy: $1.505 venta · $1.485 compra | Bluelytics
                  Cotización del dólar blue hoy en Argentina: compra $1.485, venta $1.505. Dólar oficial, euro blue, brecha cambiaria e histórico. Actualizado cada 5 minutos.
/euro-blue        Euro blue hoy: $1.640 venta · $1.610 compra | Bluelytics
/brecha-cambiaria Brecha cambiaria hoy: 2,7% entre dólar blue y oficial | Bluelytics
/calculadora      Convertir dólares a pesos (dólar blue y oficial) | Bluelytics
/historico        Dólar blue histórico: evolución desde 2011 | Bluelytics
/historico/2024-03-15  Dólar blue el 15 de marzo de 2024: $1.010 venta | Bluelytics
```

Format numbers with `Intl.NumberFormat('es-AR')` (dot thousands, comma decimals).

Freshness [DOC https://developers.google.com/search/docs/appearance/publication-dates, 2025-12-10]: show a
prominent labelled date ("Actualizado: …"), give `dateModified` with time zone (`-03:00`) in structured
data, keep visible and structured values consistent, avoid extra unrelated dates near the top. Use the time
of the last price change, not the render time, for `dateModified`, `Last-Modified` and sitemap `lastmod`.

Social tags per page: `og:type=website`, `og:title`, `og:description`, `og:url`, `og:site_name`,
`og:locale` (+ `og:locale:alternate`), `og:image` (absolute URL, 1200×630, with `og:image:width`,
`og:image:height`, `og:image:alt`), `twitter:card=summary_large_image`, `twitter:site`. Point `og:image` at
the same generated dark rate card used for social posts, stored in R2, with a version query
(`?v=<lastChangeTs>`) so platforms refetch after a change. X card image limits were not re-read (the doc
returned HTTP 402) and are **[UNVERIFIED]**.

`<meta name="robots" content="max-image-preview:large">` is what enables large previews in Discover [DOC
https://developers.google.com/search/docs/appearance/google-discover, 2026-03-09].

### 8.4 Programmatic pages without tripping spam policies

Relevant policy text [DOC https://developers.google.com/search/docs/essentials/spam-policies, 2026-08-28]:
scaled content abuse = "many pages are generated for the primary purpose of manipulating search rankings
and not helping users"; doorway abuse includes "creating substantially similar pages that are closer to
search results than a clearly defined, browseable hierarchy".

- **Per-date pages** (`/historico/2024-03-15`): each has unique data. Make that visible: the day's
  compra/venta for every series, change vs previous trading day, position within the month (min/max),
  brecha that day, a 30-day chart centred on the date, prev/next links, breadcrumb to month and year hubs.
  Return 404 for dates with no data (weekends, holidays, future). Month and year hubs carry tables and are
  the browseable hierarchy.
- **Per-amount pages** ("100 dólares a pesos"): a short curated list only (for example 1, 10, 20, 50, 100,
  200, 500, 1.000, 5.000, 10.000 USD and a handful of ARS→USD amounts), each showing the amount at blue,
  oficial and euro rates, a small table of nearby amounts, and the value a month and a year ago. Every other
  amount is handled by the calculator at one canonical URL; `?monto=` variants carry
  `rel=canonical` to `/calculadora`. Do not generate an unbounded `[amount]` route.
- English pages mirror the Spanish set through the manifest; no machine-translated filler.

### 8.5 Internal linking, robots, llms.txt, IndexNow

- Every page links (plain `<a href>`) to all intent pages via header/footer; `/historico` → years → months
  → days; each day page → prev/next/month. Google discovers links only from `<a href>` [DOC
  https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics, 2026-03-04].
- `robots.txt`: `User-agent: *` / `Allow: /` / `Sitemap: https://bluelytics.com.ar/sitemap-index.xml`.
  Do not block `/_astro/`.
- `llms.txt`: optional static file describing the public API for tools that read it; zero effect on Google.
- IndexNow [DOC https://www.indexnow.org/documentation, https://www.indexnow.org/faq]:
  key 8–128 chars (`a-z A-Z 0-9 -`) served as `https://bluelytics.com.ar/<key>.txt` (put it in `public/`).

```sh
curl -sS -X POST 'https://api.indexnow.org/indexnow' \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"host":"bluelytics.com.ar","key":"<KEY>","keyLocation":"https://bluelytics.com.ar/<KEY>.txt",
       "urlList":["https://bluelytics.com.ar/","https://bluelytics.com.ar/en","https://bluelytics.com.ar/historico/2026-11-20"]}'
# 200 received · 202 key validation pending · 400 bad format · 403 key invalid · 422 URL/host mismatch · 429 too many
```

  Up to 10,000 URLs per POST; one endpoint shares with all participants. The FAQ says to avoid submitting
  the same URL many times a day without meaningful change and to wait at least 5 (elsewhere 10) minutes
  between resubmissions; exact rate limits are not published. Policy: ping from the cron only when a value
  actually changed, throttle to one ping per URL per 30 minutes, and submit each new day page once.

### 8.6 Discover, News, AI features

- Discover needs no markup; it favours articles and videos with large images (≥ 1200 px wide, 16:9,
  `max-image-preview:large`) and "might not recommend" utility pages [DOC Discover page]. Treat it as a
  possible bonus for the daily page, not a channel to design for.
- Google News / Top Stories are publisher surfaces; "preferred sources" (global in 2026) applies there and
  in AI Mode/AI Overviews [DOC https://developers.google.com/search/docs/appearance/preferred-sources,
  2026-09-18]. Low priority for a data site.
- Google's AI-features guide says ordinary SEO applies and special AI files or chunking can be ignored
  [DOC ai-optimization-guide].

---

## 9. Migration from the AngularJS hash-route SPA

Current production state, fetched 2026-11-22: S3 behind Cloudflare, `<title>bluelytics</title>`, empty
meta description, no canonical, no hreflang, `/sitemap.xml` 404, minimal `robots.txt`, `/privacy.html` 200.

- Google: "Don't use fragments to change the content of a page, as Google Search generally doesn't support
  URL fragments" [DOC https://developers.google.com/search/docs/crawling-indexing/url-structure,
  2026-10-21]. So `/#/calculator`, `/#/evolution`, `/#/gap`, `/#/api`, `/#/about` are all `/` in the index,
  and every backlink to them already counts for `/`. Fragments are never sent to the server, so no HTTP
  redirect is possible or needed.
- Keep `/` as the home URL. The new section URLs are new pages, discovered through links and the sitemap.
- Forward human visitors with a client script on the home page. It must be an Astro-processed `<script>`
  (so CSP hashes it), not `is:inline`:

```astro
<script>
  const map: Record<string, string> = {
    '#/calculator': '/calculadora', '#/evolution': '/historico', '#/gap': '/brecha-cambiaria',
    '#/api': '/api', '#/about': '/acerca',
  };
  const target = map[location.hash.split('?')[0].replace(/\/$/, '')];
  if (target) location.replace(target);
</script>
```

  Google treats JavaScript redirects as a last resort that it may not see if rendering fails [DOC
  https://developers.google.com/search/docs/crawling-indexing/301-redirects, 2026-11-16]; that is
  irrelevant here because the fragment URLs are not separate documents to Google.
- `/privacy.html` (linked from app-store listings): `public/_redirects` line
  `/privacy.html /privacidad 301`. Verified locally: 301 to `/privacidad`, and the rule runs before
  Cloudflare's own `.html` handling (which would otherwise answer 307).
- Site-move guidance that still applies [DOC
  https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes, 2026-08-20]:
  self-referencing canonicals on new URLs, submit the new sitemap in Search Console, keep redirects at
  least a year, expect a few weeks of fluctuation.
- Launch checklist: keep old asset paths that third parties hotlink (check S3 logs) or redirect them;
  `www` → apex 301 and Always-Use-HTTPS at the zone; `workers_dev: false` and `preview_urls: false` so no
  duplicate hostnames get indexed; verify the domain property in Search Console and Bing Webmaster Tools;
  inspect `/` with the URL Inspection tool after launch.

---

## 10. Recommended architecture

### 10.1 Routes

"Live" cache = `Astro.cache.set({ maxAge: 60, swr: 600, tags: ['rates'] })`, browser
`Cache-Control: public, max-age=0`, tag purged by the cron when a value changes.

| Route (es / en) | Rendering | Cache policy |
|---|---|---|
| `/` · `/en` | SSR | Live |
| `/euro-blue` · `/en/blue-euro` | SSR | Live |
| `/dolar-oficial` · `/en/official-dollar` | SSR | Live |
| `/brecha-cambiaria` · `/en/exchange-gap` | SSR | Live |
| `/calculadora` · `/en/calculator` | SSR (rates in `data-*`) | Live |
| `/dolares-a-pesos/[amount]` · `/en/usd-to-ars/[amount]` (allow-list, else 404) | SSR | Live |
| `/historico` · `/en/history` | SSR (SVG chart + table) | `maxAge 900, swr 86400`, tags `rates`,`history` |
| `/historico/[period]` · `/en/history/[period]` (`YYYY`, `YYYY-MM`, `YYYY-MM-DD` in one route file) | SSR | closed periods `maxAge 86400, swr 2592000`, tag `history`; current day/month/year Live; no data → `cache.set(false)` + 404 |
| `/data/evolution.json` | SSR endpoint | `maxAge 3600, swr 86400`, tag `history` |
| `/api` · `/en/api`, `/acerca` · `/en/about`, `/privacidad` · `/en/privacy` | Prerendered | Static asset (free, `max-age=0, must-revalidate` + etag) |
| `/404` | Prerendered | Static; `assets.not_found_handling: "404-page"` |
| `/privacy.html` | `_redirects` | 301 → `/privacidad` |
| `/robots.txt`, `/llms.txt`, `/<indexnow-key>.txt`, favicons | Static | Static asset |
| `/sitemap-index.xml`, `/sitemap-pages.xml`, `/sitemap-history.xml` | SSR endpoints | `maxAge 3600, swr 86400`, tag `sitemap` |
| `/_astro/*` | Static | `public, max-age=31536000, immutable` (adapter-generated) |
| `/internal/revalidate` (POST, shared secret or service binding only) | SSR endpoint | never cached; calls `cache.invalidate({ tags })` |

### 10.2 Config

```js
// apps/web/astro.config.mjs
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';

export default defineConfig({
  site: 'https://bluelytics.com.ar',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'always' },
  adapter: cloudflare({ imageService: 'compile' }),
  session: false,
  i18n: { locales: ['es', 'en'], defaultLocale: 'es', routing: { prefixDefaultLocale: false } },
  cache: { provider: cacheCloudflare() },          // remove for the Workers Free / Cache API variant
  security: { csp: { directives: ["default-src 'self'", "img-src 'self' data:", "connect-src 'self' https://api.bluelytics.com.ar"] } },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
});
```

Deploy: `wrangler types && astro check && astro build && wrangler deploy` (prefix `CLOUDFLARE_ENV=<env>` on
the build for environments). Pulumi should own D1, R2, KV, DNS and the custom domain and feed IDs into
`wrangler.jsonc`; the Worker upload itself is simplest left to `wrangler deploy`, because the adapter
generates the multi-module bundle, asset manifest and final config (judgement; a Pulumi-native upload of
`dist/server` + `dist/client` was not tested).

### 10.3 Dependency versions

```jsonc
// apps/web/package.json
{
  "engines": { "node": ">=22.23.4" },             // use 24.22.3 locally and in CI
  "dependencies": {
    "astro": "7.4.13",
    "@astrojs/cloudflare": "14.4.9",
    "wrangler": "4.166.0"
  },
  "devDependencies": {
    "@astrojs/check": "0.9.12",
    "typescript": "6.0.3",                        // NOT 7.0.2: astro check refuses it
    "@types/node": "26.6.6"
  }
}
```

Optional: `@astrojs/sitemap` 3.7.6 (only if not hand-writing sitemaps), `uplot` 1.6.32 (only if the
hand-rolled chart is not enough). Not needed: any UI framework integration, `@astrojs/db` (removed),
`astro-seo`. `vitest` 5.1.1 with Astro's `getViteConfig()` and the workerd pool was not tested
**[UNVERIFIED]**.

---

## 11. Not verified

- Real Workers Cache behaviour on a deployed Worker: HIT/MISS headers, purge propagation time, whether
  `Cloudflare-CDN-Cache-Control` and `Cache-Tag` are stripped as documented, SWR timing. Local preview only
  shows the headers Astro emits.
- Whether enabling cache only on a named entrypoint still makes static-asset requests billable.
- Whether `must-revalidate` / `s-maxage` in the plain `Cache-Control` header disables SWR when
  `Cloudflare-CDN-Cache-Control` is also present.
- Whether a zone Transform Rule that strips query strings runs before the Workers Cache key is computed.
- `remote: true` bindings during `astro build` prerendering, and CI credentials for it.
- Actual CPU time of an Astro SSR render of these pages in production (matters for the 10 ms Free limit).
- X/Twitter card image limits (doc returned HTTP 402); browser handling of JSON-LD under the generated CSP.
- SERP composition for the target Spanish queries and the effect of prices in titles (no primary source).
- Astro island runtime size for Preact/Svelte/Solid; vitest 5 integration.
- The Astro docs were read from the `withastro/docs` `main` branch on 2026-11-22; individual pages carry no
  dates.
