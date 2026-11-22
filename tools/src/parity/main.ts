import { parseArgs } from 'node:util';
import type { GoldenCapture } from '@bluelytics/contract';
import { goldenManifest } from '@bluelytics/contract/golden';
import { CliError, formatTable, isMain, runCli, usageError } from '../cli.ts';
import { cacheBusted, parseBaseUrl, type FetchLike } from '../http.ts';
import { compareCapture, type CheckResult, type Fetched } from './compare.ts';

export const PARITY_USAGE = `Usage: pnpm parity -- --old <url> --new <url> [--strict]

Replays every request of packages/contract/golden-manifest.json against both APIs and compares:
status; content-type and CORS headers; bodies byte for byte for static captures, row by row for
the evolution bodies, and by structure (keys, key order, %.2f numbers, JSONP wrapper, trailing
newline) for the time-varying ones and currency.json.

  --old <url>   reference API, e.g. https://api.bluelytics.com.ar (required)
  --new <url>   API under test (required)
  --strict      expected differences (other values on latest/last_price/alerts/currency,
                recent evolution rows) fail too
  -h, --help    this text

Every request carries a unique ts= query parameter so edge caches answer fresh copies.
Exit code: 0 when nothing failed (warnings allowed), 1 otherwise.`;

export interface ParityOptions {
  oldUrl: URL;
  newUrl: URL;
  strict: boolean;
  captures?: readonly GoldenCapture[];
  fetch?: FetchLike;
  ts?: number;
}

async function fetchCapture(base: URL, capture: GoldenCapture, ts: number, fetchFn: FetchLike): Promise<Fetched> {
  const url = cacheBusted(base, capture.path, capture.query, ts);
  try {
    const res = await fetchFn(url.href, { method: capture.method, headers: capture.requestHeaders, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    return { ok: true, status: res.status, headers: res.headers, body: new Uint8Array(await res.arrayBuffer()) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** One check per capture, in manifest order. */
export async function runParity(options: ParityOptions): Promise<CheckResult[]> {
  const fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
  const ts = options.ts ?? Date.now();
  const results: CheckResult[] = [];
  for (const capture of options.captures ?? goldenManifest()) {
    const [before, after] = await Promise.all([fetchCapture(options.oldUrl, capture, ts, fetchFn), fetchCapture(options.newUrl, capture, ts, fetchFn)]);
    results.push(compareCapture(capture, before, after, options.strict));
  }
  return results;
}

/** The human-readable report: one table row per capture, then a summary line. */
export function formatReport(results: readonly CheckResult[], options: Pick<ParityOptions, 'oldUrl' | 'newUrl' | 'strict'>): string {
  const count = (verdict: CheckResult['verdict']) => results.filter((result) => result.verdict === verdict).length;
  const table = formatTable(
    ['result', 'capture', 'request', 'status', 'detail'],
    results.map((result) => [result.verdict.toUpperCase(), result.name, result.request, result.status, result.details.join('; ')]),
  );
  return [
    `parity: old ${options.oldUrl.href}  new ${options.newUrl.href}${options.strict ? '  (strict)' : ''}`,
    '',
    table,
    '',
    `${results.length} checks: ${count('ok')} ok, ${count('warn')} warn, ${count('fail')} fail`,
  ].join('\n');
}

export async function main(argv: string[]): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { old: { type: 'string' }, new: { type: 'string' }, strict: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false } },
    }));
  } catch (error) {
    usageError(error, PARITY_USAGE);
  }
  if (values.help) {
    console.log(PARITY_USAGE);
    return 0;
  }
  if (values.old === undefined || values.new === undefined) throw new CliError(`--old and --new are required\n\n${PARITY_USAGE}`);
  const options = { oldUrl: parseBaseUrl(values.old, '--old'), newUrl: parseBaseUrl(values.new, '--new'), strict: values.strict };
  const results = await runParity(options);
  console.log(formatReport(results, options));
  return results.some((result) => result.verdict === 'fail') ? 1 : 0;
}

if (isMain(import.meta.url)) runCli('parity', main);
