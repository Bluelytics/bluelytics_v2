/** Pure transforms of `daily_rates` rows for charts, tables and history pages. */
import { averageHundredths } from '@bluelytics/core';
import type { DailyRow, RatePair } from '@bluelytics/core';
import type { SeriesData } from './chart.ts';

/** One day with both rates (either may be missing). */
export interface DayRates {
  day: string;
  blue: RatePair | null;
  oficial: RatePair | null;
}

/** Groups rows (any order) by day, oldest first. */
export function groupByDay(rows: readonly DailyRow[]): DayRates[] {
  const byDay = new Map<string, DayRates>();
  for (const row of rows) {
    const entry = byDay.get(row.day) ?? { day: row.day, blue: null, oficial: null };
    const pair = { buy: row.buy, sell: row.sell };
    if (row.tipo === 'Blue') entry.blue = pair;
    else entry.oficial = pair;
    byDay.set(row.day, entry);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Sell closes per day, the shape charts and `/data/series.json` use. A zero sell counts as missing. */
export function toSeries(days: readonly DayRates[]): SeriesData {
  const sell = (pair: RatePair | null): number | null => (pair !== null && pair.sell > 0 ? pair.sell : null);
  return { days: days.map((d) => d.day), blue: days.map((d) => sell(d.blue)), oficial: days.map((d) => sell(d.oficial)) };
}

/** Change from `previous` to `current` (both whole pesos). */
export interface Move {
  previous: number;
  delta: number;
  ratio: number;
  direction: 'up' | 'down' | 'flat';
}

export function move(current: number, previous: number | null | undefined): Move | null {
  if (previous == null || previous <= 0) return null;
  const delta = current - previous;
  return { previous, delta, ratio: delta / previous, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' };
}

/** Blue over official sell, minus one (the sell-based gap used by every chart and the social cards). */
export function gapRatio(blueSell: number | null | undefined, oficialSell: number | null | undefined): number | null {
  if (blueSell == null || oficialSell == null || blueSell <= 0 || oficialSell <= 0) return null;
  return blueSell / oficialSell - 1;
}

export function averageOf(pair: RatePair): number {
  return averageHundredths(pair.buy, pair.sell);
}

/** First, last, lowest and highest blue sell of a set of days (`null` without blue data). */
export interface PeriodSummary {
  first: DayRates;
  last: DayRates;
  minSell: number;
  minDay: string;
  maxSell: number;
  maxDay: string;
  days: number;
}

export function summarize(days: readonly DayRates[]): PeriodSummary | null {
  const withBlue = days.filter((d): d is DayRates & { blue: RatePair } => d.blue !== null && d.blue.sell > 0);
  const first = withBlue[0];
  const last = withBlue.at(-1);
  if (first === undefined || last === undefined) return null;
  let min = first;
  let max = first;
  for (const d of withBlue) {
    if (d.blue.sell < min.blue.sell) min = d;
    if (d.blue.sell > max.blue.sell) max = d;
  }
  return { first, last, minSell: min.blue.sell, minDay: min.day, maxSell: max.blue.sell, maxDay: max.day, days: withBlue.length };
}

/** Days grouped by `YYYY-MM` (or `YYYY`), oldest first. */
export function groupByPeriod(days: readonly DayRates[], length: 4 | 7): { key: string; days: DayRates[] }[] {
  const groups = new Map<string, DayRates[]>();
  for (const d of days) {
    const key = d.day.slice(0, length);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [d]);
    else list.push(d);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, days: list }));
}
