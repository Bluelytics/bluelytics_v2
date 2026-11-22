// Contract tests: they must hold for any card.mjs dropped in (placeholder or final design).
import { describe, expect, it } from 'vitest';
import {
  CARD_KIND_SIZES,
  cardAltText,
  computeCardFacts,
  formatDateRange,
  formatGap,
  formatPercent,
  formatPesos,
  formatSignedPesos,
  formatTimestamp,
  plainText,
  renderCardHtml,
  type CardKind,
  type CardSize,
} from '../src/index.ts';
import { BIG, DOWN, FLAT, NO_REF, UP, WEEK_ONE_DAY, WEEK_UP } from './fixtures.ts';

const MINUS = '−';
const NBSP = ' ';

describe('renderCardHtml', () => {
  const cases = (Object.entries(CARD_KIND_SIZES) as [CardKind, readonly CardSize[]][]).flatMap(([kind, sizes]) =>
    sizes.flatMap((size) => [UP, DOWN, FLAT, NO_REF, BIG].map((data, i) => [kind, size, i, data] as const)),
  );

  it.each(cases)('%s/%s #%i is one self-contained document', (kind, size, _i, data) => {
    const html = renderCardHtml(kind, size, data);
    expect(html.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/<html lang="es"/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//i);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    expect(html).toContain('bluelytics.com.ar');
  });

  it('is deterministic', () => {
    expect(renderCardHtml('update', 'portrait', UP)).toBe(renderCardHtml('update', 'portrait', UP));
  });

  it('shows the hero price in es-AR format', () => {
    expect(renderCardHtml('update', 'landscape', BIG)).toMatch(/12\.480/);
  });
});

describe('formatters', () => {
  it('formats pesos with forced grouping and typographic signs', () => {
    expect(formatPesos(1675)).toBe(`$${NBSP}1.675`);
    expect(formatPesos(950)).toBe(`$${NBSP}950`);
    expect(formatSignedPesos(15)).toBe(`+$${NBSP}15`);
    expect(formatSignedPesos(-25)).toBe(`${MINUS}$${NBSP}25`);
    expect(formatSignedPesos(0)).toBe(`$${NBSP}0`);
  });

  it('formats percentages, escalating tiny moves instead of printing 0,00', () => {
    expect(formatPercent(0.009)).toBe('+0,90%');
    expect(plainText(formatPercent(-25 / 1675))).toBe('-1,49%');
    expect(formatPercent(1 / 12480)).toBe('+0,01%');
    expect(formatPercent(1 / 30000)).toBe('+0,003%');
    expect(formatGap(1675 / 1601 - 1)).toBe('4,6%');
  });

  it('formats timestamps in Argentine time, 24-hour clock', () => {
    expect(plainText(formatTimestamp('2026-11-20T22:45:00.000Z'))).toBe('20 nov 2026, 19:45 (ART)');
    expect(plainText(formatTimestamp('2027-09-08T22:35:00.000Z'))).toBe('8 sept 2027, 19:35 (ART)');
    expect(formatTimestamp('2026-11-20T22:45:00.000Z', { plain: true })).toBe('20 de noviembre de 2026, 19:45, hora de Argentina');
  });

  it('formats trading-day ranges', () => {
    expect(plainText(formatDateRange(['2026-11-16', '2026-11-20']))).toBe('16 - 20 nov 2026');
    expect(formatDateRange(['2026-11-16', '2026-11-20'], { prose: true })).toBe('del 16 al 20 de noviembre de 2026');
    expect(formatDateRange(['2026-11-20'], { prose: true })).toBe('del 20 de noviembre de 2026');
  });
});

describe('computeCardFacts', () => {
  it('derives the move against the reference close', () => {
    const f = computeCardFacts(UP);
    expect(f).toMatchObject({ sell: 1675, buy: 1655, deltaAbs: 15, direction: 'up', oficialSell: 1601, points: 5, min: 1610, max: 1675 });
    expect(f.deltaPct).toBeCloseTo(15 / 1660, 12);
    expect(f.gapPct).toBeCloseTo(1675 / 1601 - 1, 12);
  });

  it('distinguishes flat from no reference', () => {
    expect(computeCardFacts(FLAT)).toMatchObject({ direction: 'flat', deltaAbs: 0, hasRef: true });
    expect(computeCardFacts(NO_REF)).toMatchObject({ direction: 'unknown', deltaAbs: null, deltaPct: null, hasRef: false });
  });
});

describe('cardAltText', () => {
  it('describes an update in one plain Spanish paragraph', () => {
    const alt = cardAltText('update', DOWN);
    expect(alt).toContain('Dólar blue: venta $ 1.650, compra $ 1.630.');
    expect(alt).toContain('Bajó $ 25 (-1,49%) respecto del cierre anterior.');
    expect(alt).toContain('hora de Argentina');
    expect(alt).not.toMatch(/[− ]/);
  });

  it('describes weekly summaries, including one-day weeks', () => {
    expect(cardAltText('weekly', WEEK_UP)).toContain('resumen semanal del 16 al 20 de noviembre de 2026');
    expect(cardAltText('weekly', WEEK_ONE_DAY)).toContain('Un solo cierre en la semana.');
  });

  it('never claims "sin cambios" without a reference and stays within 420 characters', () => {
    expect(cardAltText('update', NO_REF)).not.toMatch(/sin cambios|Subió|Bajó/i);
    for (const data of [UP, DOWN, FLAT, BIG, WEEK_UP]) {
      expect(cardAltText('update', data).length).toBeLessThanOrEqual(420);
    }
  });
});
