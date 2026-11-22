import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatDateTime,
  formatDay,
  formatDayNumeric,
  formatHundredths,
  formatInteger,
  formatMonth,
  formatPercent,
  formatPesos,
  formatPesosHundredths,
  formatSignedInteger,
  formatSignedPercent,
  formatTime,
  MINUS,
  weekdayName,
} from '../src/lib/format.ts';

describe('es-AR and English number formatting', () => {
  it('groups thousands per locale', () => {
    expect(formatInteger(1675, 'es')).toBe('1.675');
    expect(formatInteger(1675, 'en')).toBe('1,675');
    expect(formatInteger(1_234_567, 'es')).toBe('1.234.567');
    expect(formatInteger(999, 'es')).toBe('999');
    expect(formatInteger(-1200, 'es')).toBe(`${MINUS}1.200`);
    expect(() => formatInteger(1.5, 'es')).toThrow(RangeError);
  });

  it('prints hundredths from integers', () => {
    expect(formatHundredths(165250, 'es')).toBe('1.652,50');
    expect(formatHundredths(165250, 'en')).toBe('1,652.50');
    expect(formatHundredths(5, 'es')).toBe('0,05');
    expect(formatPesosHundredths(165250, 'es')).toBe('$\u00a01.652,50');
  });

  it('adds the currency sign with a non-breaking space (U+00A0) in Spanish', () => {
    expect(formatPesos(1675, 'es')).toBe('$\u00a01.675');
    expect(formatPesos(1675, 'en')).toBe('$1,675');
  });

  it('signs moves and percentages', () => {
    expect(formatSignedInteger(30, 'es')).toBe('+30');
    expect(formatSignedInteger(-30, 'es')).toBe(`${MINUS}30`);
    expect(formatSignedInteger(0, 'es')).toBe('0');
    expect(formatPercent(0.0431, 'es')).toBe('4,3\u00a0%');
    expect(formatPercent(0.0431, 'en')).toBe('4.3%');
    expect(formatSignedPercent(0.0183, 'es', 2)).toBe('+1,83\u00a0%');
    expect(formatSignedPercent(-0.0183, 'en', 2)).toBe(`${MINUS}1.83%`);
    expect(formatSignedPercent(-0.00001, 'es')).toBe('0,0\u00a0%');
    expect(formatPercent(1.989, 'es')).toBe('198,9\u00a0%');
  });
});

describe('dates in Argentine time', () => {
  it('formats days', () => {
    expect(formatDay('2026-11-20', 'es')).toBe('20 de noviembre de 2026');
    expect(formatDay('2026-11-20', 'en')).toBe('November 20, 2026');
    expect(formatDay('2026-09-05', 'es', 'short')).toBe('5 sept 2026');
    expect(formatDayNumeric('2026-11-20', 'es')).toBe('20/11');
    expect(formatDayNumeric('2026-11-20', 'en', true)).toBe('11/20/2026');
    expect(formatMonth(2024, 3, 'es')).toBe('marzo de 2024');
    expect(weekdayName('2026-11-20', 'es')).toBe('viernes');
  });

  it('converts instants to the 24-hour Buenos Aires clock', () => {
    expect(formatTime('2026-11-20T22:45:51.758024Z')).toBe('19:45');
    expect(formatTime('2026-11-21T01:05:00Z')).toBe('22:05');
    expect(formatDateTime('2026-11-21T01:05:00Z', 'es')).toBe('20 nov 2026, 22:05');
  });

  it('describes elapsed time coarsely', () => {
    expect(formatAgo('2026-11-20T22:00:00Z', '2026-11-20T22:05:30Z', 'es')).toBe('hace 5 min');
    expect(formatAgo('2026-11-20T10:00:00Z', '2026-11-20T22:00:00Z', 'en')).toBe('12 h ago');
    expect(formatAgo('2026-11-10T10:00:00Z', '2026-11-20T22:00:00Z', 'es')).toBe('hace 10 días');
  });
});
