// Shared data fixtures for card design work. Values are whole pesos.
// CardData = {
//   blue:    { buy, sell },          published dólar blue
//   oficial: { buy, sell },          published dólar oficial
//   prevSell,                        reference blue sell: previous trading day's close (update, og)
//                                    or previous week's last close (weekly)
//   updatedAt,                       UTC ISO time of the published value
//   series: [{ day: 'YYYY-MM-DD', sell }]   blue sell daily closes, oldest → newest.
//                                    update/og: last ≤30 trading days ending today (last item = today, = blue.sell)
//                                    weekly: this week's 1–5 trading days (last item = blue.sell)
// }
const tradingDaysBack = (endDay, n) => {
  const out = []; const d = new Date(endDay + 'T12:00:00Z')
  while (out.length < n) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1) }
  return out
}
const series = (endDay, values) => tradingDaysBack(endDay, values.length).map((day, i) => ({ day, sell: values[i] }))

const UP30 = [1585,1590,1590,1600,1595,1605,1610,1610,1620,1615,1625,1630,1640,1635,1630,1640,1645,1650,1645,1640,1650,1655,1650,1660,1665,1655,1660,1665,1660,1675]
const DOWN30 = [1720,1715,1725,1730,1720,1710,1715,1705,1700,1710,1705,1695,1690,1700,1695,1685,1690,1680,1685,1690,1680,1675,1685,1680,1670,1675,1680,1670,1675,1650]
const FLAT30 = [1660,1665,1660,1670,1665,1670,1675,1670,1665,1670,1675,1680,1675,1670,1675,1670,1665,1670,1675,1670,1675,1680,1675,1670,1675,1680,1675,1670,1675,1675]
const BIG30 = UP30.map(v => Math.round(v * 7.45 / 5) * 5)

export const scenarios = {
  up:    { blue: { buy: 1655, sell: 1675 }, oficial: { buy: 1548, sell: 1601 }, prevSell: 1660, updatedAt: '2026-11-20T18:45:12.000Z', series: series('2026-11-20', UP30) },
  down:  { blue: { buy: 1630, sell: 1650 }, oficial: { buy: 1550, sell: 1603 }, prevSell: 1675, updatedAt: '2026-11-23T14:05:40.000Z', series: series('2026-11-23', DOWN30) },
  flat:  { blue: { buy: 1655, sell: 1675 }, oficial: { buy: 1548, sell: 1601 }, prevSell: 1675, updatedAt: '2026-11-20T21:59:03.000Z', series: series('2026-11-20', FLAT30) },
  big:   { blue: { buy: 12350, sell: 12480 }, oficial: { buy: 9870, sell: 10250 }, prevSell: 11890, updatedAt: '2027-09-08T22:35:00.000Z', series: series('2027-09-08', BIG30) },
  weekUp:    { blue: { buy: 1655, sell: 1675 }, oficial: { buy: 1548, sell: 1601 }, prevSell: 1645, updatedAt: '2026-11-20T21:00:05.000Z', series: series('2026-11-20', [1650, 1655, 1660, 1665, 1675]) },
  weekDown:  { blue: { buy: 1630, sell: 1650 }, oficial: { buy: 1552, sell: 1605 }, prevSell: 1675, updatedAt: '2026-11-27T21:00:05.000Z', series: series('2026-11-27', [1680, 1670, 1675, 1660, 1650]) },
  weekShort: { blue: { buy: 1660, sell: 1680 }, oficial: { buy: 1550, sell: 1603 }, prevSell: 1670, updatedAt: '2026-12-11T21:00:05.000Z', series: [{ day: '2026-12-10', sell: 1685 }, { day: '2026-12-11', sell: 1680 }] },
}

export const SIZES = { landscape: [1600, 900], portrait: [1080, 1350], story: [1080, 1920], og: [1200, 630] }

export const MATRIX = [
  ...['landscape', 'portrait', 'story'].flatMap(size => ['up', 'down', 'big'].map(sc => ['update', size, sc])),
  ...['landscape', 'portrait', 'story'].flatMap(size => ['weekUp', 'weekDown', 'weekShort'].map(sc => ['weekly', size, sc])),
  ...['up', 'down', 'flat', 'big'].map(sc => ['og', 'og', sc]),
]
