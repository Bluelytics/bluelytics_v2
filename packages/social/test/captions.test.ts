import { describe, expect, it } from 'vitest';
import { buildAltText, buildCaption, cardAltText, twitterLength, type CardData } from '../src/index.ts';
import { BIG, DOWN, FLAT, NO_REF, UP, WEEK_ONE_DAY, WEEK_UP } from './fixtures.ts';

const URLISH = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|ar|net|org)\b/i;

describe('X captions', () => {
  it('reads as Spanish with accents and no URL or domain', () => {
    expect(buildCaption('twitter', 'update', UP)).toBe(
      [
        'El dólar blue subió a $ 1.675: +$ 15 (+0,90%) respecto del cierre anterior.',
        'Compra $ 1.655 · Venta $ 1.675',
        'Oficial $ 1.601 · Brecha 4,6%',
        'Actualizado: 20 nov 2026, 15:45 (ART)',
        '#DólarBlue',
      ].join('\n'),
    );
    expect(buildCaption('twitter', 'update', DOWN)).toMatch(/^El dólar blue bajó a \$ 1\.650: -\$ 25 \(-1,49%\)/);
  });

  it('handles flat moves and a missing reference', () => {
    expect(buildCaption('twitter', 'update', FLAT)).toMatch(/^El dólar blue se mantiene en \$ 1\.675, sin cambios/);
    expect(buildCaption('twitter', 'update', NO_REF)).toMatch(/^Dólar blue: \$ 1\.675 \(venta\)\.\n/);
  });

  it('summarises the week', () => {
    expect(buildCaption('twitter', 'weekly', WEEK_UP).split('\n').slice(0, 2)).toEqual([
      'Resumen semanal del dólar blue (del 16 al 20 de noviembre de 2026): cerró en $ 1.675, con una suba de $ 30 (+1,82%) respecto de la semana anterior.',
      'Compra $ 1.655 · Venta $ 1.675',
    ]);
    expect(buildCaption('twitter', 'weekly', WEEK_UP)).toContain('Mínimo $ 1.650 · Máximo $ 1.675');
    expect(buildCaption('twitter', 'weekly', WEEK_ONE_DAY)).not.toContain('Mínimo');
  });

  const all: [string, CardData][] = [['up', UP], ['down', DOWN], ['flat', FLAT], ['noRef', NO_REF], ['big', BIG], ['week', WEEK_UP]];
  it.each(all)('%s fits in 280 weighted characters without a URL', (_name, data) => {
    for (const kind of ['update', 'weekly'] as const) {
      const text = buildCaption('twitter', kind, data);
      expect(twitterLength(text)).toBeLessThanOrEqual(280);
      expect(text).not.toMatch(URLISH);
      expect(text).not.toMatch(/[− ]/);
    }
  });

  it('drops optional lines when a caption would be too long', () => {
    const longWeek: CardData = { ...BIG, series: [{ day: '2027-12-27', sell: 99999 }, { day: '2028-01-03', sell: 123456 }] };
    const text = buildCaption('twitter', 'weekly', { ...longWeek, blue: { buy: 123000, sell: 123456 }, prevSell: 99999 });
    expect(twitterLength(text)).toBeLessThanOrEqual(280);
    expect(text.startsWith('Resumen semanal del dólar blue')).toBe(true);
  });
});

describe('twitterLength', () => {
  it('weights Latin text as 1 and other scripts and symbols as 2', () => {
    expect(twitterLength('Dólar · $ 1.675')).toBe(15);
    expect(twitterLength('▲')).toBe(2);
    expect(twitterLength('日本')).toBe(4);
    expect(twitterLength('Dólar')).toBe(5);
  });
});

describe('Instagram and Facebook captions', () => {
  it('Instagram: details, timestamp, "link en la bio" and hashtags', () => {
    const text = buildCaption('instagram', 'update', UP);
    expect(text).toContain('Oficial $ 1.601 · Brecha 4,6%');
    expect(text).toContain('Actualizado: 20 nov 2026, 15:45 (ART)');
    expect(text).toContain('link en la bio');
    expect(text.split('\n').at(-1)).toBe('#dólarblue #dolarblue #dólar #dolar #argentina #economía #bluelytics');
    expect(text.length).toBeLessThanOrEqual(2200);
  });

  it('Facebook: ends with the site URL', () => {
    expect(buildCaption('facebook', 'weekly', WEEK_UP).split('\n').at(-1)).toBe('Más datos e histórico: https://bluelytics.com.ar');
  });
});

describe('buildAltText', () => {
  it('is the card alt text', () => {
    expect(buildAltText('update', BIG)).toBe(cardAltText('update', BIG));
    expect(buildAltText('weekly', WEEK_UP).length).toBeLessThanOrEqual(1000);
  });
});
