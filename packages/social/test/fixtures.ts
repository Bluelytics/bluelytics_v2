import type { CardData, CardSeriesPoint } from '../src/cards/types.ts';

/** Trading days (Mon–Fri) ending at `endDay`, oldest first, paired with `values`. */
function series(endDay: string, values: readonly number[]): CardSeriesPoint[] {
  const days: string[] = [];
  const d = new Date(`${endDay}T12:00:00Z`);
  while (days.length < values.length) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) days.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return days.map((day, i) => ({ day, sell: values[i] ?? 0 }));
}

export const UP: CardData = {
  blue: { buy: 1655, sell: 1675 },
  oficial: { buy: 1548, sell: 1601 },
  prevSell: 1660,
  updatedAt: '2026-11-20T18:45:12.000Z',
  series: series('2026-11-20', [1610, 1630, 1645, 1660, 1675]),
};

export const DOWN: CardData = {
  blue: { buy: 1630, sell: 1650 },
  oficial: { buy: 1550, sell: 1603 },
  prevSell: 1675,
  updatedAt: '2026-11-23T14:05:40.000Z',
  series: series('2026-11-23', [1690, 1680, 1675, 1650]),
};

export const FLAT: CardData = { ...UP, prevSell: 1675 };

export const NO_REF: CardData = { ...UP, prevSell: null };

/** Five-digit prices, a ~5 % move, September. */
export const BIG: CardData = {
  blue: { buy: 12350, sell: 12480 },
  oficial: { buy: 9870, sell: 10250 },
  prevSell: 11890,
  updatedAt: '2027-09-08T22:35:00.000Z',
  series: series('2027-09-08', [11800, 11850, 11890, 12480]),
};

export const WEEK_UP: CardData = {
  blue: { buy: 1655, sell: 1675 },
  oficial: { buy: 1548, sell: 1601 },
  prevSell: 1645,
  updatedAt: '2026-11-20T21:00:05.000Z',
  series: series('2026-11-20', [1650, 1655, 1660, 1665, 1675]),
};

export const WEEK_ONE_DAY: CardData = {
  ...WEEK_UP,
  series: [{ day: '2026-11-20', sell: 1675 }],
};
