import { describe, expect, it } from 'vitest';
import { CONSENSUS_CONFIG, computeConsensus, dailyRowsFromState, renderLatest, tickFromConsensus, withEuro } from '../src/index.ts';
import type { ConsensusInput, ConsensusObservation, PublishedRate, PublishedState, SourceId } from '../src/index.ts';
import { expectBytes, goldenBytes } from './helpers.ts';

const NOW = '2026-11-23T15:00:00.000Z';
const MINUTE = 60_000;

function at(minutesAgo: number): string {
  return new Date(Date.parse(NOW) - minutesAgo * MINUTE).toISOString();
}

function blue(source: SourceId, buy: number, sell: number, minutesAgo = 0): ConsensusObservation {
  return { runAt: at(minutesAgo), source, kind: 'blue', ok: true, buyCents: Math.round(buy * 100), sellCents: Math.round(sell * 100) };
}

function oficial(source: SourceId, buy: number, sell: number, minutesAgo = 0): ConsensusObservation {
  return { ...blue(source, buy, sell, minutesAgo), kind: 'oficial' };
}

function failed(source: SourceId, kind: 'blue' | 'oficial' = 'blue'): ConsensusObservation {
  return { runAt: NOW, source, kind, ok: false, buyCents: null, sellCents: null };
}

const PREVIOUS: PublishedState = {
  oficial: { updatedAt: '2026-11-23T14:55:00.000Z', buy: 1548, sell: 1601, buyRaw: 1548.41, sellRaw: 1601.32, euroBuy: 1683, euroSell: 1741 },
  blue: { updatedAt: '2026-11-23T14:55:00.000Z', buy: 1635, sell: 1670, buyRaw: 1635, sellRaw: 1670, euroBuy: 1777, euroSell: 1815 },
};

function run(observations: ConsensusObservation[], overrides: Partial<ConsensusInput> = {}) {
  return computeConsensus({ now: NOW, observations, recent: [], previous: PREVIOUS, eurPerUsd: 0.92, ...overrides });
}

const ALL_BLUE = [
  blue('ambito', 1640, 1680),
  blue('dolarhoy', 1630, 1670),
  blue('cronista', 1620, 1660),
  blue('infodolar', 1650, 1690),
  blue('lanacion', 1500, 1540),
  blue('infobae', 1700, 1740),
  blue('criptoya', 1800, 1850),
];
const ALL_OFICIAL = [oficial('ambito_oficial', 1550.4, 1602.6), oficial('bna', 1550, 1600)];

describe('computeConsensus: voter selection', () => {
  it('uses the four primaries when all are fresh (reserve, substitute and last resort stay out)', () => {
    const result = run([...ALL_BLUE, ...ALL_OFICIAL]);
    expect(result.voters).toEqual({ blue: ['ambito', 'dolarhoy', 'cronista', 'infodolar'], oficial: ['bna'] });
    // buys 1620 1630 1640 1650 → 1635; sells 1660 1670 1680 1690 → 1675
    expect(result.state.blue).toMatchObject({ buy: 1635, sell: 1675, buyRaw: 1635, sellRaw: 1675, updatedAt: NOW });
    expect(result.state.oficial).toMatchObject({ buy: 1550, sell: 1600, buyRaw: 1550, sellRaw: 1600, updatedAt: NOW });
    expect(result.held).toEqual({ blue: false, oficial: false });
    expect(result.rejected).toEqual([]);
  });

  it('one primary down: three primaries vote, the reserve does not join', () => {
    const result = run([...ALL_BLUE.filter((o) => o.source !== 'dolarhoy'), failed('dolarhoy'), ...ALL_OFICIAL]);
    expect(result.voters.blue).toEqual(['ambito', 'cronista', 'infodolar']);
    expect(result.state.blue).toMatchObject({ buy: 1640, sell: 1680 });
  });

  it('two primaries down: the reserve joins', () => {
    const observations = ALL_BLUE.filter((o) => !['dolarhoy', 'infodolar'].includes(o.source));
    const result = run([...observations, ...ALL_OFICIAL]);
    expect(result.voters.blue).toEqual(['ambito', 'cronista', 'lanacion']);
    expect(result.state.blue).toMatchObject({ buy: 1620, sell: 1660 });
  });

  it('three primaries down: one primary plus the reserve; the last resort stays out at two voters', () => {
    const observations = ALL_BLUE.filter((o) => ['ambito', 'lanacion', 'criptoya'].includes(o.source));
    const result = run([...observations, ...ALL_OFICIAL]);
    expect(result.voters.blue).toEqual(['ambito', 'lanacion']);
    expect(result.state.blue).toMatchObject({ buy: 1570, sell: 1610, buyRaw: 1570, sellRaw: 1610 });
  });

  it('the last resort votes only below two voters', () => {
    const alone = run([blue('ambito', 1640, 1680), blue('criptoya', 1660, 1700)]);
    expect(alone.voters.blue).toEqual(['ambito', 'criptoya']);
    expect(alone.state.blue).toMatchObject({ buy: 1650, sell: 1690 });

    const onlyLastResort = run([blue('criptoya', 1660, 1700), failed('ambito'), failed('lanacion')]);
    expect(onlyLastResort.voters.blue).toEqual(['criptoya']);
    expect(onlyLastResort.state.blue).toMatchObject({ buy: 1660, sell: 1700 });
  });

  it('infobae stands in for cronista only while cronista has no usable quote, as one vote', () => {
    const withCronista = run(ALL_BLUE);
    expect(withCronista.voters.blue).not.toContain('infobae');

    const observations = ALL_BLUE.filter((o) => o.source !== 'cronista');
    const result = run(observations);
    expect(result.voters.blue).toEqual(['ambito', 'dolarhoy', 'infobae', 'infodolar']);
  });

  it('official: first usable source of the chain, BNA first and Ámbito when BNA is down', () => {
    expect(run([oficial('ambito_oficial', 1550.4, 1602.6), failed('bna', 'oficial')]).voters.oficial).toEqual(['ambito_oficial']);
    const both = run(ALL_OFICIAL);
    expect(both.voters.oficial).toEqual(['bna']);
    expect(both.state.oficial).toMatchObject({ buy: 1550, sell: 1600 });
  });

  it('ignores extra-rate observations', () => {
    const extra: ConsensusObservation = { ...blue('ambito_extras', 1700, 1750), kind: 'extra' };
    expect(run([extra, blue('ambito', 1640, 1680)]).voters.blue).toEqual(['ambito']);
  });

  it('infobae also stands in when cronista is fresh but rejected (usable = fresh and valid)', () => {
    const result = run([blue('ambito', 1640, 1680), blue('cronista', 1500, 1700), blue('infobae', 1650, 1690)]);
    expect(result.rejected).toEqual([{ source: 'cronista', kind: 'blue', runAt: NOW, reason: 'spread' }]);
    expect(result.voters.blue).toEqual(['ambito', 'infobae']);
  });
});

describe('computeConsensus: freshness and holding', () => {
  it('counts recent observations up to 30 minutes old, newest per source', () => {
    const recent = [blue('dolarhoy', 1600, 1640, 30), blue('dolarhoy', 1610, 1650, 5), blue('infodolar', 1500, 1540, 31)];
    const result = run([blue('ambito', 1640, 1680), failed('dolarhoy'), failed('infodolar')], { recent });
    expect(result.voters.blue).toEqual(['ambito', 'dolarhoy']);
    expect(result.state.blue).toMatchObject({ buy: 1625, sell: 1665 });
  });

  it('deduplicates an observation passed both as current and recent', () => {
    const observation = blue('ambito', 1640, 1680);
    expect(run([observation], { recent: [observation] }).voters.blue).toEqual(['ambito']);
  });

  it('holds the previous values and updated_at when nothing is fresh', () => {
    const stale = [blue('ambito', 1700, 1740, 31), oficial('ambito_oficial', 1560, 1610, 45)];
    const result = run([failed('ambito'), failed('dolarhoy'), failed('ambito_oficial', 'oficial')], { recent: stale });
    expect(result.held).toEqual({ blue: true, oficial: true });
    expect(result.voters).toEqual({ blue: [], oficial: [] });
    expect(result.state).toEqual(PREVIOUS);
    expect(result.changed).toBe(false);
  });

  it('ignores observations dated after the run', () => {
    const result = run([blue('ambito', 1640, 1680, -1), blue('dolarhoy', 1630, 1670)]);
    expect(result.rejected).toEqual([{ source: 'ambito', kind: 'blue', runAt: at(-1), reason: 'future' }]);
    expect(result.voters.blue).toEqual(['dolarhoy']);
  });

  it('a run without voters republishes nothing, even if the euro would round differently now', () => {
    // As seeded from the goldens: raw = rounded pesos, so 1601 / 0.92 = 1740.2 would not give the published 1741.
    const seeded: PublishedState = {
      oficial: { ...(PREVIOUS.oficial as PublishedRate), buyRaw: 1548, sellRaw: 1601 },
      blue: PREVIOUS.blue,
    };
    const result = run([failed('ambito'), failed('ambito_oficial', 'oficial')], { previous: seeded });
    expect(result.state).toEqual(seeded);
    expect(result.changed).toBe(false);
    expect(renderLatest(result.state)).toBe(renderLatest(PREVIOUS));
  });

  it('holds one kind independently of the other (last_update follows blue only)', () => {
    const result = run([oficial('ambito_oficial', 1560, 1610)]);
    expect(result.held).toEqual({ blue: true, oficial: false });
    expect(result.state.blue).toEqual(PREVIOUS.blue);
    expect(result.state.oficial?.updatedAt).toBe(NOW);
    expect(result.changed).toBe(true);
  });

  it('holds nothing on the very first run without a previous state', () => {
    const result = run([blue('ambito', 1640, 1680)], { previous: { oficial: null, blue: null } });
    expect(result.state.oficial).toBeNull();
    expect(result.state.blue).toMatchObject({ buy: 1640, sell: 1680, euroBuy: 1783, euroSell: 1826 });
    expect(tickFromConsensus(NOW, result)).toBeNull();
  });

  it('reports changed only when a published integer moves', () => {
    const same = run([blue('ambito', 1635.2, 1670.1), oficial('ambito_oficial', 1548.3, 1601.4)]);
    expect(same.changed).toBe(false);
    expect(same.state.blue?.updatedAt).toBe(NOW);
    expect(run([blue('ambito', 1636, 1670)]).changed).toBe(true);
  });
});

describe('computeConsensus: validation', () => {
  it('rejects implausible observations instead of clamping them', () => {
    const result = run([
      blue('ambito', 100, 105), // not strictly above 100 pesos
      blue('dolarhoy', 1680, 1640), // sell < buy
      blue('cronista', 1400, 1600), // spread 12.5 %
      { ...blue('infodolar', 1640, 1680), sellCents: null },
      { ...blue('lanacion', 1640, 1680), buyCents: 164_000.5 },
      blue('criptoya', 1_000_000, 1_000_001),
      blue('infobae', 1650, 1690),
    ]);
    expect(result.rejected.map((r) => [r.source, r.reason])).toEqual([
      ['ambito', 'range'],
      ['dolarhoy', 'inverted'],
      ['cronista', 'spread'],
      ['infodolar', 'invalid'],
      ['lanacion', 'invalid'],
      ['criptoya', 'range'],
    ]);
    expect(result.voters.blue).toEqual(['infobae']);
  });

  it('accepts a spread of exactly 10 % and equal buy and sell', () => {
    expect(run([blue('ambito', 1503, 1670), blue('dolarhoy', 1650, 1650)]).voters.blue).toEqual(['ambito', 'dolarhoy']);
    expect(run([blue('ambito', 1502.99, 1670)]).rejected.map((r) => r.reason)).toEqual(['spread']);
  });
});

describe('computeConsensus: jump guard', () => {
  it('rejects a lone source more than 15 % away from the last published value', () => {
    const result = run([blue('ambito', 1900, 1940), blue('dolarhoy', 1630, 1670), blue('infodolar', 1640, 1680)]);
    expect(result.rejected).toEqual([{ source: 'ambito', kind: 'blue', runAt: NOW, reason: 'jump' }]);
    expect(result.voters.blue).toEqual(['dolarhoy', 'infodolar']);
  });

  it('falls back to the source’s newest earlier quote that is not a jump', () => {
    const result = run([blue('ambito', 1900, 1940), blue('dolarhoy', 1630, 1670)], { recent: [blue('ambito', 1640, 1680, 5)] });
    expect(result.voters.blue).toEqual(['ambito', 'dolarhoy']);
    expect(result.state.blue).toMatchObject({ buy: 1635, sell: 1675 });
  });

  it('accepts the new level when two independent sources agree on it', () => {
    const result = run([blue('ambito', 1900, 1940), blue('dolarhoy', 1910, 1950), blue('infodolar', 1640, 1680)]);
    expect(result.rejected).toEqual([]);
    expect(result.voters.blue).toEqual(['ambito', 'dolarhoy', 'infodolar']);
    expect(result.state.blue).toMatchObject({ buy: 1900, sell: 1940 });
  });

  it('does not count two feeds of one vendor as agreement', () => {
    const result = run([blue('cronista', 1900, 1940), blue('infobae', 1905, 1945), blue('ambito', 1640, 1680)]);
    expect(result.rejected.map((r) => r.source).sort()).toEqual(['cronista', 'infobae']);
    expect(result.voters.blue).toEqual(['ambito']);
  });

  it('does not count sources that jump to different levels as agreement', () => {
    const result = run([blue('ambito', 1900, 1940), blue('dolarhoy', 2100, 2150)]);
    expect(result.held.blue).toBe(true);
    expect(result.rejected.map((r) => r.reason)).toEqual(['jump', 'jump']);
  });

  it('allows exactly 15 % up and down, and rejects one centavo more', () => {
    // previous blue buy 1635, sell 1670: × 1.15 = 1880.25 / 1920.5, × 0.85 = 1389.75 / 1419.5
    expect(run([blue('ambito', 1880.25, 1920.5)]).voters.blue).toEqual(['ambito']);
    expect(run([blue('ambito', 1389.75, 1419.5)]).voters.blue).toEqual(['ambito']); // float division: |0.85 − 1| > 0.15
    expect(run([blue('ambito', 1880.26, 1920.5)]).held.blue).toBe(true);
    expect(run([blue('ambito', 1389.74, 1419.5)]).held.blue).toBe(true);
  });

  it('allows exactly −15 % for every previous value from 1000 to 2000 in steps of 20', () => {
    for (let pesos = 1000; pesos <= 2000; pesos += 20) {
      const rate = { updatedAt: NOW, buy: pesos, sell: pesos, buyRaw: pesos, sellRaw: pesos, euroBuy: 0, euroSell: 0 };
      const down = blue('ambito', pesos * 0.85, pesos * 0.85);
      expect(run([down], { previous: { oficial: null, blue: rate } }).voters.blue, `previous ${pesos}`).toEqual(['ambito']);
    }
  });

  it('confirms a jump when two sources are exactly 5 % apart', () => {
    // 1995 / 1900 − 1 is 0.050000000000000044 in floats
    const result = run([blue('ambito', 1995, 2037), blue('dolarhoy', 1900, 1940)]);
    expect(result.rejected).toEqual([]);
    expect(result.voters.blue).toEqual(['ambito', 'dolarhoy']);
  });

  it('only sources that may vote for the kind can confirm a jump', () => {
    const extras: ConsensusObservation = blue('ambito_extras', 1900, 1940);
    const unknown = { ...blue('ambito', 1900, 1940), source: 'foo' } as unknown as ConsensusObservation;
    const result = run([blue('ambito', 1900, 1940), extras, unknown]);
    expect(result.held.blue).toBe(true);
    expect(result.rejected).toEqual([{ source: 'ambito', kind: 'blue', runAt: NOW, reason: 'jump' }]);
    // Official sources cannot confirm a blue jump either.
    expect(run([blue('ambito', 1900, 1940), { ...blue('bna', 1900, 1940) }]).held.blue).toBe(true);
  });

  it('exposes every threshold in one config object', () => {
    expect(CONSENSUS_CONFIG).toMatchObject({
      freshnessMs: 30 * MINUTE,
      minPesos: 100,
      maxPesos: 1_000_000,
      maxSpreadPercent: 10,
      maxJumpPercent: 15,
      jumpAgreementTolerancePercent: 5,
    });
    const strict = { ...CONSENSUS_CONFIG, maxJumpPercent: 1 };
    const result = computeConsensus({ now: NOW, observations: [blue('ambito', 1700, 1740)], recent: [], previous: PREVIOUS, eurPerUsd: 0.92 }, strict);
    expect(result.held.blue).toBe(true);
  });
});

describe('computeConsensus: rounding and euro', () => {
  it('rounds the medians half to even', () => {
    // buys 1600, 1601 → 1600.5 → 1600; sells 1641, 1642 → 1641.5 → 1642
    expect(run([blue('ambito', 1600, 1641), blue('dolarhoy', 1601, 1642)]).state.blue).toMatchObject({ buy: 1600, sell: 1642, buyRaw: 1600.5, sellRaw: 1641.5 });
  });

  it('reproduces the golden /v2/latest from the sources of 2026-11-20 (spec C.1)', () => {
    const now = '2026-11-20T22:45:51.758024Z';
    const observations: ConsensusObservation[] = [
      { runAt: now, source: 'ambito', kind: 'blue', ok: true, buyCents: 165_500, sellCents: 167_500 },
      { runAt: now, source: 'lanacion', kind: 'blue', ok: true, buyCents: 161_505, sellCents: 166_500 },
      { runAt: now, source: 'ambito_oficial', kind: 'oficial', ok: true, buyCents: 154_841, sellCents: 160_132 },
    ];
    const result = computeConsensus({ now, observations, recent: [], previous: { oficial: null, blue: null }, eurPerUsd: 0.92 });
    expect(result.state.blue).toMatchObject({ buy: 1635, sell: 1670, euroBuy: 1777, euroSell: 1815, buyRaw: 1635.025 });
    expect(result.state.oficial).toMatchObject({ buy: 1548, sell: 1601, euroBuy: 1683, euroSell: 1741 });
    expectBytes(renderLatest(result.state), goldenBytes('v2_latest'));
  });

  it('keeps the previous euro values without a usable EUR rate', () => {
    for (const eurPerUsd of [null, 0, Number.NaN]) {
      expect(run([blue('ambito', 1700, 1740)], { eurPerUsd }).state.blue).toMatchObject({ buy: 1700, euroBuy: 1777, euroSell: 1815 });
    }
  });

  it('withEuro re-derives euro values from the unrounded pesos', () => {
    const state = withEuro(PREVIOUS, 0.86);
    expect(state.oficial).toMatchObject({ euroBuy: 1800, euroSell: 1862 }); // 1548.41/0.86 = 1800.48, 1601.32/0.86 = 1862.0
    expect(state.blue).toMatchObject({ euroBuy: 1901, euroSell: 1942 });
    expect(withEuro({ oficial: null, blue: null }, 0.9)).toEqual({ oficial: null, blue: null });
  });
});

describe('rows derived from a run', () => {
  const result = run([...ALL_BLUE, ...ALL_OFICIAL]);

  it('builds the tick with voters and the Argentine day', () => {
    expect(tickFromConsensus(NOW, result)).toEqual({
      runAt: NOW,
      day: '2026-11-23',
      blueBuy: 1635,
      blueSell: 1675,
      blueBuyRaw: 1635,
      blueSellRaw: 1675,
      oficialBuy: 1550,
      oficialSell: 1600,
      oficialBuyRaw: 1550,
      oficialSellRaw: 1600,
      voters: { blue: ['ambito', 'dolarhoy', 'cronista', 'infodolar'], oficial: ['bna'] },
      changed: true,
    });
  });

  it('builds the two daily rows of the Argentine trading day, Oficial first', () => {
    const lateRun = '2026-11-24T02:30:00.000Z'; // 23:30 on the 23rd in Buenos Aires
    expect(dailyRowsFromState(lateRun, result.state)).toEqual([
      { day: '2026-11-23', tipo: 'Oficial', buy: 1550, sell: 1600, updatedAt: lateRun, origin: 'live' },
      { day: '2026-11-23', tipo: 'Blue', buy: 1635, sell: 1675, updatedAt: lateRun, origin: 'live' },
    ]);
    expect(dailyRowsFromState(NOW, { oficial: null, blue: null })).toEqual([]);
  });
});
