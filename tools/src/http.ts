import { CliError } from './cli.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Validates a base URL flag: an absolute http(s) URL. */
export function parseBaseUrl(raw: string, flag: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError(`${flag} must be an absolute URL, got ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CliError(`${flag} must be an http(s) URL, got ${JSON.stringify(raw)}`);
  return url;
}

/**
 * The legacy API edge-caches most paths for two hours; a unique query string is its own cache key,
 * so `ts=` returns what the origin has now (MIGRATION.md 3.1 does the same). Both APIs ignore it.
 */
export function cacheBusted(base: URL, path: string, query: string | null, ts: number): URL {
  const url = new URL(path, base);
  url.search = query === null ? `ts=${ts}` : `${query}&ts=${ts}`;
  return url;
}
