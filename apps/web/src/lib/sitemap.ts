/**
 * Hand-written sitemaps (docs/research/astro-seo.md §5): `lastmod` is the real last change, and every
 * URL carries its hreflang alternates. Pure functions; the endpoints feed them from D1.
 */
import { absoluteUrl, alternates, dayPeriod, historyPaths, LIVE_ROUTES, ROUTES, type LocalizedPaths, type RouteId } from '../i18n/routes.ts';

export const SITEMAP_FILES = ['/sitemap-pages.xml', '/sitemap-history.xml'] as const;

export interface SitemapEntry {
  paths: LocalizedPaths;
  /** W3C datetime or `YYYY-MM-DD`; omitted when unknown. */
  lastmod?: string;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';

const escapeXml = (text: string): string =>
  text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);

export function sitemapIndex(lastmod?: string): string {
  const items = SITEMAP_FILES.map(
    (path) => `<sitemap><loc>${escapeXml(absoluteUrl(path))}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}</sitemap>`,
  );
  return `${XML_HEADER}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>\n`;
}

/** One `<url>` per locale of each entry, each listing every alternate (Google's reciprocal rule). */
export function urlset(entries: readonly SitemapEntry[]): string {
  const urls: string[] = [];
  for (const entry of entries) {
    const links = alternates(entry.paths)
      .map((alt) => `<xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${escapeXml(alt.href)}"/>`)
      .join('');
    const lastmod = entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '';
    for (const path of [entry.paths.es, entry.paths.en]) {
      urls.push(`<url><loc>${escapeXml(absoluteUrl(path))}</loc>${lastmod}${links}</url>`);
    }
  }
  return (
    `${XML_HEADER}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    `${urls.join('\n')}\n</urlset>\n`
  );
}

/** Every manifest page; live pages get `lastmod` = last rate change. */
export function pageEntries(lastRateChange: string | null): SitemapEntry[] {
  return (Object.keys(ROUTES) as RouteId[]).map((id) => {
    const entry: SitemapEntry = { paths: ROUTES[id] };
    if (lastRateChange !== null && LIVE_ROUTES.includes(id)) entry.lastmod = lastRateChange;
    return entry;
  });
}

/**
 * Year, month and day pages for every day with data (`days` sorted ascending). A period's
 * `lastmod` is its newest day, except the current day, whose data still moves (`lastRateChange`).
 */
export function historyEntries(days: readonly string[], lastRateChange: string | null): SitemapEntry[] {
  const latest = new Map<string, string>();
  for (const day of days) {
    latest.set(day.slice(0, 4), day);
    latest.set(day.slice(0, 7), day);
  }
  const newest = days.at(-1);
  const stamp = (day: string): string => (day === newest && lastRateChange !== null ? lastRateChange : day);
  const entries: SitemapEntry[] = [];
  for (const [key, day] of latest) {
    const { year, month } = dayPeriod(day);
    entries.push({ paths: historyPaths(key.length === 4 ? { year } : { year, month }), lastmod: stamp(day) });
  }
  for (const day of days) entries.push({ paths: historyPaths(dayPeriod(day)), lastmod: stamp(day) });
  return entries;
}
