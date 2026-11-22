import { CliError } from '../cli.ts';
import { cacheBusted, type FetchLike } from '../http.ts';

/** The legacy API bodies the backfill reads (public GETs). */
export const LEGACY_PATHS = {
  evolution: '/v2/evolution.json',
  currency: '/data/json/currency.json',
  alerts: '/v2/alerts',
  latest: '/v2/latest',
} as const;

export type LegacyBody = keyof typeof LEGACY_PATHS;

/** Downloads `which` from the legacy API; any non-200 or non-JSON answer is an error. */
export async function downloadLegacy(
  base: URL,
  which: readonly LegacyBody[],
  deps: { fetch?: FetchLike; ts: number },
): Promise<Partial<Record<LegacyBody, string>>> {
  const fetchFn = deps.fetch ?? ((url, init) => fetch(url, init));
  const entries = await Promise.all(
    which.map(async (name) => {
      const url = cacheBusted(base, LEGACY_PATHS[name], null, deps.ts);
      let res: Response;
      try {
        res = await fetchFn(url.href, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
      } catch (error) {
        throw new CliError(`GET ${url.href} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const text = await res.text();
      if (res.status !== 200) throw new CliError(`GET ${url.href} answered HTTP ${res.status}`);
      if (!(res.headers.get('content-type') ?? '').includes('json')) {
        throw new CliError(`GET ${url.href} is not JSON (content-type ${JSON.stringify(res.headers.get('content-type'))})`);
      }
      return [name, text] as const;
    }),
  );
  return Object.fromEntries(entries);
}
