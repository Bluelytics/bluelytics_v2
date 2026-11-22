import { addSeconds, artDate, artParts, withEuro } from '@bluelytics/core';
import {
  getCurrencies,
  getLatestRates,
  getRenderedEtags,
  getState,
  insertObservationsStatements,
  pruneObservations,
  renderRows,
  runBatch,
  setStateStatement,
  upsertCurrenciesStatements,
  upsertExtraRatesStatements,
  upsertLatestRatesStatements,
  upsertRenderedStatements,
} from '@bluelytics/db';
import { ambitoExtras, fetchExtras } from '@bluelytics/scrapers';
import type { CurrencyUpdate } from './currencies.ts';
import { refreshCurrencies } from './currencies.ts';
import type { Deps } from './deps.ts';
import { errorText } from './errors.ts';

export const DAILY_STATE_KEY = 'daily_last_day';
/** The daily step runs on the first invocation at or after 06:00 ART (ARCHITECTURE §7). */
export const DAILY_FROM_HOUR = 6;
const OBSERVATION_RETENTION_DAYS = 90;

export interface DailyReport {
  day: string;
  currencies: Omit<Extract<CurrencyUpdate, { ok: true }>, 'rows'> | { ok: false; failures: string[] } | { ok: false; error: string };
  extraRates: number | { error: string };
  pruned: number | { error: string };
}

export async function isDailyDue(deps: Deps, now: string): Promise<boolean> {
  if (artParts(now).hour < DAILY_FROM_HOUR) return false;
  return (await getState(deps.db, DAILY_STATE_KEY))?.value !== artDate(now);
}

/**
 * Currencies (then `currency`, `latest` and `last_price` re-rendered with the new EUR), `extra_rates`
 * and the 90-day observation pruning. Each part fails on its own; the day is marked done either
 * way so a broken provider is not retried every five minutes.
 */
export async function runDaily(deps: Deps, now: string): Promise<DailyReport> {
  const day = artDate(now);
  const report: DailyReport = {
    day,
    currencies: await updateCurrencies(deps, now).catch((error: unknown) => ({ ok: false as const, error: errorText(error) })),
    extraRates: await captureExtras(deps, now).catch((error: unknown) => ({ error: errorText(error) })),
    pruned: await pruneObservations(deps.db, addSeconds(now, -OBSERVATION_RETENTION_DAYS * 86_400)).catch((error: unknown) => ({ error: errorText(error) })),
  };
  await runBatch(deps.db, [setStateStatement(deps.db, DAILY_STATE_KEY, day, now)]);
  return report;
}

async function updateCurrencies(deps: Deps, now: string): Promise<DailyReport['currencies']> {
  const { db } = deps;
  const [stored, latest, etags] = await Promise.all([getCurrencies(db), getLatestRates(db), getRenderedEtags(db)]);
  const update = await refreshCurrencies(stored, { fetch: deps.fetch, now });
  if (!update.ok) {
    deps.log('error', 'currency refresh rejected', { failures: update.failures });
    return update;
  }
  const merged = stored.map((row) => update.rows.find((next) => next.code === row.code) ?? row);
  const eur = merged.find((row) => row.code === 'EUR')?.valueHundredths;
  const state = withEuro(latest, eur ? eur / 100 : null);
  const rendered = (
    await renderRows({ latest: state, currencies: merged }, { legacyBlueBug: deps.config.legacyBlueBug }, ['currency', 'latest', 'last_price'])
  ).filter((row) => etags[row.key] !== row.etag);
  await runBatch(db, upsertCurrenciesStatements(db, update.rows), upsertLatestRatesStatements(db, state), upsertRenderedStatements(db, rendered, now));
  if (update.rejected.length > 0) deps.log('warn', 'currency jump rejected', { codes: update.rejected });
  const { rows: _rows, ...summary } = update;
  return summary;
}

async function captureExtras(deps: Deps, now: string): Promise<number> {
  const { observation, rates } = await fetchExtras(ambitoExtras, { fetch: deps.fetch, now });
  await runBatch(deps.db, insertObservationsStatements(deps.db, [observation]), upsertExtraRatesStatements(deps.db, rates));
  return rates.length;
}
