import type { PublishedState } from '@bluelytics/core';
import { addDays, artDate, isoWeekTradingDays } from '@bluelytics/core';
import type { D1DatabaseLike } from '@bluelytics/db';
import { getDailySeries, getPreviousClose } from '@bluelytics/db';
import type { CardData } from '@bluelytics/social';

/** Trading days on the `update`/`og` chart. */
const UPDATE_SERIES_DAYS = 30;

export type Published = { blue: NonNullable<PublishedState['blue']>; oficial: NonNullable<PublishedState['oficial']> };

export function isPublished(state: PublishedState): state is Published {
  return state.blue !== null && state.oficial !== null;
}

function base(state: Published): Pick<CardData, 'blue' | 'oficial' | 'updatedAt'> {
  return {
    blue: { buy: state.blue.buy, sell: state.blue.sell },
    oficial: { buy: state.oficial.buy, sell: state.oficial.sell },
    updatedAt: state.blue.updatedAt,
  };
}

/** `update` and `og` cards: move against the previous trading day's close, last 30 closes ending today. */
export async function updateCardData(db: D1DatabaseLike, state: Published, now: string): Promise<CardData> {
  const day = artDate(now);
  const [previous, rows] = await Promise.all([
    getPreviousClose(db, day),
    getDailySeries(db, { tipo: 'Blue', from: addDays(day, -2 * UPDATE_SERIES_DAYS), to: day }),
  ]);
  return {
    ...base(state),
    prevSell: previous?.sell ?? null,
    series: rows.slice(-UPDATE_SERIES_DAYS).map((row) => ({ day: row.day, sell: row.sell })),
  };
}

/** `weekly` card: this ISO week's closes against the previous week's last close. */
export async function weeklyCardData(db: D1DatabaseLike, state: Published, now: string): Promise<CardData> {
  const monday = isoWeekTradingDays(artDate(now))[0] as string;
  const [previous, rows] = await Promise.all([getPreviousClose(db, monday), getDailySeries(db, { tipo: 'Blue', from: monday, to: artDate(now) })]);
  return { ...base(state), prevSell: previous?.sell ?? null, series: rows.map((row) => ({ day: row.day, sell: row.sell })) };
}
