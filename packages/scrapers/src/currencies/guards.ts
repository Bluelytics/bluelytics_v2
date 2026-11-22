import { isValidDay } from '@bluelytics/core';
import { ParseError } from '../errors.ts';

/** Units of each currency per 1 USD, upper-case ISO-style codes, from one provider. */
export interface CurrencyRates {
  provider: CurrencyProviderId;
  url: string;
  /** `YYYY-MM-DD` the provider dates its rates with. */
  date: string;
  rates: Record<string, number>;
}

export type CurrencyProviderId = 'fawazahmed0' | 'frankfurter_v2';

/** ARCHITECTURE §7 daily currency guards (the per-code jump guard needs stored values: the jobs Worker applies it). */
export const CURRENCY_GUARDS = {
  minCodes: 150,
  eur: { above: 0.5, below: 1.5 },
  arsAbove: 100,
  maxAgeDays: 3,
} as const;

/** Whole days from `day` to `today` (positive = `day` is in the past). */
export function daysBefore(day: string, today: string): number {
  if (!isValidDay(day)) throw new ParseError('timestamp', `not a calendar date: ${JSON.stringify(day)}`);
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}

/** Rates dated more than 3 days away from `today` (UTC date of the run) are a stale copy. */
export function assertRecentDate(provider: CurrencyProviderId, date: string, today: string): void {
  if (Math.abs(daysBefore(date, today)) > CURRENCY_GUARDS.maxAgeDays) {
    throw new ParseError('stale', `${provider}: rates are dated ${date}, more than ${CURRENCY_GUARDS.maxAgeDays} days from ${today}`);
  }
}

/** Positive finite numbers only, keys upper-cased; anything else is dropped. */
export function cleanRates(raw: Record<string, unknown>): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) rates[code.toUpperCase()] = value;
  }
  return rates;
}

/** Refuses a table that is incomplete, not USD-based, or has an implausible EUR or ARS. */
export function assertPlausibleRates(provider: CurrencyProviderId, rates: Record<string, number>): void {
  const count = Object.keys(rates).length;
  if (count < CURRENCY_GUARDS.minCodes) throw new ParseError('guard', `${provider}: only ${count} currencies (need ${CURRENCY_GUARDS.minCodes})`);
  const usd = rates['USD'];
  if (usd !== undefined && Math.abs(usd - 1) > 1e-6) throw new ParseError('guard', `${provider}: USD is ${usd}, rates are not per 1 USD`);
  const eur = rates['EUR'];
  if (eur === undefined || !(eur > CURRENCY_GUARDS.eur.above && eur < CURRENCY_GUARDS.eur.below)) {
    throw new ParseError('guard', `${provider}: EUR is ${eur} (need ${CURRENCY_GUARDS.eur.above} < EUR < ${CURRENCY_GUARDS.eur.below})`);
  }
  const ars = rates['ARS'];
  if (ars === undefined || !(ars > CURRENCY_GUARDS.arsAbove)) throw new ParseError('guard', `${provider}: ARS is ${ars} (need > ${CURRENCY_GUARDS.arsAbove})`);
}
