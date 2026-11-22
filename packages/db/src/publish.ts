import {
  RENDERED_CONTENT_TYPE,
  RENDERED_KEYS,
  etag,
  renderAlerts,
  renderCurrency,
  renderEvolutionCsv,
  renderEvolutionJson,
  renderLastPrice,
  renderLatest,
} from '@bluelytics/core';
import type { AlertRow, CurrencyRow, DailyRow, PublishedState, RenderedKey, RenderedRow } from '@bluelytics/core';
import { getLatestAlerts } from './alerts.ts';
import { getCurrencies } from './currencies.ts';
import type { D1DatabaseLike } from './d1.ts';
import { runBatch } from './d1.ts';
import { getEvolutionRows, getLatestRates } from './rates.ts';
import { getRenderedEtags, upsertRenderedStatements } from './rendered.ts';

export interface RenderOptions {
  /** `LEGACY_V1_BLUE_BUG`: `/json/last_price` shows the oficial values in its blue entry. */
  legacyBlueBug: boolean;
}

/** Everything the six API bodies are rendered from. */
export interface RenderSource {
  latest: PublishedState;
  alerts: { current: AlertRow | null; previous: AlertRow | null };
  /** In output order. */
  currencies: readonly CurrencyRow[];
  /** In API order: `day DESC`, Oficial before Blue. */
  daily: readonly DailyRow[];
}

function renderBody(key: RenderedKey, source: Partial<RenderSource>, options: RenderOptions): string {
  const need = <K extends keyof RenderSource>(name: K): RenderSource[K] => {
    const value = source[name];
    if (value === undefined) throw new Error(`render ${key}: missing ${name}`);
    return value;
  };
  switch (key) {
    case 'latest':
      return renderLatest(need('latest'));
    case 'last_price':
      return renderLastPrice(need('latest'), options);
    case 'alerts': {
      const { current, previous } = need('alerts');
      return renderAlerts(current, previous);
    }
    case 'currency':
      return renderCurrency(need('currencies'));
    case 'evolution_json':
      return renderEvolutionJson(need('daily'));
    case 'evolution_csv':
      return renderEvolutionCsv(need('daily'));
  }
}

/**
 * Pure: renders `keys` (default: all six) from data already in memory, so the jobs Worker can
 * write the bodies in the same D1 batch as the rows they come from. Only the parts of `source`
 * that the requested keys need must be present.
 */
export async function renderRows(
  source: Partial<RenderSource>,
  options: RenderOptions,
  keys: readonly RenderedKey[] = RENDERED_KEYS,
): Promise<RenderedRow[]> {
  return Promise.all(
    keys.map(async (key) => {
      const body = renderBody(key, source, options);
      return { key, contentType: RENDERED_CONTENT_TYPE[key], body, etag: await etag(body) };
    }),
  );
}

/** API order of `daily_rates`: `day DESC`, then Oficial before Blue. */
function compareEvolution(a: DailyRow, b: DailyRow): number {
  if (a.day !== b.day) return a.day < b.day ? 1 : -1;
  return a.tipo === b.tipo ? 0 : a.tipo === 'Oficial' ? -1 : 1;
}

/**
 * `evolution` (API order, as from `getEvolutionRows`) as it will be once `rows` are upserted: a row
 * with the same `(day, tipo)` is replaced, new ones are inserted in order. Lets a tick render the
 * evolution bodies in the same batch as its `daily_rates` upsert (ARCHITECTURE §7 step 3).
 */
export function mergeDailyRows(evolution: readonly DailyRow[], rows: readonly DailyRow[]): DailyRow[] {
  const replaced = new Set(rows.map((row) => `${row.day}|${row.tipo}`));
  const kept = evolution.filter((row) => !replaced.has(`${row.day}|${row.tipo}`));
  const latest = new Map(rows.map((row) => [`${row.day}|${row.tipo}`, row]));
  return [...kept, ...latest.values()].sort(compareEvolution);
}

/** Reads the tables that `keys` (default: all six) depend on and renders them. */
export async function buildRendered(
  db: D1DatabaseLike,
  options: RenderOptions & { keys?: readonly RenderedKey[] },
): Promise<RenderedRow[]> {
  const keys = options.keys ?? RENDERED_KEYS;
  const wants = (...candidates: RenderedKey[]): boolean => candidates.some((key) => keys.includes(key));
  const [latest, alerts, currencies, daily] = await Promise.all([
    wants('latest', 'last_price') ? getLatestRates(db) : undefined,
    wants('alerts') ? getLatestAlerts(db) : undefined,
    wants('currency') ? getCurrencies(db) : undefined,
    wants('evolution_json', 'evolution_csv') ? getEvolutionRows(db) : undefined,
  ]);
  const source: Partial<RenderSource> = {
    ...(latest && { latest }),
    ...(alerts && { alerts }),
    ...(currencies && { currencies }),
    ...(daily && { daily }),
  };
  return renderRows(source, { legacyBlueBug: options.legacyBlueBug }, keys);
}

/** Stores the rows whose etag differs from the stored one, in one batch; returns the keys written. */
export async function writeRendered(db: D1DatabaseLike, rows: readonly RenderedRow[], now: string = new Date().toISOString()): Promise<RenderedKey[]> {
  const stored = await getRenderedEtags(db);
  const changed = rows.filter((row) => stored[row.key] !== row.etag);
  await runBatch(db, upsertRenderedStatements(db, changed, now));
  return changed.map((row) => row.key);
}
