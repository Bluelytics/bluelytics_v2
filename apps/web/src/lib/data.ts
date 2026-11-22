/** Reads for the pages, through `@bluelytics/db` on the `DB` binding. */
import { addDays, artDate, artParts } from '@bluelytics/core';
import {
  getCurrency,
  getDailyRowsBetween,
  getExtraRates,
  getHistoryCoverage,
  getLatestRates,
  getPreviousClose,
  getSourceHealth,
  type D1DatabaseLike,
} from '@bluelytics/db';
import { env } from 'cloudflare:workers';
import type { SeriesData } from './chart.ts';
import { groupByDay, toSeries, type DayRates } from './series.ts';
import { buildSnapshot, type Snapshot } from './snapshot.ts';

const db = (): D1DatabaseLike => env.DB;

export function nowIso(): string {
  return new Date().toISOString();
}

/** Today in Argentina (`YYYY-MM-DD`). */
export function todayArt(): string {
  return artDate(nowIso());
}

export async function loadSnapshot(): Promise<Snapshot> {
  const state = await getLatestRates(db());
  const base = artDate(state.blue?.updatedAt ?? state.oficial?.updatedAt ?? nowIso());
  const [blue, oficial] = await Promise.all([getPreviousClose(db(), base, 'Blue'), getPreviousClose(db(), base, 'Oficial')]);
  return buildSnapshot(state, { blue, oficial });
}

/** Days with `day >= from` (inclusive), both rates, oldest first. */
export async function loadDays(from?: string, to?: string): Promise<DayRates[]> {
  const range: { from?: string; to?: string } = {};
  if (from !== undefined) range.from = from;
  if (to !== undefined) range.to = to;
  return groupByDay(await getDailyRowsBetween(db(), range));
}

/** The last `days` calendar days of sell closes ending today. */
export async function loadRecentSeries(days: number): Promise<SeriesData> {
  return toSeries(await loadDays(addDays(todayArt(), -(days - 1))));
}

/** Every day with data: the payload of `/data/series.json`. */
export async function loadFullSeries(): Promise<SeriesData> {
  return toSeries(await loadDays());
}

/** Months with data (`YYYY-MM`, ascending). */
export function loadCoverage() {
  return getHistoryCoverage(db());
}

export function loadExtras() {
  return getExtraRates(db());
}

/** EUR per USD (the cross rate the euro values are derived with), `null` when unknown. */
export async function loadEurPerUsd(): Promise<number | null> {
  const eur = await getCurrency(db(), 'EUR');
  return eur?.valueHundredths ? eur.valueHundredths / 100 : null;
}

/** Source health over the last 24 hours. */
export function loadHealth() {
  return getSourceHealth(db(), new Date(Date.now() - 86_400_000).toISOString());
}

/** Current Argentine year (bounds history URLs). */
export function currentYear(): number {
  return Number(artParts(nowIso()).day.slice(0, 4));
}
