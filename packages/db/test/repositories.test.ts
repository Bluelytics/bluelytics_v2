import { readFileSync } from 'node:fs';
import { alertWindow } from '@bluelytics/core';
import type { DailyRow, Observation, PublishedState, Tick } from '@bluelytics/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  downsample,
  getCurrencies,
  getCurrency,
  getDailyRowsBetween,
  getDailySeries,
  getDayRates,
  failStalePendingPosts,
  getEvolutionRows,
  getExtraRates,
  getFreshObservations,
  getHistoryCoverage,
  getHistoryDay,
  getHistoryMonth,
  getHistoryYear,
  getLastSentPost,
  getLastTickAtOrBefore,
  getLatestAlerts,
  getLatestRates,
  getPreviousClose,
  getRetryablePosts,
  getSourceHealth,
  getState,
  getTicksBetween,
  insertAlert,
  insertObservationsStatements,
  insertPendingPost,
  insertRowsStatements,
  insertTickStatement,
  markPostDryRun,
  markPostFailed,
  markPostSent,
  pruneObservations,
  runBatch,
  setAlertPushStatus,
  setState,
  setStateStatement,
  upsertCurrenciesStatements,
  upsertDailyRowsStatements,
  upsertExtraRatesStatements,
  upsertLatestRatesStatements,
} from '../src/index.ts';
import type { LocalD1 } from '../src/testing.ts';
import { MIGRATIONS_DIR, createLocalD1, migrationFiles, splitSqlStatements } from '../src/testing.ts';

let local: LocalD1;
beforeEach(async () => {
  local = await createLocalD1();
});
afterEach(() => local.dispose());

function tick(runAt: string, blueSell: number, overrides: Partial<Tick> = {}): Tick {
  return {
    runAt,
    day: runAt.slice(0, 10),
    blueBuy: blueSell - 35,
    blueSell,
    blueBuyRaw: blueSell - 35,
    blueSellRaw: blueSell,
    oficialBuy: 1548,
    oficialSell: 1601,
    oficialBuyRaw: null,
    oficialSellRaw: null,
    voters: { blue: ['ambito', 'dolarhoy'], oficial: ['ambito_oficial'] },
    changed: true,
    ...overrides,
  };
}

function daily(day: string, tipo: 'Oficial' | 'Blue', sell: number): DailyRow {
  return { day, tipo, buy: sell - 40, sell, updatedAt: null, origin: 'backfill_api' };
}

describe('migrations', () => {
  it('are split safely: no statement text contains comment or terminator characters', () => {
    expect(migrationFiles()).toEqual(['0001_init.sql']);
    const sql = readFileSync(new URL('0001_init.sql', MIGRATIONS_DIR), 'utf8');
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(13);
    expect(statements.filter((s) => s.startsWith('CREATE TABLE'))).toHaveLength(10);
    expect(statements.filter((s) => s.startsWith('CREATE INDEX'))).toHaveLength(3);
    for (const literal of sql.replace(/--.*$/gm, '').match(/'[^']*'/g) ?? []) expect(literal).not.toMatch(/--|;/);
  });

  it('create the schema of ARCHITECTURE §5', async () => {
    const { results } = await local.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
      .all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual([
      'alerts',
      'currencies',
      'daily_rates',
      'extra_rates',
      'latest_rates',
      'observations',
      'rendered',
      'social_posts',
      'state',
      'ticks',
    ]);
  });

  it('enforce the CHECK constraints', async () => {
    await expect(runBatch(local.db, upsertDailyRowsStatements(local.db, [{ ...daily('2026-11-20', 'Blue', 1665), tipo: 'blue' as 'Blue' }]))).rejects.toThrow(
      /CHECK/,
    );
  });
});

describe('statement helpers', () => {
  it('chunks multi-row inserts under 100 bound parameters', () => {
    const rows = Array.from({ length: 35 }, (_, i) => [i, 'x', null] as const);
    expect(insertRowsStatements(local.db, 't', ['a', 'b', 'c'], rows)).toHaveLength(2); // 33 + 2 rows
    expect(() => insertRowsStatements(local.db, 't', ['a', 'b'], [[1]])).toThrow(RangeError);
  });

  it('runBatch is all or nothing', async () => {
    const good = setStateStatement(local.db, 'k', 'v', '2026-11-22T00:00:00.000Z');
    const bad = local.db.prepare('INSERT INTO nope VALUES (1)');
    await expect(runBatch(local.db, [good, bad])).rejects.toThrow();
    expect(await getState(local.db, 'k')).toBeNull();
    await runBatch(local.db, []);
  });
});

describe('latest_rates', () => {
  const state: PublishedState = {
    oficial: { updatedAt: '2026-11-23T13:05:00.000Z', buy: 1548, sell: 1601, buyRaw: 1548.41, sellRaw: 1601.32, euroBuy: 1683, euroSell: 1741 },
    blue: { updatedAt: '2026-11-20T22:45:51.758024Z', buy: 1635, sell: 1670, buyRaw: 1635.025, sellRaw: 1670, euroBuy: 1777, euroSell: 1815 },
  };

  it('round-trips both rates, raw floats and microsecond timestamps included, and upserts', async () => {
    expect(await getLatestRates(local.db)).toEqual({ oficial: null, blue: null });
    await runBatch(local.db, upsertLatestRatesStatements(local.db, state));
    expect(await getLatestRates(local.db)).toEqual(state);
    const moved = { ...state, oficial: null, blue: { ...state.blue!, sell: 1680, updatedAt: '2026-11-23T13:10:00.000Z' } };
    await runBatch(local.db, upsertLatestRatesStatements(local.db, moved));
    expect(await getLatestRates(local.db)).toEqual({ oficial: state.oficial, blue: moved.blue });
  });
});

describe('daily_rates', () => {
  beforeEach(async () => {
    await runBatch(
      local.db,
      upsertDailyRowsStatements(local.db, [
        daily('2026-11-19', 'Blue', 1640),
        daily('2026-11-19', 'Oficial', 1586),
        daily('2026-11-20', 'Oficial', 1595),
        daily('2026-11-20', 'Blue', 1665),
        daily('2013-04-05', 'Blue', 8),
        daily('2020-05-16', 'Blue', 120), // an old-system Saturday row
        daily('2020-05-15', 'Blue', 119),
      ]),
    );
  });

  it('lists the evolution in API order (day DESC, Oficial before Blue)', async () => {
    const rows = await getEvolutionRows(local.db);
    expect(rows.map((row) => `${row.day} ${row.tipo}`)).toEqual([
      '2026-11-20 Oficial',
      '2026-11-20 Blue',
      '2026-11-19 Oficial',
      '2026-11-19 Blue',
      '2020-05-16 Blue',
      '2020-05-15 Blue',
      '2013-04-05 Blue',
    ]);
  });

  it('upserts idempotently: a live run replaces the day and marks its origin', async () => {
    const live: DailyRow = { day: '2026-11-20', tipo: 'Blue', buy: 1635, sell: 1670, updatedAt: '2026-11-20T22:45:51.758Z', origin: 'live' };
    await runBatch(local.db, upsertDailyRowsStatements(local.db, [live]));
    await runBatch(local.db, upsertDailyRowsStatements(local.db, [live]));
    const rows = await getHistoryDay(local.db, '2026-11-20');
    expect(rows).toEqual([daily('2026-11-20', 'Oficial', 1595), live]);
  });

  it('looks up one day for /v2/historical', async () => {
    expect(await getDayRates(local.db, '2026-11-20')).toEqual({ oficial: { buy: 1555, sell: 1595 }, blue: { buy: 1625, sell: 1665 } });
    expect(await getDayRates(local.db, '2013-04-05')).toEqual({ oficial: null, blue: { buy: -32, sell: 8 } });
    expect(await getDayRates(local.db, '2026-11-21')).toEqual({ oficial: null, blue: null });
  });

  it('finds the previous trading day close, Monday-safe, skipping weekend rows', async () => {
    expect((await getPreviousClose(local.db, '2026-11-23'))?.day).toBe('2026-11-20'); // Monday → Friday
    expect((await getPreviousClose(local.db, '2026-11-20'))?.sell).toBe(1640);
    expect((await getPreviousClose(local.db, '2026-11-20', 'Oficial'))?.sell).toBe(1586);
    expect((await getPreviousClose(local.db, '2020-05-18'))?.day).toBe('2020-05-15'); // the Saturday row is skipped
    expect(await getPreviousClose(local.db, '2013-04-05')).toBeNull();
  });

  it('serves history ranges, series and coverage for the site', async () => {
    expect((await getHistoryMonth(local.db, 2026, 11)).map((row) => `${row.day} ${row.tipo}`)).toEqual([
      '2026-11-19 Oficial',
      '2026-11-19 Blue',
      '2026-11-20 Oficial',
      '2026-11-20 Blue',
    ]);
    expect(await getHistoryMonth(local.db, 2026, 12)).toEqual([]);
    expect(() => getHistoryMonth(local.db, 2026, 13)).toThrow(RangeError);
    expect((await getHistoryYear(local.db, 2020)).map((row) => row.day)).toEqual(['2020-05-15', '2020-05-16']);
    expect((await getDailySeries(local.db, { tipo: 'Blue', from: '2020-01-01' })).map((row) => row.sell)).toEqual([119, 120, 1640, 1665]);
    expect((await getDailySeries(local.db, { tipo: 'Blue', maxPoints: 2 })).map((row) => row.day)).toEqual(['2013-04-05', '2026-11-20']);
    expect(await getDailyRowsBetween(local.db, { to: '2013-12-31' })).toHaveLength(1);
    expect(await getHistoryCoverage(local.db)).toEqual([
      { month: '2013-04', days: 1 },
      { month: '2020-05', days: 2 },
      { month: '2026-11', days: 2 },
    ]);
  });

  it('downsamples evenly, keeping both ends', () => {
    const values = Array.from({ length: 11 }, (_, i) => i);
    expect(downsample(values, 3)).toEqual([0, 5, 10]);
    expect(downsample(values, 11)).toEqual(values);
    expect(downsample([1], 5)).toEqual([1]);
    expect(() => downsample(values, 1)).toThrow(RangeError);
  });
});

describe('ticks', () => {
  const now = '2026-11-23T19:00:00.000Z';
  const { after, before } = alertWindow(now); // (13:00, 18:45)

  beforeEach(async () => {
    await runBatch(local.db, [
      insertTickStatement(local.db, tick('2026-11-20T22:45:00.000Z', 1670)),
      insertTickStatement(local.db, tick('2026-11-23T13:00:00.000Z', 1675)), // exactly at the window start: outside
      insertTickStatement(local.db, tick('2026-11-23T13:05:00.000Z', 1680)),
      insertTickStatement(local.db, tick('2026-11-23T18:40:00.000Z', 1690, { voters: { blue: ['ambito'], oficial: [] }, changed: false })),
      insertTickStatement(local.db, tick('2026-11-23T18:45:00.000Z', 1700)), // exactly at the window end: outside
    ]);
  });

  it('selects the alert window with both ends exclusive', async () => {
    const window = await getTicksBetween(local.db, after, before);
    expect(window.map((t) => t.blueSell)).toEqual([1680, 1690]);
    expect(window[1]).toEqual(tick('2026-11-23T18:40:00.000Z', 1690, { voters: { blue: ['ambito'], oficial: [] }, changed: false }));
  });

  it('finds the previous close at or before the window start', async () => {
    expect((await getLastTickAtOrBefore(local.db, after))?.blueSell).toBe(1675);
    expect((await getLastTickAtOrBefore(local.db, '2026-11-23T12:59:59.999Z'))?.blueSell).toBe(1670);
    expect(await getLastTickAtOrBefore(local.db, '2026-11-01T00:00:00.000Z')).toBeNull();
  });

  it('normalises bounds that are not in storage form', async () => {
    // '2026-11-23T18:45:00Z' < '2026-11-23T18:45:00.000Z' as strings ('Z' > '.'): compared raw, the end tick would leak in
    const trimmedBounds = await getTicksBetween(local.db, '2026-11-23T13:00:00Z', '2026-11-23T18:45:00Z');
    expect(trimmedBounds.map((t) => t.blueSell)).toEqual([1680, 1690]);
    const offsetBounds = await getTicksBetween(local.db, '2026-11-23T10:00:00-03:00', '2026-11-23T15:45:00-03:00');
    expect(offsetBounds.map((t) => t.blueSell)).toEqual([1680, 1690]);
    expect((await getLastTickAtOrBefore(local.db, '2026-11-23T13:00:00Z'))?.blueSell).toBe(1675);
    // and stores run_at in storage form
    await insertTickStatement(local.db, tick('2026-11-23T14:00:00Z', 1685)).run();
    expect((await getLastTickAtOrBefore(local.db, '2026-11-23T14:00:00.000Z'))?.runAt).toBe('2026-11-23T14:00:00.000Z');
  });

  it('is idempotent per run_at', async () => {
    await insertTickStatement(local.db, tick('2026-11-23T13:05:00.000Z', 1681)).run();
    expect((await getTicksBetween(local.db, after, before)).map((t) => t.blueSell)).toEqual([1681, 1690]);
  });
});

describe('observations', () => {
  const obs = (runAt: string, source: Observation['source'], ok: boolean, sell: number | null = null, error: string | null = null): Observation => ({
    runAt,
    source,
    kind: source === 'ambito_oficial' ? 'oficial' : 'blue',
    ok,
    buyCents: sell === null ? null : sell - 3500,
    sellCents: sell,
    sourceTs: null,
    error,
    durationMs: 120,
  });

  beforeEach(async () => {
    await runBatch(
      local.db,
      insertObservationsStatements(local.db, [
        obs('2026-11-23T13:00:00.000Z', 'ambito', true, 167_000),
        obs('2026-11-23T13:00:00.000Z', 'dolarhoy', false, null, 'HTTP 503'),
        obs('2026-11-23T13:05:00.000Z', 'ambito', true, 167_500),
        obs('2026-11-23T13:05:00.000Z', 'dolarhoy', true, 166_000),
        obs('2026-11-23T13:10:00.000Z', 'ambito', false, null, 'timeout'),
        obs('2026-11-23T13:10:00.000Z', 'dolarhoy', true, 166_500),
        obs('2026-11-23T13:10:00.000Z', 'ambito_oficial', true, 160_100),
        obs('2026-11-23T13:15:00.000Z', 'ambito', false, null, 'parse: anchor not found'),
        obs('2026-11-23T13:15:00.000Z', 'cronista', false, null, 'HTTP 404'),
      ]),
    );
  });

  it('returns the successful observations since T, newest first', async () => {
    const fresh = await getFreshObservations(local.db, '2026-11-23T13:05:00.000Z');
    // newest run first; within a run, the later insert first
    expect(fresh.map((o) => `${o.runAt.slice(11, 16)} ${o.source}`)).toEqual(['13:10 ambito_oficial', '13:10 dolarhoy', '13:05 dolarhoy', '13:05 ambito']);
    expect(fresh[1]).toEqual(obs('2026-11-23T13:10:00.000Z', 'dolarhoy', true, 166_500));
  });

  it('summarises per-source health', async () => {
    const health = await getSourceHealth(local.db, '2026-11-23T00:00:00.000Z');
    expect(health).toEqual([
      {
        source: 'ambito',
        kind: 'blue',
        runs: 4,
        okRuns: 2,
        lastRunAt: '2026-11-23T13:15:00.000Z',
        lastOkAt: '2026-11-23T13:05:00.000Z',
        consecutiveFailures: 2,
        lastBuyCents: 164_000,
        lastSellCents: 167_500,
        lastError: 'parse: anchor not found',
        avgDurationMs: 120,
      },
      expect.objectContaining({ source: 'ambito_oficial', kind: 'oficial', runs: 1, consecutiveFailures: 0, lastError: null }),
      expect.objectContaining({ source: 'cronista', runs: 1, okRuns: 0, lastOkAt: null, consecutiveFailures: 1, lastSellCents: null }),
      expect.objectContaining({ source: 'dolarhoy', runs: 3, okRuns: 2, consecutiveFailures: 0, lastSellCents: 166_500, lastError: 'HTTP 503' }),
    ]);
    expect(await getSourceHealth(local.db, '2026-11-24T00:00:00.000Z')).toEqual([]);
  });

  it('normalises bounds that are not in storage form', async () => {
    expect((await getFreshObservations(local.db, '2026-11-23T13:10:00Z')).map((o) => o.source)).toEqual(['ambito_oficial', 'dolarhoy']);
    expect((await getFreshObservations(local.db, '2026-11-23T10:10:00-03:00')).length).toBe(2);
    expect((await getSourceHealth(local.db, '2026-11-23T13:15:00Z')).map((h) => h.source)).toEqual(['ambito', 'cronista']);
    expect(await pruneObservations(local.db, '2026-11-23T13:05:00Z')).toBe(2);
  });

  it('prunes by run_at', async () => {
    expect(await pruneObservations(local.db, '2026-11-23T13:10:00.000Z')).toBe(4);
    expect(await pruneObservations(local.db, '2026-11-23T13:10:00.000Z')).toBe(0);
    expect((await getSourceHealth(local.db, '2026-11-01T00:00:00.000Z')).map((h) => h.runs)).toEqual([2, 1, 1, 1]);
  });
});

describe('alerts', () => {
  it('continues the legacy id sequence and returns the two newest', async () => {
    expect(await getLatestAlerts(local.db)).toEqual({ current: null, previous: null });
    await local.db.batch([
      local.db.prepare("INSERT INTO alerts (id, alert_at, buy, sell) VALUES (1884, '2026-11-20T19:00:54.374497Z', 1623, 1658)"),
      local.db.prepare("INSERT INTO alerts (id, alert_at, buy, sell) VALUES (1885, '2026-11-20T20:00:54.374497Z', 1635, 1670)"),
    ]);
    const inserted = await insertAlert(local.db, { alertAt: '2026-11-23T13:05:00.000Z', buy: 1650, sell: 1690 });
    expect(inserted).toEqual({ id: 1886, alertAt: '2026-11-23T13:05:00.000Z', buy: 1650, sell: 1690, pushStatus: null });
    await setAlertPushStatus(local.db, 1886, 'sent');
    const latest = await getLatestAlerts(local.db);
    expect(latest.current).toEqual({ ...inserted, pushStatus: 'sent' });
    expect(latest.previous?.id).toBe(1885);
  });
});

describe('social_posts', () => {
  const post = {
    network: 'twitter',
    kind: 'update',
    eventKey: 'update-2026-11-23-1690',
    createdAt: '2026-11-23T15:00:00.000Z',
    buy: 1650,
    sell: 1690,
  } as const;

  it('claims an event once (pending before sending) and records the outcome', async () => {
    const first = await insertPendingPost(local.db, post);
    expect(first.claimed).toBe(true);
    expect(first.post).toMatchObject({ status: 'pending', attempts: 0, sentAt: null });
    const again = await insertPendingPost(local.db, post);
    expect(again).toEqual({ claimed: false, post: first.post });
    expect((await insertPendingPost(local.db, { ...post, network: 'instagram' })).claimed).toBe(true);

    const failed = await markPostFailed(local.db, first.post.id, { error: 'HTTP 429', imageKey: 'social/2026/11/twitter-x.jpg' });
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, error: 'HTTP 429', imageKey: 'social/2026/11/twitter-x.jpg' });
    expect((await getRetryablePosts(local.db, 3)).map((p) => p.id)).toEqual([first.post.id]);
    expect(await getLastSentPost(local.db, 'twitter', 'update')).toBeNull();

    const sent = await markPostSent(local.db, first.post.id, { sentAt: '2026-11-23T15:10:00.000Z', externalId: 'buf_123' });
    expect(sent).toMatchObject({ status: 'sent', attempts: 2, error: null, externalId: 'buf_123', imageKey: 'social/2026/11/twitter-x.jpg' });
    expect(await getRetryablePosts(local.db, 3)).toEqual([]);
    expect(await getLastSentPost(local.db, 'twitter', 'update')).toEqual(sent);
    expect(await getLastSentPost(local.db, 'twitter', 'weekly')).toBeNull();
  });

  it('stops offering a post for retry after maxAttempts', async () => {
    const { post: claimed } = await insertPendingPost(local.db, post);
    for (let i = 0; i < 3; i++) await markPostFailed(local.db, claimed.id, { error: `try ${i}` });
    expect(await getRetryablePosts(local.db, 3)).toEqual([]);
    await expect(markPostFailed(local.db, 999, { error: 'x' })).rejects.toThrow(/does not exist/);
  });

  it('records dry runs, which count as sent only when asked', async () => {
    const { post: claimed } = await insertPendingPost(local.db, post);
    await markPostDryRun(local.db, claimed.id, { at: '2026-11-23T15:00:01.000Z' });
    expect(await getLastSentPost(local.db, 'twitter', 'update')).toBeNull();
    expect((await getLastSentPost(local.db, 'twitter', 'update', ['sent', 'dry_run']))?.status).toBe('dry_run');
  });

  it('finds the newest sent post of any kind (the cooldown clock)', async () => {
    const update = await insertPendingPost(local.db, post);
    const weekly = await insertPendingPost(local.db, { ...post, kind: 'weekly', eventKey: 'weekly-2026-W48' });
    await markPostSent(local.db, update.post.id, { sentAt: '2026-11-27T20:00:00.000Z', externalId: null });
    await markPostSent(local.db, weekly.post.id, { sentAt: '2026-11-27T21:00:00.000Z', externalId: null });
    expect((await getLastSentPost(local.db, 'twitter', null))?.kind).toBe('weekly');
    expect((await getLastSentPost(local.db, 'twitter', 'update'))?.id).toBe(update.post.id);
    expect(await getLastSentPost(local.db, 'instagram', null)).toBeNull();
  });

  it('turns stale pending posts into failed attempts that can be retried', async () => {
    const stale = await insertPendingPost(local.db, post);
    const fresh = await insertPendingPost(local.db, {
      ...post,
      eventKey: 'update-2026-11-23-1710',
      createdAt: '2026-11-23T15:20:00.000Z',
    });
    const changed = await failStalePendingPosts(local.db, '2026-11-23T15:15:00Z');
    expect(changed).toEqual([{ ...stale.post, status: 'failed', attempts: 1, error: 'stale pending' }]);
    expect((await getRetryablePosts(local.db, 3)).map((p) => p.id)).toEqual([stale.post.id]);
    expect(await failStalePendingPosts(local.db, '2026-11-23T15:15:00Z')).toEqual([]);
    expect((await insertPendingPost(local.db, { ...post, eventKey: fresh.post.eventKey })).post.status).toBe('pending');
  });

  it('picks the newest sent post by sent_at', async () => {
    const a = await insertPendingPost(local.db, post);
    const b = await insertPendingPost(local.db, { ...post, eventKey: 'update-2026-11-23-1710', sell: 1710 });
    await markPostSent(local.db, b.post.id, { sentAt: '2026-11-23T16:00:00.000Z', externalId: null });
    await markPostSent(local.db, a.post.id, { sentAt: '2026-11-23T15:00:05.000Z', externalId: null });
    expect((await getLastSentPost(local.db, 'twitter', 'update'))?.sell).toBe(1710);
  });
});

describe('currencies, extra rates and state', () => {
  it('upserts currencies and keeps the output order', async () => {
    await runBatch(
      local.db,
      upsertCurrenciesStatements(local.db, [
        { code: 'PAB', name: 'Balboa', valueHundredths: 100, valueDate: null, position: 0 },
        { code: 'VES', name: 'Bolívar soberano​ Venezolano', valueHundredths: 3_610_000, valueDate: null, position: 2 },
        { code: 'BTC', name: 'Bitcoin', valueHundredths: 0, valueDate: null, position: 1 },
      ]),
    );
    await runBatch(local.db, upsertCurrenciesStatements(local.db, [{ code: 'EUR', name: 'Euro', valueHundredths: 86, valueDate: '2026-11-23', position: 3 }]));
    await runBatch(local.db, upsertCurrenciesStatements(local.db, [{ code: 'EUR', name: 'Euro', valueHundredths: 87, valueDate: '2026-11-24', position: 3 }]));
    expect((await getCurrencies(local.db)).map((c) => c.code)).toEqual(['PAB', 'BTC', 'VES', 'EUR']);
    expect((await getCurrencies(local.db))[2]?.name).toBe('Bolívar soberano​ Venezolano');
    expect(await getCurrency(local.db, 'EUR')).toEqual({ code: 'EUR', name: 'Euro', valueHundredths: 87, valueDate: '2026-11-24', position: 3 });
    expect(await getCurrency(local.db, 'XXX')).toBeNull();
  });

  it('upserts extra rates', async () => {
    const mep = { code: 'mep', name: 'Dólar MEP', buyCents: 160_000, sellCents: 161_000, source: 'ambito_extras', sourceTs: null, updatedAt: '2026-11-23T13:00:00.000Z' };
    await runBatch(local.db, upsertExtraRatesStatements(local.db, [mep]));
    await runBatch(local.db, upsertExtraRatesStatements(local.db, [{ ...mep, sellCents: 162_000 }]));
    expect(await getExtraRates(local.db)).toEqual([{ ...mep, sellCents: 162_000 }]);
  });

  it('gets and sets state', async () => {
    expect(await getState(local.db, 'daily_job_day')).toBeNull();
    await setState(local.db, 'daily_job_day', '2026-11-23', '2026-11-23T09:00:00.000Z');
    await setState(local.db, 'daily_job_day', '2026-11-24', '2026-11-24T09:00:00.000Z');
    expect(await getState(local.db, 'daily_job_day')).toEqual({ value: '2026-11-24', updatedAt: '2026-11-24T09:00:00.000Z' });
  });
});
