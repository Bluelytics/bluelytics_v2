/** Calculator arithmetic shared by the server render and the `<bl-calc>` element. */
import type { Locale } from '../i18n/routes.ts';

/** Rates in hundredths of a peso per unit of foreign currency. */
export type PriceKind = 'buy' | 'average' | 'sell';
export type CalcRates = Record<'blue' | 'oficial', Record<'usd' | 'eur', Record<PriceKind, number> | null>>;

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
