import type { RenderedKey } from '@bluelytics/core';
import { RENDERED_KEYS } from '@bluelytics/core';
import { getRendered, getRenderedEtags, getState, setState } from '@bluelytics/db';
import type { Deps } from './deps.ts';
import { errorText } from './errors.ts';

/** Public path and `Cache-Control` of each fixed body, as the API Worker serves it (ARCHITECTURE §6). */
export const STATIC_API_OBJECTS: Readonly<Record<RenderedKey, { path: string; cacheControl: string }>> = {
  latest: { path: '/v2/latest', cacheControl: 'public, max-age=30' },
  last_price: { path: '/json/last_price', cacheControl: 'public, max-age=30' },
  alerts: { path: '/v2/alerts', cacheControl: 'public, max-age=30' },
  currency: { path: '/data/json/currency.json', cacheControl: 'public, max-age=300' },
  evolution_json: { path: '/v2/evolution.json', cacheControl: 'public, max-age=300' },
  evolution_csv: { path: '/v2/evolution.csv', cacheControl: 'public, max-age=300' },
};

/** R2 key of a fixed body: `api<path>` (infra `STATIC_API_R2_PREFIX`). */
export const staticApiKey = (key: RenderedKey): string => `api${STATIC_API_OBJECTS[key].path}`;

/** `state` entry: the etag of each body last copied to R2 and purged successfully. */
export const STATIC_STATE_KEY = 'static_api_etags';

export interface StaticSyncReport {
  copied: RenderedKey[];
  purged: boolean;
}

/** What `static-first` lacks to purge (`/admin/health` shows it); empty when it can run. */
export function missingPurgeConfig(deps: Pick<Deps, 'config' | 'secrets'>): string[] {
  const missing: string[] = [];
  if (!deps.config.zoneId) missing.push('CLOUDFLARE_ZONE_ID');
  if (!deps.secrets.purgeToken) missing.push('CLOUDFLARE_PURGE_TOKEN');
  return missing;
}

/**
 * `static-first` mode: copies every body whose stored etag differs from the copy on R2 (all six on
 * the first run after switching modes), then purges those paths. Copies are recorded only after a
 * successful purge, so a failed copy or purge is simply repeated by the next run.
 */
export async function syncStaticApi(deps: Deps, now: string): Promise<StaticSyncReport> {
  const missing = missingPurgeConfig(deps);
  // Checked before copying: without a purge nothing is recorded, so every run would copy all six bodies again.
  if (missing.length > 0) throw new Error(`static-first purge needs ${missing.join(' and ')}`);
  const [etags, state] = await Promise.all([getRenderedEtags(deps.db), getState(deps.db, STATIC_STATE_KEY)]);
  const copiedEtags = state ? (JSON.parse(state.value) as Partial<Record<RenderedKey, string>>) : {};
  const stale = RENDERED_KEYS.filter((key) => etags[key] !== undefined && etags[key] !== copiedEtags[key]);
  if (stale.length === 0) return { copied: [], purged: false };
  for (const key of stale) {
    const row = await getRendered(deps.db, key);
    if (!row) continue;
    await deps.bucket.put(staticApiKey(key), row.body, {
      httpMetadata: { contentType: row.contentType, cacheControl: STATIC_API_OBJECTS[key].cacheControl },
    });
    copiedEtags[key] = row.etag;
  }
  await purgeStaticPaths(deps, stale);
  await setState(deps.db, STATIC_STATE_KEY, JSON.stringify(copiedEtags), now);
  return { copied: stale, purged: true };
}

/**
 * Prefix purge of the public path and of its rewritten R2 form (`/api<path>`): research §3b says a
 * prefix purge must name the post-rewrite URL, and sending both costs the same single request.
 */
async function purgeStaticPaths(deps: Deps, keys: readonly RenderedKey[]): Promise<void> {
  const { zoneId, apiHostname } = deps.config;
  const token = deps.secrets.purgeToken ?? '';
  const prefixes = keys.flatMap((key) => [`${apiHostname}${STATIC_API_OBJECTS[key].path}`, `${apiHostname}/api${STATIC_API_OBJECTS[key].path}`]);
  const response = await deps.fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`purge failed: HTTP ${response.status} ${errorText(await response.text())}`);
}
