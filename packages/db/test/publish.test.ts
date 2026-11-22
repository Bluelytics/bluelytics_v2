import { RENDERED_KEYS, renderEvolutionJson, renderLatest, withEuro } from '@bluelytics/core';
import type { DailyRow, RenderedKey } from '@bluelytics/core';
import { goldenBody } from '@bluelytics/contract/golden';
import type { GoldenName } from '@bluelytics/contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildRendered,
  getCurrency,
  getEvolutionRows,
  getLatestRates,
  getRendered,
  getRenderedEtags,
  insertAlert,
  mergeDailyRows,
  runBatch,
  upsertDailyRowsStatements,
  upsertLatestRatesStatements,
  writeRendered,
} from '../src/index.ts';
import type { LocalD1 } from '../src/testing.ts';
import { createLocalD1, seedFromGoldens } from '../src/testing.ts';

const GOLDEN_FOR: Record<RenderedKey, GoldenName> = {
  latest: 'v2_latest',
  last_price: 'v1_last_price',
  alerts: 'v2_alerts',
  currency: 'currency',
  evolution_json: 'evolution_full',
  evolution_csv: 'evolution_csv_full',
};

function expectSameBytes(actual: string, name: GoldenName): void {
  const expected = Buffer.from(goldenBody(name));
  const bytes = Buffer.from(actual, 'utf8');
  expect(bytes.length, name).toBe(expected.length);
  expect(bytes.equals(expected), `${name} differs`).toBe(true);
}

describe('buildRendered on a D1 seeded from the goldens', () => {
  let local: LocalD1;

  beforeAll(async () => {
    local = await createLocalD1();
    expect(await seedFromGoldens(local.db)).toEqual({ daily: 9365, currencies: 169, alerts: 2, latest: 2 });
  });

  afterAll(() => local.dispose());

  it('renders all six bodies byte-identical to the legacy API', async () => {
    const rows = await buildRendered(local.db, { legacyBlueBug: true });
    expect(rows.map((row) => row.key)).toEqual([...RENDERED_KEYS]);
    for (const row of rows) expectSameBytes(row.body, GOLDEN_FOR[row.key]);
    expect(rows.find((row) => row.key === 'latest')?.etag).toBe('"761c5e8b4122d23e"');
    expect(rows.find((row) => row.key === 'evolution_json')?.etag).toBe('"4fee6951c154fcdf"');
    expect(Object.fromEntries(rows.map((row) => [row.key, row.contentType]))).toEqual({
      latest: 'application/json; charset=UTF-8',
      last_price: 'application/json; charset=UTF-8',
      alerts: 'application/json; charset=UTF-8',
      currency: 'application/json; charset=UTF-8',
      evolution_json: 'application/json; charset=UTF-8',
      evolution_csv: 'text/csv',
    });
  });

  it('puts the blue values into last_price without the legacy bug', async () => {
    const [row] = await buildRendered(local.db, { legacyBlueBug: false, keys: ['last_price'] });
    expect(row?.body).toContain('"source":"blue","value_avg":1652.50,"value_sell":1670.00,"value_buy":1635.00}');
  });

  it('stores bodies, then writes only what changed', async () => {
    const rows = await buildRendered(local.db, { legacyBlueBug: true });
    expect(await writeRendered(local.db, rows, '2026-11-22T15:00:00.000Z')).toEqual([...RENDERED_KEYS]);
    expect(await writeRendered(local.db, rows, '2026-11-22T15:05:00.000Z')).toEqual([]);

    const stored = await getRendered(local.db, 'evolution_json');
    expect(stored?.updatedAt).toBe('2026-11-22T15:00:00.000Z');
    expectSameBytes(stored?.body ?? '', 'evolution_full');
    expectSameBytes((await getRendered(local.db, 'currency'))?.body ?? '', 'currency');

    await insertAlert(local.db, { alertAt: '2026-11-23T13:05:00.000Z', buy: 1650, sell: 1690 });
    const next = await buildRendered(local.db, { legacyBlueBug: true });
    expect(await writeRendered(local.db, next, '2026-11-23T13:05:01.000Z')).toEqual(['alerts']);
    const alerts = await getRendered(local.db, 'alerts');
    expect(alerts?.body).toBe(
      '{"alert_id":1886,"alert_at":"2026-11-23T13:05:00Z","current":{"value_avg":1670.00,"value_sell":1690.00,"value_buy":1650.00},' +
        '"previous":{"value_avg":1652.50,"value_sell":1670.00,"value_buy":1635.00}}\n',
    );
    expect((await getRenderedEtags(local.db)).alerts).toBe(alerts?.etag);
  });

  it('re-derives the euro with the stored EUR (daily step) and still renders the golden latest', async () => {
    const eur = await getCurrency(local.db, 'EUR');
    const state = withEuro(await getLatestRates(local.db), (eur?.valueHundredths ?? 0) / 100);
    expectSameBytes(renderLatest(state), 'v2_latest');
  });

  it('mergeDailyRows predicts getEvolutionRows after an upsert, for a new day and a replaced one', async () => {
    const before = await getEvolutionRows(local.db);
    const today: DailyRow[] = [
      { day: '2026-11-23', tipo: 'Oficial', buy: 1550, sell: 1603, updatedAt: '2026-11-23T13:00:00.000Z', origin: 'live' },
      { day: '2026-11-23', tipo: 'Blue', buy: 1640, sell: 1680, updatedAt: '2026-11-23T13:00:00.000Z', origin: 'live' },
    ];
    // Blue only, as when a day has no Oficial row yet; and a row in the middle of the history.
    const replaced: DailyRow[] = [
      { day: '2026-11-20', tipo: 'Blue', buy: 1620, sell: 1666, updatedAt: '2026-11-20T22:00:00.000Z', origin: 'live' },
      { day: '2013-04-05', tipo: 'Oficial', buy: 5, sell: 6, updatedAt: null, origin: 'backfill_api' },
    ];
    const expected = mergeDailyRows(mergeDailyRows(before, today), replaced);
    await runBatch(local.db, upsertDailyRowsStatements(local.db, today), upsertDailyRowsStatements(local.db, replaced));
    const after = await getEvolutionRows(local.db);
    expect(expected).toEqual(after);
    expect(after).toHaveLength(before.length + 3);
    expect(renderEvolutionJson(expected)).toBe(renderEvolutionJson(after));
    // restore the seeded rows for the tests below
    await local.db.prepare("DELETE FROM daily_rates WHERE day IN ('2026-11-23') OR (day = '2013-04-05' AND tipo = 'Oficial')").run();
    await runBatch(local.db, upsertDailyRowsStatements(local.db, before.filter((row) => row.day === '2026-11-20')));
    expect(await getEvolutionRows(local.db)).toEqual(before);
  });

  it('renders only the requested keys and reads only what they need', async () => {
    await local.db.batch(
      upsertLatestRatesStatements(local.db, {
        oficial: null,
        blue: { updatedAt: '2026-11-23T13:05:00.120Z', buy: 1650, sell: 1690, buyRaw: 1650.2, sellRaw: 1689.9, euroBuy: 1800, euroSell: 1840 },
      }),
    );
    const rows = await buildRendered(local.db, { legacyBlueBug: false, keys: ['latest'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toContain('"blue":{"value_avg":1670.00,"value_sell":1690.00,"value_buy":1650.00}');
    expect(rows[0]?.body).toContain('"last_update":"2026-11-23T10:05:00.12-03:00"}');
  });
});

describe('empty database', () => {
  it('renders the legacy empty bodies', async () => {
    const local = await createLocalD1();
    try {
      const rows = Object.fromEntries((await buildRendered(local.db, { legacyBlueBug: false })).map((row) => [row.key, row.body]));
      expect(rows.evolution_json).toBe('null\n');
      expect(rows.evolution_csv).toBe('day,type,value_buy,value_sell\n');
      expect(rows.currency).toBe('null\n');
      expect(rows.latest).toContain('"last_update":"0001-01-01T00:00:00Z"}');
      expect(rows.alerts).toContain('"alert_id":0,"alert_at":"0001-01-01T00:00:00Z"');
    } finally {
      await local.dispose();
    }
  });
});
