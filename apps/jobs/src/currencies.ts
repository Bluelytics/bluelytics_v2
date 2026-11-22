import type { CurrencyRow } from '@bluelytics/core';
import { numberToHundredths } from '@bluelytics/core';
import type { CurrencyRates, FetchDeps } from '@bluelytics/scrapers';
import { CURRENCY_SOURCES, describeError, fetchCurrencies, fetchCurrencySource } from '@bluelytics/scrapers';

/** A code moving more than this against its stored value needs the other provider's confirmation (ARCHITECTURE §7). */
export const MAX_CURRENCY_JUMP_PERCENT = 30;
/** Two providers "agree" on a code within this distance (percent, inclusive). */
export const PROVIDER_AGREEMENT_PERCENT = 5;

export type CurrencyUpdate =
  | { ok: true; provider: string; date: string; rows: CurrencyRow[]; updated: number; rejected: string[]; failures: string[] }
  | { ok: false; failures: string[] };

/** More than `percent` % apart, ignoring a one-hundredth rounding step (small currencies such as KWD 0.31). */
function differs(next: number, reference: number, percent: number): boolean {
  const difference = Math.abs(next - reference);
  return difference > 1 && difference * 100 > percent * Math.abs(reference);
}

/**
 * The daily currency refresh: the first provider passing the table guards (scrapers), then the
 * per-code jump guard against the stored values. Only codes already in `currencies` are updated
 * (names and order are the legacy contract); codes a provider no longer lists keep their value.
 */
export async function refreshCurrencies(stored: readonly CurrencyRow[], deps: FetchDeps): Promise<CurrencyUpdate> {
  const fetched = await fetchCurrencies(deps);
  if (!fetched.ok) return fetched;
  const { result, failures } = fetched;
  let secondOpinion: Promise<CurrencyRates | null> | undefined;
  const confirm = (): Promise<CurrencyRates | null> =>
    (secondOpinion ??= fetchCurrencySource(otherProvider(result), deps).catch((error: unknown) => {
      failures.push(`second opinion: ${describeError(error)}`);
      return null;
    }));

  const rows: CurrencyRow[] = [];
  const rejected: string[] = [];
  for (const row of stored) {
    const rate = result.rates[row.code];
    if (rate === undefined) continue;
    const value = numberToHundredths(rate);
    if (value === row.valueHundredths) continue;
    if (row.valueHundredths !== null && row.valueHundredths > 0 && differs(value, row.valueHundredths, MAX_CURRENCY_JUMP_PERCENT)) {
      const other = (await confirm())?.rates[row.code];
      if (other === undefined || differs(numberToHundredths(other), value, PROVIDER_AGREEMENT_PERCENT)) {
        rejected.push(row.code);
        continue;
      }
    }
    rows.push({ ...row, valueHundredths: value, valueDate: result.date });
  }
  return { ok: true, provider: result.provider, date: result.date, rows, updated: rows.length, rejected, failures };
}

function otherProvider(result: CurrencyRates) {
  const other = CURRENCY_SOURCES.find((source) => source.provider !== result.provider);
  if (!other) throw new Error('no second currency provider configured');
  return other;
}
