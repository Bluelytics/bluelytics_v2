import { describe, expect, it } from 'vitest';
import { ParseError, jsonPriceCents, parsePriceCents } from '../src/index.ts';

describe('parsePriceCents', () => {
  it.each([
    ['$ 1.655,00', 'ar', 165500],
    ['1548,41', 'ar', 154841],
    ['$1.675', 'ar', 167500],
    ['$<!-- -->1615,05', 'ar', 161505],
    ['$<!-- --> <!-- -->1.675', 'ar', 167500],
    ['24600,00', 'ar', 2460000],
    ['1.234.567,89', 'ar', 123456789],
    ['&nbsp;1.655,005', 'ar', 165501],
    ['1571.0000', 'en', 157100],
    ['1655', 'en', 165500],
    ['1694.4806', 'en', 169448],
  ] as const)('%s (%s) → %i centavos', (raw, format, cents) => {
    expect(parsePriceCents(raw, format)).toBe(cents);
  });

  it.each([
    ['1655.50', 'ar'], // '.' is a thousands separator in 'ar': this would read 165550
    ['16.55,00', 'ar'],
    ['1,655.00', 'en'],
    ['1.655,00', 'en'],
    ['-5', 'ar'],
    ['N/D', 'ar'],
    ['', 'ar'],
    ['1.655,00 1.675,00', 'ar'],
    ['0,00', 'ar'],
  ] as const)('%j (%s) throws instead of guessing', (raw, format) => {
    expect(() => parsePriceCents(raw, format)).toThrow(ParseError);
  });
});

describe('jsonPriceCents', () => {
  it('accepts positive finite JSON numbers only', () => {
    expect(jsonPriceCents(1655, 'x')).toBe(165500);
    expect(jsonPriceCents(1694.4806, 'x')).toBe(169448);
    for (const bad of ['1655', null, undefined, true, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(() => jsonPriceCents(bad, 'x')).toThrow(ParseError);
    }
  });
});
