import type { ConsensusResult, DailyRow, Observation, PublishedState, RenderedKey } from '@bluelytics/core';
import { RENDERED_KEYS, addSeconds, artDate, computeConsensus, dailyRowsFromState, tickFromConsensus } from '@bluelytics/core';
import type { D1StatementLike, RenderSource } from '@bluelytics/db';
import {
  getCurrencies,
  getCurrency,
  getDailyRowsBetween,
  getEvolutionRows,
  getFreshObservations,
  getLatestAlerts,
  getLatestRates,
  getRenderedEtags,
  insertObservationsStatements,
  insertTickStatement,
  mergeDailyRows,
  renderRows,
  runBatch,
  upsertDailyRowsStatements,
  upsertLatestRatesStatements,
  upsertRenderedStatements,
} from '@bluelytics/db';
import { fetchAll } from '@bluelytics/scrapers';
import type { Deps } from './deps.ts';

const FRESHNESS_SECONDS = 30 * 60;

export interface TickResult {
  observations: Observation[];
  previous: PublishedState;
  consensus: ConsensusResult;
  /** Bodies whose etag changed and were written in the tick's batch. */
  rendered: RenderedKey[];
}

/** Whether today's stored rows already carry the values about to be upserted (then the evolution bodies cannot change). */
function sameDailyValues(stored: readonly DailyRow[], next: readonly DailyRow[]): boolean {
  return (
    stored.length === next.length &&
    next.every((row) => stored.some((old) => old.tipo === row.tipo && old.buy === row.buy && old.sell === row.sell))
  );
}

/**
 * Steps 1–3 of ARCHITECTURE §7: fetch every source, compute the consensus, and write observations,
 * `latest_rates`, today's `daily_rates`, the tick and every changed body in one D1 batch.
 * The two evolution bodies (about 700 KB each) are rebuilt only when today's values moved.
 */
export async function runTick(deps: Deps, now: string): Promise<TickResult> {
  const { db } = deps;
  const day = artDate(now);
  const observations = await fetchAll(deps.sources, { fetch: deps.fetch, now });
  const [recent, previous, eur, todayRows, etags] = await Promise.all([
    getFreshObservations(db, addSeconds(now, -FRESHNESS_SECONDS)),
    getLatestRates(db),
    getCurrency(db, 'EUR'),
    getDailyRowsBetween(db, { from: day, to: day }),
    getRenderedEtags(db),
  ]);
  const eurPerUsd = eur?.valueHundredths ? eur.valueHundredths / 100 : null;
  const consensus = computeConsensus({ now, observations, recent, previous, eurPerUsd });
  const daily = dailyRowsFromState(now, consensus.state);
  const tick = tickFromConsensus(now, consensus);

  const keys = new Set<RenderedKey>(['latest', 'last_price']);
  if (!sameDailyValues(todayRows, daily)) keys.add('evolution_json').add('evolution_csv');
  // Self-healing: a body that was never rendered (fresh database) is rendered now.
  for (const key of RENDERED_KEYS) if (etags[key] === undefined) keys.add(key);
  const source = await renderSource(deps, consensus.state, daily, keys);
  const rows = (await renderRows(source, { legacyBlueBug: deps.config.legacyBlueBug }, [...keys])).filter((row) => etags[row.key] !== row.etag);

  const tickStatements: D1StatementLike[] = tick ? [insertTickStatement(db, tick)] : [];
  await runBatch(
    db,
    insertObservationsStatements(db, observations),
    upsertLatestRatesStatements(db, consensus.state),
    upsertDailyRowsStatements(db, daily),
    tickStatements,
    upsertRenderedStatements(db, rows, now),
  );
  return { observations, previous, consensus, rendered: rows.map((row) => row.key) };
}

async function renderSource(deps: Deps, latest: PublishedState, daily: readonly DailyRow[], keys: ReadonlySet<RenderedKey>): Promise<Partial<RenderSource>> {
  const { db } = deps;
  const [evolution, alerts, currencies] = await Promise.all([
    keys.has('evolution_json') || keys.has('evolution_csv') ? getEvolutionRows(db) : undefined,
    keys.has('alerts') ? getLatestAlerts(db) : undefined,
    keys.has('currency') ? getCurrencies(db) : undefined,
  ]);
  return {
    latest,
    ...(evolution && { daily: mergeDailyRows(evolution, daily) }),
    ...(alerts && { alerts }),
    ...(currencies && { currencies }),
  };
}

/**
 * A run outside the trading window (only `POST /admin/run?force=1`): sources are fetched and
 * recorded, and the bodies are re-rendered from the stored tables. Nothing else is written
 * (MIGRATION.md C6: no `daily_rates`, `ticks`, `alerts`, `social_posts`, nor `latest_rates`).
 */
export async function runObservationOnly(deps: Deps, now: string): Promise<{ observations: Observation[] }> {
  const observations = await fetchAll(deps.sources, { fetch: deps.fetch, now });
  await runBatch(deps.db, insertObservationsStatements(deps.db, observations));
  return { observations };
}
