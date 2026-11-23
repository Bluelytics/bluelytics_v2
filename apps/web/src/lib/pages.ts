/** Data for each live page, loaded in the page frontmatter and handed to its view. */
import type { ExtraRate } from '@bluelytics/core';
import type { SeriesData } from './chart.ts';
import { loadEurPerUsd, loadExtras, loadRecentSeries, loadSnapshot } from './data.ts';
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

