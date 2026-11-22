import { describe, expect, it } from 'vitest';
import { isClosed, parseDayParams, parseMonth, parseYear, periodEnd } from '../src/lib/history.ts';

describe('history URL parameters', () => {
  it('accepts years with data only', () => {
    expect(parseYear('2024', 2026)).toBe(2024);
    expect(parseYear('2010', 2026)).toBeNull();
    expect(parseYear('2027', 2026)).toBeNull();
    expect(parseYear('24', 2026)).toBeNull();
    expect(parseYear(undefined, 2026)).toBeNull();
  });

  it('accepts only canonical two-digit months and real days', () => {
    expect(parseMonth('03')).toBe(3);
    expect(parseMonth('3')).toBeNull();
    expect(parseMonth('13')).toBeNull();
    expect(parseDayParams(2024, 2, '29')).toBe('2024-02-29');
    expect(parseDayParams(2023, 2, '29')).toBeNull();
    expect(parseDayParams(2024, 3, '5')).toBeNull();
  });

  it('knows period ends and closed periods', () => {
    expect(periodEnd(2024)).toBe('2024-12-31');
    expect(periodEnd(2024, 2)).toBe('2024-02-29');
    expect(periodEnd(2024, 12)).toBe('2024-12-31');
    expect(isClosed('2026-11-20', '2026-11-22')).toBe(true);
    expect(isClosed('2026-11-22', '2026-11-22')).toBe(false);
  });
});
