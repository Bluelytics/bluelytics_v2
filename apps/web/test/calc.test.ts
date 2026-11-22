import { describe, expect, it } from 'vitest';
import { parseAmount, toForeignHundredths, toPesosHundredths } from '../src/lib/calc.ts';

describe('calculator arithmetic', () => {
  it('parses amounts in each locale', () => {
    expect(parseAmount('1.234,5', 'es')).toBe(1234.5);
    expect(parseAmount('$ 100', 'es')).toBe(100);
    expect(parseAmount('1,234.5', 'en')).toBe(1234.5);
    expect(parseAmount('', 'es')).toBeNull();
    expect(parseAmount('abc', 'en')).toBeNull();
    expect(parseAmount('-5', 'es')).toBeNull();
  });

  it('converts at the average rate like the legacy calculator', () => {
    // Legacy check (legacy-frontend.md §4.2): blue avg 1652.50, 100000 ARS → 60.51 USD.
    expect(toForeignHundredths(100_000, 165_250)).toBe(6051);
    expect(toPesosHundredths(100, 165_250)).toBe(16_525_000);
    expect(toForeignHundredths(10, 0)).toBe(0);
  });
});
