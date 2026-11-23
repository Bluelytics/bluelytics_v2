import { describe, expect, it } from 'vitest';
import { calcCurrencies, crossRateHundredths, displayUnits, parseAmount, toForeignHundredths, toPesosHundredths } from '../src/lib/calc.ts';

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

  it('converts any currency through the dollar like the legacy calculator', () => {
    // legacy: ars = ext / value * dolar. 100 BRL at 5.00 BRL/USD and a 1652.50 dollar = 33,050 ARS.
    const brl = crossRateHundredths(165_250, 500) as number;
    expect(toPesosHundredths(100, brl)).toBe(3_305_000);
    expect(toForeignHundredths(33_050, brl)).toBe(10_000);
    expect(crossRateHundredths(165_250, 0)).toBeNull();
    // small currencies keep their decimals: 1,000,000 IDR at 16,000 IDR/USD = 103,281.25 ARS
    expect(toPesosHundredths(1_000_000, crossRateHundredths(165_250, 1_600_000) as number)).toBe(10_328_125);
    expect(displayUnits(10.3)).toBe(10);
    expect(displayUnits(3305)).toBe(1);
  });

  it('lists the other currencies with a value, without USD, EUR and ARS, sorted by name', () => {
    const rows = [
      { code: 'USD', name: 'Dólar estadounidense', valueHundredths: 100 },
      { code: 'BRL', name: 'Real brasileño', valueHundredths: 500 },
      { code: 'BTC', name: 'Bitcoin', valueHundredths: 0 },
      { code: 'ARS', name: 'Peso argentino', valueHundredths: 160_000 },
      { code: 'CLP', name: 'Peso chileno', valueHundredths: 95_000 },
      { code: 'EUR', name: 'Euro', valueHundredths: 92 },
    ];
    expect(calcCurrencies(rows, 'es').map((c) => c.code)).toEqual(['CLP', 'BRL']);
    expect(calcCurrencies(rows, 'en').map((c) => c.name)).toEqual(['Brazilian Real', 'Chilean Peso']);
    expect(calcCurrencies(rows, 'es').every((c) => c.americas)).toBe(true);
  });
});
