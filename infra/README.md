# @bluelytics/infra

Pulumi program (TypeScript, `@pulumi/cloudflare` pinned to **6.24.0**, `@pulumi/pulumi` 3.277.0) for the
long-lived Cloudflare resources of bluelytics ("architecture C", `docs/ARCHITECTURE.md` D6 and §11,
`docs/research/pulumi-cloudflare.md` §11). Worker code, bindings, routes/custom domains, crons, secrets and
D1 migrations belong to wrangler (`apps/*/wrangler.jsonc`), never to this program.

| File | What |
|---|---|
| `Pulumi.yaml` | Project `bluelytics` (so stack config keys are `bluelytics:*`); runs `src/index.ts` with Node's own type stripping (`typescript: false`, no ts-node) |
| `Pulumi.example.yaml` | Example stack config, no secrets |
| `src/index.ts` | The resource graph and the stack outputs |
| `src/config.ts` | Reads and validates the stack config (`readInfraConfig`) |
| `src/zone-rules.ts` | Pure builders for every zone rule (`buildZoneRules`) |
| `src/preserved-rules.ts` | Rules copied from the zone before adoption (empty until then) |

## Resources

| Pulumi name | Resource | Notes |
|---|---|---|
| `db` | `D1Database` `bluelytics` | `protect`. No `primaryLocationHint` on purpose: the D1 GET response has none, so setting it makes an import or a later refresh plan a **replacement** (data loss). Cloudflare places the database near where the first `pulumi up` runs. |
| `media-bucket` | `R2Bucket` `bluelytics-public` | `protect`. No `location` for the same reason (replace-on-change). |
| `media-domain` | `R2CustomDomain` on `mediaHostname` | TLS ≥ 1.2. Cloudflare creates and owns the DNS record: never add a `DnsRecord` for it. |
| `media-lifecycle` | `R2BucketLifecycle` | `social/` objects deleted after 90 days; multipart uploads aborted after 7 days (restates the bucket default, which a rule list replaces). Delete is a no-op upstream. |
| `media-cors` | `R2BucketCors` | `GET`/`HEAD` from any origin, any header, preflight cached 1 day. |
| `redirect-rules` | `Ruleset` `http_request_dynamic_redirect` | only with `manageRulesets=true`: `www.<zone>` → `https://<webHostname>` 301, path and query kept (needs the proxied `www` record that exists today). |
| `cache-rules` | `Ruleset` `http_request_cache_settings` | only with `manageRulesets=true`: media host cached (2 h edge / 1 h browser; `/social/*` 30 d / 1 d; 4xx–5xx 60 s); plus the static-first API rules. |
| `transform-rules`, `response-header-rules`, `cloud-connector-rules` | `Ruleset` ×2, `CloudConnectorRules` | only with `apiMode=static-first` (see below). |

No DNS records, no KV, no Worker resources. A phase with no rules gets no `Ruleset` at all.

Outputs (`pulumi stack output --json`): `d1DatabaseId` (the D1 UUID), `d1DatabaseName`, `r2BucketName`,
`mediaHostname`. `pnpm infra:sync-ids` copies `d1DatabaseId` into the `d1_databases` entry with
`"database_name": "bluelytics"` of `apps/{api,jobs,web}/wrangler.jsonc` (top level and every `env.*`),
keeping comments; it fails without writing anything if a file or that entry is missing. Options:
`-- --stack <name>` (otherwise the selected stack), `-- --from-json <file>` (a saved `pulumi stack output --json`).
The bucket name is fixed (`bluelytics-public`) and is not rewritten.

## Stack config

| Key | Default | Meaning |
|---|---|---|
| `bluelytics:accountId` | required | Cloudflare account ID (32 hex) |
| `bluelytics:zoneId` | required | Zone ID of `zoneName` (32 hex) |
| `bluelytics:zoneName` | required | `bluelytics.com.ar` |
| `bluelytics:webHostname` | `zoneName` | Site hostname; target of the www redirect |
| `bluelytics:apiHostname` | `api.<zoneName>` | API hostname (static-first rules match it) |
| `bluelytics:mediaHostname` | `media.<zoneName>` | R2 custom domain; must be its own subdomain of the zone |
| `bluelytics:apiMode` | `worker` | `worker` or `static-first` |
| `bluelytics:manageRulesets` | `false` | `true` only after the existing zone rules are adopted (below) |
| `bluelytics:adopt` | — | One-time import IDs, see "Adopting existing objects" |
| `cloudflare:apiToken` | — | Secret (`pulumi config set --secret cloudflare:apiToken`), or `CLOUDFLARE_API_TOKEN` in the environment |

`static-first` is refused unless `manageRulesets=true`. Invalid values fail the program before any resource is
registered.

```sh
cd infra
pulumi stack init prod
pulumi config set bluelytics:accountId <account id>      # … each key, as in docs/MIGRATION.md 1.2
pulumi config set --secret cloudflare:apiToken            # prompts
cd .. && pnpm infra:preview                              # = pulumi preview --diff
pnpm infra:up && pnpm infra:sync-ids                     # = pulumi up; then rewrite database_id
```

Arguments after `--` reach Pulumi: `pnpm infra:preview -- --stack prod`.

## API token (`cloudflare:apiToken`)

A user API token used only by Pulumi (the wrangler deploy token is separate). Dashboard names; assembled from the
providers' "Accepted Permissions" lists and never exercised against the API (`pulumi-cloudflare.md` §10, §14):
if an operation fails with a permission error, add the missing permission.

| Scope | Permission | For |
|---|---|---|
| Account | D1: Edit | `db` |
| Account | Workers R2 Storage: Edit | bucket, custom domain, lifecycle, CORS |
| Zone `bluelytics.com.ar` | Zone: Read | zone lookups |
| Zone | DNS: Edit | the DNS record the R2 custom domain creates (whether it is required is unverified) |
| Zone | Cache Rules: Edit | `cache-rules` |
| Zone | Single Redirect: Edit | `redirect-rules` |
| Zone | Transform Rules: Edit | `transform-rules`, `response-header-rules` |
| Zone | Cloud Connector: Edit | `cloud-connector-rules` (static-first only) |

## Offline validation

`tsc` (`pnpm typecheck`), the unit tests (`pnpm test`) and a preview on a local `file://` backend with a dummy
token. Never point automation at the owner's Pulumi Cloud state.

```sh
export PULUMI_BACKEND_URL=file://$PWD/.pulumi-local PULUMI_CONFIG_PASSPHRASE=test   # .pulumi-local/ is git-ignored
export CLOUDFLARE_API_TOKEN=0000000000000000000000000000000000000000                # 40 chars: format check only
mkdir -p .pulumi-local && cp Pulumi.example.yaml .pulumi-local/Pulumi.offline.yaml
pulumi stack init offline --non-interactive
cat Pulumi.offline.yaml >> .pulumi-local/Pulumi.offline.yaml && rm Pulumi.offline.yaml   # keep the salt out of infra/
pulumi preview --stack offline --diff --config-file .pulumi-local/Pulumi.offline.yaml
```

Result on 2026-11-22 (Pulumi CLI 3.276.0, Node 24.22.3), run with the network namespace cut off
(`unshare -rn`, loopback up): with `manageRulesets=false` the preview exits 0 and plans exactly
`+ 6 to create` (stack, D1, bucket, custom domain, lifecycle, CORS), outputs `d1DatabaseName`, `r2BucketName`,
`mediaHostname` known and `d1DatabaseId` unknown. The provider makes no API call for these types.
With `apiMode=static-first` + `manageRulesets=true`:

- Rulesets excluded (`--exclude 'urn:pulumi:offline::bluelytics::cloudflare:index/ruleset:Ruleset::*'`): exit 0,
  `+ 7 to create` (the six above plus `CloudConnectorRules`, which previews offline).
- Rulesets included: exit 1, `Bridged provider panic … nil pointer dereference` in the provider's plan-time
  `?dry_run=true` call, as documented in `pulumi-cloudflare.md` §8.4. Previewing Rulesets needs egress to
  `api.cloudflare.com`, and only a real token makes that dry run validate the rule expressions; a dummy token
  turns it into 401 warnings.

Sandbox quirk: inside `unshare -rn` the CLI did not see its plugin cache (`pulumi plugin ls` was empty) and
tried to download the provider; putting the cached binary on `PATH`
(`PATH=~/.pulumi/plugins/resource-cloudflare-v6.24.0:$PATH`) makes Pulumi use it as an ambient plugin.

## Adopting existing objects (`bluelytics:adopt`)

`adopt` maps a Pulumi name (`db`, `media-bucket`, `redirect-rules`, `cache-rules`, `transform-rules`,
`response-header-rules`, `cloud-connector-rules`) to the import ID of an object that already exists. The program
then passes it as the `import` resource option: the next `pulumi up` adopts the object **and applies the program
on top of it in the same run**. Remove each key after the first successful `up`
(`pulumi config rm --path 'bluelytics:adopt.<name>'`).

| Name | Import ID |
|---|---|
| `db` | `<account_id>/<database_id>` |
| `media-bucket` | `<account_id>/bluelytics-public/default` |
| `*-rules` (Ruleset) | `zones/<zone_id>/<ruleset_id>` |
| `cloud-connector-rules` | `<zone_id>` |

D1/R2 only need this if something else created them first (for example a `wrangler deploy` that ran before
`pnpm infra:up` and auto-provisioned the bucket, `pulumi-cloudflare.md` §11.4).

### Existing zone rules (before `manageRulesets=true`)

A `Ruleset` owns the **whole** rule list of its phase, and an import does not preserve rules that are not in the
program: they are deleted by the same `up` (`pulumi-cloudflare.md` §8.1). Cloud Connector rules behave the same
(the API replaces the list). Per phase this program manages (`http_request_dynamic_redirect`,
`http_request_cache_settings`, and for static-first `http_request_transform`, `http_response_headers_transform`
and Cloud Connector):

1. Find the entry point: `GET /zones/<zone_id>/rulesets/phases/<phase>/entrypoint` (Cloud Connector:
   `GET /zones/<zone_id>/cloud_connector/rules`). A 404 or an empty list means nothing to adopt for that phase:
   Pulumi creates it.
2. Copy every rule you want to keep into `src/preserved-rules.ts`, in zone order, with camelCase field names
   (`actionParameters`, `edgeTtl`, …) and `ref` set to the rule's existing `ref` (dashboard rules have
   `ref` = `id`), so the rule keeps its identity. Preserved rules run before the program's own rules; cache rules
   are not terminating (later matches win), redirects are (first match wins). Rules the program already defines
   (the www redirect) are not copied: the import then shows one rule replaced by the program's equivalent; that
   is the only `rules` change to accept.
3. The entry point must be named `default` and be `kind: zone` (dashboard-created ones are). Any other
   `name` would plan a replacement, which deletes the whole phase: stop and rename nothing; delete the rules in
   the dashboard after copying them instead, and let Pulumi create the phase.
4. `pulumi config set --path 'bluelytics:adopt.cache-rules' 'zones/<zone_id>/<ruleset_id>'` (one per non-empty
   phase), then `pulumi config set bluelytics:manageRulesets true`.
5. `pnpm infra:preview` with the real token and network. Expect `= import` for each adopted ruleset and **no**
   `~ rules` diff beyond step 2's accepted one. Anything else: fix `preserved-rules.ts` first.
6. `pnpm infra:up`, remove the `adopt` keys, `pnpm infra:preview` shows no changes.

## `apiMode=static-first` (`docs/MIGRATION.md` Phase 7)

Requires `manageRulesets=true`, the jobs Worker writing each fixed body to R2 as `api/<path>`, and its purge
token. The program adds, all matching only `apiHostname` requests **without a query string** for the six fixed
paths (`/v2/latest`, `/v2/alerts`, `/json/last_price`, `/v2/evolution.json`, `/v2/evolution.csv`,
`/data/json/currency.json`):

- `transform-rules` `api_static_r2_key`: path → `/api<path>` (the R2 key).
- `cloud-connector-rules`: send them to the bucket through `mediaHostname`.
- `cache-rules` `api_static_browser_30s` / `_300s`: cache them, 2 h edge TTL (the Free-plan floor; freshness comes
  from purge-on-write), browser TTL 30 s or 300 s like the Worker's own `Cache-Control`, 4xx–5xx 60 s.
- `response-header-rules` `api_static_cors`: `Access-Control-Allow-Origin: *`, `Vary: Origin` (R2 CORS only answers
  requests that carry `Origin`).

The cache, CORS and Cloud Connector expressions accept the path both before and after the rewrite, because the
docs do not say which form later phases see. Requests with a query string (`?days`, `?callback`, `?pretty`, cache
busters) and `/v2/historical` must still reach the API Worker, so the `api.<zone>/*` route stays unless live test
7.2 shows that a Worker route takes precedence over Cloud Connector; in that case the route has to exclude the six
paths and their query-string variants would be served from R2 without `?days`/`?callback`/`?pretty` handling.
Revert: `pulumi config set bluelytics:apiMode worker` and `pnpm infra:up` (removes the transform, response-header
and Cloud Connector phases entirely, and the two API cache rules).

## Undo and safety

- `pulumi destroy` refuses to delete D1 and R2 (`protect`); that is intended. Lifecycle deletion is a no-op upstream.
- Turning `manageRulesets` back to `false` **deletes** every managed entry-point ruleset (and the rules in it).
- Never rename `db`/`media-bucket` or their `name`s: both are replace-on-change.
