import { describe, expect, it } from 'vitest';
import { absoluteUrl, alternates, dayPeriod, historyPath, historyPaths, LOCALES, NAV, ROUTES, type RouteId } from '../src/i18n/routes.ts';

describe('route manifest', () => {
  it('pairs every page in both locales, English under /en, no trailing slash', () => {
    for (const id of Object.keys(ROUTES) as RouteId[]) {
      const { es, en } = ROUTES[id];
      expect(en === '/en' || en.startsWith('/en/')).toBe(true);
      expect(es.startsWith('/en')).toBe(false);
      for (const path of [es, en]) expect(path === '/' || !path.endsWith('/')).toBe(true);
    }
  });

  it('has unique paths', () => {
    const paths = LOCALES.flatMap((locale) => Object.values(ROUTES).map((paths) => paths[locale]));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('matches the ARCHITECTURE §10 table', () => {
    expect(ROUTES.official).toEqual({ es: '/dolar-oficial', en: '/en/official-dollar' });
    expect(ROUTES.gap).toEqual({ es: '/brecha', en: '/en/gap' });
    expect(ROUTES.history).toEqual({ es: '/historico', en: '/en/history' });
    expect(NAV[0]).toBe('home');
  });

  it('builds absolute production URLs', () => {
    expect(absoluteUrl('/')).toBe('https://bluelytics.com.ar/');
    expect(absoluteUrl('/en/gap')).toBe('https://bluelytics.com.ar/en/gap');
  });

  it('emits reciprocal hreflang alternates with Spanish as x-default', () => {
    expect(alternates(ROUTES.calculator)).toEqual([
      { hreflang: 'es', href: 'https://bluelytics.com.ar/calculadora' },
      { hreflang: 'en', href: 'https://bluelytics.com.ar/en/calculator' },
      { hreflang: 'x-default', href: 'https://bluelytics.com.ar/calculadora' },
    ]);
  });

  it('builds history paths with two-digit months and days', () => {
    expect(historyPath('es')).toBe('/historico');
    expect(historyPath('es', { year: 2024 })).toBe('/historico/2024');
    expect(historyPath('en', { year: 2024, month: 3 })).toBe('/en/history/2024/03');
    expect(historyPaths(dayPeriod('2024-03-05'))).toEqual({ es: '/historico/2024/03/05', en: '/en/history/2024/03/05' });
  });
});
