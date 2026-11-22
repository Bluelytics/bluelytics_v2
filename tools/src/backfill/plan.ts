import { seedAlerts, seedCurrencies, seedDailyRates, seedLatestRates } from '@bluelytics/contract';
import { RENDERED_KEYS } from '@bluelytics/core';
import type { AlertRow, CurrencyRow, DailyRow, PublishedState, RenderedKey } from '@bluelytics/core';
import { CliError } from '../cli.ts';
import type { LegacyBody } from './legacy.ts';

/** Rows converted from the legacy bodies. `currencies`/`latest` only exist in a full run. */
export interface BackfillData {
  daily: DailyRow[];
  alerts: AlertRow[];
  currencies?: CurrencyRow[];
  latest?: PublishedState;
}

export interface BackfillPlan {
  /** `--since` day, or `null` for a full run. */
  since: string | null;
  /** What is written to D1. */
  write: BackfillData;
  /** Everything downloaded (all days): what a dry run renders the bodies from. */
  all: BackfillData;
  /** The bodies to re-render: only those that depend on the tables written. */
  keys: readonly RenderedKey[];
}

/** `--since` touches only `daily_rates` and `alerts` (MIGRATION.md C8). */
export const SINCE_KEYS: readonly RenderedKey[] = ['alerts', 'evolution_json', 'evolution_csv'];

/** The legacy bodies a run needs. */
export const bodiesFor = (since: string | null): LegacyBody[] => (since === null ? ['evolution', 'alerts', 'currency', 'latest'] : ['evolution', 'alerts']);

function required(bodies: Partial<Record<LegacyBody, string>>, name: LegacyBody): string {
  const body = bodies[name];
  if (body === undefined) throw new CliError(`internal: ${name} was not downloaded`);
  return body;
}

/** Converts the legacy bodies with the contract seed helpers (exact `%.2f` parsing; throws on anything unexpected). */
export function planBackfill(bodies: Partial<Record<LegacyBody, string>>, since: string | null): BackfillPlan {
  const daily = seedDailyRates(required(bodies, 'evolution'));
  const alerts = seedAlerts(required(bodies, 'alerts'));
  if (daily.length === 0) throw new CliError('the legacy /v2/evolution.json is empty: refusing to backfill nothing');
  if (since !== null) {
    const all = { daily, alerts };
    return { since, write: { daily: daily.filter((row) => row.day >= since), alerts }, all, keys: SINCE_KEYS };
  }
  const currencies = seedCurrencies(required(bodies, 'currency'));
  const eur = currencies.find((row) => row.code === 'EUR')?.valueHundredths;
  if (eur === undefined || eur === null || eur <= 0) throw new CliError('the legacy currency.json has no usable EUR value');
  // The legacy euro figures were derived with this EUR value; consistent raw values keep them on a re-render.
  const latest = seedLatestRates(required(bodies, 'latest'), { eurPerUsd: eur / 100 });
  const all = { daily, alerts, currencies, latest };
  return { since: null, write: all, all, keys: RENDERED_KEYS };
}
