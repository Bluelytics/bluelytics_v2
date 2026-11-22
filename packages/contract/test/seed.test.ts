import {
  computeConsensus,
  renderAlerts,
  renderCurrency,
  renderEvolutionCsv,
  renderEvolutionJson,
  renderLastPrice,
  renderLatest,
  rint,
  withEuro,
  wrapJsonp,
} from '@bluelytics/core';
import { describe, expect, it } from 'vitest';
import { goldenText } from '../src/golden.ts';
import { seedAlerts, seedCurrencies, seedDailyRates, seedLatestRates } from '../src/index.ts';

function utf8(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

describe('seedDailyRates', () => {
  const rows = seedDailyRates(goldenText('evolution_full'));

  it('turns the whole history into integer rows, in response order', () => {
    expect(rows).toHaveLength(9365);
    expect(rows[0]).toEqual({ day: '2026-11-20', tipo: 'Oficial', buy: 1543, sell: 1595, updatedAt: null, origin: 'backfill_api' });
    expect(rows[1]).toEqual({ day: '2026-11-20', tipo: 'Blue', buy: 1615, sell: 1665, updatedAt: null, origin: 'backfill_api' });
    expect(rows.at(-1)?.day).toBe('2011-01-03');
    expect(rows.every((row) => Number.isSafeInteger(row.buy) && Number.isSafeInteger(row.sell))).toBe(true);
    expect(rows.filter((row) => row.day === '2013-04-05').map((row) => row.tipo)).toEqual(['Blue']);
  });

  it('round-trips through the renderers byte for byte', () => {
    expect(utf8(renderEvolutionJson(rows)).equals(Buffer.from(goldenText('evolution_full'), 'utf8'))).toBe(true);
    expect(renderEvolutionCsv(rows)).toBe(goldenText('evolution_csv_full'));
  });

  it('accepts the null body and rejects anything that is not whole pesos', () => {
    expect(seedDailyRates('null\n')).toEqual([]);
    expect(() => seedDailyRates('[{"date":"2026-11-20","source":"Blue","value_sell":1665.50,"value_buy":1615.00}]')).toThrow(/whole pesos/);
    expect(() => seedDailyRates('[{"date":"2026-11-20","source":"blue","value_sell":1665.00,"value_buy":1615.00}]')).toThrow(/source/);
    expect(() => seedDailyRates('[{"date":"2026-11-20","source":"Blue","value_sell":1.665e3,"value_buy":1615.00}]')).toThrow(/%\.2f/);
    expect(() => seedDailyRates('{"date":1}')).toThrow(/array/);
    expect(() => seedDailyRates('[')).toThrow(/not valid JSON/);
  });
});

describe('seedCurrencies', () => {
  const rows = seedCurrencies(goldenText('currency'));

  it('keeps the response order as position and the names byte for byte', () => {
    expect(rows).toHaveLength(169);
    expect(rows.slice(0, 2)).toEqual([
      { code: 'PAB', name: 'Balboa', valueHundredths: 100, valueDate: null, position: 0 },
      { code: 'BTC', name: 'Bitcoin', valueHundredths: 0, valueDate: null, position: 1 },
    ]);
    expect(rows.at(-1)).toMatchObject({ code: 'CHF', valueHundredths: 90, position: 168 });
    expect(rows.find((row) => row.code === 'TOP')?.name).toBe('Paʻanga');
    expect(rows.find((row) => row.code === 'VES')?.name).toBe('Bolívar soberano​ Venezolano');
    expect(rows.find((row) => row.code === 'ARS')?.valueHundredths).toBe(23_241);
    expect(rows.find((row) => row.code === 'EUR')?.valueHundredths).toBe(92);
  });

  it('round-trips through renderCurrency byte for byte', () => {
    expect(renderCurrency(rows)).toBe(goldenText('currency'));
  });

  it('stores a value date when given one', () => {
    expect(seedCurrencies(goldenText('currency'), { valueDate: '2023-05-19' })[0]?.valueDate).toBe('2023-05-19');
    expect(seedCurrencies('null\n')).toEqual([]);
  });
});

describe('seedAlerts', () => {
  it('produces the previous and the current alert, continuing the legacy ids', () => {
    expect(seedAlerts(goldenText('v2_alerts'))).toEqual([
      { id: 1884, alertAt: '2026-11-20T19:00:54.374497Z', buy: 1623, sell: 1658, pushStatus: null },
      { id: 1885, alertAt: '2026-11-20T20:00:54.374497Z', buy: 1635, sell: 1670, pushStatus: null },
    ]);
  });

  it('round-trips through renderAlerts byte for byte', () => {
    const [previous, current] = seedAlerts(goldenText('v2_alerts'));
    expect(renderAlerts(current!, previous!)).toBe(goldenText('v2_alerts'));
  });

  it('accepts an explicit earlier time for the previous alert and refuses a later one', () => {
    const body = goldenText('v2_alerts');
    expect(seedAlerts(body, { previousAlertAt: '2026-11-19T15:00:00Z' })[0]?.alertAt).toBe('2026-11-19T15:00:00.000Z');
    expect(() => seedAlerts(body, { previousAlertAt: '2026-11-20T20:00:54.374497Z' })).toThrow(/earlier/);
  });

  it('seeds nothing from an empty legacy table', () => {
    const empty =
      '{"alert_id":0,"alert_at":"0001-01-01T00:00:00Z","current":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00},' +
      '"previous":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00}}\n';
    expect(seedAlerts(empty)).toEqual([]);
    expect(() => seedAlerts(empty.replace('"alert_id":0', '"alert_id":1'))).toThrow(/predecessor/);
  });
});

/** EUR per USD of the capture (`currency.json`: `"EUR"` 0.92), which the legacy euro figures use. */
const EUR_PER_USD = 0.92;

describe('seedLatestRates', () => {
  const state = seedLatestRates(goldenText('v2_latest'));

  it('keeps the microsecond timestamp in UTC storage form', () => {
    expect(state.blue).toEqual({
      updatedAt: '2026-11-20T22:45:51.758024Z',
      buy: 1635,
      sell: 1670,
      buyRaw: 1635,
      sellRaw: 1670,
      euroBuy: 1777,
      euroSell: 1815,
    });
    expect(state.oficial).toMatchObject({ updatedAt: '2026-11-20T22:45:51.758024Z', buy: 1548, sell: 1601, euroBuy: 1683, euroSell: 1741 });
  });

  it('round-trips through renderLatest and renderLastPrice byte for byte', () => {
    expect(renderLatest(state)).toBe(goldenText('v2_latest'));
    expect(wrapJsonp('myCb', renderLatest(state))).toBe(goldenText('v2_latest_jsonp'));
    expect(renderLastPrice(state, { legacyBlueBug: true })).toBe(goldenText('v1_last_price'));
  });

  it('with the capture’s EUR, picks unrounded values that reproduce the euro figures', () => {
    const eurPerUsd = EUR_PER_USD;
    const consistent = seedLatestRates(goldenText('v2_latest'), { eurPerUsd });
    for (const rate of [consistent.oficial!, consistent.blue!]) {
      expect([rint(rate.buyRaw), rint(rate.sellRaw)]).toEqual([rate.buy, rate.sell]);
      expect([rint(rate.buyRaw / eurPerUsd), rint(rate.sellRaw / eurPerUsd)]).toEqual([rate.euroBuy, rate.euroSell]);
    }
    expect(renderLatest(withEuro(consistent, eurPerUsd))).toBe(goldenText('v2_latest'));
    // raw = rounded pesos cannot: 1601 / 0.92 = 1740.2, but the golden says 1741 (from 1601.32)
    expect(renderLatest(withEuro(state, eurPerUsd))).not.toBe(goldenText('v2_latest'));
    expect(() => seedLatestRates(goldenText('v2_latest'), { eurPerUsd: 0.5 })).toThrow(/no unrounded value/);
    expect(() => seedLatestRates(goldenText('v2_latest'), { eurPerUsd: 0 })).toThrow(/eurPerUsd/);
  });

  it('survives a tick without voters at the capture’s EUR byte for byte, either way it was seeded', () => {
    const now = '2026-11-23T13:00:00.000Z';
    const failed = (source: 'ambito' | 'ambito_oficial', kind: 'blue' | 'oficial') => ({
      runAt: now,
      source,
      kind,
      ok: false,
      buyCents: null,
      sellCents: null,
    });
    for (const previous of [state, seedLatestRates(goldenText('v2_latest'), { eurPerUsd: EUR_PER_USD })]) {
      const result = computeConsensus({
        now,
        observations: [failed('ambito', 'blue'), failed('ambito_oficial', 'oficial')],
        recent: [],
        previous,
        eurPerUsd: EUR_PER_USD,
      });
      expect(result.changed).toBe(false);
      expect(renderLatest(result.state)).toBe(goldenText('v2_latest'));
    }
  });

  it('rejects an inconsistent value_avg and maps the Go zero time to no rows', () => {
    expect(() => seedLatestRates(goldenText('v2_latest').replace('1574.50', '1574.00'))).toThrow(/value_avg/);
    expect(seedLatestRates(renderLatest({ oficial: null, blue: null }))).toEqual({ oficial: null, blue: null });
  });
});
