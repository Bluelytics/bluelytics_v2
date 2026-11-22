import { addDays } from '@bluelytics/core';
import type { DailyRow, DailyTipo } from '@bluelytics/core';
import type { D1DatabaseLike, D1Value } from './d1.ts';
import { dailyFromRecord } from './rates.ts';

type DailyRecord = Parameters<typeof dailyFromRecord>[0];

/** `daily_rates` rows with `from <= day <= to` (either bound optional), oldest first, Oficial before Blue within a day. */
export async function getDailyRowsBetween(
  db: D1DatabaseLike,
  range: { from?: string; to?: string; tipo?: DailyTipo } = {},
): Promise<DailyRow[]> {
  const where: string[] = [];
  const values: D1Value[] = [];
  if (range.from !== undefined) {
    where.push('day >= ?');
    values.push(range.from);
  }
  if (range.to !== undefined) {
    where.push('day <= ?');
    values.push(range.to);
  }
  if (range.tipo !== undefined) {
    where.push('tipo = ?');
    values.push(range.tipo);
  }
  const sql = `SELECT * FROM daily_rates${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY day, tipo DESC`;
  const { results } = await db.prepare(sql).bind(...values).all<DailyRecord>();
  return results.map(dailyFromRecord);
}

/**
 * At most `maxPoints` evenly spaced elements of `rows`, always keeping the first and the last
 * (chart series). `maxPoints >= 2`; shorter inputs are returned unchanged.
 */
export function downsample<T>(rows: readonly T[], maxPoints: number): T[] {
  if (!Number.isInteger(maxPoints) || maxPoints < 2) throw new RangeError(`downsample: maxPoints must be an integer >= 2, got ${maxPoints}`);
  if (rows.length <= maxPoints) return [...rows];
  const picked: T[] = [];
  for (let i = 0; i < maxPoints; i++) picked.push(rows[Math.round((i * (rows.length - 1)) / (maxPoints - 1))] as T);
  return picked;
}

/** One rate's daily series, oldest first, optionally limited to a range and downsampled for a chart. */
export async function getDailySeries(
  db: D1DatabaseLike,
  options: { tipo: DailyTipo; from?: string; to?: string; maxPoints?: number },
): Promise<DailyRow[]> {
  const rows = await getDailyRowsBetween(db, options);
  return options.maxPoints === undefined ? rows : downsample(rows, options.maxPoints);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Rows of one day (`/historico/yyyy/mm/dd`): Oficial then Blue; empty when there is no data. */
export function getHistoryDay(db: D1DatabaseLike, day: string): Promise<DailyRow[]> {
  return getDailyRowsBetween(db, { from: day, to: day });
}

/** Rows of one calendar month (`month` 1–12), oldest first. */
export function getHistoryMonth(db: D1DatabaseLike, year: number, month: number): Promise<DailyRow[]> {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`getHistoryMonth: invalid month ${month}`);
  const first = `${String(year).padStart(4, '0')}-${pad2(month)}-01`;
  const next = month === 12 ? `${String(year + 1).padStart(4, '0')}-01-01` : `${String(year).padStart(4, '0')}-${pad2(month + 1)}-01`;
  return getDailyRowsBetween(db, { from: first, to: addDays(next, -1) });
}

/** Rows of one calendar year, oldest first. */
export function getHistoryYear(db: D1DatabaseLike, year: number): Promise<DailyRow[]> {
  const yyyy = String(year).padStart(4, '0');
  return getDailyRowsBetween(db, { from: `${yyyy}-01-01`, to: `${yyyy}-12-31` });
}

/** Which months have data and how many days each (`YYYY-MM`, oldest first): navigation and sitemaps. */
export async function getHistoryCoverage(db: D1DatabaseLike): Promise<{ month: string; days: number }[]> {
  const { results } = await db
    .prepare('SELECT substr(day, 1, 7) AS month, COUNT(DISTINCT day) AS days FROM daily_rates GROUP BY month ORDER BY month')
    .all<{ month: string; days: number }>();
  return results;
}
