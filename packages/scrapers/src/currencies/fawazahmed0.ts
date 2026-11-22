import { ParseError } from '../errors.ts';
import { isRecord, parseJson } from '../text.ts';
import { assertPlausibleRates, assertRecentDate, cleanRates } from './guards.ts';

/** `{"date":"2026-11-22","usd":{"ars":1579.69,"eur":0.9116,…}}` (CC0, keyless; crypto and metals included). */
export function parseFawazahmed0(text: string, today: string): { date: string; rates: Record<string, number> } {
  const data = parseJson(text);
  if (!isRecord(data) || !isRecord(data['usd'])) throw new ParseError('json', 'fawazahmed0: no "usd" object');
  const { date } = data;
  if (typeof date !== 'string') throw new ParseError('timestamp', 'fawazahmed0: no "date" string');
  assertRecentDate('fawazahmed0', date, today);
  const rates = cleanRates(data['usd']);
  assertPlausibleRates('fawazahmed0', rates);
  return { date, rates };
}
