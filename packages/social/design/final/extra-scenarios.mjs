// Robustness fixtures for the final card (same CardData shape as harness/scenarios.mjs; whole pesos).
// The stress cases the feed judge ran, calendar edge cases (month and year boundaries, a mid-week holiday) and a
// missing previous close.
const tradingDaysBack = (endDay, n) => {
  const out = []; const d = new Date(endDay + 'T12:00:00Z')
  while (out.length < n) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1) }
  return out
}
const series = (endDay, values) => tradingDaysBack(endDay, values.length).map((day, i) => ({ day, sell: values[i] }))
const UP30 = [1585, 1590, 1590, 1600, 1595, 1605, 1610, 1610, 1620, 1615, 1625, 1630, 1640, 1635, 1630, 1640, 1645, 1650, 1645, 1640, 1650, 1655, 1650, 1660, 1665, 1655, 1660, 1665, 1660, 1675]
const SIX = UP30.map(v => v * 75)
const crash = [...UP30.slice(0, 29), 1558]
const tiny = [...UP30.slice(0, 28), 1675, 1676]
const base = { blue: { buy: 1655, sell: 1675 }, oficial: { buy: 1548, sell: 1601 }, prevSell: 1660, updatedAt: '2026-11-20T18:45:12.000Z' }

export const extraScenarios = {
  // update + og
  sixDigit: { blue: { buy: 124350, sell: 125625 }, oficial: { buy: 99870, sell: 102250 }, prevSell: 124500, updatedAt: '2027-09-08T22:35:00.000Z', series: series('2027-09-08', [...SIX.slice(0, 29), 125625]) },
  sixTiny: { blue: { buy: 124350, sell: 125626 }, oficial: { buy: 99870, sell: 102250 }, prevSell: 125625, updatedAt: '2027-09-08T22:35:00.000Z', series: series('2027-09-08', [...SIX.slice(0, 29), 125626]) },
  tiny: { ...base, blue: { buy: 1656, sell: 1676 }, prevSell: 1675, series: series('2026-11-20', tiny) },
  crash: { ...base, blue: { buy: 1538, sell: 1558 }, prevSell: 1675, series: series('2026-11-20', crash) },
  fewPts: { ...base, series: series('2026-11-20', [1650, 1660, 1675]) },
  onePt: { ...base, series: series('2026-11-20', [1675]) },
  flatSer: { ...base, prevSell: 1675, series: series('2026-11-20', Array(30).fill(1675)) },
  negGap: { ...base, oficial: { buy: 1650, sell: 1700 }, series: series('2026-11-20', UP30) },
  // no previous close (first post after an outage): the card must not claim "sin cambios"
  noRef: { ...base, prevSell: null, series: series('2026-11-20', UP30) },
  // weekly
  wOneDay: { blue: { buy: 1660, sell: 1680 }, oficial: { buy: 1550, sell: 1603 }, prevSell: 1670, updatedAt: '2026-12-11T21:00:05.000Z', series: [{ day: '2026-12-11', sell: 1680 }] },
  wSix: { blue: { buy: 124350, sell: 125625 }, oficial: { buy: 99870, sell: 102250 }, prevSell: 117500, updatedAt: '2027-09-10T21:00:05.000Z', series: series('2027-09-10', [118000, 119250, 121500, 123375, 125625]) },
  wCrash: { blue: { buy: 1538, sell: 1558 }, oficial: { buy: 1548, sell: 1601 }, prevSell: 1675, updatedAt: '2026-11-27T21:00:05.000Z', series: series('2026-11-27', [1670, 1640, 1610, 1590, 1558]) },
  wFlatNeg: { blue: { buy: 1655, sell: 1675 }, oficial: { buy: 1650, sell: 1700 }, prevSell: 1675, updatedAt: '2026-11-27T21:00:05.000Z', series: series('2026-11-27', [1675, 1675, 1675, 1675, 1675]) },
  wYear: { blue: { buy: 1700, sell: 1720 }, oficial: { buy: 1560, sell: 1610 }, prevSell: 1705, updatedAt: '2027-01-01T21:00:05.000Z', series: [{ day: '2026-12-28', sell: 1705 }, { day: '2026-12-29', sell: 1710 }, { day: '2026-12-30', sell: 1715 }, { day: '2027-01-01', sell: 1720 }] },
  wNoRef: { blue: { buy: 1655, sell: 1675 }, oficial: { buy: 1548, sell: 1601 }, prevSell: undefined, updatedAt: '2026-11-20T21:00:05.000Z', series: series('2026-11-20', [1650, 1655, 1660, 1665, 1675]) },
  wHoliday: { blue: { buy: 1640, sell: 1660 }, oficial: { buy: 1550, sell: 1603 }, prevSell: 1650, updatedAt: '2026-10-09T21:00:05.000Z', series: [{ day: '2026-10-05', sell: 1655 }, { day: '2026-10-06', sell: 1650 }, { day: '2026-10-08', sell: 1665 }, { day: '2026-10-09', sell: 1660 }] },
}

const UPDATE = ['sixDigit', 'sixTiny', 'tiny', 'crash', 'fewPts', 'onePt', 'flatSer', 'negGap', 'noRef']
const WEEKLY = ['wOneDay', 'wSix', 'wCrash', 'wFlatNeg', 'wYear', 'wHoliday', 'wNoRef']
export const EXTRA_MATRIX = [
  ...UPDATE.flatMap(sc => [['update', 'landscape', sc], ['update', 'portrait', sc], ['update', 'story', sc], ['og', 'og', sc]]),
  ...WEEKLY.flatMap(sc => ['landscape', 'portrait', 'story'].map(size => ['weekly', size, sc])),
]
