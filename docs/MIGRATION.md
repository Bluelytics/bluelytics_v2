# Migrating bluelytics.com.ar to v2 and taking the legacy system down

Operator runbook. Follow it in order, against production, with a terminal open next to it.

- Design: `docs/ARCHITECTURE.md` (wins over this file if they disagree; tell the maintainer).
- Behaviour changes users will see: `docs/DECISIONS.md`.
- Platform facts and their evidence: `docs/research/cloudflare.md`, `docs/research/pulumi-cloudflare.md`,
  `docs/research/buffer-api.md`, `docs/research/astro-seo.md`, `docs/research/sources.md`.
- What the legacy system does: `docs/legacy/*.md`.

Markers used below:

- **[FIND OUT]** the legacy setup is not documented anywhere; discover it before acting.
- **[TEST FIRST]** the research could not verify this; run the test described before relying on it.
- **Undo** how to reverse the step. **Clean until** the moment after which the undo is no longer free.

Written 2026-11-22. The operator commands used here are exactly those of `ARCHITECTURE.md` §11. Step 0.5
checks that each one exists and behaves as this guide needs; if one is missing or behaves differently, stop
and get the implementation fixed before continuing. Do not improvise a replacement command.

Two rules for the whole migration:

- **Commit and push every change to `apps/*/wrangler.jsonc` right after you deploy it.** Wrangler owns a
  Worker's routes and vars (`cloudflare.md` §12): a later `pnpm deploy:*` from another checkout, or from CI,
  deploys whatever that checkout contains and silently removes production routes or turns flags back off. If a
  CI deploy workflow exists, disable it until Phase 5 is finished.
- **The legacy scraper trigger enabled and either v2 flag (`PUSH_ENABLED`, `SOCIAL_ENABLED`) `"true"` must
  never be true at the same time.** Both systems would push the same alert and post the same move.

---

## Overview (one page)

### Phases

Durations are estimates, not measurements.

| Phase | What happens | Elapsed (estimate) | What users notice |
|---|---|---|---|
| 0. Prerequisites and inventory | Accounts, CLIs, tokens, implementation checks, export the Cloudflare zone config, discover the AWS setup, **full Postgres backup** | 1 day | Nothing |
| 1. Provision v2 | `pnpm infra:up`, IDs, D1 migrations, API and web Workers on shadow hostnames | 1 day | Nothing (shadow web host is `noindex`) |
| 2. Load data | Backfill from the legacy API, deploy the jobs Worker in shadow mode, parity check, cards, Buffer draft test | 0.5–1 day | Nothing |
| 3. Shadow period | v2 scrapes and computes next to legacy; no pushes, no posts; daily comparison; switch rehearsals; announcement | at least 5 trading days (one full Mon–Fri week) | The announcement of the planned date |
| 4. Cutover | Saturday: freeze legacy, final sync, switch API, switch website. Sunday: real secrets, enable push and social. Monday: watch the open and prove legacy is silent | Sat 3–4 h, Sun 1 h, Mon morning | New website. API keeps its URLs and format; values follow the new source set (see DECISIONS.md). Same push format |
| 5. After cutover | 48-hour watch, Search Console, first real posts, mobile check, monitoring, remove shadow hosts | 2 days + follow-ups in week 2 | New social card design; posts on Mondays too |
| 6. Take legacy down | After the stability period: replace the `www` redirect, DNS off the old origins, stop compute, final exports, delete AWS resources, rotate secrets, archive repos, clean local dirs | 1 working day, at least 14 days after cutover; then one billing cycle to confirm $0 | Nothing |
| 7. Optional: static-first API | Live tests, then R2 + CDN for the hot API paths | later, only if traffic justifies it | Nothing intended |

Total (estimate): about 10–12 days from Phase 0 to the end of the 48-hour watch; legacy is gone 3–5 weeks after the start.

### Cost, before and after

- **Before:** unknown. Nothing in the repositories records it. Phase 0 step 0.9 reads it from AWS Billing.
- **After (Cloudflare, from `docs/research/cloudflare.md` §1, §4, §6, §13):** Workers Paid is a flat
  USD 5/month per account and includes 10M Worker requests and 30M CPU-ms per month; D1, R2 (10 GB, 1M
  writes, 10M reads per month, no egress fees) and Browser Run (10 browser-hours/month on Paid) stay inside
  their included allowances at this project's volumes. In the default `worker` API mode, traffic above 10M
  requests/month costs USD 0.30 per extra million; Phase 7 (`static-first`) removes that per-request cost.
  The zone plan, Buffer plan and domain registration do not change. Workers Logs pricing changes on
  2026-12-01 (free tier becomes 0.5 GB/day ingestion); not expected to matter at this volume.
- Pulumi Cloud plan limits were not checked (`pulumi-cloudflare.md` §11.6); a self-managed backend costs nothing.

### Decisions to take before starting

Write the answer next to each; several of them change commands below.

- [ ] **Workers Paid (required for the jobs Worker).** Not a real choice: on Free the jobs Worker does not
      fit. Free allows 50 D1 queries per invocation (Paid: 1,000) and a counted Friday 18:05 run (daily step,
      tick, update and weekly posts on two networks) makes exactly 50, so one more network, a story or an
      alert goes over; Free also allows 10 ms CPU per cron run (ticks where the value moves and the daily step
      exceed it) and one Browser Run Quick Action per 10 s. Switch to **Paid** before step 2.4. For request
      volume, Free allows 100,000 Worker requests per day **account-wide**; in `worker` mode every API request
      is one, and every website request is **at least two** billed invocations (the gateway calls the Astro
      entrypoint through `ctx.exports`, and favicon, images and `robots.txt` pass the gateway too; only
      `/_astro/*` skips it). Multiply the page requests of step 0.8 by 2 or more when sizing against Free's
      100k/day or Paid's 10M/month.
- [x] **`/json/last_price` bug — decided 2026-11-23: fix it** (`LEGACY_V1_BLUE_BUG=false`). Legacy returns the *oficial* numbers in the `blue` entry. v2 fixes it by
      default; `LEGACY_V1_BLUE_BUG=true` keeps the bug. Three third-party bindings use this endpoint; the
      choice is announced before the switch (step 3.4).
- [ ] **Shadow hostnames.** This guide uses `api-v2.bluelytics.com.ar` (API) and `v2.bluelytics.com.ar` (web).
      They must not exist in DNS today (step 0.6 checks). The shadow API is publicly reachable with real data
      for at least a week and third parties may find it; decide now whether it is kept after cutover (5.7).
- [ ] **Admin hostname for the jobs Worker** (`/admin/*`, bearer-token protected). Written `$JOBS_HOST` below.
      Either a custom domain on a new name, in `apps/jobs/wrangler.jsonc`:
      `"workers_dev": false, "routes": [{ "pattern": "jobs.bluelytics.com.ar", "custom_domain": true }]`;
      or the `workers.dev` URL: `"workers_dev": true` and no routes, giving
      `bluelytics-jobs.<account subdomain>.workers.dev` (the account subdomain is shown in the dashboard under
      Workers & Pages, or by `cf "/accounts/$CF_ACCOUNT_ID/workers/subdomain" | jq -r .result.subdomain`).
- [ ] **Is the v2 GitHub repository public?** If yes, step 1.8 (restrict the Firebase client API key) must be
      done before the first push to the public remote, and a public repo publishes the mobile app's source
      for the first time (`docs/legacy/git-audit.md` §10 item 9).
- [ ] **Analytics.** Cloudflare Web Analytics only (`ARCHITECTURE.md` §10), or also GA4 (`PUBLIC_GA4_ID`;
      legacy used `G-64QZCDRTRP`). Step 1.5 sets it up; 2.8, 4.9 and 5.1 verify it.
- [ ] **App-store badges.** Both listings returned 404 on 2026-11-22. Leave `PUBLIC_ANDROID_URL` /
      `PUBLIC_IOS_URL` unset unless you confirm the listings in Play Console / App Store Connect.
- [ ] **Pulumi backend.** Pulumi Cloud (`PULUMI_ACCESS_TOKEN`, as `ARCHITECTURE.md` §11 assumes) or a
      self-managed `file://` backend. Commands for both are in step 0.3.
- [ ] **Opening-push baseline** (decided in step 3.3 from the measured v2 − legacy gap).
- [ ] **Stability period before Phase 6.** Default: 14 days and 10 trading days with no open v2 incident.
- [ ] **Ops alerts.** Whether to set `OPS_WEBHOOK_URL` (Slack/Discord/Telegram webhook) for source-health
      messages. Without it, nothing tells you when sources fail (step 5.8).

What `/v2/latest` shows at the switch is not a choice: legacy is frozen at cutover, so production serves v2's
own consensus from the switch on. The blue value may step at that moment (on 2026-11-20 it would have been
1635/1670 → 1655/1675; the legacy scraper patch in progress may already have changed that gap). The shadow
period measures the real difference, and step 3.4 announces it.

### Already done or found out (2026-11-22)

Owner decisions and read-only findings from the first session. Re-check them only if something seems off.

- **Decisions:** Workers **Paid** (assumed active on the account; it is shared with the owner's other project).
  Social stays on Buffer: the new API key works and lists two connected channels, whose ids equal the legacy
  profile ids: `BUFFER_CHANNELS={"twitter":"532affdc1d36e0037832ea01","instagram":"5eaee89c594d230afc4f3418"}`.
- **Credentials on the operator machine:** wrangler OAuth login (account `bb89fd1555c4374955e50cf1112d2845`);
  `CLOUDFLARE_INFRA_TOKEN` (the Pulumi + ops token of 0.4, verified active with every read permission) and
  `BUFFER_API_KEY` in `~/dev/bluelytics/.env`, outside every repository. `aws login` works (it resolves to the
  account root user; an IAM user or SSO role is advisable).
- **Cloudflare zone** (`0a984ad377dc9f0db7092fd75702ccdc`, Free zone plan; inventory saved in `.work/inventory/`):
  apex and `www` are proxied CNAMEs to the S3 website endpoint `bluelytics.com.ar.s3-website-sa-east-1.amazonaws.com`
  (the bucket is in **sa-east-1**, not us-west-2); `api` is a proxied CNAME to the load balancer
  `bluelytics-api-lb-976772362.us-west-2.elb.amazonaws.com`; Zoho MX records and a Google site-verification TXT
  must be kept; three `_…acm-validations.aws` CNAMEs can go at teardown. No page rules, no Worker routes. One
  cache rule, "Latest value", caches **every hostname** except the path `/v2/latest` for 7200 s at edge and
  browser — scope it to the legacy API before shadow hostnames serve traffic (0.6/1.x). SSL mode is
  **Flexible** (move to Full (strict) once AWS origins are gone), Always Use HTTPS on, minimum TLS 1.0.
- **AWS (us-west-2):** scraper = ECS Fargate cluster `bluelytics-scraper`, task definitions
  `bluelytics-scraper:3` (EventBridge rule `scraper-every-5-min`, `cron(0/15 * ? * MON-FRI *)`) and
  `bluelytics-scraper-currencies:1` (rule `bluelytics-scraper-currency-every-6-h`), both on the `:latest`
  image, credentials injected as ECS secrets. API = ECS service `bluelytics-api-service` in cluster
  `bluelytics-api-cluster` behind the load balancer above. Database = RDS Postgres 16 `bluelytics`
  (db.t4g.micro, private, automated snapshots kept 3 days). Logs in CloudWatch `/ecs/bluelytics-scraper` and
  `/ecs/bluelytics-scraper-currencies`. The legacy scraper fix was deployed on 2026-11-22 (image
  `sha256:caedf503…`); the previous image is tagged `rollback-2024-09-03` in ECR.
- **Mobile app retired for now** (owner, 2026-11-22; to be revived later). Push alerts stay off:
  `PUSH_ENABLED` remains `"false"` after cutover, `FIREBASE_SERVICE_ACCOUNT_JSON` keeps its placeholder, and
  the Firebase steps (1.8, the real key in 4.10, the mobile check in Phase 5) are skipped. The FCM topic
  `dolar` simply stops receiving messages when legacy is switched off.
- **Progress, 2026-11-22/23:** Phase 1 done (Pulumi Cloud stack `magiquear/prod`; D1 `ea1ea06c-…`; shadow
  hosts live). Phase 2: backfill done (9,365 rows, alerts to 1885, `PRE_SHADOW_LAST=1885`, remote
  `sqlite_sequence` writable); strict parity 25/27, the two `/json/last_price` differences being the
  `LEGACY_V1_BLUE_BUG` decision; 2.3 rehearsal passed; jobs Worker live at
  `bluelytics-jobs.pabloseibelt.workers.dev` (admin host) with both flags off; Buffer draft test passed for
  both channels and the real Buffer key was swapped for a placeholder; shadow website checks passed.
  `ADMIN_TOKEN` lives in `~/dev/bluelytics/.env`. A manual RDS snapshot
  `bluelytics-pre-v2-migration-2026-11-22` exists; the VPN endpoint in the old `.ovpn` no longer exists, so
  the full `pg_dump` of 0.10 needs another route (a one-off task inside AWS) before Phase 6.
- **Website:** `/evolucion` was merged into `/historico` (301 redirect); drop it from any page lists.
- **CUTOVER DONE 2026-11-23 01:28–02:10 UTC (Sunday night ART), shadow period skipped by owner decision.**
  A forced observe run first proved every source reachable from Cloudflare (all blue primaries ok; infobae
  failing, secondary). Legacy frozen at `FREEZE_UTC=2026-11-23T01:28:40Z` (both EventBridge rules DISABLED;
  post-freeze RDS snapshot `bluelytics-post-freeze-2026-11-23`). 4.5 sync: no change needed; parity showed only
  the planned differences (euro fields, currency.json, last_price fix). Social baseline rows inserted (4.6).
  API route `api.bluelytics.com.ar/*` (id `ad52a0b0…`) and web route `bluelytics.com.ar/*` live; five
  exemption routes for the old bundles in `.work/exemption-routes.jsonl` (remove on Monday, 4.10/5.6).
  `SOCIAL_ENABLED=true` after a passing draft gate; `PUSH_ENABLED=false` (app retired). Rollback scripts:
  `.work/ROLLBACK_API.sh`, `.work/ROLLBACK_WEB.sh`. Next: 4.11 (Monday open), then Phase 5.
- **Phase 5–6 progress, 2026-11-23 (night):** exemption routes and shadow hostnames removed (5.6, 5.7).
  LinkedIn added as a third Buffer channel (`6b03a7e9…`); Facebook is not used. Backups in
  `~/dev/bluelytics/backups/` (SHA256SUMS): final legacy `pg_dump` taken by a one-off Fargate task in the scraper
  network (`bluelytics-20261123T0300Z.dump`, also in `s3://db-bluelytics/pg-dump-final/`), restore-tested
  (dolar_values 704,368; alertas_dolar 1,884; actualizaciones_sociales 6,152; weekly 1,229; currency_values
  381,871); D1 export; the site bucket and `db-bluelytics` archived; www bucket redirect config saved. 6.3: www →
  apex is a Cloudflare redirect rule. 6.4: apex and api are proxied `AAAA 100::`, www a proxied CNAME to the apex,
  ACM validation records deleted; nothing in DNS points at AWS. 6.7: ECS API service scaled to 0, RDS stopped
  (**AWS restarts a stopped RDS after 7 days**: delete or re-stop it by 2026-11-30). ALB access logging off;
  `bluelytics-access-logs` has a 1-day expire-all lifecycle rule (owner: delete it, not needed), so
  `aws s3 rb s3://bluelytics-access-logs` once empty.
- **6.8 done, 2026-11-27** (owner go; log in `.work/aws-teardown/`): RDS `bluelytics` deleted without a final
  snapshot (the restore-tested dump replaces it), with its automated backups and the three manual snapshots;
  ECS service, both clusters and every task definition; both EventBridge rules; the ALB (and its Elastic IP);
  CloudFormation stack `EC2ContainerService-bluelytics-api-cluster` (VPC, subnets, target group; the eight
  security groups made outside the stack had to go first); both ECR
  repositories; the 11 `/bluelytics/*` SSM parameters; the three `/ecs/bluelytics-*` log groups; Route 53 zone
  `bluelytics.com.ar` (unused: the registrar delegates to Cloudflare; records saved in
  `.work/aws-teardown/route53-bluelytics.json`); IAM user `bluesocial` and roles `BlueExportRole`, `RDSAccessS3`;
  bucket `bluelytics-access-logs`. Emptied, website off, public access blocked, names kept:
  `bluelytics.com.ar`, `www.bluelytics.com.ar`, `bluesocialposts`. `db-bluelytics` keeps only
  `pg-dump-final/bluelytics-20261123T0300Z.dump` (off-site copy; the 2023 export is archived locally).
  Kept on purpose: generic roles `ecsTaskExecutionRole`, `ecsEventsRole`, `ecsAutoscaleRole`,
  `rds-monitoring-role`, IAM group `s3blue`, SNS topic `mailPablo`, and everything of other projects in the
  account. Remaining: 6.9 (bill to zero after one cycle), 6.10–6.13.

---

## Phase 0 — Prerequisites and inventory

Nothing in this phase changes production.

### 0.1 Tools

- [ ] Node 24 (`nvm use` in the repo reads `.nvmrc`), pnpm 12.22 (`pnpm --version`).
- [ ] Pulumi CLI 3.276.0 or newer (`pulumi version`; the research ran 3.276.0). Wrangler comes from the repo (`pnpm --filter @bluelytics/api exec wrangler --version` → 4.166.x after `pnpm install`).
- [ ] AWS CLI v2, `psql` and `pg_dump` with a major version **equal to or newer than** the production Postgres server, `jq`, `curl` 7.82 or newer (for `--json`), `openssl`, `gpg` or `age`, `dig`, `gh`, Docker (for the restore test), and your OpenVPN client with your existing profile.
- [ ] A password manager entry for every secret created in this guide. Never paste a secret into a file inside the repo or into a command line (use the `read -rs` pattern below so values stay out of shell history).

### 0.2 Session variables and helpers

Every later step assumes these. Keep `MIG_DIR` outside the repo; it will hold exports, backups and the
rollback scripts. Put the block in `$MIG_DIR/session.sh` (no secrets in it) and `source` it in every new shell.

```sh
export MIG_DIR=~/bluelytics-migration
mkdir -p "$MIG_DIR"/{cf,aws,backup,parity,tmp} && chmod 700 "$MIG_DIR" "$MIG_DIR/tmp"
export ZONE=bluelytics.com.ar
export API_PROD=api.bluelytics.com.ar
export API_SHADOW=api-v2.bluelytics.com.ar      # decision
export WEB_SHADOW=v2.bluelytics.com.ar          # decision
export JOBS_HOST=<decision>
export MEDIA_HOST=media.bluelytics.com.ar
export AWS_REGION=us-west-2
[ -f "$MIG_DIR/state.env" ] && . "$MIG_DIR/state.env"    # ids recorded by later steps (not secret)
wr_api()  { pnpm --filter @bluelytics/api  exec wrangler "$@"; }   # D1 commands use the API Worker's config
wr_jobs() { pnpm --filter @bluelytics/jobs exec wrangler "$@"; }
wr_web()  { pnpm --filter @bluelytics/web  exec wrangler "$@"; }
# Cloudflare API, read-only and purges, with the ops token: cf <path> [extra curl flags]
cf()  { local p=$1; shift; curl -sS -H "Authorization: Bearer $CF_OPS_TOKEN" "$@" "https://api.cloudflare.com/client/v4$p"; }
# Cloudflare API with the deploy token (Worker route changes): cfw <path> [extra curl flags]
cfw() { local p=$1; shift; curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$@" "https://api.cloudflare.com/client/v4$p"; }
# The id of the one Worker route with exactly this pattern; fails if there are zero or several.
route_id() {
  cf "/zones/$CF_ZONE_ID/workers/routes" | jq -er --arg p "$1" \
    '[.result[] | select(.pattern == $p)] | if length == 1 then .[0].id else error("expected 1 route for \($p), found \(length)") end'
}
# write_rollback <file> <route id>: a standalone script that deletes that route, runnable from a fresh shell.
write_rollback() {
  [ -n "${2:-}" ] && [ "$2" != null ] || { echo "write_rollback: empty route id, nothing written" >&2; return 1; }
  printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
    '[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { read -rsp "Cloudflare deploy token: " CLOUDFLARE_API_TOKEN; echo; }' \
    "curl -fsS -X DELETE -H \"Authorization: Bearer \$CLOUDFLARE_API_TOKEN\" https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/workers/routes/$2 | jq -e .success" \
    > "$1"
  chmod 700 "$1" && bash -n "$1" && cat "$1"
}
```

`write_rollback` prints the script it wrote: check that the last line contains the zone id and a route id,
and `$CLOUDFLARE_API_TOKEN` literally (not its value).

At the end of every working session, clear the secrets from the shell:

```sh
unset CF_OPS_TOKEN CLOUDFLARE_API_TOKEN ADMIN_TOKEN BUFFER_API_KEY PULUMI_CONFIG_PASSPHRASE CF_DNS_TOKEN
```

### 0.3 Accounts and identities

- [ ] Cloudflare: you can open the account that owns the `bluelytics.com.ar` zone. Note the zone plan (step 0.6 prints it).
- [ ] Cloudflare R2 enabled on the account. R2 requires a one-time checkout step before the first bucket can be created; expect to need a payment method on file (`cloudflare.md` §6).
- [ ] If you chose Workers Paid: subscribe now. Do **not** set a low spending limit: when it is hit, every Worker request and every cron run is rejected (HTTP 1103), and a test Worker in the same account can exhaust it (`cloudflare.md` §1).
- [ ] Pulumi backend, one of:
  - Pulumi Cloud: `pulumi login` (interactive), then `pulumi whoami`. State and stack secrets live in Pulumi Cloud.
  - Self-managed: the state lives in a directory you back up; stack secrets are encrypted with a passphrase.
    Losing either orphans the protected D1/R2 resources and the stack config.

    ```sh
    mkdir -p ~/bluelytics-pulumi-state && chmod 700 ~/bluelytics-pulumi-state
    pulumi login file://$HOME/bluelytics-pulumi-state
    read -rs PULUMI_CONFIG_PASSPHRASE && export PULUMI_CONFIG_PASSPHRASE   # generate it; store it in the password manager first
    ```

    Back up the state directory after every `pnpm infra:up` (step 1.3 shows the command).
- [ ] AWS, two identities, neither of them the legacy scraper or `s3cmd` IAM user (that user is deleted in 6.11):
  - `bl-readonly`: an IAM user or Identity Center role with the managed `ReadOnlyAccess` policy, for Phase 0 and
    every check up to Phase 6. Configure it as an AWS CLI profile.
  - `bl-admin`: an identity with permission to stop and delete resources, used only in Phase 6, with MFA.
  Run `aws sts get-caller-identity --profile <name>` for both and note the user/role names. Never use the
  keys from the legacy `.env`.
- [ ] Buffer: create a new API key (Buffer → Settings → API, `https://publish.buffer.com/settings/api`). The legacy v1 token is rejected by the new API (`buffer-api.md`). Store it as `BUFFER_API_KEY`. Do not revoke the legacy token yet (the legacy scraper still posts with it until cutover).
- [ ] Google Cloud project `bluelytics-mobile`: IAM & Admin → Service Accounts → `firebase-adminsdk-…@bluelytics-mobile` → Keys → **Add key** (JSON). This new key is what v2 uses (`FIREBASE_SERVICE_ACCOUNT_JSON`); the legacy key stays until Phase 6. Save the JSON file as an attachment in the password manager; record its `private_key_id` (`jq -r .private_key_id <file>` prints only the id) so you can tell the keys apart later. Then `shred -u` the downloaded file.
- [ ] GitHub access to the legacy repositories (step 6.12).

### 0.4 Cloudflare API tokens

Create user API tokens (My Profile → API Tokens). Account-owned tokens do not support Page Rules, which the
inventory must read. The permission sets below were assembled from documentation and never exercised
(`pulumi-cloudflare.md` §10): if a command fails with a permission error, add the missing permission and
note it.

| Token | Used by | Permissions |
|---|---|---|
| **Pulumi** | `pnpm infra:*`, stored as Pulumi secret `cloudflare:apiToken`; also the DNS edits of Phase 6 (`CF_DNS_TOKEN`) | Account: D1 Edit, Workers R2 Storage Edit. Zone `bluelytics.com.ar`: Zone Read, DNS Edit, Cache Rules Edit, Single Redirect Edit, Transform Rules Edit. Phase 7 adds Zone Cloud Connector Edit/Write. |
| **Deploy** | wrangler (`pnpm deploy:*`, `db:migrate:remote`, `wrangler d1/tail/secret`), route changes and the rollback scripts; env `CLOUDFLARE_API_TOKEN` | Template "Edit Cloudflare Workers" (Workers Routes Write on the zone, Workers Scripts Write, Workers KV Storage Write, Workers Tail Read, Workers R2 Storage Write, Account Settings Read, User Details Read, User Memberships Read) **plus D1 Edit** (the template has no D1 permission). |
| **Ops** (temporary, local only) | inventory, checks and cache purges in this guide (`cf`) | Read permissions for: Zone, DNS, Page Rules, Zone Settings, Workers Routes, Cache Rules, Transform Rules, Single Redirect, Cloud Connector, Account Workers Scripts; plus **Cache Purge** on the zone. Deleted in step 6.11. |

```sh
read -rs CF_OPS_TOKEN && export CF_OPS_TOKEN          # paste, Enter
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
cf /user/tokens/verify | jq '.result.status'          # → "active"
cfw /user/tokens/verify | jq '.result.status'         # → "active"
```

### 0.5 Repository green and implementation checks

```sh
pnpm install && pnpm typecheck && pnpm test && pnpm build
pnpm run          # lists the root scripts
```

Expect all three to pass and `pnpm run` to list every command of `ARCHITECTURE.md` §11. If not, stop: nothing
below is safe on a red build.

This guide relies on the behaviours below. Each one is a requirement on the implementation, not something
to work around on the day. Check each; if one fails, stop and get it fixed.

| # | Behaviour this guide needs | How to check |
|---|---|---|
| C1 | `pnpm deploy:api`, `deploy:jobs` and `deploy:web` `-- <flags>` pass the flags through to `wrangler deploy` (pnpm forwards a literal `--`; the shared `scripts/wrangler-deploy.mjs` drops it) | For each of the three, `pnpm deploy:<app> -- --dry-run` ends with `--dry-run: exiting now.` and uploads nothing. Run it with no `CLOUDFLARE_API_TOKEN` exported, so a regression fails at the token prompt instead of deploying |
| C2 | A flag is on only for the exact string `"true"` (`"false"`, empty or missing → off) | A test in `apps/jobs` covers it; `grep -n "=== 'true'" apps/jobs/src/env.ts` shows the comparison in `isEnabled`, and `grep -rn "_ENABLED" apps/jobs/src` shows every flag read through it |
| C3 | `GET /admin/health` reports the effective `PUSH_ENABLED` and `SOCIAL_ENABLED` | Read the handler or its test |
| C4 | With `PUSH_ENABLED` off, a new alert row gets `push_status` `disabled` (or another non-`sent` value) and nothing is sent; with `SOCIAL_ENABLED` off, a post row gets `dry_run` and Buffer is not called | The pipeline test in `apps/jobs` |
| C5 | `FIREBASE_SERVICE_ACCOUNT_JSON` is parsed only when a push is sent, so a placeholder value is harmless in shadow mode | Read the FCM sender |
| C6 | `POST /admin/run?force=1` outside the trading window does not write `daily_rates`, `ticks`, `alerts` or `social_posts` (fetching sources and writing `observations` is fine) | Read the handler or its test. If it does write them, never call it outside the trading window (2.4) |
| C7 | `pnpm backfill` (full run) writes `daily_rates`, the last two `alerts` with their legacy ids, `currencies`, `latest_rates`, and re-renders the `rendered` bodies | `--dry-run` output lists each table with a row count |
| C8 | `pnpm backfill -- --since <day>` writes only `daily_rates` for days ≥ `<day>` and the last two `alerts`, then re-renders the affected bodies; it never touches `latest_rates`, `currencies`, `ticks`, `observations` or `social_posts` | `--dry-run --since <day>` output lists only those tables |
| C9 | With `SOCIAL_ENABLED` on, the social rule's baseline is the newest **`sent`** post per network; `dry_run` rows do not count. With it off, `dry_run` rows stand in for `sent` ones (so shadow rows follow the real cooldowns and 0.75 % rule) and their event keys end in `-dry`, so they never block or seed a live post | Read `runSocial` in `apps/jobs/src/social.ts`; the shadow-mode pipeline test switches posting on mid-day and expects real posts |
| C10 | Recommended, not in `ARCHITECTURE.md` §7: `POST /admin/push/test` sends an FCM `validate_only: true` message with the deployed secret and reports the result | If missing, the deployed Firebase secret cannot be tested before the first real alert (known gap; see 4.10) |

**Undo:** nothing changed.

### 0.6 Inventory of the Cloudflare zone

Why: a Pulumi ruleset replaces **every** rule of its phase, and a wrangler custom domain silently replaces an
existing DNS record when run non-interactively (`pulumi-cloudflare.md` §6.1, §8.1). None of the current zone
configuration is in any repository. Known from outside: `api.bluelytics.com.ar` is proxied, every API path
except `/v2/latest` is edge-cached with `cache-control: max-age=7200` (404s included), the site root gets the
same header, and `www` redirects to the apex. Which rule does each is unknown.

```sh
cd "$MIG_DIR/cf"
cf "/zones?name=$ZONE" > zone.json
export CF_ZONE_ID=$(jq -r '.result[0].id' zone.json) CF_ACCOUNT_ID=$(jq -r '.result[0].account.id' zone.json)
export CLOUDFLARE_ACCOUNT_ID=$CF_ACCOUNT_ID        # wrangler uses it; avoids a prompt on multi-account tokens
printf 'export CF_ZONE_ID=%s CF_ACCOUNT_ID=%s CLOUDFLARE_ACCOUNT_ID=%s\n' "$CF_ZONE_ID" "$CF_ACCOUNT_ID" "$CF_ACCOUNT_ID" >> "$MIG_DIR/state.env"
jq -r '.result[0] | "plan=\(.plan.name) status=\(.status)"' zone.json
cf "/zones/$CF_ZONE_ID/dns_records/export" > dns.bind            # BIND file: the rollback source for every record
cf "/zones/$CF_ZONE_ID/dns_records?per_page=100" > dns.json
cf "/zones/$CF_ZONE_ID/pagerules" > pagerules.json
cf "/zones/$CF_ZONE_ID/rulesets" > rulesets.json
for id in $(jq -r '.result[] | select(.kind=="zone") | .id' rulesets.json); do cf "/zones/$CF_ZONE_ID/rulesets/$id" > "ruleset-$id.json"; done
cf "/zones/$CF_ZONE_ID/workers/routes" > worker-routes.json
cf "/zones/$CF_ZONE_ID/settings" > settings.json
cf "/zones/$CF_ZONE_ID/cloud_connector/rules" > cloud-connector.json
cf "/accounts/$CF_ACCOUNT_ID/workers/scripts" > workers.json
cf "/accounts/$CF_ACCOUNT_ID/rules/lists" > lists.json             # bulk redirect lists, if any
jq -r '.result[] | select(.name|test("^(www\\.|api\\.)?bluelytics\\.com\\.ar$")) | [.name,.type,.content,.proxied,.id] | @tsv' dns.json
dig +short SOA bluelytics.com.ar                                   # last field: negative-caching TTL (used in 6.4)
```

Check each file has `"success": true`; a permission error means the ops token lacks that Read permission.
Then answer, in writing:

- [ ] Zone plan: ______ (Free plans have a 2-hour minimum edge TTL and no Snippets/Custom Errors; matters for Phase 7).
- [ ] DNS records for `bluelytics.com.ar`, `www`, `api`: type, target, proxied (expected: all proxied). The apex target is the S3 site (an S3 website endpoint is normally a CNAME, flattened at the apex); the `api` target tells you where the Go API runs (input to 0.7); the `www` target tells you how the redirect works.
- [ ] No record exists yet for `$API_SHADOW`, `$WEB_SHADOW`, `$JOBS_HOST` (if a custom domain), `$MEDIA_HOST`. If one exists, pick another name.
- [ ] Which rule makes API paths cacheable and sets the 2-hour TTL (Page Rule "Cache Everything", a Cache Rule in `http_request_cache_settings`, or a Worker), which exempts `/v2/latest`, and which sets `max-age=7200` on the apex.
- [ ] How `www` → apex is done: a Page Rule, a Single Redirect (`http_request_dynamic_redirect`), a bulk redirect, or an S3 redirect bucket (the `www` record is then a CNAME to an `s3-website` endpoint). If it is S3, it dies with S3 in Phase 6 unless replaced first (step 6.3).
- [ ] How `http://` → `https://` is done (`always_use_https` in `settings.json`, or a rule). Old Android app builds call `http://api.bluelytics.com.ar` and need the 301 (`legacy-mobile.md` §1.5).
- [ ] `browser_cache_ttl`, `security_level`, and whether bot protection (Bot Fight Mode) is on. Bot challenges on the API host break the mobile app (OkHttp/CFNetwork clients).
- [ ] Web Analytics: dashboard → Analytics & Logs → Web Analytics. Is there a site for `bluelytics.com.ar`, and is it in automatic (edge-injected) mode? Legacy relies on that injection (`legacy-frontend.md` §0 item 9).
- [ ] Existing Worker routes or Workers: none expected. If any route already matches `api.bluelytics.com.ar/*` or `bluelytics.com.ar/*`, the cutover steps need adjusting; stop and resolve first.
- [ ] Any non-empty ruleset in a phase Pulumi would manage (`http_request_cache_settings`, `http_request_dynamic_redirect`, `http_request_transform`, `http_response_headers_transform`). Keep `manageRulesets=false` until those rules are copied into the Pulumi program (step 6.6).

**Undo:** nothing changed.

### 0.7 Inventory of AWS (read-only) [FIND OUT]

How the containers are run and scheduled, and where Postgres, the VPN and the API origin live, is not
recorded anywhere. Use the `bl-readonly` profile so nothing here can modify anything. Some `describe` outputs
contain environment **values** (including the Postgres password): the queries below print names only; do not
drop the `--query` filters.

```sh
cd "$MIG_DIR/aws"
export AWS_PROFILE=bl-readonly
aws sts get-caller-identity
aws ecr describe-repositories --query 'repositories[].{name:repositoryName,uri:repositoryUri}'
for r in bluelytics_api bluelytics_scraper; do
  aws ecr describe-images --repository-name "$r" --query 'sort_by(imageDetails,&imagePushedAt)[-3:].{pushed:imagePushedAt,tags:imageTags,size:imageSizeInBytes}'
done
# Who starts the scraper? RunTask calls of the last 7 days, grouped by caller and task definition.
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=RunTask \
  --start-time "$(date -u -d '-7 days' +%FT%TZ)" --query 'Events[].CloudTrailEvent' --output json \
  | jq -r '.[] | fromjson | [(.userIdentity.invokedBy // .userIdentity.arn), .requestParameters.cluster, .requestParameters.taskDefinition] | @tsv' | sort | uniq -c
aws ecs list-clusters
aws ecs list-task-definitions --query 'taskDefinitionArns[-10:]'
# For each cluster:    aws ecs list-services --cluster <c> ; aws ecs list-tasks --cluster <c>
# For a task definition, names only:
#   aws ecs describe-task-definition --task-definition <td> --query 'taskDefinition.{role:taskRoleArn,exec:executionRoleArn,containers:containerDefinitions[].{image:image,env:environment[].name,secrets:secrets[].{name:name,from:valueFrom}}}'
aws events list-event-buses --query 'EventBuses[].Name'
for b in $(aws events list-event-buses --query 'EventBuses[].Name' --output text); do
  aws events list-rules --event-bus-name "$b" --query 'Rules[].{name:Name,schedule:ScheduleExpression,state:State}'
done
aws scheduler list-schedules --query 'Schedules[].{name:Name,group:GroupName,state:State}'
aws ec2 describe-instances --query 'Reservations[].Instances[].{id:InstanceId,state:State.Name,type:InstanceType,name:Tags[?Key==`Name`]|[0].Value,publicIp:PublicIpAddress,launched:LaunchTime}'
aws ec2 describe-addresses --query 'Addresses[].{ip:PublicIp,instance:InstanceId}'
aws ec2 describe-volumes --query 'Volumes[].{id:VolumeId,size:Size,state:State,instance:Attachments[0].InstanceId}'
aws ec2 describe-snapshots --owner-ids self --query 'Snapshots[].{id:SnapshotId,size:VolumeSize,start:StartTime,kms:KmsKeyId}'
aws ec2 describe-nat-gateways --query 'NatGateways[].{id:NatGatewayId,state:State}'
aws ec2 describe-client-vpn-endpoints --query 'ClientVpnEndpoints[].{id:ClientVpnEndpointId,status:Status.Code,dns:DnsName}'
aws ec2 describe-vpc-endpoints --query 'VpcEndpoints[].{id:VpcEndpointId,type:VpcEndpointType,service:ServiceName}'
aws ec2 describe-vpcs --query 'Vpcs[].{id:VpcId,default:IsDefault,cidr:CidrBlock}'
aws ec2 describe-reserved-instances --query 'ReservedInstances[].{id:ReservedInstancesId,state:State,end:End}'
aws elbv2 describe-load-balancers --query 'LoadBalancers[].{name:LoadBalancerName,dns:DNSName,type:Type}'
aws rds describe-db-instances --query 'DBInstances[].{id:DBInstanceIdentifier,engine:Engine,version:EngineVersion,class:DBInstanceClass,public:PubliclyAccessible,encrypted:StorageEncrypted,kms:KmsKeyId}'
aws rds describe-db-clusters --query 'DBClusters[].{id:DBClusterIdentifier,engine:Engine}'
aws rds describe-db-snapshots --query 'DBSnapshots[].{id:DBSnapshotIdentifier,created:SnapshotCreateTime}'
aws rds describe-db-instance-automated-backups --query 'DBInstanceAutomatedBackups[].{id:DBInstanceIdentifier,status:Status,resource:DbiResourceId}'
aws rds describe-reserved-db-instances --query 'ReservedDBInstances[].{id:ReservedDBInstanceId,state:State}'
aws lightsail get-instances --query 'instances[].{name:name,state:state.name}' 2>/dev/null
aws lightsail get-relational-databases --query 'relationalDatabases[].name' 2>/dev/null
aws apprunner list-services 2>/dev/null; aws lambda list-functions --query 'Functions[].FunctionName'
aws secretsmanager list-secrets --query 'SecretList[].Name'
aws ssm describe-parameters --query 'Parameters[].{name:Name,type:Type}'
aws kms list-aliases --query 'Aliases[?!starts_with(AliasName, `alias/aws/`)].{alias:AliasName,key:TargetKeyId}'
aws backup list-backup-vaults --query 'BackupVaultList[].{name:BackupVaultName,points:NumberOfRecoveryPoints}'
aws savingsplans describe-savings-plans --query 'savingsPlans[].{id:savingsPlanId,state:state,end:end}'
aws s3api list-buckets --query 'Buckets[].Name'
aws s3api get-bucket-website --bucket bluelytics.com.ar
aws s3api get-bucket-logging --bucket bluelytics.com.ar
aws s3api get-bucket-versioning --bucket bluelytics.com.ar
aws sns list-topics
aws logs describe-log-groups --query 'logGroups[].{name:logGroupName,bytes:storedBytes}'
aws iam list-users --query 'Users[].UserName'
aws iam list-roles --query 'Roles[?!starts_with(Path, `/aws-service-role/`)].RoleName'
# For each user: aws iam list-access-keys --user-name <u> ; aws iam get-access-key-last-used --access-key-id <id>
aws route53 list-hosted-zones --query 'HostedZones[].Name'
aws acm list-certificates --query 'CertificateSummaryList[].DomainName'
# Anything in other regions?
for r in $(aws ec2 describe-regions --query 'Regions[].RegionName' --output text); do
  i=$(aws ec2 describe-instances --region "$r" --query 'length(Reservations[].Instances[])' --output text)
  d=$(aws rds describe-db-instances --region "$r" --query 'length(DBInstances)' --output text)
  v=$(aws ec2 describe-client-vpn-endpoints --region "$r" --query 'length(ClientVpnEndpoints)' --output text)
  [ "$i$d$v" != "000" ] && echo "$r: $i instances, $d db instances, $v client VPN endpoints"
done
```

Also look in the console at AWS Marketplace → Manage subscriptions (an OpenVPN Access Server AMI is a
Marketplace subscription that bills separately).

If the containers run on an EC2 host (a plausible reading of `bluescraper/docker_run.sh`, which uses
`docker run --add-host`), log in and look. A cron line may pass environment values inline (`-e NAME=value`),
so mask them while reading:

```sh
mask() { sed -E 's/((-e|--env) +[A-Za-z_][A-Za-z0-9_]*=)[^ ]+/\1***/g; s/(([A-Z_]*(KEY|SECRET|PASS|TOKEN)[A-Z_]*)=)[^ ]+/\1***/g'; }
crontab -l 2>&1 | mask; sudo crontab -l 2>&1 | mask; ls /etc/cron.d; sudo cat /etc/cron.d/* 2>/dev/null | mask
systemctl list-timers --all
docker ps -a --format '{{.Names}} {{.Image}} {{.CreatedAt}} {{.Status}}'
```

Do not run `docker inspect` (it prints the environment).

Write down, in `$MIG_DIR/aws/inventory.md`:

- [ ] Scraper trigger(s): what, where, schedule expression, and how to disable each without deleting it. There may be more than one (for example a Scheduler schedule and an EventBridge rule, or a crontab on a second host): every caller in the CloudTrail summary must be explained. Needed at steps 4.2 and 4.3.
- [ ] How to see that a run happened: the scraper's CloudWatch log group (new log streams per run), ECS task history, or container start times on the host. Needed at step 4.3.
- [ ] Currency job trigger (`entrypoint_currencies.sh`; dead since about May 2023 but may still be scheduled).
- [ ] API runtime (ECS service / EC2 container / other) and what the `api` DNS record points at.
- [ ] Postgres: RDS instance or cluster id, or the EC2 instance that runs it; reachable only through the VPN; whether its storage and snapshots use a customer KMS key.
- [ ] VPN: an EC2 instance (possibly a Marketplace AMI) or an AWS Client VPN endpoint.
- [ ] S3 buckets: the site bucket `bluelytics.com.ar`, a `www` redirect bucket if 0.6 found one, and the post-image bucket (`S3_BUCKET` in the legacy `.env`; read the name yourself, do not paste it anywhere public). Versioning on or off for each.
- [ ] Where the task definitions' `secrets[]` come from (Secrets Manager or SSM Parameter Store names).
- [ ] SNS topic used by `bluescraper/src/buffer.py` and its email subscription.
- [ ] IAM users and keys used by the scraper, by `s3cmd` (frontend `build.sh`) and by ECR pushes, and their "last used" dates; IAM roles used by tasks, schedules and instances.
- [ ] Anything else that costs money: NAT gateways, Elastic IPs and other public IPv4 addresses, load balancers, Client VPN, VPC endpoints, snapshots, automated backups, backup vaults, log groups, hosted zones, KMS keys, reserved instances or Savings Plans (these bill until they expire, whatever you delete).

**Undo:** nothing changed.

### 0.8 Traffic baseline

In the Cloudflare dashboard, open the zone's traffic analytics for the last 30 days and record requests per
day. If the view lets you filter by hostname, record `api.bluelytics.com.ar` and the apex separately; if not,
the zone total is an upper bound. Workers Paid is needed anyway for the jobs Worker (Decisions list); this
number sizes request volume against Paid's included 10M/month. Count each website request as at least two
billed Worker invocations (gateway plus the Astro entrypoint); API requests count once. More than ~10M API
requests per month is when Phase 7 starts to save money.

- [ ] API requests/day: peak ______, average ______. Website requests/day: peak ______.

### 0.9 Current AWS cost

AWS Billing console → Bills, last three months, by service and region. Or with Cost Explorer (the API is
billed per request; the console view is enough):

```sh
aws ce get-cost-and-usage --time-period Start=2026-08-01,End=2026-11-01 --granularity MONTHLY \
  --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE
aws ce get-cost-and-usage --time-period Start=2026-10-01,End=2026-11-01 --granularity MONTHLY \
  --metrics UnblendedCost --group-by Type=DIMENSION,Key=USAGE_TYPE      # shows public IPv4, snapshots, VPN hours
```

- [ ] Monthly AWS cost: ______ (the number Phase 6 takes to zero). Every usage type in the second list must match something in the 0.7 inventory.

### 0.10 Full Postgres backup — do this now

Why now: the seed data in the repository ends on **2020-05-12**. Everything since — about 265k–354k
per-source samples, every alert, every social post, the currency history to 2023 — exists only in the
production database (`legacy-backend-spec.md` I.3, `git-audit.md` §10 item 4). The public API exposes only
the daily published values.

Connect the VPN. Put the connection details in `~/.pgpass` (mode 600; one line, removed in 6.13) or answer the
password prompt; do not put the password on the command line.

```sh
export PGHOST=<db host> PGDATABASE=<db name> PGUSER=<user>     # from your own records; not printed here
psql -Atc 'select version()'                                  # pg_dump major version must be >= this
STAMP=$(date -u +%Y%m%dT%H%MZ)
pg_dump --format=custom --no-owner --no-privileges --file "$MIG_DIR/backup/bluelytics-$STAMP.dump"
pg_restore --list "$MIG_DIR/backup/bluelytics-$STAMP.dump" | grep -E 'TABLE DATA|MATERIALIZED VIEW DATA'
psql -Atc "select 'dolar_values', count(*), min(scraped_at), max(scraped_at) from dolar_values
  union all select 'alertas_dolar', count(*), min(alert_at), max(alert_at) from alertas_dolar
  union all select 'actualizaciones_sociales', count(*), min(update_at), max(update_at) from actualizaciones_sociales
  union all select 'actualizaciones_sociales_weekly', count(*), min(sent_at), max(sent_at) from actualizaciones_sociales_weekly
  union all select 'currency_values', count(*), min(scraped_dt)::timestamp, max(scraped_dt)::timestamp from currency_values" \
  | tee "$MIG_DIR/backup/counts-$STAMP.txt"
for t in dolar_values alertas_dolar actualizaciones_sociales actualizaciones_sociales_weekly; do
  psql -c "\copy (select * from $t) to '$MIG_DIR/backup/$t-$STAMP.csv' csv header"
done
sha256sum "$MIG_DIR"/backup/*"$STAMP"* > "$MIG_DIR/backup/SHA256SUMS-$STAMP"
```

Expect: `alertas_dolar` max id 1885 or later (the last public alert on 2026-11-22 was 1885); `dolar_values`
max `scraped_at` within the last 15 minutes of the last trading window.

Verify the dump restores (a backup you have not restored is not a backup):

```sh
docker run --rm -d --name bl-restore -e POSTGRES_PASSWORD=local -p 55432:5432 postgres:<server major>
sleep 5; PGPASSWORD=local createdb -h localhost -p 55432 -U postgres bl
PGPASSWORD=local pg_restore --no-owner -h localhost -p 55432 -U postgres -d bl "$MIG_DIR/backup/bluelytics-$STAMP.dump"
PGPASSWORD=local psql -h localhost -p 55432 -U postgres -d bl -Atc 'select count(*) from dolar_values'   # = counts file
docker stop bl-restore
```

- [ ] Restore row counts equal the production counts.
- [ ] Two copies in two independent places (for example an encrypted external disk and an encrypted cloud
      folder; encrypt with `gpg --symmetric` or `age`). Not in the repo, not in any R2 bucket the site uses.

**Undo:** nothing changed in production.

---

## Phase 1 — Provision v2 without touching production hostnames

### 1.1 Guard against touching a production hostname

The most dangerous mistake in Phases 1–3 is a `routes` entry with a production hostname. A
`custom_domain: true` route on `bluelytics.com.ar` or `api.bluelytics.com.ar`, deployed from a non-interactive
shell (CI, or any script whose stdout is not a terminal), **replaces the existing DNS record without asking**
and takes the legacy site or API offline (`pulumi-cloudflare.md` §6.1). Before **every** deploy until Phase 4:

```sh
grep -n '"pattern"' apps/*/wrangler.jsonc
grep -nE '"(workers_dev|preview_urls)"' apps/web/wrangler.jsonc      # both false (astro-seo.md §9)
```

Expect only `$API_SHADOW`, `$WEB_SHADOW`, `$JOBS_HOST` (if a custom domain) and, during step 3.2 only, the two
`__v2probe` patterns. Anything else: stop and fix the file. Recovery if it happens anyway: Appendix D,
"Wrangler replaced a DNS record".

### 1.2 Pulumi stack

```sh
cd infra
pulumi stack init prod
pulumi config set bluelytics:accountId "$CF_ACCOUNT_ID"
pulumi config set bluelytics:zoneId "$CF_ZONE_ID"
pulumi config set bluelytics:zoneName bluelytics.com.ar
pulumi config set bluelytics:webHostname bluelytics.com.ar
pulumi config set bluelytics:apiHostname api.bluelytics.com.ar
pulumi config set bluelytics:mediaHostname media.bluelytics.com.ar
pulumi config set bluelytics:apiMode worker
pulumi config set bluelytics:manageRulesets false
pulumi config set --secret cloudflare:apiToken          # prompts; paste the Pulumi token
cd ..
pnpm infra:preview
```

Expect the preview to create only: D1 database `bluelytics`, R2 bucket `bluelytics-public`, its custom domain
on `media.bluelytics.com.ar`, its lifecycle rule and CORS policy. **If it plans any DNS record, ruleset or
custom domain on the apex, `www` or `api`, stop**: with `manageRulesets=false` and `apiMode=worker` it must not.

### 1.3 Create the resources

```sh
pnpm infra:up
pnpm infra:sync-ids
git diff -- apps/*/wrangler.jsonc        # only database_id / bucket name values changed
# self-managed backend only: back up the state (repeat after every infra:up)
tar -C ~ -cz bluelytics-pulumi-state | gpg --symmetric -o "$MIG_DIR/backup/pulumi-state-$(date -u +%Y%m%dT%H%MZ).tgz.gpg"
```

- [ ] `curl -sSI https://$MEDIA_HOST/` answers from Cloudflare (a 404 for a missing key is fine; a TLS error means the certificate is still being issued; wait a few minutes).
- [ ] Commit and push the id changes.

**Undo:** D1 and R2 are `protect`ed, so `pulumi destroy` refuses; that is intended. Remove them by hand only
if you abandon the migration.

### 1.4 D1 migrations

```sh
pnpm db:migrate:remote
wr_api d1 execute bluelytics --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expect the tables of `ARCHITECTURE.md` §5: `alerts, currencies, daily_rates, extra_rates, latest_rates,
observations, rendered, social_posts, state, ticks` (plus `d1_migrations`, `sqlite_sequence`).
Failure: Appendix D, "D1 migration failed".

### 1.5 Flags and plain config

In `apps/jobs/wrangler.jsonc` → `vars` (names from `ARCHITECTURE.md` §7, §9):

| Var | Value now |
|---|---|
| `PUSH_ENABLED` | `"false"` |
| `SOCIAL_ENABLED` | `"false"` |
| `API_MODE` | `"worker"` |
| `LEGACY_V1_BLUE_BUG` | `"false"` (or `"true"` if you decided to keep the bug) |
| `BUFFER_CHANNELS` | set in step 2.7 |
| `MEDIA_HOSTNAME` | `"media.bluelytics.com.ar"` (the R2 custom domain; image URLs sent to Buffer) |
| `API_HOSTNAME` | `"api.bluelytics.com.ar"` (only read by the static-first purge, Phase 7) |
| `CLOUDFLARE_ZONE_ID` | `""` now; set to `$CF_ZONE_ID` in step 7.3 before switching to static-first |

Admin host: set `workers_dev` / `routes` in `apps/jobs/wrangler.jsonc` as decided (Decisions list). The file
ships with `"workers_dev": true` and no routes (the `workers.dev` admin host).

`apps/api/wrangler.jsonc` vars: `SHADOW_HOSTNAME` (`"api-v2.bluelytics.com.ar"`, answers there carry
`noindex`), and copies of `LEGACY_V1_BLUE_BUG` and `API_MODE` that the API Worker does not read. Keep those two
equal to the jobs values by hand: the jobs Worker renders the bodies, so its values decide the output.
`apps/web/wrangler.jsonc` vars: `PRODUCTION_HOSTNAME` (`"bluelytics.com.ar"`, every other host gets `noindex`)
and `MEDIA_ORIGIN` (`"https://media.bluelytics.com.ar"`, Open Graph images).

For `apps/web`: leave `PUBLIC_ANDROID_URL`, `PUBLIC_IOS_URL` unset (badges hidden); set `PUBLIC_GA4_ID` only if
you decided to use GA4. A var and a secret must never share a name: deploying a var with a secret's name
silently deletes the secret (`cloudflare.md` §11).

Analytics: `apps/web` embeds the Cloudflare Web Analytics beacon `<script>` only when the build-time env
`PUBLIC_CF_BEACON_TOKEN` is set (a public site token, not a secret: create or reuse the Web Analytics site in the
dashboard and export it before `pnpm deploy:web`). Unset, the page relies on the zone's edge injection found
in 0.6; whether that works on Worker-rendered HTML has not been verified, so setting the token is the safer
choice. v2 sends no Content-Security-Policy, so nothing blocks `static.cloudflareinsights.com`. 2.8 and 4.9
check the beacon loads.

```sh
grep -nE '"(PUSH|SOCIAL)_ENABLED"' apps/jobs/wrangler.jsonc      # both must read "false"
```

### 1.6 Secrets (prepare only)

Values come from the password manager (Appendix B lists where each originates). The jobs Worker does not
exist yet, so its first deploy carries the secrets in a file (`--secrets-file`, `pulumi-cloudflare.md` §9);
that happens in step 2.4. Prepare now:

```sh
openssl rand -base64 32          # ADMIN_TOKEN: save it in the password manager
```

Jobs secrets: `BUFFER_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON` (the whole JSON of the **new** key as one
value), `ADMIN_TOKEN`, optionally `OPS_WEBHOOK_URL`. `CLOUDFLARE_PURGE_TOKEN` only in Phase 7. The API and web
Workers need no secrets.

During the shadow period the jobs Worker holds a **placeholder** instead of the real Firebase key, and the
real Buffer key only for the draft test of 2.7. Shadow safety then does not depend only on the flags being
parsed correctly. The real values go in on Sunday (4.10).

### 1.7 Deploy the API and web Workers (not the jobs Worker yet)

The jobs Worker is deployed in step 2.4, after the backfill. Reason: its first cron run on an empty database
would insert alert id 1 (breaking the id sequence that must continue after legacy's last alert) and compute a
consensus with no previous published value for the jump guard.

```sh
grep -n '"pattern"' apps/*/wrangler.jsonc      # step 1.1
pnpm deploy:api
pnpm deploy:web
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_SHADOW/v2/latest
curl -sSI https://$WEB_SHADOW/ | grep -i x-robots-tag
```

Expect: the API answers (a JSON error body is fine while the database is empty, never an HTML error page);
the web host returns `x-robots-tag: noindex` (`ARCHITECTURE.md` §10). If `noindex` is missing, fix before
going on: an indexed shadow host is a duplicate-content problem. Optionally ask for the same header on the
shadow API host, so search engines do not index it either.

**Undo:** remove the shadow routes and redeploy, or delete the Workers in the dashboard. Production is untouched.

### 1.8 Restrict the Firebase client API key (before any public push)

If the v2 repository is or will be public, do this before the first push to the public remote: the mobile
app's `google-services.json` and `GoogleService-Info.plist` under `apps/mobile` contain the Firebase client
API key. It is public by design, but unrestricted. Google Cloud Console → APIs & Services → Credentials →
that key: restrict it to Android package `com.bluelytics.mobileapp` with the signing SHA-1, the iOS bundle id,
and the Firebase APIs actually used (`git-audit.md` §9 item 9). GitHub push protection may flag the key on the
first push; it is that public key and can be allowed (`git-audit.md` §10 item 8).

---

## Phase 2 — Load data

### 2.1 Backfill, dry run

Best on a weekend or after 20:00 ART, when today's legacy row is final (`legacy-backend-spec.md` I.3).

```sh
pnpm backfill -- --from https://api.bluelytics.com.ar --dry-run
curl -sS https://api.bluelytics.com.ar/v2/evolution.json | jq 'length'      # legacy row count
```

Expect the dry run to report daily rows equal to that count (9,365 rows / 4,683 dates on 2026-11-22, growing
by 2 per weekday), the last two alerts (1884 values and 1885, or later), 169 currencies, the latest values, and
the re-rendered bodies (C7).

### 2.2 Backfill for real

```sh
wr_api d1 time-travel info bluelytics          # note the bookmark/timestamp: your undo point
pnpm backfill -- --from https://api.bluelytics.com.ar --remote
wr_api d1 execute bluelytics --remote --command "SELECT tipo, COUNT(*), MIN(day), MAX(day) FROM daily_rates GROUP BY tipo"
wr_api d1 execute bluelytics --remote --command "SELECT id, alert_at, buy, sell FROM alerts ORDER BY id DESC LIMIT 3"
wr_api d1 execute bluelytics --remote --command "SELECT name, seq FROM sqlite_sequence"
wr_api d1 execute bluelytics --remote --command "SELECT key, updated_at FROM rendered ORDER BY key"
# does remote D1 accept writes to sqlite_sequence? (a no-op; needed in 4.5)
wr_api d1 execute bluelytics --remote --command "UPDATE sqlite_sequence SET seq = seq WHERE name = 'alerts'"
```

Expect: Oficial + Blue counts summing to the legacy row count (the 2013-04-05 Blue-only row is why they
differ by one); first day 2011-01-03; alerts ending at legacy's last id; `sqlite_sequence` for `alerts` equal to
that id; six `rendered` keys. Record whether the `UPDATE sqlite_sequence` was accepted or refused.

Record the last legacy alert id imported here; step 4.5 deletes every alert above it:

```sh
echo "export PRE_SHADOW_LAST=<last id shown above>" >> "$MIG_DIR/state.env"
```

**Undo:** `wr_api d1 time-travel restore bluelytics --timestamp=<timestamp noted above>`.

### 2.3 Rehearse the cutover sync locally

The cutover (step 4.5) replaces the alert rows on top of shadow data. During the shadow period v2 and legacy
both hand out ids after `PRE_SHADOW_LAST` (v2 for shadow alerts, legacy for real ones), so the same id can
exist with different values on each side. Rehearse the whole procedure once against a local D1, including a
shadow row whose id collides with the one legacy will own:

```sh
pnpm db:migrate:local
pnpm backfill -- --from https://api.bluelytics.com.ar                   # local, ids N-1 and N
# simulate shadow alerts with ids N+1 and N+2 (what v2 would insert while legacy also issues N+1, N+2)
wr_api d1 execute bluelytics --local --command "INSERT INTO alerts (alert_at, buy, sell, push_status) VALUES ('2026-01-01T00:00:00.000Z', 1, 1, 'disabled'), ('2026-01-01T00:10:00.000Z', 2, 2, 'disabled')"
pnpm backfill -- --from https://api.bluelytics.com.ar --since <a recent date> --dry-run    # C8: only daily_rates and alerts
# the 4.5 procedure:
wr_api d1 execute bluelytics --local --command "DELETE FROM alerts"
pnpm backfill -- --from https://api.bluelytics.com.ar --since <a recent date>
wr_api d1 execute bluelytics --local --command "UPDATE sqlite_sequence SET seq = <legacy last id> WHERE name = 'alerts'"
wr_api d1 execute bluelytics --local --command "SELECT id, alert_at, sell FROM alerts ORDER BY id; SELECT seq FROM sqlite_sequence WHERE name='alerts'"
```

Expect exactly two alert rows, equal to legacy's `/v2/alerts` (`previous` and `current`), and `seq` equal to
legacy's last id. Write down the commands exactly as they worked; 4.5 uses them unchanged against `--remote`.

### 2.4 Deploy the jobs Worker (shadow mode)

```sh
grep -n '"pattern"' apps/*/wrangler.jsonc
grep -nE '"(PUSH|SOCIAL)_ENABLED"' apps/jobs/wrangler.jsonc        # both "false"
read -rs ADMIN_TOKEN && export ADMIN_TOKEN
read -rs BUFFER_API_KEY && export BUFFER_API_KEY
(
  umask 077
  jq -n --arg b "$BUFFER_API_KEY" --arg a "$ADMIN_TOKEN" \
    '{BUFFER_API_KEY: $b, ADMIN_TOKEN: $a, FIREBASE_SERVICE_ACCOUNT_JSON: "{\"placeholder\":\"shadow mode, not a key\"}"}' \
    > "$MIG_DIR/tmp/secrets.json"
)
pnpm deploy:jobs -- --secrets-file "$MIG_DIR/tmp/secrets.json"      # C1
shred -u "$MIG_DIR/tmp/secrets.json"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "https://$JOBS_HOST/admin/health" | jq .
```

`jq` writes the file, so no editor leaves backup or swap copies; the subshell keeps `umask 077` from
affecting the rest of the session. Add `OPS_WEBHOOK_URL` with another `--arg` if you use it.

Expect `/admin/health` to answer and to show both flags off (C3). If you are inside the trading window, run one
tick now and check it:

```sh
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://$JOBS_HOST/admin/run?force=1"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "https://$JOBS_HOST/admin/health" | jq .
```

Expect a completed run, every source listed with a status, `latest` rendered. Outside the trading window, do
not force a run unless C6 holds; wait for the first scheduled run of the next window instead.

Commit and push the jobs config. Cron changes take up to 15 minutes to propagate; runs can be missed until then
(`cloudflare.md` §8).

Later single-secret changes, without editors or command-line values (`wrangler secret bulk` takes a JSON file):

```sh
( umask 077; jq -n --arg v "$VALUE" '{NAME: $v}' > "$MIG_DIR/tmp/one.json" ); wr_jobs secret bulk "$MIG_DIR/tmp/one.json"; shred -u "$MIG_DIR/tmp/one.json"
```

**Undo:** set `"crons": []` in `apps/jobs/wrangler.jsonc` and redeploy (commenting the key out does not remove triggers).

### 2.5 Parity check

```sh
pnpm parity -- --old https://api.bluelytics.com.ar --new https://$API_SHADOW | tee "$MIG_DIR/parity/first.txt"
pnpm parity -- --old https://api.bluelytics.com.ar --new https://$API_SHADOW --strict | tee "$MIG_DIR/parity/first-strict.txt"
```

What good looks like:

| Endpoint | Expected |
|---|---|
| `/v2/evolution.json`, `/v2/evolution.csv` (with and without `?days=`) | Byte-identical, except rows of days v2 computed itself since 2.4 (rule: close of the day, not median of 49 samples) |
| `/v2/historical?day=` (weekday, Saturday, Sunday, old, future, bad, missing) | Byte-identical bodies and status codes for past days, including the 404 bodies |
| `/` , 404, 405, `OPTIONS` | Identical bodies; `OPTIONS` 204 with the legacy CORS headers |
| `/v2/latest`, `/json/last_price` | Different values: new source set and live EUR (`*_euro`); `last_price` `blue` entry differs unless `LEGACY_V1_BLUE_BUG=true`. Same keys, key order, `%.2f` numbers, trailing newline, JSONP wrapper |
| `/data/json/currency.json` | Same codes, names and order; values differ once the jobs Worker has done its daily refresh (legacy frozen since about May 2023) |
| `/v2/alerts` | Identical until v2 inserts its first shadow alert, then different |
| Headers | v2 adds `etag`, `cache-control` (30 s on latest/last_price/alerts, 300 s on evolution/currency); content types and CORS identical |

Anything else is a bug: fix before Phase 3.

### 2.6 Post cards

```sh
pnpm cards:preview                       # → out/cards/*.jpg, rendered with local Chrome
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "https://$JOBS_HOST/admin/card?kind=update&size=portrait" -o "$MIG_DIR/card-update-portrait.html"
```

Check by eye: es-AR numbers (`$ 1.675`), 24-hour time, delta coloured with arrow and sign, no tax-surcharge
line, logo and fonts present, nothing within 64 px of the portrait card's side edges.

### 2.7 Buffer channels and a draft

```sh
pnpm buffer:channels                     # uses BUFFER_API_KEY from the shell (read in 2.4)
```

Expect two channels, `instagram` and `twitter`. Put their **Buffer channel ids** (the `id` field, not
`serviceId`) into `BUFFER_CHANNELS`, e.g. `{"twitter":"<id>","instagram":"<id>"}`, redeploy jobs, then:

```sh
pnpm deploy:jobs
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://$JOBS_HOST/admin/social/test"
```

Expect a **draft** (never published) in Buffer for each channel, with the card image visible. Delete the
drafts in Buffer. If the draft has no image or the call fails with "Failed to fetch image dimensions", see
Appendix D. Commit and push `BUFFER_CHANNELS`.

Then take the real Buffer key out of the Worker until Sunday (4.10):

```sh
( umask 077; jq -n '{BUFFER_API_KEY: "placeholder-shadow-mode"}' > "$MIG_DIR/tmp/one.json" ); wr_jobs secret bulk "$MIG_DIR/tmp/one.json"; shred -u "$MIG_DIR/tmp/one.json"
```

### 2.8 Status page, source health and the website on the shadow host

- [ ] `https://$WEB_SHADOW/estado` lists every source with a recent success.
- [ ] `/admin/health`: every blue primary (`ambito`, `dolarhoy`, `cronista`, `infodolar`) and `ambito_oficial` ok.
      Requests from Cloudflare's network were **never tested** during research (`sources.md` §7): a source
      that fails here but works from your machine is probably blocking datacenter traffic. See Appendix D.
- [ ] Site pages on `$WEB_SHADOW` render prices in the HTML (view source), Spanish and English.
- [ ] The page verification block of step 4.9 (item 3), run with `W=https://$WEB_SHADOW`: every line except
      the `www`, `http://` and `x-robots-tag` ones (the shadow host must send `noindex`) gives the result 4.9
      expects. `/privacy.html` must answer 200 with the unchanged text, not 301 or 307.
- [ ] `curl -sSI https://$WEB_SHADOW/ | grep -i cache-control` shows the page's own short caching (`ARCHITECTURE.md` §10: 60 s); record the exact value, 4.9 compares production with it.
- [ ] Nothing in the build is served under the legacy bundle prefixes that 4.9 exempts:
      `find apps/web/dist \( -path '*/scripts/*' -o -path '*/styles/*' -o -path '*/locale/*' -o -path '*/images/material-design/*' -o -path '*/bower_components/*' \) | head`
      prints nothing, and `curl -sS -o /dev/null -w '%{http_code}\n' https://$WEB_SHADOW/scripts/x.js` is 404.
- [ ] Analytics: in a browser on `$WEB_SHADOW`, the developer console shows no Content-Security-Policy error,
      and the page source (or the network tab) has the Web Analytics beacon (`static.cloudflareinsights.com/beacon.min.js`)
      or the GA4 tag if chosen. If edge injection is the mechanism and the shadow host does not get it, check
      again on production in 4.9.

---

## Phase 3 — Shadow period

v2 runs every 5 minutes inside the trading window (Mon–Fri 07:00–19:59 ART) next to legacy, with push and
social disabled. Legacy remains the only thing users see.

### 3.1 Daily checks (about 10 minutes, after 20:00 ART)

```sh
# v2 vs legacy, latest values
for h in https://api.bluelytics.com.ar https://$API_SHADOW; do
  curl -sS "$h/v2/latest" | jq -c --arg h "$h" '{h:$h, blue:[.blue.value_buy,.blue.value_sell], oficial:[.oficial.value_buy,.oficial.value_sell], last_update}'
done | tee -a "$MIG_DIR/parity/daily.jsonl"
# per-source success in the last 24 h
wr_api d1 execute bluelytics --remote --command "SELECT source, SUM(ok) AS ok, COUNT(*) AS runs FROM observations WHERE run_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') GROUP BY source ORDER BY source"
# what v2 would have alerted / posted
wr_api d1 execute bluelytics --remote --command "SELECT id, alert_at, sell, push_status FROM alerts ORDER BY id DESC LIMIT 5"
wr_api d1 execute bluelytics --remote --command "SELECT network, kind, event_key, status, sell, created_at FROM social_posts ORDER BY id DESC LIMIT 10"
# what legacy actually alerted; the query string bypasses the 2-hour edge copy (each query string is its own cache key)
curl -sS "https://api.bluelytics.com.ar/v2/alerts?ts=$(date +%s)"
```

- [ ] Run count close to 156 per trading day (13 hours × 12). Gaps: look at Cron Events in the dashboard.
- [ ] Every blue primary ok in most runs; `/estado` agrees.
- [ ] Blue difference v2 − legacy recorded. Expect a stable, explainable gap (La Nación no longer drags the
      value; `sources.md` §0) and **reset this record if the patched legacy scraper is deployed during the
      shadow period**, because the gap changes.
- [ ] v2 shadow alerts happen at roughly the moments legacy alerted (about one per trading day historically),
      plus possible opening-gap alerts legacy never sends.
- [ ] `dry_run` social rows appear when legacy posts, plus on Mondays (legacy never posts on Mondays). Each row
      is a post v2 would have sent: the cooldowns (X 15 min, Instagram 60 min) and the 0.75 % rule apply to the
      dry runs as they will to live posts, so expect at most one row per network per move. Keys end in `-dry`;
      an update key with `-after-<instant>` names the dry run it was compared with.
- [ ] Workers errors: dashboard Workers metrics / Workers Logs for all three Workers; `wr_jobs tail` during a run if something looks wrong.
- [ ] Workers Paid is active (Decisions list: the jobs Worker exceeds Free's 50 D1 queries per invocation and
      10 ms CPU). Browser Run under its daily allowance (dashboard).

The first time each of these happens, check it explicitly; it proves the flags are honoured with real data:

- [ ] First shadow alert row: `push_status` is `disabled` (or the implementation's other non-`sent` value, C4), and no notification arrived on a subscribed phone.
- [ ] First social row: `status = 'dry_run'`, `external_id` empty, and nothing new in Buffer's queue or sent list.
- [ ] `/admin/health` shows both flags off.

If any of these fails, set `"crons": []`, redeploy jobs, and fix before continuing.

### 3.2 Rehearse the switch mechanics on dead paths

This tests, on the real hostnames with their real zone rules, how Worker routes behave, without affecting any
path anyone uses. It also rehearses the rollback scripts exactly as 4.7 and 4.9 generate them.

**API host.** Add a second route to `apps/api/wrangler.jsonc`:

```jsonc
{ "pattern": "api.bluelytics.com.ar/__v2probe*", "zone_name": "bluelytics.com.ar" }
```

```sh
pnpm deploy:api
curl -sS -D - https://api.bluelytics.com.ar/__v2probe | head -20
curl -sS -D - -o /dev/null http://api.bluelytics.com.ar/__v2probe | head -5
```

Expect: the v2 404 JSON body with an `etag` and v2's `cache-control: public, max-age=60` (if you see
`max-age=7200`, a zone rule rewrites Worker responses' browser TTL: find and scope that rule before cutover,
otherwise the mobile app would cache `/v2/latest` for 2 hours); `http://` answers 301 to `https://`.

[TEST FIRST] Script-less exemption routes (used in 4.9). Cloudflare's routes documentation says that a route
with no Worker attached exempts a path from a broader route, and that the most specific pattern wins
(`cloudflare.md` §3c); nobody has tried it on this zone. Test it under the probe:

```sh
cfw "/zones/$CF_ZONE_ID/workers/routes" -X POST --json '{"pattern":"api.bluelytics.com.ar/__v2probe/legacy*"}' | jq -c '{success, id: .result.id}'
curl -sS -D - -o /dev/null https://api.bluelytics.com.ar/__v2probe/legacy/x | grep -iE '^HTTP|^etag'   # legacy: no etag
curl -sS -D - -o /dev/null https://api.bluelytics.com.ar/__v2probe/other | grep -iE '^HTTP|^etag'      # v2: etag
cfw "/zones/$CF_ZONE_ID/workers/routes/$(route_id 'api.bluelytics.com.ar/__v2probe/legacy*')" -X DELETE | jq .success
```

If the exempted path still shows an `etag`, script-less routes do not work as described: in 4.9 skip the
exemptions and accept that browsers holding the old `index.html` for up to 2 hours may show a broken page
until they reload.

Rollback script, from a fresh shell without the token, timed:

```sh
write_rollback "$MIG_DIR/ROLLBACK_PROBE.sh" "$(route_id 'api.bluelytics.com.ar/__v2probe*')"
time env -u CLOUDFLARE_API_TOKEN "$MIG_DIR/ROLLBACK_PROBE.sh"      # prompts for the deploy token; prints true
curl -sS -D - -o /dev/null https://api.bluelytics.com.ar/__v2probe | grep -iE '^HTTP|^etag'   # legacy 404 again, no etag
```

**Apex.** Add `{ "pattern": "bluelytics.com.ar/__v2probe*", "zone_name": "bluelytics.com.ar" }` to
`apps/web/wrangler.jsonc`, `pnpm deploy:web`, then compare the response headers on production and shadow:

```sh
diff <(curl -sS -D - -o /dev/null https://bluelytics.com.ar/__v2probe | grep -iE '^(cache-control|content-type):' | sort) \
     <(curl -sS -D - -o /dev/null https://$WEB_SHADOW/__v2probe     | grep -iE '^(cache-control|content-type):' | sort)
```

Expect no difference. A `max-age=7200` on the apex only means a zone rule rewrites the browser TTL of Worker
pages there; that would freeze live prices in browsers for 2 hours: find and scope that rule before cutover.

Finally remove both probe routes from the two `wrangler.jsonc` files, redeploy API and web (wrangler removes
routes no longer in the config), and confirm:

```sh
cf "/zones/$CF_ZONE_ID/workers/routes" | jq -c '.result[] | {pattern, script}'     # no __v2probe left
rm "$MIG_DIR/ROLLBACK_PROBE.sh"
```

### 3.3 Exit criteria (all must hold)

- [ ] At least 5 consecutive trading days, including a Monday and a Friday, with no unexplained failure. Holidays do not count.
- [ ] Every run of the trading window recorded, except documented Cloudflare cron misses.
- [ ] At least 3 blue voters fresh in at least 99 % of runs; no source failing for a whole day without a known cause.
- [ ] Parity (`pnpm parity -- --old https://api.bluelytics.com.ar --new https://$API_SHADOW --strict`) shows only the differences listed in 2.5.
- [ ] Website checks of 2.8 still pass on `$WEB_SHADOW`.
- [ ] Blue gap v2 − legacy understood and accepted (it is what consumers will see at the switch), and measured
      against both thresholds, using the latest Friday close of each side:
      `gap_alert = |v2_sell − legacy_last_alert_sell| / legacy_last_alert_sell` (alert threshold: more than 0.5 %) and
      `gap_post = |v2_sell − legacy_close_sell| / legacy_close_sell` (post threshold: 0.75 % or more).
- [ ] **Opening-push baseline decided** (used in 4.6). After 4.5 the newest alert row is legacy's, so Monday's
      first alert compares v2's price with legacy's last alert. With an empty 6-hour window the rule also needs
      the price strictly outside v2's own previous close (`ARCHITECTURE.md` §4), so the method gap alone does
      not fire; but any opening move away from v2's Friday close fires once `gap_alert` plus that move exceeds
      0.5 %, and the notification text (`+12.00 / +0.72%`) then includes the method gap. Choose:
      - **A, no baseline** (recommended when `gap_alert` is well under 0.5 %): Monday behaves like any day, the
        first delta is measured from legacy's last alert.
      - **B, baseline alert row** (recommended when `gap_alert` is near or above 0.5 %): 4.6 inserts one alert
        row with v2's Friday close. Trade-offs: it uses id legacy_last + 1 without a push, and `/v2/alerts`
        shows it as `current` once re-rendered, so from 4.6 on that endpoint no longer matches legacy's.
- [ ] Friday weekly `dry_run` row created for each network after 18:00 ART; card looks right.
- [ ] Rehearsals 2.3 and 3.2 done, including the rollback script from a fresh shell.
- [ ] Workers Paid in effect (Decisions list).
- [ ] New Firebase key validated with the local dry run below (it sends nothing to any device). If C10
      (`/admin/push/test`) exists, it is used on Sunday (4.10) against the deployed secret.
- [ ] Step 3.4 done at least one week before the planned cutover Saturday.

Local FCM key test (`dry_run=True` asks FCM to validate only). Run it outside the repo: save the new key file
from the password manager as `$MIG_DIR/tmp/fb.json` (mode 600), then:

```sh
python3 -m venv "$MIG_DIR/tmp/fcmtest" && "$MIG_DIR/tmp/fcmtest/bin/pip" install -q firebase-admin
"$MIG_DIR/tmp/fcmtest/bin/python" - "$MIG_DIR/tmp/fb.json" <<'EOF'
import sys, firebase_admin
from firebase_admin import credentials, messaging
firebase_admin.initialize_app(credentials.Certificate(sys.argv[1]))
msg = messaging.Message(topic="alertas-blue",
      notification=messaging.Notification(title="Subió el Dólar Blue", body="Venta: 1670.00 (+12.00 / +0.72%)"))
print(messaging.send(msg, dry_run=True))
EOF
shred -u "$MIG_DIR/tmp/fb.json"
```

Expect a message name like `projects/bluelytics-mobile/messages/…`. An auth error means the key is wrong or
belongs to another project. Keep the venv; Appendix D and 4.10 reuse it.

### 3.4 Announce the change before the switch

At least one week before the planned cutover Saturday:

- [ ] Fill in the planned date in `docs/DECISIONS.md` and publish its content on the current site or the
      repository README, and wherever API consumers read news (social accounts, the API page).
- [ ] State the `LEGACY_V1_BLUE_BUG` choice and the measured blue gap (3.3) in that text.
- [ ] Open an issue on each third-party binding that uses `/json/last_price` (`fedeisas/laravel-dolar-blue`,
      `matiu/dolar-blue`, `morrillo/currency_usd_update`) if you fix the `blue` entry, with the planned date.

---

## Phase 4 — Cutover

### 4.1 When

- Trading window (scraping): Mon–Fri 07:00–19:59 ART (UTC−3, no daylight saving) = 10:00–22:59 UTC. Legacy
  and v2 use the same window.
- Social windows: price-move posts Mon–Fri 10:00–18:59 ART; legacy weekly post Friday 18:00–20:59 ART; v2 weekly
  Friday from 18:00 ART.
- Push alerts only change inside the trading window.

So: **cut over on a Saturday**, after legacy's Friday weekly post has gone out. From Friday 21:00 ART until
Monday 07:00 ART no system writes data, alerts or posts (58 hours; 45 from a Saturday 10:00 start), so you can
verify and roll back with no market data diverging. Both systems also scrape on weekday holidays, so a Monday
holiday does not change the plan; only the first real price movement may come a day later.

Note that the legacy container still **starts** on weekends: its scrapers skip by weekday guards, but
`alerts.py` runs on every container run (`legacy-backend-spec.md` D.1). That is why a live legacy trigger is
visible on a Saturday as container runs, not as data.

### 4.2 Go / no-go (Saturday 09:30 ART)

- [ ] Phase 3 exit criteria met.
- [ ] Legacy weekly posts from Friday visible on X and Instagram.
- [ ] Phase 0 backup restored successfully; `$MIG_DIR/cf/dns.bind` present.
- [ ] Deploy token, `CF_OPS_TOKEN` and `ADMIN_TOKEN` in the shell; `CF_ZONE_ID` set (`source $MIG_DIR/session.sh`).
- [ ] VPN connected; `psql -Atc 'select 1'` works.
- [ ] The 0.7 trigger discovery re-run today with `AWS_PROFILE=bl-readonly` (the legacy scraper is being patched
      and redeployed, which can create a new task definition, rule, schedule or host after the inventory):
      the CloudTrail RunTask summary for the last 7 days, `aws events list-rules` on every bus,
      `aws scheduler list-schedules`, `aws ecs list-services` per cluster, and the crontab/timers on any host.
      Every caller is in `inventory.md`, with its disable command.
- [ ] Two to four uninterrupted hours today, one hour Sunday evening, and Monday 06:45–11:00 ART.

### 4.3 Saturday 10:00 — Freeze legacy and prove it stopped

Disable (do not delete) **every** legacy scraper trigger and the currency job trigger found in 4.2: the
EventBridge rule or Scheduler schedule (state DISABLED), the ECS scheduled task, or the crontab line (comment
it out). The scraper, alerts, social posts and weekly post all run inside that one container, so this stops all
of them. Record the moment:

```sh
echo "export FREEZE_UTC=$(date -u +%FT%TZ)" >> "$MIG_DIR/state.env"; . "$MIG_DIR/state.env"
# whichever applies:
aws events describe-rule --name <rule> [--event-bus-name <bus>] --query State     # → DISABLED
aws scheduler get-schedule --name <schedule> --group-name <group> --query State   # → DISABLED
aws ecs list-tasks --cluster <cluster> --desired-status RUNNING                    # none of the scraper
```

A disabled state is not proof. Wait 35 minutes (past two quarter-hour marks, plus CloudTrail's delivery delay),
then show that nothing started after `$FREEZE_UTC`:

```sh
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=RunTask \
  --start-time "$FREEZE_UTC" --query 'length(Events)'                               # → 0
aws logs describe-log-streams --log-group-name <scraper log group> --order-by LastEventTime --descending \
  --max-items 3 --query 'logStreams[].{stream:logStreamName,last:lastEventTimestamp}'   # last event before the freeze (ms epoch)
# on an EC2 host instead: newest scraper container created before the freeze
docker ps -a --format '{{.CreatedAt}} {{.Image}} {{.Status}}' | grep -i scraper | sort -r | head -3
```

If anything started after the freeze, a trigger is still live: find it before going on. The definitive
check comes on Monday (4.11), the first time a live legacy run would write data.

Then take a post-freeze backup (repeat 0.10 with a new `STAMP`) and keep it: it holds the final legacy alerts
and social rows. While it runs, continue with 4.4. Also record the latest legacy rows (used in 4.11 and 4.12):

```sh
psql -Atc "select 'dolar_values', max(scraped_at) from dolar_values
  union all select 'alertas_dolar', max(id)::text from alertas_dolar
  union all select 'actualizaciones_sociales', max(update_at)::text from actualizaciones_sociales
  union all select 'actualizaciones_sociales_weekly', max(sent_at)::text from actualizaciones_sociales_weekly" | tee "$MIG_DIR/backup/freeze-maxima.txt"
psql -Atc "select distinct on (social_network) social_network, update_at, value_buy, value_sell
           from actualizaciones_sociales order by social_network, update_at desc"
```

**Undo:** re-enable the trigger(s). **Clean until** Sunday 18:00, when the v2 flags go on (4.10); after that,
turn the v2 flags off first (rule at the top).

### 4.4 10:40 — Make the legacy API read fresh

The legacy API is edge-cached for about 2 hours. Purge it so the final sync reads the origin, not a stale copy:

```sh
cf "/zones/$CF_ZONE_ID/purge_cache" -X POST --json '{"hosts":["api.bluelytics.com.ar"]}' | jq .success
curl -sS -D - -o /dev/null https://api.bluelytics.com.ar/v2/evolution.json | grep -iE 'cf-cache-status|age:'
```

Expect `cf-cache-status: MISS` or `EXPIRED` on the first request (Tiered Cache can report EXPIRED). Purging is
harmless: the origin is still up.

### 4.5 10:45 — Final history sync

Goal: v2's history equals exactly what consumers saw from legacy, no shadow alert survives, and the next alert
id is legacy's last + 1. Use the commands exactly as rehearsed in 2.3.

```sh
wr_api d1 time-travel info bluelytics                  # note: undo point for this step
wr_api d1 execute bluelytics --remote --command "SELECT tipo, updated_at, buy, sell FROM latest_rates" | tee "$MIG_DIR/parity/latest-before.txt"
LEGACY_LAST=$(curl -sS "https://api.bluelytics.com.ar/v2/alerts?ts=$(date +%s)" | jq -er '.alert_id')
echo "export LEGACY_LAST=$LEGACY_LAST" >> "$MIG_DIR/state.env"; echo "pre-shadow $PRE_SHADOW_LAST, legacy now $LEGACY_LAST"
# every alert row goes: the backfill re-inserts legacy's last two with their own ids
wr_api d1 execute bluelytics --remote --command "DELETE FROM alerts"
pnpm backfill -- --from https://api.bluelytics.com.ar --since <first shadow day minus 3 days> --remote
wr_api d1 execute bluelytics --remote --command "UPDATE sqlite_sequence SET seq = $LEGACY_LAST WHERE name = 'alerts'"
```

If 2.2 showed that remote D1 refuses the `sqlite_sequence` update, skip it: when v2 had more shadow alerts than
legacy, the next id then skips a few numbers. That is cosmetic (the mobile app never reads `/v2/alerts`,
`legacy-mobile.md`); a reused id would not be.

Check:

```sh
wr_api d1 execute bluelytics --remote --command "SELECT id, alert_at, buy, sell, push_status FROM alerts ORDER BY id"     # exactly legacy's last two
wr_api d1 execute bluelytics --remote --command "SELECT seq FROM sqlite_sequence WHERE name='alerts'"                     # = $LEGACY_LAST
wr_api d1 execute bluelytics --remote --command "SELECT day, tipo, origin FROM daily_rates WHERE strftime('%w', day) IN ('0','6') AND origin = 'live'"   # empty
wr_api d1 execute bluelytics --remote --command "SELECT tipo, updated_at, buy, sell FROM latest_rates" | diff "$MIG_DIR/parity/latest-before.txt" -   # no difference (C8)
pnpm parity -- --old https://api.bluelytics.com.ar --new https://$API_SHADOW --strict | tee "$MIG_DIR/parity/cutover.txt"
```

Expect byte-identical `/v2/evolution.*`, `/v2/historical` and `/v2/alerts`; only the deliberate differences on
`/v2/latest`, `/json/last_price`, `currency.json` and headers (table in 2.5). Do not force a jobs run here: the
backfill re-renders the bodies (C8), and a forced run on a Saturday is only safe if C6 holds.

The API Worker keeps each past day of `/v2/historical` in memory for up to an hour, so a warm isolate can still
answer a shadow-period day with the pre-backfill row. If parity differs only on such a day, re-run it an hour
after the backfill (or `pnpm deploy:api`, which starts fresh isolates) before treating it as a failure.

If a weekend `live` row exists, or `latest_rates` changed, or parity differs elsewhere: restore the time-travel
point, find out why, and repeat; do not switch with a wrong history.

**Undo:** `wr_api d1 time-travel restore bluelytics --timestamp=<noted>`. **Clean until** the API switch (4.7).

### 4.6 11:05 — Push and social state

Nothing is sent yet; this only prepares state.

```sh
wr_api d1 execute bluelytics --remote --command "SELECT status, COUNT(*) FROM social_posts GROUP BY status"
wr_api d1 execute bluelytics --remote --command "SELECT tipo, buy, sell, updated_at FROM latest_rates WHERE tipo = 'blue'"
```

- [ ] No `pending` or `failed` rows. Failed posts are retried up to twice on later runs; a shadow-period row
      retried after enabling would publish an old price. Delete such rows
      (`DELETE FROM social_posts WHERE status IN ('pending','failed')`). `dry_run` rows stay as history; once
      `SOCIAL_ENABLED` is on they are not a baseline (C9), their keys end in `-dry`, and they are never retried,
      so they never block a later post.
- [ ] Social baseline, one `sent` row per network with **v2's** published blue (the `latest_rates` row above,
      which is what production serves from 4.7). Without it, the first post compares Monday's price with
      Friday's daily row, which after 4.5 is legacy's value, so a v2 − legacy gap of 0.75 % or more would post
      "subió" on X and Instagram on Monday purely because of the method change. Fill in `<buy>`, `<sell>` and
      `<updated_at>` from the query above:

      ```sh
      wr_api d1 execute bluelytics --remote --command "INSERT INTO social_posts (network, kind, event_key, created_at, sent_at, buy, sell, status, attempts) VALUES
        ('twitter',   'update', 'cutover-baseline', strftime('%Y-%m-%dT%H:%M:%fZ','now'), '<updated_at>', <buy>, <sell>, 'sent', 0),
        ('instagram', 'update', 'cutover-baseline', strftime('%Y-%m-%dT%H:%M:%fZ','now'), '<updated_at>', <buy>, <sell>, 'sent', 0)"
      wr_api d1 execute bluelytics --remote --command "SELECT network, kind, event_key, status, sent_at, sell FROM social_posts WHERE event_key = 'cutover-baseline'"
      ```

      The row has no `external_id`: it was never sent to Buffer. Use only the networks in `BUFFER_CHANNELS`.
- [ ] Alert baseline, only if you chose **B** in 3.3. `<alert_at>` is `latest_rates.updated_at` from the query
      above if it is later than legacy's last `alert_at`, otherwise legacy's `alert_at` plus one second:

      ```sh
      wr_api d1 execute bluelytics --remote --command "INSERT INTO alerts (id, alert_at, buy, sell, push_status) VALUES ($((LEGACY_LAST + 1)), '<alert_at>', <buy>, <sell>, 'baseline')"
      ```

      Then re-render the alerts body: if C6 holds, `POST /admin/run?force=1`; otherwise the first Monday run
      does it, and until then `/v2/alerts` still shows legacy's last alert.
- [ ] With A: no alert rows other than legacy's last two (4.5). With B: those plus the baseline row.

**Undo:** delete the inserted rows (`DELETE FROM social_posts WHERE event_key = 'cutover-baseline'`;
`DELETE FROM alerts WHERE push_status = 'baseline'`).

### 4.7 11:15 — Switch the API

Mechanism: a Worker route on the existing proxied `api` record. The DNS record and the legacy origin are not
touched, and deleting the route restores legacy immediately (`pulumi-cloudflare.md` §11.5). Add to the
`routes` of `apps/api/wrangler.jsonc`, keeping the shadow entry:

```jsonc
{ "pattern": "api.bluelytics.com.ar/*", "zone_name": "bluelytics.com.ar" }
```

```sh
pnpm deploy:api
write_rollback "$MIG_DIR/ROLLBACK_API.sh" "$(route_id 'api.bluelytics.com.ar/*')"     # must print the script; an error means stop
curl -sS -D - -o /dev/null https://api.bluelytics.com.ar/v2/latest | grep -iE '^etag|^cache-control'
```

Expect an `etag` header: legacy never sends one, so it proves v2 answered. Commit and push the route. Then run
the verification suite (4.8).

**Undo, before Sunday 18:00 (4.10):** run `$MIG_DIR/ROLLBACK_API.sh` (seconds), purge the `api` host (4.4
command), remove the route from `apps/api/wrangler.jsonc` and commit, so the next deploy does not re-add it.

**Undo, after 4.10:** first set both v2 flags to `"false"` and `pnpm deploy:jobs`. Then either keep v2 serving
the API (usually right: fix forward), or roll back the whole system with 4.12. Never roll back only the API
while v2 is pushing and posting: phones and social networks would get v2 values while the app and third
parties read frozen legacy data.

### 4.8 11:17 — API verification suite

```sh
A=https://api.bluelytics.com.ar
for p in / /v2/latest /v2/alerts /json/last_price /v2/evolution.json /v2/evolution.csv /data/json/currency.json \
         '/v2/evolution.json?days=5' '/v2/evolution.csv?days=3' '/v2/evolution.json?days=0' \
         '/v2/historical?day=2026-11-20' '/v2/historical?day=2026-11-21' '/v2/historical?day=2013-02-12' '/v2/historical?day=2024-1-5' \
         '/v2/latest?pretty' /nope; do
  printf '%-40s %s\n' "$p" "$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "$A$p")"
done
# mobile app contract (legacy-mobile.md §1.5): object, blue and oficial present, numeric rates; currency array
curl -sS $A/v2/latest | jq -e '(.blue.value_buy|type)=="number" and (.blue.value_sell|type)=="number" and (.oficial.value_buy|type)=="number" and (.oficial.value_sell|type)=="number"'
curl -sS $A/data/json/currency.json | jq -e 'type=="array" and all(.[]; (.code|type)=="string" and (.name|type)=="string" and (.value|type)=="number")'
# JSONP
curl -sS "$A/v2/latest?callback=cb" | head -c 3; echo; curl -sS "$A/v2/latest?callback=cb" | tail -c 3 | od -c | head -1
curl -sS -o /dev/null -w '%{http_code}\n' "$A/v2/latest?callback=alert(1)"          # 400 (new rule)
curl -sS "$A/json/last_price?callback=cb" | head -c 3; echo
# CORS, simple and preflight
curl -sS -D - -o /dev/null -H 'Origin: https://example.org' $A/v2/latest | grep -iE 'access-control-allow-origin|vary'
curl -sS -D - -o /dev/null -X OPTIONS -H 'Origin: https://example.org' -H 'Access-Control-Request-Method: GET' $A/v2/latest | grep -iE '^HTTP|access-control'
# HEAD, ETag/304, http→https, 405, browser caching
curl -sSI $A/v2/latest | head -1
E=$(curl -sS -D - -o /dev/null $A/v2/latest | awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r')
curl -sS -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $E" $A/v2/latest                      # 304
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://api.bluelytics.com.ar/v2/latest     # 301 https://…
curl -sS -o /dev/null -w '%{http_code}\n' -X POST $A/v2/latest                                       # 405
curl -sS -D - -o /dev/null $A/v2/latest | grep -i '^cache-control'                                   # public, max-age=30
pnpm parity -- --old https://$API_SHADOW --new $A --strict        # production host == shadow host now
```

Expect: 200 for the data paths with `application/json; charset=UTF-8` (CSV with its legacy type); `days=0` →
`null`; Saturday 2026-11-21 → Friday's values; 2013-02-12 → 404 `{"error":"Error: day not found"}`; `2024-1-5`
→ 404 parsing error; `/nope` → 404 legacy body; JSONP starts `cb(` and ends `);`; preflight `204` with
`access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE`; both `jq -e` print `true`; `/v2/latest` with
`max-age=30`, not 7200. Any failure on the mobile contract, CORS or caching lines: roll back (4.7 Undo) and fix.

### 4.9 11:45 — Watch, then switch the website

Watch the API Worker for 30–60 minutes: error rate in Workers metrics, request volume comparable to the 0.8
baseline for a Saturday, `wr_api tail` sample looks normal.

Website mechanism: the same kind of route on the existing proxied apex record (still pointing at S3).

1. Browsers may hold the old `index.html` for up to 2 hours and then request old bundles. Exempt the old
   bundle paths from the new route for one day with script-less routes (tested in 3.2; skip this item if that
   test failed). The more specific pattern wins, so creation order does not matter. 2.8 checked that `apps/web`
   serves nothing under these prefixes.

   ```sh
   for p in scripts styles locale images/material-design bower_components; do
     cfw "/zones/$CF_ZONE_ID/workers/routes" -X POST --json "{\"pattern\":\"bluelytics.com.ar/$p/*\"}" | jq -c '{success, id: .result.id}'
   done | tee "$MIG_DIR/cf/exemption-routes.jsonl"
   ```

2. Add `{ "pattern": "bluelytics.com.ar/*", "zone_name": "bluelytics.com.ar" }` to `apps/web/wrangler.jsonc`
   routes, then:

   ```sh
   pnpm deploy:web
   write_rollback "$MIG_DIR/ROLLBACK_WEB.sh" "$(route_id 'bluelytics.com.ar/*')"     # must print the script
   ```

   Commit and push the route.

3. Verify:

   ```sh
   W=https://bluelytics.com.ar
   for p in / /en /dolar-oficial /euro-blue /brecha /calculadora /historico /api /acerca /estado \
            /privacy.html /sitemap.xml /robots.txt /favicon.ico /images/logo.png /index.html /no-such-page; do
     printf '%-20s %s\n' "$p" "$(curl -sS -o /dev/null -w '%{http_code}' "$W$p")"
   done
   curl -sSI $W/ | grep -i x-robots-tag || echo "no x-robots-tag (correct for production)"
   curl -sSI $W/ | grep -i '^cache-control'                    # must equal the value recorded on $WEB_SHADOW in 2.8
   curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.bluelytics.com.ar/calculadora
   curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://bluelytics.com.ar/
   curl -sS $W/ | grep -c 'rel="canonical"'
   curl -sS $W/ | grep -cE 'cloudflareinsights|googletagmanager'    # analytics present (or injected; see below)
   ```

   Expect 200 on the pages, `/privacy.html` 200 with the unchanged policy text (it is the URL registered with
   the app stores), `/robots.txt` with a `Sitemap:` line, `/no-such-page` a real 404, `www` and `http` 301 to
   `https://bluelytics.com.ar/…`, and the page `cache-control` equal to the shadow host's. A `max-age=7200` on
   `/` is a rollback reason: browsers would show a frozen price for 2 hours. `/index.html` should 301 to `/`
   and the legacy image paths should still answer 200 (`legacy-frontend.md` §9.1); if either does not, note it
   as a follow-up, it is not a rollback reason. **A `noindex` header on production is a rollback reason** (it
   would de-index the site). In a browser: `https://bluelytics.com.ar/#!/calculator`, `/#/gap`,
   `/#!/evolution` land on the new pages; the developer console shows no CSP error and, in the network tab, a
   request to `cloudflareinsights.com` (or GA4 if chosen). Edge-injected beacons do not appear in `curl`
   output, so the browser check is the one that counts.

**Undo:** run `$MIG_DIR/ROLLBACK_WEB.sh`, purge the apex host, remove the route from `apps/web/wrangler.jsonc`
and commit. S3 serves again immediately. **Clean until** 6.4 changes the apex record; after that, see 6.4 Undo.

The exemption routes are removed on Sunday at 4.10 (step 5.6 describes it).

Cache: on routed paths the Worker runs before the zone cache, so stale edge copies of legacy responses are
not served; purging is not required for correctness. Purge the apex host anyway after removing the exemptions,
and purge the relevant host after any rollback. Browser and device caches already holding legacy responses
(up to 2 hours) cannot be purged and expire on their own.

### 4.10 Sunday 18:00 — Real secrets, then enable push and social

Checks first:

- [ ] Legacy is still stopped: repeat the 4.3 proof commands with `--start-time "$FREEZE_UTC"` (no RunTask, no
      new log streams or containers since the freeze).
- [ ] 4.6 state still holds (no `pending`/`failed` social rows; baseline rows present; alerts = legacy's last two,
      plus the baseline row if B).
- [ ] `/v2/latest` on production unchanged since Saturday except the daily currency refresh.

Put the real secrets into the jobs Worker (flags are still off). Export the new Firebase key from the password
manager as `$MIG_DIR/tmp/fb.json`, then:

```sh
read -rs BUFFER_API_KEY && export BUFFER_API_KEY
( umask 077
  jq -n --rawfile fb "$MIG_DIR/tmp/fb.json" --arg b "$BUFFER_API_KEY" '{FIREBASE_SERVICE_ACCOUNT_JSON: $fb, BUFFER_API_KEY: $b}' > "$MIG_DIR/tmp/secrets.json" )
jq -r '.FIREBASE_SERVICE_ACCOUNT_JSON | fromjson | .project_id, .private_key_id' "$MIG_DIR/tmp/secrets.json"   # bluelytics-mobile, the id from 0.3
wr_jobs secret bulk "$MIG_DIR/tmp/secrets.json"
shred -u "$MIG_DIR/tmp/secrets.json" "$MIG_DIR/tmp/fb.json"
```

Validate them as deployed:

```sh
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://$JOBS_HOST/admin/push/test"      # C10: validate_only, sends nothing
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://$JOBS_HOST/admin/social/test"    # drafts only; delete them in Buffer
```

The social test is a **hard gate** for `SOCIAL_ENABLED`: it sends the same `createPost` document as a live
post, and that document spreads `... on MutationError`, which only validates if Buffer's live schema still
declares `implements MutationError` on its payload types (the saved `buffer-schema.graphql` lost those
clauses and cannot prove it). Every network must come back with a draft id and appear in Buffer's drafts. A
GraphQL validation error (`Fragment cannot be spread here …`) means every live post would fail: leave
`SOCIAL_ENABLED` off and get the client fixed.

If C10 does not exist, this is a known gap: the deployed Firebase secret is first used by Monday's first real
alert. Re-run the 3.3 local test with the same key file before shredding it, and watch `push_status` closely in
4.11.

Remove the five exemption routes and purge the apex host:

```sh
for id in $(jq -r '.id' "$MIG_DIR/cf/exemption-routes.jsonl"); do cfw "/zones/$CF_ZONE_ID/workers/routes/$id" -X DELETE | jq -c .success; done
cf "/zones/$CF_ZONE_ID/purge_cache" -X POST --json '{"hosts":["bluelytics.com.ar"]}' | jq .success
```

Then set `PUSH_ENABLED` and `SOCIAL_ENABLED` to `"true"` in `apps/jobs/wrangler.jsonc` and deploy:

```sh
grep -nE '"(PUSH|SOCIAL)_ENABLED"' apps/jobs/wrangler.jsonc
pnpm deploy:jobs
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "https://$JOBS_HOST/admin/health" | jq .     # both flags on (C3)
```

Commit and push the flag change. Nothing is sent before Monday 07:00 ART (no runs inside the window until then).

**Undo:** set both back to `"false"` and `pnpm deploy:jobs` (about a minute), or `wr_jobs rollback` to the
previous version. A push or post already sent cannot be recalled; delete posts by hand in Buffer or on the network.

### 4.11 Monday — Watch the open and prove legacy is silent

Expected behaviour, given the rules in `packages/core` and the 4.6 state:

- Push: the first alert fires when the blue sell moves more than 0.5 % from the newest alert row (legacy's last
  alert with A, v2's Friday close with B) and is strictly outside v2's previous close. Its id is legacy's last + 1
  (+ 2 with B). With A, the text's delta includes the v2 − legacy method gap.
- Social: no post before 10:00 ART; then the first post per network when the sell is at least 0.75 % away from
  the `cutover-baseline` value and differs from Friday's daily close.

Timeline:

- 06:45 ART: `/admin/health` OK; you are at the terminal; VPN connected.
- 07:00–07:15: first run. `/v2/latest` `last_update` moves; observations for every source; daily rows for
  today created. After any alert: `SELECT id, alert_at, sell, push_status FROM alerts ORDER BY id DESC LIMIT 2`:
  `push_status` must say sent, and the id must be the one expected above.
- **07:05 and 07:20 ART: legacy is silent.** This is the first moment a live legacy trigger would write data.
  Over the VPN:

  ```sh
  psql -Atc "select max(scraped_at), count(*) filter (where scraped_at > '$FREEZE_UTC') from dolar_values"
  psql -Atc "select max(id), count(*) filter (where alert_at > '$FREEZE_UTC') from alertas_dolar"
  ```

  Expect the maxima recorded in `freeze-maxima.txt` and two zeros. At 10:20 ART also check
  `select count(*) from actualizaciones_sociales where update_at > '$FREEZE_UTC'` → 0, and Buffer's sent list for
  posts made with the legacy token. **If any row exists, set both v2 flags to `"false"` and deploy at once**
  (rule at the top), then find and disable the remaining legacy trigger.
- From 10:00: first possible social posts; check Buffer's sent list and `social_posts` (`status = 'sent'`, `external_id` set).
- If something misbehaves: flags off first (4.10 Undo), then investigate.

### 4.12 Full rollback (v2 → legacy) after Sunday 18:00

Possible while the legacy stack exists (until Phase 6), but no longer free: the two histories diverge. The
order matters: legacy must be running and fresh before traffic goes back to it, otherwise the zone caches its
stale responses for 2 hours (every path except `/v2/latest`, 404s included; `legacy-backend-spec.md` A.0.8).

1. v2 flags to `"false"`, `pnpm deploy:jobs`. v2 keeps serving the API and the site meanwhile.
2. Copy into legacy, over the VPN, what v2 sent since the freeze, so legacy neither reuses alert ids nor re-posts
   the same move nor re-posts the weekly chart. Read v2's rows:

   ```sh
   wr_api d1 execute bluelytics --remote --command "SELECT id, alert_at, buy, sell, push_status FROM alerts WHERE id > $LEGACY_LAST AND push_status IS NOT 'baseline' ORDER BY id"
   wr_api d1 execute bluelytics --remote --command "SELECT network, kind, sent_at, buy, sell FROM social_posts WHERE status = 'sent' AND external_id IS NOT NULL ORDER BY sent_at"
   ```

   and insert them (timestamps in UTC without zone, values as `numeric`):

   ```sql
   INSERT INTO alertas_dolar (id, alert_at, value_buy, value_sell) VALUES (…);
   SELECT setval(pg_get_serial_sequence('alertas_dolar','id'), (SELECT max(id) FROM alertas_dolar));
   INSERT INTO actualizaciones_sociales (social_network, update_at, value_buy, value_sell) VALUES (…);   -- kind = 'update'
   INSERT INTO actualizaciones_sociales_weekly (social_network, sent_at) VALUES (…);                     -- kind = 'weekly'
   ```

   Copy every v2 alert, including ones whose push failed: they used up those ids. If you chose B, the baseline
   alert row (`push_status = 'baseline'`) is not copied.
3. Re-enable the legacy trigger(s).
4. Wait for one legacy run that writes data: inside the trading window, the next quarter-hour. Check
   `psql -Atc "select max(scraped_at) from dolar_values"` moved past the re-enable time. Outside the trading
   window legacy writes nothing until the next morning: keep v2 serving (flags off) and do steps 5–6 after
   legacy's first run of the next window.
5. Delete the routes (`$MIG_DIR/ROLLBACK_API.sh`, `$MIG_DIR/ROLLBACK_WEB.sh`), remove them from both
   `wrangler.jsonc` files and commit, and purge both hosts:
   `cf "/zones/$CF_ZONE_ID/purge_cache" -X POST --json '{"hosts":["api.bluelytics.com.ar","bluelytics.com.ar"]}'`.
6. Purge both hosts again after the next legacy run (15 minutes later).
7. Accept: legacy has no samples for the days v2 ran, so those days are missing from legacy's
   `/v2/evolution.*` and `/v2/historical`, which v2 had served.

---

## Phase 5 — After cutover

### 5.1 48-hour watch list

- [ ] Every 5-minute run inside the window recorded; no source failing for more than an hour without an `OPS_WEBHOOK_URL` message.
- [ ] Workers error rate near zero for all three Workers; no 1027 (Free daily limit) or 1103 (spending limit) errors.
- [ ] API request volume matches the pre-cutover baseline (a large drop means some client is failing; a large rise means a cache stopped working).
- [ ] Pushes: id sequence continuous, `push_status` sent, frequency in line with the shadow observation.
- [ ] Posts: at most one per network per move; no duplicates; images render on X and Instagram.
- [ ] Daily rows for Monday and Tuesday equal the last published value of each day (new close rule).
- [ ] Web Analytics (and GA4 if chosen) shows visits for the new site.
- [ ] The deployed configuration matches the pushed repository: `git status --short apps/*/wrangler.jsonc` is
      clean and `git log origin/main -1` contains the 4.10 flag change; the routes listed by
      `cf "/zones/$CF_ZONE_ID/workers/routes" | jq -r '.result[].pattern'` are exactly the patterns in the three
      `wrangler.jsonc` files; `/admin/health` shows both flags on.

### 5.2 Search Console and Bing

- [x] Google Search Console property verified (2026-11-23). Bing Webmaster Tools: not yet (it can import from Search Console).
- [x] Submitted `https://bluelytics.com.ar/sitemap.xml` to Google (2026-11-23). Bing: not yet.
- [ ] URL Inspection on `/` and on one `/historico/…` day page; request indexing.
- [ ] Old hash URLs (`/#!/calculator` etc.) need nothing: Google treats them as `/`, so their links already count for the home page (`astro-seo.md` §9). The client shim forwards human visitors.
- [ ] Keep `www` → apex and `http` → `https` 301s permanently; expect a few weeks of ranking fluctuation.
- [ ] Optional: IndexNow key file and pings (`astro-seo.md` §8.5).

### 5.3 Buffer

- [ ] First real price-move post per network: visible in Buffer's sent list and on the network, caption accents correct, image correct.
- [ ] First Friday after cutover, from 18:00 ART: one weekly post per network.
- [ ] Any `failed` row: read `error`, see Appendix D.

### 5.4 Mobile app

- [ ] If you have the app installed and subscribed to alerts: the first alert arrives with the legacy title/body format (`Subió el Dólar Blue` / `Venta: 1670.00 (+12.00 / +0.72%)`).
- [ ] Pull-to-refresh on the value screen shows the new values; the calculator loads currencies (values now current).
- [ ] Without a device: rely on `push_status` in D1. iOS delivery depends on APNs credentials in Firebase, whose status is unknown and unchanged by this migration.

### 5.5 Announcement: actual date

- [ ] Replace the planned date in `docs/DECISIONS.md` with the actual cutover date and update the places where
      3.4 published it.
- [ ] Optional: one social post explaining the new source set and the step in the blue value.

### 5.6 Legacy bundle exemptions

Removed on Sunday at 4.10. If that was skipped, do it now with the same commands and purge the apex host.

### 5.7 Shadow hostnames

Keep them only if you want a permanent staging host. Otherwise remove their entries from the three
`wrangler.jsonc` files, redeploy, commit, then confirm nothing is left:

```sh
cf "/accounts/$CF_ACCOUNT_ID/workers/domains" | jq '.result[] | {id, hostname, service}'
dig +short $API_SHADOW $WEB_SHADOW
```

If a custom domain survives the redeploy, delete it in the Worker's domain settings or with
`cfw "/accounts/$CF_ACCOUNT_ID/workers/domains/<id>" -X DELETE`. The admin host stays.

### 5.8 Monitoring from now on

Legacy emailed the owner (SNS) when a post failed. After the watch, v2 needs its own alarms:

- [ ] Workers Issues automation (dashboard → Workers → Issues → automations; free, `cloudflare.md` §10) to your
      email or webhook, on first occurrence, for all three Workers.
- [ ] An external uptime monitor on `https://api.bluelytics.com.ar/v2/latest` and `https://bluelytics.com.ar/`.
- [ ] `OPS_WEBHOOK_URL` set, if you decided to (source-health messages, `ARCHITECTURE.md` §7).
- [ ] Known gaps, to raise with the implementation: "cron never ran" is detectable only by an external
      heartbeat the jobs Worker pings (`cloudflare.md` §10), which `ARCHITECTURE.md` does not include; and
      failed posts and failed pushes are not sent to `OPS_WEBHOOK_URL` (it covers source health only). Until
      they exist, look at `/estado` and at `failed` rows in `social_posts` and `alerts` at least weekly.

### 5.9 Routine backups

D1 becomes the only copy of everything after cutover once Phase 6 deletes legacy. Time Travel covers 30 days
on Paid (`cloudflare.md` §4); Pulumi `protect` only stops Pulumi destroys.

- [ ] Monthly, on a weekend (the export blocks the database while it runs, `cloudflare.md` §4):
      `wr_api d1 export bluelytics --remote --output "$HOME/bluelytics-backups/d1-$(date -u +%Y%m%d).sql"`,
      then encrypt it and keep it in the two backup places of 0.10.
- [ ] Self-managed Pulumi backend: back up the state directory after every `pnpm infra:up` (1.3 command).

---

## Phase 6 — Taking the old system down

Use the `bl-admin` AWS profile for the changes in this phase (`export AWS_PROFILE=bl-admin`) and `bl-readonly`
for the checks.

### 6.0 Gate

- [ ] Stability period elapsed (default: 14 days and 10 trading days since cutover).
- [ ] No open v2 incident; no rollback in that period.
- [ ] You accept that after step 6.8 there is no way back to legacy.
- [ ] D1 export taken on a weekend and stored in two places:
      `STAMP=$(date -u +%Y%m%dT%H%MZ); wr_api d1 export bluelytics --remote --output "$MIG_DIR/backup/d1-$STAMP.sql"`.

Order: replace what only exists on AWS, move traffic off the old origins, prove nothing uses them, stop
compute, export and verify data, snapshot, delete compute, delete data last, then secrets, repositories and
local files.

### 6.1 Final database export

The database has been frozen since cutover. Repeat 0.10 (dump, counts, CSVs, checksums, **restore test**).

- [ ] Counts equal the post-freeze backup from 4.3.
- [ ] Two copies stored; checksums verified in both places.

### 6.2 Archive the S3 buckets

```sh
aws s3 sync s3://bluelytics.com.ar "$MIG_DIR/backup/s3-site/"                 # read-only on the bucket
aws s3 ls --recursive --summarize s3://bluelytics.com.ar | tail -2             # compare object count and size
aws s3api get-bucket-website --bucket <www redirect bucket, if any> > "$MIG_DIR/aws/www-bucket-website.json"
```

The post-image bucket holds only generated post images; X and Instagram keep their own copies of published
images (inferred, not verified), so archiving it is optional.

### 6.3 Replace the `www` redirect, if it lives on AWS

Do this before any DNS record changes. If 0.6 found that `www` → apex is a Cloudflare rule, skip to the last
check. If it is an S3 redirect bucket (the `www` record is a proxied CNAME to an `s3-website` endpoint):

1. Create a Single Redirect in the dashboard (Rules → Redirect Rules, template "Redirect from WWW to root"):
   hostname equals `www.bluelytics.com.ar`, 301, target `https://bluelytics.com.ar` with the path preserved and
   the query string kept. A redirect rule runs at the edge before the origin is contacted, and needs the
   proxied `www` record that already exists (`pulumi-cloudflare.md` §8.3).
2. Verify on both schemes, while the S3 bucket still exists:

   ```sh
   curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.bluelytics.com.ar/calculadora?x=1   # 301 https://bluelytics.com.ar/calculadora?x=1
   curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://www.bluelytics.com.ar/privacy.html
   ```

3. Edit the `www` record **in place** (same type, no gap) to point away from AWS: CNAME content
   `bluelytics.com.ar`, proxied. Repeat the two checks.
4. Check the record through the API, not with `dig` (a proxied record always resolves to Cloudflare addresses):
   `cf "/zones/$CF_ZONE_ID/dns_records?name=www.bluelytics.com.ar" | jq -c '.result[] | {type, content, proxied}'`.

The rule is imported into Pulumi with the others in 6.6. **Undo:** restore the `www` record from `dns.bind` and
delete the redirect rule.

### 6.4 Move the apex and the API off the old origins

While the legacy origins still exist (so this is still reversible from `dns.bind`). Both hostnames keep their
Worker routes; only the DNS record behind each changes to the documented originless placeholder, proxied
(`A 192.0.2.0` or `AAAA 100::`, `cloudflare.md` §9). No custom domain is involved, so no wrangler DNS takeover.

- If the record is already `A`/`AAAA`, edit its content in place: no gap.
- If it is a `CNAME` (expected for the apex on S3), a type change means delete + create, which leaves a short
  window with no record. Resolvers that ask during that window may cache the negative answer for up to the
  zone's negative-caching TTL (last field of the SOA record printed in 0.6). Do it at a quiet hour (Saturday
  night), with both calls back to back.

[TEST FIRST] the delete + create, on a throwaway hostname, with the Pulumi token (it has DNS Edit):

```sh
read -rs CF_DNS_TOKEN && export CF_DNS_TOKEN
D="https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records"
curl -fsS -H "Authorization: Bearer $CF_DNS_TOKEN" "$D" --json '{"type":"CNAME","name":"cnametest.bluelytics.com.ar","content":"bluelytics.com.ar","proxied":true,"ttl":1}' | jq -c '{success, id: .result.id}'
( for i in $(seq 1 40); do printf '%s %s\n' "$(date +%T.%N | cut -c1-12)" "$(dig +short @1.1.1.1 cnametest.bluelytics.com.ar A | head -1)"; sleep 0.25; done ) &
swap() {   # swap <name>: replace its CNAME by a proxied AAAA 100::
  local id; id=$(cf "/zones/$CF_ZONE_ID/dns_records?name=$1&type=CNAME" | jq -er '.result | if length == 1 then .[0].id else error("no single CNAME") end') || return 1
  curl -fsS -X DELETE -H "Authorization: Bearer $CF_DNS_TOKEN" "$D/$id" | jq -c .success &&
  curl -fsS -H "Authorization: Bearer $CF_DNS_TOKEN" "$D" --json "{\"type\":\"AAAA\",\"name\":\"$1\",\"content\":\"100::\",\"proxied\":true,\"ttl\":1}" | jq -c '{success, id: .result.id}'
}
sleep 3; swap cnametest.bluelytics.com.ar; wait
```

Expect both calls to succeed and the address column to stay filled (an empty line is the gap). Delete the test
record afterwards (`cf "/zones/$CF_ZONE_ID/dns_records?name=cnametest.bluelytics.com.ar"` gives its id; `DELETE`
with `CF_DNS_TOKEN`).

Then, for real:

- **Apex** (`bluelytics.com.ar`): `swap bluelytics.com.ar` if it is a CNAME, or an in-place edit to `A 192.0.2.0`
  if it is an `A` record. The Worker route `bluelytics.com.ar/*` keeps serving every path.
- **API** (`api.bluelytics.com.ar`): the same. Keep the route (it keeps Phase 7 possible).
- `www` was handled in 6.3. **Everything else in `dns.bind` that points at AWS** (an ELB, an EC2 IP, an S3
  endpoint, a VPN host): delete it. A DNS name left pointing at a deleted S3 bucket or released IP can be taken
  over by whoever creates that resource next.

Verify: the 4.8 suite and the 4.9 checks again, and the record contents through the API:

```sh
for n in bluelytics.com.ar www.bluelytics.com.ar api.bluelytics.com.ar; do cf "/zones/$CF_ZONE_ID/dns_records?name=$n" | jq -c '.result[] | {name, type, content, proxied}'; done
```

Expect no content pointing at AWS. Commit nothing here (DNS is not in the repo), but note the new records in
`$MIG_DIR/cf/`.

**Undo:** recreate the original record of each hostname from `$MIG_DIR/cf/dns.bind` (same type, target, proxied),
deleting the placeholder first; the routes are unchanged. **Clean until** 6.8 deletes the origins.

### 6.5 Confirm nothing still calls the old origins

Wait at least 48 hours after 6.4, then:

- [ ] Legacy API logs (CloudWatch log group, or `docker logs` on the host): no requests since 6.4. Any request
      now comes from a client calling the origin directly, bypassing Cloudflare; look at its user agent and decide.
- [ ] Load balancer `RequestCount` (if 0.7 found one) or instance network-in: flat.
- [ ] S3 site bucket: request metrics or access logs if enabled (`get-bucket-logging` in 0.7); otherwise the
      S3 request line of the bill for the period.
- [ ] Cloudflare: Worker request counts for the API and web Workers match the zone's request volume for those hosts.
- [ ] `http` → `https` is a zone setting, not an origin feature (0.6); `curl -sSI http://bluelytics.com.ar/` still 301.

### 6.6 Take over the zone rules in Pulumi (optional now, required for Phase 7)

The legacy cache rules for the API host no longer affect anything (the Worker answers before the cache) but
they are still in the zone. Either delete them in the dashboard, or, to have Pulumi manage the zone: copy every
rule you want to keep (including the `www` redirect of 6.3) into the Pulumi program, import the existing
entry-point rulesets, and confirm with `pnpm infra:preview` that the import shows **no** change to `rules`
before setting `manageRulesets=true` and running `pnpm infra:up` (`pulumi-cloudflare.md` §8.1: import does not
preserve rules that are not in the program). Page Rules are not managed by Pulumi here; delete the legacy cache
ones by hand.

### 6.7 Stop compute (reversible)

- [ ] Save the definitions of every legacy trigger to `$MIG_DIR/aws/` so they can be recreated: for each rule
      `aws events describe-rule --name <r>` and `aws events list-targets-by-rule --rule <r>`; for each schedule
      `aws scheduler get-schedule --name <s> --group-name <g>`; a copy of each crontab, masked as in 0.7.
      They stay disabled; they are deleted in 6.8.
- [ ] API: scale the ECS service to 0, or stop the container, or **stop** (not terminate) the instance.
- [ ] Wait 48 hours; watch Cloudflare analytics and your inbox for anything that broke.

**Undo:** start or scale up again.

### 6.8 Snapshot, then delete compute and data

In this order:

- [ ] RDS: delete with a **final snapshot** (`aws rds delete-db-instance --db-instance-identifier <id> --final-db-snapshot-identifier bluelytics-final-<date>`;
      for an Aurora cluster, the cluster equivalent). Then delete retained automated backups
      (`aws rds delete-db-instance-automated-backup --dbi-resource-id <id>`). For Postgres on EC2 or Lightsail,
      create a snapshot of its volume(s) or database first.
- [ ] EBS snapshots of any instance you are about to terminate (they may contain the legacy `.env` and keys:
      treat the snapshots as secret, and delete them after your retention period, e.g. 90 days).
- [ ] Terminate the API/scraper host(s) and the VPN host; release Elastic IPs; delete the Client VPN endpoint
      (disassociate its target networks first), VPC endpoints, unattached volumes, load balancers, NAT gateways,
      security groups and a dedicated VPC if one exists. Cancel the OpenVPN Marketplace subscription if there is one.
- [ ] ECS: delete services, the triggers saved in 6.7 (EventBridge rules after removing their targets,
      Scheduler schedules, crontab lines), task definitions (deregister), cluster.
- [ ] ECR: the images contain the Firebase Admin key (`git-audit.md` §9 item 3); do not keep them.
      `aws ecr delete-repository --repository-name bluelytics_scraper --force` and the same for `bluelytics_api`.
- [ ] Secrets Manager secrets and SSM parameters found in 0.7 (they hold the Postgres password), after the RDS
      final snapshot exists: `aws secretsmanager delete-secret --secret-id <name> --recovery-window-in-days 7`,
      `aws ssm delete-parameter --name <name>`.
- [ ] S3, after 6.2, 6.3 and 6.4: for each legacy bucket (site, `www` redirect, post images), check
      `aws s3api get-bucket-versioning --bucket <b>`; empty it (console → bucket → **Empty** removes every object
      version; `aws s3 rm --recursive` does not remove old versions). Then, rather than deleting the bucket,
      which releases its globally unique name to anyone: `aws s3api delete-bucket-website --bucket <b>` and
      `aws s3api put-public-access-block --bucket <b> --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`.
      An empty bucket costs nothing. If you later close the AWS account the names are released anyway; accept
      that only after checking that no DNS record (6.4) and no live page points at the S3 URLs.
- [ ] SNS: delete the posting-failure topic and its subscription.
- [ ] CloudWatch log groups of the legacy services.
- [ ] IAM roles used only by the deleted tasks, schedules and instances.
- [ ] KMS customer keys used only by legacy: schedule deletion (`aws kms schedule-key-deletion --key-id <id> --pending-window-in-days 30`)
      **only after** every snapshot encrypted with that key is deleted; a deleted key makes its snapshots unrestorable.
- [ ] AWS Backup vaults: delete their recovery points, then the vault, unless you keep them as your snapshot.
- [ ] Route 53 hosted zones, ACM certificates, or anything else 0.7 found that only served legacy.
- [ ] Reserved instances and Savings Plans cannot be cancelled; note their end dates (they bill until then).

### 6.9 AWS bill to zero

- [ ] One week after 6.8: Billing → Bills (current month, by service and region) shows only snapshot storage you chose to keep.
- [ ] Re-run the 0.7 commands and the region loop with `bl-readonly`; everything empty except what you kept on purpose.
      Re-run the Cost Explorer `USAGE_TYPE` query: no compute, VPN, IPv4 or NAT usage left.
- [ ] Next invoice: about zero (or the retained snapshots). If the account has no other use, close it after
      that invoice and after deleting the snapshots, once you no longer need them.

### 6.10 Retire legacy credentials in other services

- [ ] Buffer: revoke the legacy v1 access token / its developer app (Buffer stays; v2 uses the new key).
- [ ] Firebase: delete the **old** service-account key in `bluelytics-mobile` (keep the one whose
      `private_key_id` you recorded in 0.3).

### 6.11 Secret rotation checklist (adapted from `docs/legacy/git-audit.md` §9)

| # | Credential | Action now |
|---|---|---|
| 1 | AWS IAM access key in the legacy `.env` (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`), plus `~/.aws/credentials` and `~/.s3cfg` | After 6.9: check CloudTrail / "last used", then delete the legacy IAM user's keys and the user. Remove the local credential files' legacy entries; keep the `bl-readonly`/`bl-admin` profiles only while the account stays open, and delete their keys when it closes. |
| 2 | Postgres credentials (`PG_*`) | Die with the database. If the same password is used anywhere else, change it there. |
| 3 | Firebase Admin key (legacy file, ECR image layers, local Docker caches) | Old key deleted in 6.10; ECR deleted in 6.8; local images in 6.13. |
| 4 | OpenVPN PKI (`bluelytics_vpn/`) | VPN host or endpoint deleted in 6.8; delete the local files and the client profile (6.13). |
| 5 | Android upload-keystore passwords (heap dump in the local mobile `.git`) | Purge locally (6.13). If that `.git` was ever backed up or synced, change the passwords (`keytool -storepasswd`, `keytool -keypasswd`) or request an upload-key reset in Play Console. |
| 6 | Buffer legacy token, profile ids | Revoked in 6.10. |
| 7 | Meta app credentials (`bluescraper/test.py`) | Not used by v2: reset the App Secret or delete the app at developers.facebook.com. |
| 8 | Open Exchange Rates App ID (`OPENEX_API_KEY`) | Not used by v2: delete it in the openexchangerates.org account. |
| 9 | Firebase client API key (public by design, tracked in the mobile app) | Restricted in step 1.8; confirm the restriction is still in place. |
| 10 | Cloudflare ops token | Delete it. Keep the Pulumi and deploy tokens in the password manager; rotate any that was ever pasted somewhere it should not be. |

### 6.12 Archive the legacy GitHub repositories

Repositories: `Bluelytics/bluelytics_api`, `Bluelytics/bluelytics_frontend`, `Bluelytics/bluescraper`,
`sicarul/blueimg`, `sicarul/bluelytics_mobile_v3` (private). For each: add a README line pointing to the v2
repository (GitHub web editor, or a fresh clone in a temporary directory, not the legacy working directory),
then:

```sh
gh repo archive <owner>/<repo> --yes
```

Archiving makes a repository read-only; do the README change first. The legacy scraper patch that was in
progress at the time of writing should be merged or abandoned before archiving `bluescraper`.

### 6.13 Clean the local legacy working directories

These hold live credentials (`bluescraper/.env`, `bluescraper/test.py`,
`bluescraper/bluelytics-mobile-firebase-adminsdk.json`, all of `bluelytics_vpn/`) and a 436 MB heap dump with
keystore passwords in `bluelytics_mobile_v3/.git` (`git-audit.md` §1, §5, §6). Before deleting:

- [ ] The v2 repository is pushed (every commit, including the `wrangler.jsonc` changes of Phase 4) and contains the legacy imports (`git log --oneline | grep 'legacy: import'` shows all five).
- [ ] The database backups (6.1), the D1 export (6.0) and the S3 archive (6.2) exist in two places.
- [ ] Rotation (6.10, 6.11) done, so the files on disk are no longer live credentials.

Then delete, by explicit path (never `rm -rf` the parent `~/dev/bluelytics`, which also contains `bluelytics_v2`):

```sh
cd ~/dev/bluelytics
rm -rf bluescraper bluelytics_api bluelytics_frontend bluelytics_mobile_v3 blueimg bluelytics_database bluelytics_notifiy bluelytics_vpn
docker image ls | grep -i bluelytics          # remove each: docker image rm <id>; then: docker builder prune
```

Also remove:

- [ ] The Postgres line from `~/.pgpass` (and the file if it holds nothing else).
- [ ] The bluelytics profile from your OpenVPN client.
- [ ] `$MIG_DIR`: archive it encrypted to the two backup places (`tar -C ~ -cz bluelytics-migration | gpg --symmetric -o bluelytics-migration.tgz.gpg`; it holds dumps, the DNS export and the inventory), check the archive opens, then delete the directory. The rollback scripts in it are useless from 6.8 on.

On SSDs and in synced folders, deletion does not guarantee the data is gone; rotation is what makes it harmless.
Check backups and sync tools (Time Machine, Dropbox, etc.) for copies of these directories.

---

## Phase 7 — Optional: static-first API

What it is: the jobs Worker also writes each fixed API body to R2; the CDN serves the six fixed paths, when
requested without a query string, from R2 with no Worker request; everything else (query strings,
`/v2/historical`, unknown paths) still reaches the API Worker (`ARCHITECTURE.md` D5, §6; `infra/README.md`).
Worth it only when API traffic makes Worker requests cost real money (above 10M/month on Paid; step 0.8).

### 7.1 Prerequisites

- [ ] Phase 6 step 6.6 done (`manageRulesets=true`, zone rules owned by Pulumi).
- [ ] `api` still served by a Worker **route** on a proxied record (not a custom domain).
- [ ] Pulumi token has Zone Cloud Connector Write; a new token with only zone **Cache Purge**, stored in the
      password manager and as jobs secret `CLOUDFLARE_PURGE_TOKEN` (`wr_jobs secret put CLOUDFLARE_PURGE_TOKEN`).
      The ops token no longer exists (6.11); manual purges in this phase use this token.
- [ ] Jobs vars `CLOUDFLARE_ZONE_ID` and `API_HOSTNAME` known: `$CF_ZONE_ID` and `api.bluelytics.com.ar`
      (the purge target). Without the zone id every static-first run fails before copying anything.

### 7.2 Live tests first [TEST FIRST]

On a test hostname or test path, never on the live paths. From `cloudflare.md` §14; record each answer:

- [ ] Edge TTL floor on this zone's plan versus a short origin `max-age` (tests 1, 10, 12): does a Cache Rule produce `HIT` for extensionless JSON at all?
- [ ] Worker route precedence on the same hostname as the Cloud Connector / R2 setup (tests 2, 4).
- [ ] URL rewrite to an R2 key and the cache key it produces (test 3), if the rewrite is used.
- [ ] R2 404 body and status (test 5): it cannot reproduce the legacy JSON error body, so keep `/v2/historical` on the Worker.
- [ ] Purge latency, and which host/prefix form a purge must name behind Cloud Connector (tests 7, 11).
- [ ] CORS preflight answered like legacy (`204`, `access-control-allow-origin: *`) (test 13).
- [ ] Browser TTL: the cache rule sets an explicit short `browser_ttl`; without it the zone default (4 hours) would be sent to apps and browsers.

### 7.3 Enable

1. In `apps/jobs/wrangler.jsonc` → `vars`, set `CLOUDFLARE_ZONE_ID` to `$CF_ZONE_ID`, check `API_HOSTNAME` is
   `"api.bluelytics.com.ar"`, and set `API_MODE` to `"static-first"`. `pnpm deploy:jobs`, then
   `/admin/health` must show `"staticFirstMissing": []` (anything listed there is still unset). Force a run
   inside the trading window; its report must have no `static-api` error and `staticApi.purged: true`, and
   every fixed body must exist in R2 under `api/…` with the right content type.
2. `pulumi config set bluelytics:apiMode static-first` and `pnpm infra:preview`. Expect exactly the rules
   `infra/README.md` lists for static-first: the `transform-rules` URL rewrite `api_static_r2_key` (path →
   `/api<path>`, the R2 key), the Cloud Connector rule, the two cache rules `api_static_browser_30s` and
   `api_static_browser_300s` (2 h edge TTL, browser 30 s / 300 s), and the `response-header-rules` CORS
   transform `api_static_cors`. Nothing else may change. Then `pnpm infra:up`.
3. Keep the `api.bluelytics.com.ar/*` Worker route: requests with a query string and `/v2/historical` need it.
   Only if live test 7.2 showed that a Worker route takes precedence over Cloud Connector, narrow the route
   so that it excludes the six fixed paths (their query-string variants are then answered from R2 without
   `?days`/`?callback`/`?pretty` handling, so record that decision), `pnpm deploy:api`, commit and push.
4. Run the 4.8 suite. On the fixed paths, `cf-cache-status` should become `HIT` on repeat and the Worker's
   request count should drop.

### 7.4 Revert

Fastest: disable the Cloud Connector rule (dashboard, or `pulumi config set bluelytics:apiMode worker` +
`pnpm infra:up`), restore the `api.bluelytics.com.ar/*` route and `pnpm deploy:api`, set `API_MODE` back to
`"worker"`, commit, and purge the `api` host with the purge token:

```sh
read -rs CLOUDFLARE_PURGE_TOKEN
curl -sS -X POST -H "Authorization: Bearer $CLOUDFLARE_PURGE_TOKEN" "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" --json '{"hosts":["api.bluelytics.com.ar"]}' | jq .success
```

If test 7.2 showed Cloud Connector wins over Worker routes, disable it first; otherwise restore the route
first. Run the 4.8 suite.

---

## Appendix A — Hostnames

| Hostname | Before | During shadow (Phases 1–3) | After cutover (Phases 4–5) | After Phase 6 |
|---|---|---|---|---|
| `bluelytics.com.ar` | S3 bucket `bluelytics.com.ar` behind Cloudflare | S3 (plus the probe path in 3.2, briefly) | `bluelytics-web` via route (old bundle paths → S3 until Sunday) | `bluelytics-web` via route on an originless record |
| `www.bluelytics.com.ar` | 301 → apex (mechanism found in 0.6) | same | same | Cloudflare redirect rule on a proxied record |
| `api.bluelytics.com.ar` | Go API on AWS behind Cloudflare cache | Go API (plus the probe path in 3.2, briefly) | `bluelytics-api` via route | `bluelytics-api` via route on an originless record (Phase 7: R2 + CDN for fixed paths) |
| `media.bluelytics.com.ar` | does not exist | R2 `bluelytics-public` (post and OG images) | same | same |
| `api-v2.bluelytics.com.ar` | does not exist | `bluelytics-api` custom domain | same | removed or kept as staging |
| `v2.bluelytics.com.ar` | does not exist | `bluelytics-web` custom domain, `noindex` | same | removed or kept as staging |
| `$JOBS_HOST` | does not exist | `bluelytics-jobs` admin endpoints | same | same |
| S3 website endpoint / post-image bucket URLs | legacy | legacy | unused | buckets emptied and private (6.8) |

## Appendix B — Secrets and configuration (names only)

| Name | Kind | Set where | Value comes from |
|---|---|---|---|
| `cloudflare:apiToken` | secret | Pulumi stack config (`pulumi config set --secret`) | Cloudflare "Pulumi" token (0.4) |
| `bluelytics:accountId`, `zoneId`, `zoneName`, `webHostname`, `apiHostname`, `mediaHostname`, `apiMode`, `manageRulesets` | config | Pulumi stack config | 0.6 inventory; this guide |
| `PULUMI_ACCESS_TOKEN` | secret | shell / CI (Pulumi Cloud only) | Pulumi Cloud account |
| `PULUMI_CONFIG_PASSPHRASE` | secret | shell, `read -rs` (self-managed backend only) | password manager (0.3) |
| `CLOUDFLARE_API_TOKEN` | secret | your shell / CI | Cloudflare "Deploy" token (0.4) |
| `CLOUDFLARE_ACCOUNT_ID` | config | shell / CI | 0.6 |
| `CF_OPS_TOKEN` | secret, local only | your shell | Cloudflare "Ops" token (0.4); deleted in 6.11 |
| `CF_DNS_TOKEN` | secret, local only | your shell (6.4) | the Cloudflare "Pulumi" token |
| `BUFFER_API_KEY` | secret | jobs Worker; placeholder from 2.7 until 4.10 | Buffer → Settings → API (new key; 0.3) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | secret | jobs Worker; placeholder until 4.10 | New key of the `firebase-adminsdk-…@bluelytics-mobile` service account (0.3) |
| `ADMIN_TOKEN` | secret | jobs Worker | `openssl rand -base64 32` (1.6) |
| `OPS_WEBHOOK_URL` | secret, optional | jobs Worker | Slack/Discord/Telegram incoming webhook |
| `CLOUDFLARE_PURGE_TOKEN` | secret, Phase 7 only | jobs Worker; your shell for manual purges | Cloudflare token with zone Cache Purge (7.1) |
| `PUSH_ENABLED`, `SOCIAL_ENABLED` | var | `apps/jobs/wrangler.jsonc` | `"false"` until 4.10 |
| `API_MODE` | var | `apps/jobs/wrangler.jsonc` | `"worker"` (Phase 7: `"static-first"`) |
| `LEGACY_V1_BLUE_BUG` | var | `apps/jobs/wrangler.jsonc` | owner decision |
| `BUFFER_CHANNELS` | var | `apps/jobs/wrangler.jsonc` | `pnpm buffer:channels` (2.7) |
| `MEDIA_HOSTNAME` | var | `apps/jobs/wrangler.jsonc` | `"media.bluelytics.com.ar"` (Pulumi `bluelytics:mediaHostname`) |
| `API_HOSTNAME`, `CLOUDFLARE_ZONE_ID` | var | `apps/jobs/wrangler.jsonc` | `"api.bluelytics.com.ar"`; zone id `""` until 7.3, then `$CF_ZONE_ID` |
| `SHADOW_HOSTNAME` | var | `apps/api/wrangler.jsonc` | `"api-v2.bluelytics.com.ar"` (`noindex` there) |
| `LEGACY_V1_BLUE_BUG`, `API_MODE` (copies) | var | `apps/api/wrangler.jsonc` | not read by the API Worker; keep equal to the jobs values |
| `PRODUCTION_HOSTNAME`, `MEDIA_ORIGIN` | var | `apps/web/wrangler.jsonc` | `"bluelytics.com.ar"`, `"https://media.bluelytics.com.ar"` |
| `PUBLIC_ANDROID_URL`, `PUBLIC_IOS_URL`, `PUBLIC_GA4_ID` | build-time public env, optional | `apps/web` build environment | owner decisions |
| `PUBLIC_CF_BEACON_TOKEN` | build-time public env, optional | `apps/web` build environment | Web Analytics site token (1.5); unset = zone edge injection |
| D1 `database_id`, R2 bucket name | IDs (not secret) | `apps/*/wrangler.jsonc` | `pnpm infra:sync-ids` |
| AWS profiles `bl-readonly`, `bl-admin` | credentials, local only | `~/.aws` | 0.3; deleted when the AWS account closes |
| Legacy, retired in Phase 6: `PG_USER`, `PG_PASSWORD`, `PG_HOSTNAME`, `PG_DB`, `PG_SSLMODE`, `OPENEX_API_KEY`, legacy `BUFFER_API_KEY`, `SN_PROFILE_*`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, the Firebase admin JSON file | legacy | legacy `.env`, task definitions, Secrets Manager / SSM, image | rotated/deleted per 6.8 and 6.11 |

## Appendix C — Rollback matrix

| Step | Undo | Time to undo | Clean until | After that |
|---|---|---|---|---|
| 1.3 `infra:up` | none needed (new resources only) | — | always | D1/R2 are protected; delete by hand only if abandoning |
| 2.2 / 4.5 backfill | `wr_api d1 time-travel restore bluelytics --timestamp=…` | minutes | 4.5: the API switch (4.7); 2.2: Time Travel window (30 days Paid, 7 Free) | — |
| 2.4 jobs deploy | `"crons": []` + deploy | 1 min (+ up to 15 min propagation) | always | — |
| 4.3 legacy freeze | re-enable trigger(s) | minutes | Sunday 18:00 (4.10) | turn v2 flags off first, then 4.12 |
| 4.6 baseline rows | delete the inserted rows | seconds | Monday 07:00 ART | — |
| 4.7 API route | `ROLLBACK_API.sh`, purge `api` host, remove route from config | seconds | Sunday 18:00 (4.10) | flags off first; then keep v2 serving or 4.12 full rollback |
| 4.9 web route | `ROLLBACK_WEB.sh`, purge apex, remove route from config | seconds | 6.4 (apex record changed) | restore the apex record from `dns.bind` (6.4 Undo) while the S3 bucket still has content |
| 4.10 secrets + flags on | flags `"false"` + `pnpm deploy:jobs`, or `wr_jobs rollback` | 1 min | before the first push/post | sent pushes/posts cannot be recalled; delete posts by hand |
| 6.3 `www` redirect | restore `www` record from `dns.bind`, delete the rule | minutes | until 6.8 empties the buckets | none |
| 6.4 DNS changes | recreate records from `dns.bind` | minutes | until 6.8 deletes the origins | none |
| 6.7 compute stopped | scale up / start instance | minutes | until 6.8 | none |
| 6.8 deletions | restore from final snapshot / dump into new infrastructure | hours–days | — | v2 is the only system |
| 7.3 static-first | 7.4 | minutes | always | — |

## Appendix D — Troubleshooting

**A source is blocked from Cloudflare's network.** Symptom: one source fails in every run on v2 (`observations.error`
shows 403, a challenge page, or a timeout) while it works from your machine. Ámbito, dolarhoy, Infodolar and
criptoya are themselves behind Cloudflare and can identify Worker subrequests; Cronista, La Nación and Infobae
are behind Akamai; BNA is slow and erratic (`sources.md` §7). Consensus continues with the remaining voters and
`/estado` shows the failure. If fewer than 3 blue primaries remain reliable, do not cut over; the research
suggests, but nobody built, a non-Workers fallback (a scheduled job elsewhere posting observations to the Worker).

**D1 migration failed.** `wr_api d1 migrations list bluelytics --remote` shows which ones are applied. Wrangler
captures a backup before applying (Time Travel restores to a timestamp). Never edit an applied migration; add a
new one that fixes the problem. Each migration must stay compatible with the currently deployed code, because
migrations run before the code deploy.

**Wrangler replaced a DNS record.** Symptom: a production hostname suddenly serves a v2 Worker or errors, after a
deploy containing a `custom_domain` route for it. Fix: remove the route from the `wrangler.jsonc`, delete the
Workers custom domain (`cf "/accounts/$CF_ACCOUNT_ID/workers/domains"` to find it;
`cfw "/accounts/$CF_ACCOUNT_ID/workers/domains/<id>" -X DELETE`), recreate the original record from
`$MIG_DIR/cf/dns.bind` (same type, target, proxied). Prevention: step 1.1 before every deploy; never deploy from
CI before cutover.

**Stale or legacy responses after the switch.** First check `etag` on the response: absent means legacy
answered, so the route does not match that path (check patterns with `cf "/zones/$CF_ZONE_ID/workers/routes"`),
or a script-less exemption covers it. Present but old values: the jobs Worker has not re-rendered
(`/admin/health`), or a client/device cache from before the switch (legacy sent `max-age=7200`; expires within
2 hours). A purge (`{"hosts":[…]}`) only helps for paths served through the zone cache.

**Buffer rejects the image URL.** Error such as `Failed to create post: Failed to fetch image dimensions: Not Found`.
Check `curl -sSI https://media.bluelytics.com.ar/<image_key>` returns 200 with `content-type: image/jpeg`;
check the R2 custom domain is active; check bot protection or WAF rules are not challenging Buffer's fetcher on
`media`. The jobs Worker retries a failed post twice on later runs; after that, post by hand from the image URL
in `social_posts.image_key`.

**FCM authentication failure.** `push_status` shows a 401/403 or an OAuth error. Causes: the secret is not the
full service-account JSON (or is still the shadow placeholder), the key was deleted, or it belongs to another
project. Export the key from the password manager and check with `jq -r '.project_id, .private_key_id' <file>`
(prints no secret) that it is `bluelytics-mobile` and the key id from 0.3; validate it with the 3.3 local test;
re-set it with the `jq --rawfile` + `wr_jobs secret bulk` commands of 4.10. A 400 means the payload changed:
compare with `legacy-mobile.md` §2.6.

**Cron not running.** Dashboard → the jobs Worker → Cron Events (last 100 invocations). Trigger changes take up
to 15 minutes to propagate. On Paid, a reached spending limit rejects cron runs too (1103). On Free, CPU over
10 ms per run terminates it.

**Browser Run 429.** On Free: one Quick Action per 10 s and 10 minutes per day; the daily quota resets at 00:00 UTC.
Posts that could not render are retried on later runs; move to Paid if it recurs.
