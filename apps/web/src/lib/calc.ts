/** Calculator arithmetic shared by the server render and the `<bl-calc>` element. */
import type { Locale } from '../i18n/routes.ts';

/** Rates in hundredths of a peso per unit of foreign currency. */
export type PriceKind = 'buy' | 'average' | 'sell';
export type CalcRates = Record<'blue' | 'oficial', Record<'usd' | 'eur', Record<PriceKind, number> | null>>;

/**
 * Any other currency of `currency.json`, converted through the dollar like the legacy calculator:
 * pesos per unit = dollar rate / units per USD.
 */
export interface CalcCurrency {
  code: string;
  name: string;
  /** Units of the currency per 1 USD, in hundredths (`currency.json` `value` × 100). */
  perUsdHundredths: number;
}

/** Hundredths of a peso per unit of `currency` at a dollar rate (unrounded: small currencies need the decimals). */
export function crossRateHundredths(usdRateHundredths: number, perUsdHundredths: number): number | null {
  return perUsdHundredths > 0 ? (usdRateHundredths * 100) / perUsdHundredths : null;
}

/** The smallest power of ten of units worth at least one peso, so `1 IDR = $ 0,10` reads `1.000 IDR = $ 103,12`. */
export function displayUnits(rateHundredths: number): number {
  let units = 1;
  while (rateHundredths * units < 100 && units < 1e9) units *= 10;
  return units;
}

/** Calculator currencies other than USD/EUR (which use the published rates): with a value, sorted by name. */
export function calcCurrencies(rows: readonly { code: string; name: string; valueHundredths: number | null }[], locale: Locale): CalcCurrency[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale === 'es' ? 'es-AR' : 'en'], { type: 'currency' });
  } catch {
    names = null;
  }
  return rows
    .filter((row) => row.valueHundredths !== null && row.valueHundredths > 0 && !['USD', 'EUR', 'ARS'].includes(row.code))
    .map((row) => {
      let name = row.name;
      if (locale === 'en' && names !== null) {
        try {
          const display = names.of(row.code);
          if (display && display !== row.code) name = display;
        } catch {
          // keep the stored (Spanish) name
        }
      }
      return { code: row.code, name, perUsdHundredths: row.valueHundredths as number };
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Parses user input in either locale's notation (`1.234,5` or `1,234.5`); `null` when not a number. */
export function parseAmount(text: string, locale: Locale): number | null {
  let clean = text.trim().replace(/[\s$ ]/g, '');
  if (clean === '') return null;
  if (locale === 'es') clean = clean.replace(/\./g, '').replace(',', '.');
  else clean = clean.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  return Number(clean);
}

/** Pesos (rounded to hundredths) for `amount` units at `rateHundredths`. */
export function toPesosHundredths(amount: number, rateHundredths: number): number {
  return Math.round(amount * rateHundredths);
}

/** Foreign units in hundredths for `pesos` at `rateHundredths`. */
export function toForeignHundredths(pesos: number, rateHundredths: number): number {
  return rateHundredths > 0 ? Math.round((pesos * 10_000) / rateHundredths) : 0;
}
