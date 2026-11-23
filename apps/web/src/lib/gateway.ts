/**
 * The uncached front of the Worker (src/worker.ts). Workers Cache keys ignore the host, so anything
 * that depends on the host must be added here, after the cached `Site` entrypoint answered.
 */

import privacyPolicy from '../privacy.html?raw';
import { MOVED } from '../i18n/routes.ts';

/** Query parameters that never change a page: dropped so they do not fragment the cache. */
const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|gbraid|wbraid|msclkid|mc_[a-z]+|igshid|ref|_ga)$/i;

/** The request the cached entrypoint sees: tracking parameters removed from GET/HEAD URLs. */
export function cacheableRequest(request: Request): Request {
  if (request.method !== 'GET' && request.method !== 'HEAD') return request;
  const url = new URL(request.url);
  const kept = [...url.searchParams].filter(([name]) => !TRACKING_PARAMS.test(name));
  if (kept.length === [...url.searchParams].length) return request;
  url.search = new URLSearchParams(kept).toString();
  return new Request(url, request);
}

/** Response headers for the host that was actually requested. */
export function finalizeResponse(request: Request, response: Response, productionHostname: string): Response {
  const result = new Response(response.body, response);
  if (new URL(request.url).hostname !== productionHostname) result.headers.set('X-Robots-Tag', 'noindex');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return result;
}

/**
 * Legacy URLs answered before Astro, whose routing maps `/x.html` to `/x` (docs/legacy/legacy-frontend.md
 * §9.1–9.2): `/index.html` → `/`, and the app's privacy policy byte for byte at `/privacy.html`
 * (registered with the app stores). `null` for every other request.
 */
export function legacyResponse(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const { pathname } = new URL(request.url);
  if (pathname === '/index.html') return new Response(null, { status: 301, headers: { Location: '/' } });
  const moved = MOVED[pathname.replace(/\/$/, '')];
  if (moved !== undefined) return new Response(null, { status: 301, headers: { Location: moved, 'Cache-Control': 'public, max-age=86400' } });
  if (pathname === '/privacy.html') {
    return new Response(request.method === 'HEAD' ? null : privacyPolicy, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
    });
  }
  return null;
}
