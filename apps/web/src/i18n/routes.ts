/**
 * The route manifest: one entry per page intent, pairing the Spanish and English paths. It is the
 * single source for navigation, canonical URLs, hreflang alternates and the sitemaps
 * (docs/ARCHITECTURE.md §10). Paths have no trailing slash (`trailingSlash: 'never'`).
 */

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** The production origin: canonical URLs and sitemaps always point here, whatever host served the page. */
export const SITE_ORIGIN = 'https://bluelytics.com.ar';

export const ROUTES = {
  home: { es: '/', en: '/en' },
  official: { es: '/dolar-oficial', en: '/en/official-dollar' },
  euro: { es: '/euro-blue', en: '/en/blue-euro' },
  gap: { es: '/brecha', en: '/en/gap' },
  calculator: { es: '/calculadora', en: '/en/calculator' },
  history: { es: '/historico', en: '/en/history' },
  api: { es: '/api', en: '/en/api' },
  about: { es: '/acerca', en: '/en/about' },
  status: { es: '/estado', en: '/en/status' },
} as const satisfies Record<string, Record<Locale, string>>;

export type RouteId = keyof typeof ROUTES;

/** A page's path in every locale. */
export type LocalizedPaths = Readonly<Record<Locale, string>>;

/** Header navigation, in order. */
export const NAV: readonly RouteId[] = ['home', 'official', 'euro', 'gap', 'calculator', 'history', 'api'];

/** Pages whose content depends on the published rates (their sitemap `lastmod` is the last rate change). */
export const LIVE_ROUTES: readonly RouteId[] = ['home', 'official', 'euro', 'gap', 'calculator', 'history', 'status'];

export function routePath(id: RouteId, locale: Locale): string {
  return ROUTES[id][locale];
}

export function absoluteUrl(path: string): string {
  return path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
}

export interface Alternate {
  hreflang: 'es' | 'en' | 'x-default';
  href: string;
}

/** hreflang alternates: every version lists itself and the other, Spanish is `x-default`. */
export function alternates(paths: LocalizedPaths): Alternate[] {
  return [
    { hreflang: 'es', href: absoluteUrl(paths.es) },
    { hreflang: 'en', href: absoluteUrl(paths.en) },
    { hreflang: 'x-default', href: absoluteUrl(paths.es) },
  ];
}

/** A history period: a year, a month of a year, or one day. */
export interface HistoryPeriod {
  year: number;
  month?: number;
  day?: number;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** `/historico/2024/03/15` · `/en/history/2024/03/15` (shorter for months and years). */
export function historyPath(locale: Locale, period?: HistoryPeriod): string {
  const base = ROUTES.history[locale];
  if (period === undefined) return base;
  const parts = [String(period.year)];
  if (period.month !== undefined) parts.push(pad2(period.month));
  if (period.month !== undefined && period.day !== undefined) parts.push(pad2(period.day));
  return `${base}/${parts.join('/')}`;
}

export function historyPaths(period?: HistoryPeriod): LocalizedPaths {
  return { es: historyPath('es', period), en: historyPath('en', period) };
}

/** The history period of a `YYYY-MM-DD` day. */
export function dayPeriod(day: string): Required<HistoryPeriod> {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)) };
}

/** Retired pages and where they live now (301 from the gateway). `/evolucion` merged into `/historico`. */
export const MOVED: Readonly<Record<string, string>> = {
  '/evolucion': ROUTES.history.es,
  '/en/evolution': ROUTES.history.en,
};
