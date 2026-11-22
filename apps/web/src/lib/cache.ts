/**
 * Cache policies (docs/ARCHITECTURE.md §10, docs/research/astro-seo.md §3). The edge copy is driven by
 * Astro route caching (`Cloudflare-CDN-Cache-Control`, Workers Cache); browsers get their own short
 * `Cache-Control`. No `s-maxage`/`must-revalidate`: they disable stale-while-revalidate at the edge.
 */

interface CacheControl {
  set(options: { maxAge?: number; swr?: number; tags?: string[]; lastModified?: Date } | false): void;
}

export interface CachePolicy {
  maxAge: number;
  swr: number;
  tags: string[];
}

/** Prices: the jobs Worker publishes every 5 minutes. */
export const LIVE: CachePolicy = { maxAge: 60, swr: 240, tags: ['rates'] };
/** Long charts and the series endpoint. */
export const SLOW: CachePolicy = { maxAge: 300, swr: 3600, tags: ['rates', 'history'] };
/** Closed history periods never change. */
export const CLOSED: CachePolicy = { maxAge: 86_400, swr: 604_800, tags: ['history'] };
/** Sitemaps. */
export const SITEMAP: CachePolicy = { maxAge: 3600, swr: 86_400, tags: ['sitemap'] };

export function cacheControlHeader(policy: CachePolicy): string {
  return `public, max-age=${policy.maxAge}`;
}

/** Applies a policy to a page (`Astro`) or endpoint context; returns the browser `Cache-Control` value. */
export function applyCache(target: { cache: CacheControl }, policy: CachePolicy, lastModified?: string | null): string {
  target.cache.set({ maxAge: policy.maxAge, swr: policy.swr, tags: policy.tags, ...(lastModified ? { lastModified: new Date(lastModified) } : {}) });
  return cacheControlHeader(policy);
}

/** Applies a policy to a page and sets the browser `Cache-Control` (headers only work at page level). */
export function cachePage(page: { cache: CacheControl; response: { headers: Headers } }, policy: CachePolicy, lastModified?: string | null): void {
  page.response.headers.set('Cache-Control', applyCache(page, policy, lastModified));
}

/** A 404 must never be pinned at the edge (a future date would stay missing for a day). */
export function notFound(target: { cache: CacheControl }): Response {
  target.cache.set(false);
  return new Response(null, { status: 404 });
}
