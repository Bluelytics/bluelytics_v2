import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isValidDay } from '@bluelytics/core';
import { callerPath, CliError, isMain, REPO_ROOT, runCli, usageError } from '../cli.ts';
import { readLegacyBlueBug } from './config.ts';
import { parseBaseUrl } from '../http.ts';
import { runBackfill } from './run.ts';
import { wranglerTarget } from './target.ts';

export const BACKFILL_USAGE = `Usage: pnpm backfill -- --from <legacy API URL> [--since YYYY-MM-DD] [--remote] [--dry-run]

Downloads /v2/evolution.json, /data/json/currency.json, /v2/alerts and /v2/latest from the legacy
API, writes them to D1 "bluelytics" (origin 'backfill_api', idempotent upserts) through
\`wrangler d1 execute\` in apps/api, then re-renders the API bodies from what D1 holds.

  --from <url>         legacy API base, e.g. https://api.bluelytics.com.ar (required)
  --since <day>        only daily_rates for days >= <day> (rows legacy lacks in that range are
                       deleted) and the last two alerts; re-renders alerts and evolution only.
                       Never touches latest_rates, currencies, ticks, observations, social_posts.
  --remote             write to the remote D1 (default: the local one of \`pnpm dev:api\`)
  --dry-run            print the row counts and write the SQL files only; no database is touched
  --out <dir>          where the SQL files go (default: out/backfill)
  --persist-to <dir>   local only: wrangler --persist-to state directory
  -h, --help           this text

LEGACY_V1_BLUE_BUG (for /json/last_price) is read from apps/jobs/wrangler.jsonc, else apps/api's.`;

export async function main(argv: string[]): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        from: { type: 'string' },
        since: { type: 'string' },
        remote: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        out: { type: 'string' },
        'persist-to': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (error) {
    usageError(error, BACKFILL_USAGE);
  }
  if (values.help) {
    console.log(BACKFILL_USAGE);
    return 0;
  }
  if (values.from === undefined) throw new CliError(`--from is required\n\n${BACKFILL_USAGE}`);
  const from = parseBaseUrl(values.from, '--from');
  const since = values.since ?? null;
  if (since !== null && !isValidDay(since)) throw new CliError(`--since must be a date YYYY-MM-DD, got ${JSON.stringify(since)}`);
  if (values.remote && values['persist-to'] !== undefined) throw new CliError('--persist-to only applies to the local database');

  const flag = readLegacyBlueBug(REPO_ROOT);
  if (flag.file === null) console.warn('backfill: LEGACY_V1_BLUE_BUG not found in any wrangler.jsonc; rendering with false');
  const target = values['dry-run']
    ? null
    : wranglerTarget({ remote: values.remote, ...(values['persist-to'] !== undefined && { persistTo: callerPath(values['persist-to']) }) });
  await runBackfill({
    from,
    since,
    target,
    outDir: values.out === undefined ? join(REPO_ROOT, 'out/backfill') : callerPath(values.out),
    legacyBlueBug: flag.value,
  });
  return 0;
}

if (isMain(import.meta.url)) runCli('backfill', main);
