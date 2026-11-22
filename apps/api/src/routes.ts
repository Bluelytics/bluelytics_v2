import type { RenderedKey } from '@bluelytics/core';
import { CACHE_CONTROL } from './responses.ts';

export type Route =
  | { readonly kind: 'root' }
  | { readonly kind: 'historical' }
  | {
      readonly kind: 'rendered';
      readonly key: RenderedKey;
      readonly cacheControl: string;
      /** `?callback=` is honoured (legacy: only these two endpoints). */
      readonly jsonp: boolean;
      /** `?days=` slices the body as JSON rows or CSV lines. */
      readonly days: 'json' | 'csv' | null;
    };

function rendered(key: RenderedKey, cacheControl: string, jsonp: boolean, days: 'json' | 'csv' | null): Route {
  return { kind: 'rendered', key, cacheControl, jsonp, days };
}

/** The legacy routes, matched exactly and case-sensitively (no trailing slash). */
export const ROUTES: ReadonlyMap<string, Route> = new Map<string, Route>([
  ['/', { kind: 'root' }],
  ['/v2/latest', rendered('latest', CACHE_CONTROL.live, true, null)],
  ['/v2/alerts', rendered('alerts', CACHE_CONTROL.live, false, null)],
  ['/json/last_price', rendered('last_price', CACHE_CONTROL.live, true, null)],
  ['/v2/evolution.json', rendered('evolution_json', CACHE_CONTROL.slow, false, 'json')],
  ['/v2/evolution.csv', rendered('evolution_csv', CACHE_CONTROL.slow, false, 'csv')],
  ['/v2/historical', { kind: 'historical' }],
  ['/data/json/currency.json', rendered('currency', CACHE_CONTROL.slow, false, null)],
]);

export interface SplitUrl {
  host: string;
  path: string;
  /** Raw query string without `?`, or `null` without one. */
  query: string | null;
}

/**
 * Host, raw path and raw query of a request URL, without the cost of `new URL()`. `request.url` is
 * already a serialised absolute URL, so the path always starts at the first `/` after the host.
 */
export function splitUrl(url: string): SplitUrl {
  const hostStart = url.indexOf('//') + 2;
  const pathStart = url.indexOf('/', hostStart);
  const queryStart = url.indexOf('?', pathStart);
  const host = url.slice(hostStart, pathStart);
  if (queryStart === -1) return { host, path: url.slice(pathStart), query: null };
  return { host, path: url.slice(pathStart, queryStart), query: url.slice(queryStart + 1) };
}
