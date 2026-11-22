import { toStoredUtc } from '@bluelytics/core';
import type { Observation, ObservationKind, SourceId } from '@bluelytics/core';
import type { D1DatabaseLike, D1StatementLike } from './d1.ts';
import { insertRowsStatements, toBoolean } from './d1.ts';

interface ObservationRecord {
  run_at: string;
  source: SourceId;
  kind: ObservationKind;
  ok: number;
  buy_cents: number | null;
  sell_cents: number | null;
  source_ts: string | null;
  error: string | null;
  duration_ms: number | null;
}

/** One `observations` row per element (successes and failures); `runAt` is stored in storage form. */
export function insertObservationsStatements(db: D1DatabaseLike, observations: readonly Observation[]): D1StatementLike[] {
  return insertRowsStatements(
    db,
    'observations',
    ['run_at', 'source', 'kind', 'ok', 'buy_cents', 'sell_cents', 'source_ts', 'error', 'duration_ms'],
    observations.map((o) => [toStoredUtc(o.runAt), o.source, o.kind, o.ok ? 1 : 0, o.buyCents, o.sellCents, o.sourceTs, o.error, o.durationMs]),
  );
}

/** Successful observations with `run_at >= since`, newest first: the `recent` input of `computeConsensus`. */
export async function getFreshObservations(db: D1DatabaseLike, since: string): Promise<Observation[]> {
  const { results } = await db
    .prepare('SELECT * FROM observations WHERE run_at >= ? AND ok = 1 ORDER BY run_at DESC, id DESC')
    .bind(toStoredUtc(since))
    .all<ObservationRecord>();
  return results.map((row) => ({
    runAt: row.run_at,
    source: row.source,
    kind: row.kind,
    ok: toBoolean(row.ok),
    buyCents: row.buy_cents,
    sellCents: row.sell_cents,
    sourceTs: row.source_ts,
    error: row.error,
    durationMs: row.duration_ms,
  }));
}

/** Per-source summary of the observations since a given instant (`/estado`, `/admin/health`, ops alerts). */
export interface SourceHealth {
  source: SourceId;
  kind: ObservationKind;
  runs: number;
  okRuns: number;
  lastRunAt: string;
  /** `null` when the source has not succeeded since the cut-off. */
  lastOkAt: string | null;
  /** Failed runs after the last success (all runs since the cut-off when there was none). */
  consecutiveFailures: number;
  lastBuyCents: number | null;
  lastSellCents: number | null;
  lastError: string | null;
  avgDurationMs: number | null;
}

interface HealthRecord {
  source: SourceId;
  kind: ObservationKind;
  runs: number;
  ok_runs: number;
  last_run_at: string;
  last_ok_at: string | null;
  consecutive_failures: number;
  last_buy_cents: number | null;
  last_sell_cents: number | null;
  last_error: string | null;
  avg_duration_ms: number | null;
}

const HEALTH_SQL = `
WITH recent AS (SELECT * FROM observations WHERE run_at >= ?1),
last_ok AS (SELECT source, MAX(run_at) AS last_ok_at FROM recent WHERE ok = 1 GROUP BY source)
SELECT r.source, MAX(r.kind) AS kind, COUNT(*) AS runs, SUM(r.ok) AS ok_runs, MAX(r.run_at) AS last_run_at, l.last_ok_at,
  SUM(CASE WHEN l.last_ok_at IS NULL OR r.run_at > l.last_ok_at THEN 1 ELSE 0 END) AS consecutive_failures,
  (SELECT buy_cents FROM recent o WHERE o.source = r.source AND o.ok = 1 ORDER BY o.run_at DESC, o.id DESC LIMIT 1) AS last_buy_cents,
  (SELECT sell_cents FROM recent o WHERE o.source = r.source AND o.ok = 1 ORDER BY o.run_at DESC, o.id DESC LIMIT 1) AS last_sell_cents,
  (SELECT error FROM recent o WHERE o.source = r.source AND o.ok = 0 ORDER BY o.run_at DESC, o.id DESC LIMIT 1) AS last_error,
  AVG(r.duration_ms) AS avg_duration_ms
FROM recent r LEFT JOIN last_ok l ON l.source = r.source
GROUP BY r.source
ORDER BY r.source`;

/** Health of every source that has observations with `run_at >= since`, ordered by source id. */
export async function getSourceHealth(db: D1DatabaseLike, since: string): Promise<SourceHealth[]> {
  const { results } = await db.prepare(HEALTH_SQL).bind(toStoredUtc(since)).all<HealthRecord>();
  return results.map((row) => ({
    source: row.source,
    kind: row.kind,
    runs: row.runs,
    okRuns: row.ok_runs,
    lastRunAt: row.last_run_at,
    lastOkAt: row.last_ok_at,
    consecutiveFailures: row.consecutive_failures,
    lastBuyCents: row.last_buy_cents,
    lastSellCents: row.last_sell_cents,
    lastError: row.last_error,
    avgDurationMs: row.avg_duration_ms,
  }));
}

/** Deletes observations with `run_at < before` (ARCHITECTURE §5: older than 90 days); returns how many. */
export async function pruneObservations(db: D1DatabaseLike, before: string): Promise<number> {
  const result = await db.prepare('DELETE FROM observations WHERE run_at < ?').bind(toStoredUtc(before)).run();
  return result.meta.changes;
}
