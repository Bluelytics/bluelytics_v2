import { isValidDay } from '@bluelytics/core';
import { ParseError } from '../errors.ts';
import { isRecord, parseJson } from '../text.ts';
import { CURRENCY_GUARDS, assertPlausibleRates, daysBefore } from './guards.ts';

/**
 * Frankfurter v2 `/v2/rates?base=USD`: `[{"date","base":"USD","quote","rate"},…]`, each row with its
 * own date (central banks publish on different days). Rows older than 3 days are dropped; the table
 * is dated by its newest row.
 */
export function parseFrankfurterV2(text: string, today: string): { date: string; rates: Record<string, number> } {
  const data = parseJson(text);
  if (!Array.isArray(data)) throw new ParseError('json', 'frankfurter_v2: answer is not a JSON array');
  const rates: Record<string, number> = {};
  let newest: string | null = null;
  for (const row of data) {
    if (!isRecord(row) || row['base'] !== 'USD') continue;
    const { date, quote, rate } = row;
    if (typeof date !== 'string' || typeof quote !== 'string' || typeof rate !== 'number') continue;
    if (!Number.isFinite(rate) || rate <= 0 || !isValidDay(date)) continue;
    if (Math.abs(daysBefore(date, today)) > CURRENCY_GUARDS.maxAgeDays) continue;
    rates[quote.toUpperCase()] = rate;
    if (newest === null || date > newest) newest = date;
  }
  if (newest === null) throw new ParseError('stale', `frankfurter_v2: no USD rate dated within ${CURRENCY_GUARDS.maxAgeDays} days of ${today}`);
  assertPlausibleRates('frankfurter_v2', rates);
  return { date: newest, rates };
}
