import type { AlertRow } from '@bluelytics/core';
import { toStoredUtc } from '@bluelytics/core';
import type { D1DatabaseLike, D1StatementLike } from './d1.ts';
import { insertRowsStatements } from './d1.ts';

interface AlertRecord {
  id: number;
  alert_at: string;
  buy: number;
  sell: number;
  push_status: string | null;
}

function alertFromRecord(row: AlertRecord): AlertRow {
  return { id: row.id, alertAt: row.alert_at, buy: row.buy, sell: row.sell, pushStatus: row.push_status };
}

export interface NewAlert {
  alertAt: string;
  buy: number;
  sell: number;
  pushStatus?: string | null;
}

/** Inserts a new alert (record first, then send the push) and returns it with its id. */
export async function insertAlert(db: D1DatabaseLike, alert: NewAlert): Promise<AlertRow> {
  const row = await db
    .prepare('INSERT INTO alerts (alert_at, buy, sell, push_status) VALUES (?, ?, ?, ?) RETURNING *')
    .bind(alert.alertAt, alert.buy, alert.sell, alert.pushStatus ?? null)
    .first<AlertRecord>();
  if (!row) throw new Error('insertAlert: no row returned');
  return alertFromRecord(row);
}

/**
 * Inserts the alert only when no alert exists at or after `since` (the jobs Worker passes
 * `now − cooldown`), in one statement, so two overlapping runs (a cron run and a forced
 * `/admin/run`) cannot both record and push the same move. `null` = another run got there first.
 */
export async function insertAlertUnlessRecent(db: D1DatabaseLike, alert: NewAlert, since: string): Promise<AlertRow | null> {
  const row = await db
    .prepare(
      'INSERT INTO alerts (alert_at, buy, sell, push_status) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE alert_at >= ?) RETURNING *',
    )
    .bind(alert.alertAt, alert.buy, alert.sell, alert.pushStatus ?? null, toStoredUtc(since))
    .first<AlertRecord>();
  return row ? alertFromRecord(row) : null;
}

/** Inserts alerts with explicit ids (backfill: the autoincrement then continues after the largest id). */
export function insertAlertsStatements(db: D1DatabaseLike, alerts: readonly AlertRow[]): D1StatementLike[] {
  return insertRowsStatements(
    db,
    'alerts',
    ['id', 'alert_at', 'buy', 'sell', 'push_status'],
    alerts.map((alert) => [alert.id, alert.alertAt, alert.buy, alert.sell, alert.pushStatus]),
  );
}

/** Records the outcome of the push for an alert (e.g. `sent`, `failed: …`, `disabled`). */
export async function setAlertPushStatus(db: D1DatabaseLike, id: number, pushStatus: string): Promise<void> {
  await db.prepare('UPDATE alerts SET push_status = ? WHERE id = ?').bind(pushStatus, id).run();
}

/** The newest alert and the one before it (what `/v2/alerts` shows); `null` where missing. */
export async function getLatestAlerts(db: D1DatabaseLike): Promise<{ current: AlertRow | null; previous: AlertRow | null }> {
  const { results } = await db.prepare('SELECT * FROM alerts ORDER BY alert_at DESC, id DESC LIMIT 2').all<AlertRecord>();
  const [current, previous] = results.map(alertFromRecord);
  return { current: current ?? null, previous: previous ?? null };
}
