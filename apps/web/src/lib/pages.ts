/** Data for each live page, loaded in the page frontmatter and handed to its view. */
import type { ExtraRate } from '@bluelytics/core';
import { rangeStart, sliceSeries, type SeriesData } from './chart.ts';
import { loadDays, loadEurPerUsd, loadExtras, loadRecentSeries, loadSnapshot } from './data.ts';
import { toSeries, type DayRates } from './series.ts';
import type { Snapshot } from './snapshot.ts';

export interface LiveData {
  snapshot: Snapshot;
  series: SeriesData;
}

export interface HomeData extends LiveData {
  extras: ExtraRate[];
}

export interface EuroData {
  snapshot: Snapshot;
  eurPerUsd: number | null;
}

export interface EvolutionData {
  snapshot: Snapshot;
  /** The last year (what the server draws). */
  series: SeriesData;
  /** Every day, for the yearly table. */
  days: DayRates[];
}

/** Calendar days of the server-drawn window of the home chart and of the one-year charts. */
const MONTH = 31;
const YEAR = 366;

export async function loadHome(): Promise<HomeData> {
  const [snapshot, series, extras] = await Promise.all([loadSnapshot(), loadRecentSeries(MONTH), loadExtras()]);
  return { snapshot, series, extras };
}

export async function loadYearPage(): Promise<LiveData> {
  const [snapshot, series] = await Promise.all([loadSnapshot(), loadRecentSeries(YEAR)]);
  return { snapshot, series };
}

export async function loadEuro(): Promise<EuroData> {
  const [snapshot, eurPerUsd] = await Promise.all([loadSnapshot(), loadEurPerUsd()]);
  return { snapshot, eurPerUsd };
}

export async function loadEvolution(): Promise<EvolutionData> {
  const [snapshot, days] = await Promise.all([loadSnapshot(), loadDays()]);
  const all = toSeries(days);
  const last = all.days.at(-1);
  return { snapshot, series: last === undefined ? all : sliceSeries(all, rangeStart(last, '1y')), days };
}
