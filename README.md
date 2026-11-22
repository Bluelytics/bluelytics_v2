# bluelytics v2

Monorepo for [bluelytics.com.ar](https://bluelytics.com.ar): Argentine dólar blue and official rates.
It contains the public API (`api.bluelytics.com.ar`, byte-compatible with the legacy one), the website,
the scraper/jobs pipeline (consensus, push alerts, social posts) and the infrastructure, all on
Cloudflare (Workers, D1, R2, Cron Triggers). The design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Licence: AGPL-3.0 ([`LICENSE`](LICENSE)).

## Layout

| Path | Package | What |
|---|---|---|
| `apps/api` | `@bluelytics/api` | Worker: public API (serves pre-rendered bodies) |
| `apps/jobs` | `@bluelytics/jobs` | Worker: cron pipeline + admin endpoints |
| `apps/web` | `@bluelytics/web` | Astro site on Workers |
| `packages/core` | `@bluelytics/core` | Pure domain logic: money, time, consensus, API rendering, alert and social rules ([API](packages/core/README.md)) |
| `packages/db` | `@bluelytics/db` | D1 migrations and typed repository functions ([API](packages/db/README.md)) |
| `packages/contract` | `@bluelytics/contract` | Golden captures of the legacy API and seed helpers ([docs](packages/contract/README.md)) |
| `packages/scrapers` | `@bluelytics/scrapers` | Source adapters |
| `packages/social` | `@bluelytics/social` | Card templates, renderers, Buffer client |
| `infra` | `@bluelytics/infra` | Pulumi program |
| `tools` | `@bluelytics/tools` | Backfill, id sync, local previews |
| `apps/mobile` | — | Frozen React Native app, **not** a workspace member |
| `legacy/` | — | Imported legacy repos, reference only, not a workspace member |
| `docs/` | — | Architecture, legacy analysis, platform research |

Workspace packages are consumed as TypeScript source (`"exports": "./src/index.ts"`); there is no
package build step.

## Prerequisites

- Node 24 (`.nvmrc`), pnpm 12.22 (`packageManager` in `package.json`).
- One TypeScript (6.0.3) and one vitest (5.1.1) for every package, pinned in the `catalog:` of
  `pnpm-workspace.yaml`.

## Commands

```
pnpm install | pnpm typecheck | pnpm test | pnpm build
pnpm dev:api | dev:jobs | dev:web
pnpm db:migrate:local | db:migrate:remote
pnpm backfill -- --from https://api.bluelytics.com.ar [--since YYYY-MM-DD] [--remote] [--dry-run]
pnpm parity -- --old https://api.bluelytics.com.ar --new <url> [--strict]
pnpm cards:preview            # renders every card kind/size to out/cards/*.jpg with local Chrome
pnpm buffer:channels          # lists Buffer organizations/channels for BUFFER_API_KEY (read-only)
pnpm infra:preview | infra:up | infra:sync-ids
pnpm deploy:api | deploy:jobs | deploy:web | deploy:all
```

`pnpm test` runs every package's vitest project from the root (`vitest.config.ts`); `pnpm typecheck`
runs `tsc` in every package. Each root script delegates to the package that owns it (see
`package.json`); scripts whose package is not implemented yet fail until it is.

Secrets are never committed: Worker secrets go through `wrangler secret put`, local ones in
`.dev.vars` (ignored by git).
