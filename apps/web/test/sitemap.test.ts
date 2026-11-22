import { describe, expect, it } from 'vitest';
import { ROUTES } from '../src/i18n/routes.ts';
import { historyEntries, pageEntries, sitemapIndex, urlset } from '../src/lib/sitemap.ts';

describe('sitemaps', () => {
  it('lists the page and history sitemaps in the index', () => {
    const xml = sitemapIndex('2026-11-20T22:45:51.758Z');
    expect(xml).toContain('<loc>https://bluelytics.com.ar/sitemap-pages.xml</loc><lastmod>2026-11-20T22:45:51.758Z</lastmod>');
    expect(xml).toContain('<loc>https://bluelytics.com.ar/sitemap-history.xml</loc>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex')).toBe(true);
  });

  it('gives live pages the last rate change and static pages no lastmod', () => {
    const entries = pageEntries('2026-11-20T22:45:51.758Z');
    expect(entries).toHaveLength(Object.keys(ROUTES).length);
    expect(entries.find((e) => e.paths === ROUTES.home)?.lastmod).toBe('2026-11-20T22:45:51.758Z');
    expect(entries.find((e) => e.paths === ROUTES.api)?.lastmod).toBeUndefined();
  });

  it('writes one <url> per locale, each with all alternates', () => {
    const xml = urlset([{ paths: ROUTES.gap, lastmod: '2026-11-20' }]);
    const urls = xml.match(/<url>.*?<\/url>/g) ?? [];
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain('<xhtml:link rel="alternate" hreflang="es" href="https://bluelytics.com.ar/brecha"/>');
      expect(url).toContain('<xhtml:link rel="alternate" hreflang="en" href="https://bluelytics.com.ar/en/gap"/>');
      expect(url).toContain('<xhtml:link rel="alternate" hreflang="x-default" href="https://bluelytics.com.ar/brecha"/>');
      expect(url).toContain('<lastmod>2026-11-20</lastmod>');
    }
    expect(urls[1]).toContain('<loc>https://bluelytics.com.ar/en/gap</loc>');
  });

  it('builds year, month and day entries; the newest day carries the live timestamp', () => {
    const entries = historyEntries(['2025-12-31', '2026-01-02', '2026-01-05'], '2026-01-05T15:00:00.000Z');
    const byPath = new Map(entries.map((e) => [e.paths.es, e.lastmod]));
    expect(byPath.get('/historico/2025')).toBe('2025-12-31');
    expect(byPath.get('/historico/2025/12')).toBe('2025-12-31');
    expect(byPath.get('/historico/2026')).toBe('2026-01-05T15:00:00.000Z');
    expect(byPath.get('/historico/2026/01/02')).toBe('2026-01-02');
    expect(byPath.get('/historico/2026/01/05')).toBe('2026-01-05T15:00:00.000Z');
    expect(entries).toHaveLength(2 + 2 + 3);
  });

  it('escapes XML', () => {
    expect(urlset([{ paths: { es: '/a&b', en: '/en/a&b' } }])).toContain('https://bluelytics.com.ar/a&amp;b');
  });
});
