/** Data of the history pages (`/historico/…`); `null` = no data for that period (answer 404). */
import { addDays } from '@bluelytics/core';
import { rangeStart, sliceSeries, type SeriesData } from './chart.ts';
import { loadCoverage, loadDays, loadSnapshot, todayArt } from './data.ts';
import { isClosed, periodEnd } from './history.ts';
import { toSeries, type DayRates } from './series.ts';
import type { Snapshot } from './snapshot.ts';

/** `YYYY-MM` keys of the months with data, ascending. */
export type Coverage = string[];

/** The history hub (`/historico`): the interactive chart, downloads and the yearly table. */
export interface HistoryIndexData {
  snapshot: Snapshot;
  /** The last year (what the server draws; the range presets fetch the rest on the client). */
  series: SeriesData;
  /** Every day with data, for the yearly table. */
  days: DayRates[];
}

export interface HistoryYearData {
  year: number;
  days: DayRates[];
  previous: number | null;
  next: number | null;
  closed: boolean;
}

export interface HistoryMonthData {
  year: number;
  month: number;
  days: DayRates[];
  previous: string | null;
  next: string | null;
  closed: boolean;
}

export interface HistoryDayData {
  day: string;
  rates: DayRates;
  /** The closest earlier day with data. */
  previous: DayRates | null;
  next: DayRates | null;
  /** Every day of the same month. */
  month: DayRates[];
  /** About 30 days either side, for the chart. */
  window: DayRates[];
  closed: boolean;
}

const hasData = (d: DayRates): boolean => (d.blue?.sell ?? 0) > 0 || (d.oficial?.sell ?? 0) > 0;

/** Neighbours of `key` in a sorted list. */
export function neighbours<T>(sorted: readonly T[], key: T): { previous: T | null; next: T | null } {
  const index = sorted.indexOf(key);
  if (index < 0) return { previous: null, next: null };
  return { previous: sorted[index - 1] ?? null, next: sorted[index + 1] ?? null };
}

export async function loadHistoryIndex(): Promise<HistoryIndexData> {
  const [snapshot, all] = await Promise.all([loadSnapshot(), loadDays()]);
  const days = all.filter(hasData);
  const series = toSeries(days);
  const last = series.days.at(-1);
  return { snapshot, series: last === undefined ? series : sliceSeries(series, rangeStart(last, '1y')), days };
}

export async function loadHistoryYear(year: number): Promise<HistoryYearData | null> {
  const [days, coverage] = await Promise.all([loadDays(`${year}-01-01`, periodEnd(year)), loadCoverage()]);
  const withData = days.filter(hasData);
  if (withData.length === 0) return null;
  const years = [...new Set(coverage.map((c) => Number(c.month.slice(0, 4))))];
  return { year, days: withData, ...neighbours(years, year), closed: isClosed(periodEnd(year), todayArt()) };
}

export async function loadHistoryMonth(year: number, month: number): Promise<HistoryMonthData | null> {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const [days, coverage] = await Promise.all([loadDays(`${key}-01`, periodEnd(year, month)), loadCoverage()]);
  const withData = days.filter(hasData);
  if (withData.length === 0) return null;
  const months = coverage.map((c) => c.month);
  return { year, month, days: withData, ...neighbours(months, key), closed: isClosed(periodEnd(year, month), todayArt()) };
}

export async function loadHistoryDay(day: string): Promise<HistoryDayData | null> {
  const monthStart = `${day.slice(0, 7)}-01`;
  const monthEnd = periodEnd(Number(day.slice(0, 4)), Number(day.slice(5, 7)));
  const from = [monthStart, addDays(day, -45)].sort()[0] as string;
  const to = [monthEnd, addDays(day, 45)].sort()[1] as string;
  const days = (await loadDays(from, to)).filter(hasData);
  const index = days.findIndex((d) => d.day === day);
  const rates = days[index];
  if (rates === undefined) return null;
  const windowFrom = addDays(day, -30);
  const windowTo = addDays(day, 30);
  return {
    day,
    rates,
    previous: days[index - 1] ?? null,
    next: days[index + 1] ?? null,
    month: days.filter((d) => d.day >= monthStart && d.day <= monthEnd),
    window: days.filter((d) => d.day >= windowFrom && d.day <= windowTo),
    closed: isClosed(day, todayArt()),
  };
}
