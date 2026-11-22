/**
 * Legacy AngularJS routes (`/#!/x` since 2020, `/#/x` before): docs/legacy/legacy-frontend.md §9.3.
 * The server never sees the fragment, so the home pages forward visitors with this map on the client.
 */
import { ROUTES, type Locale, type RouteId } from '../i18n/routes.ts';

const LEGACY_ROUTES: Readonly<Record<string, RouteId>> = {
  '': 'home',
  calculator: 'calculator',
  evolution: 'evolution',
  gap: 'gap',
  api: 'api',
  about: 'about',
  analysis: 'evolution',
  forecast: 'evolution',
  wordcloud: 'home',
  dolar: 'home',
};

/**
 * Target path for a legacy fragment, or `null` when `hash` is not a legacy route (unknown legacy
 * routes go home, as the old router did). `storedLanguage` is the old `NG_TRANSLATE_LANG_KEY`
 * preference (`"en_US"` → English pages).
 */
export function legacyHashTarget(hash: string, storedLanguage: string | null): string | null {
  const match = hash.match(/^#!?\/([^/?]*)/);
  if (match === null) return null;
  const route = LEGACY_ROUTES[(match[1] ?? '').toLowerCase()] ?? 'home';
  const locale: Locale = storedLanguage?.replace(/"/g, '').startsWith('en') ? 'en' : 'es';
  return ROUTES[route][locale];
}
