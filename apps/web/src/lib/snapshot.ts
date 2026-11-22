/** What the live pages show, derived from `latest_rates` and the previous trading day's closes. */
import { averageHundredths, type DailyRow, type PublishedRate, type PublishedState } from '@bluelytics/core';
import type { CalcRates, PriceKind } from './calc.ts';
import { gapRatio, move, type Move } from './series.ts';

export interface Snapshot {
  blue: PublishedRate | null;
  oficial: PublishedRate | null;
  blueMove: Move | null;
  oficialMove: Move | null;
  /** Previous trading day of the published blue value (`YYYY-MM-DD`), the base of the moves. */
  previousDay: string | null;
  /** Sell-based gap, blue over official minus one. */
  gap: number | null;
  /** Last change of the published blue rate (UTC, storage form). */
  updatedAt: string | null;
}

export function buildSnapshot(state: PublishedState, previous: { blue: DailyRow | null; oficial: DailyRow | null }): Snapshot {
  const { blue, oficial } = state;
  return {
    blue,
    oficial,
    blueMove: blue === null ? null : move(blue.sell, previous.blue?.sell),
    oficialMove: oficial === null ? null : move(oficial.sell, previous.oficial?.sell),
    previousDay: previous.blue?.day ?? previous.oficial?.day ?? null,
    gap: gapRatio(blue?.sell, oficial?.sell),
    updatedAt: blue?.updatedAt ?? oficial?.updatedAt ?? null,
  };
}

/** `?v=` cache-buster for the Open Graph image: changes whenever the published value does. */
export function ogVersion(snapshot: Snapshot): string | null {
  return snapshot.updatedAt === null ? null : snapshot.updatedAt.replace(/\D/g, '').slice(0, 14);
}

function pairHundredths(buy: number, sell: number): Record<PriceKind, number> {
  return { buy: buy * 100, average: averageHundredths(buy, sell), sell: sell * 100 };
}

function rateCalc(rate: PublishedRate | null): CalcRates['blue'] {
  if (rate === null) return { usd: null, eur: null };
  return { usd: pairHundredths(rate.buy, rate.sell), eur: rate.euroSell > 0 ? pairHundredths(rate.euroBuy, rate.euroSell) : null };
}

/** Calculator rates (hundredths of a peso per unit) of the published state. */
export function calcRates(snapshot: Snapshot): CalcRates {
  return { blue: rateCalc(snapshot.blue), oficial: rateCalc(snapshot.oficial) };
}
