import { describe, expect, it } from 'vitest';
import {
  CURRENCY_SOURCES,
  ParseError,
  fetchCurrencies,
  parseFawazahmed0,
  parseFrankfurterV2,
  type FetchLike,
} from '../src/index.ts';
import { fixture } from './fixtures.ts';

const TODAY = '2026-11-22';
const fawaz = fixture('fawazahmed0_usd_jsdelivr.json');
const frankfurter = fixture('frankfurter_v2_rates_usd.json');

function withFawaz(change: (usd: Record<string, unknown>) => void, date = TODAY): string {
  const data = JSON.parse(fawaz) as { date: string; usd: Record<string, unknown> };
  change(data.usd);
  return JSON.stringify({ ...data, date });
}

function expectGuard(run: () => unknown, code: string, message: RegExp): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ParseError);
  expect((thrown as ParseError).code).toBe(code);
  expect((thrown as ParseError).message).toMatch(message);
}

describe('parseFawazahmed0', () => {
  it('upper-cases the codes and keeps units per USD', () => {
    const { date, rates } = parseFawazahmed0(fawaz, TODAY);
    expect(date).toBe('2026-11-22');
    expect(Object.keys(rates)).toHaveLength(340);
    expect(rates).toMatchObject({ USD: 1, EUR: 0.91158016, ARS: 1579.6945753 });
  });

  it('applies the guards: date ≤ 3 days, ≥ 150 codes, 0.5 < EUR < 1.5, ARS > 100, USD = 1', () => {
    expect(parseFawazahmed0(fawaz, '2026-11-25').date).toBe(TODAY);
    expectGuard(() => parseFawazahmed0(fawaz, '2026-11-26'), 'stale', /more than 3 days/);
    expectGuard(() => parseFawazahmed0(withFawaz((usd) => { for (const k of Object.keys(usd).slice(0, 200)) if (k !== 'eur' && k !== 'ars') delete usd[k]; }), TODAY), 'guard', /only \d+ currencies/);
    expectGuard(() => parseFawazahmed0(withFawaz((usd) => { usd['eur'] = 1.5; }), TODAY), 'guard', /EUR is 1.5/);
    expectGuard(() => parseFawazahmed0(withFawaz((usd) => { delete usd['eur']; }), TODAY), 'guard', /EUR is undefined/);
    expectGuard(() => parseFawazahmed0(withFawaz((usd) => { usd['ars'] = 99; }), TODAY), 'guard', /ARS is 99/);
    expectGuard(() => parseFawazahmed0(withFawaz((usd) => { usd['usd'] = 1.2; }), TODAY), 'guard', /USD is 1.2/);
    expectGuard(() => parseFawazahmed0('{"date":"2026-11-22"}', TODAY), 'json', /no "usd"/);
    expectGuard(() => parseFawazahmed0(withFawaz(() => {}, '22/11/2026'), TODAY), 'timestamp', /not a calendar date/);
  });

  it('drops non-numeric and non-positive entries', () => {
    const { rates } = parseFawazahmed0(withFawaz((usd) => { usd['xyz'] = 'n/a'; usd['zero'] = 0; }), TODAY);
    expect(rates).not.toHaveProperty('XYZ');
    expect(rates).not.toHaveProperty('ZERO');
  });
});

describe('parseFrankfurterV2', () => {
  it('collects USD-based rows within 3 days and dates the table by its newest row', () => {
    const { date, rates } = parseFrankfurterV2(frankfurter, TODAY);
    expect(date).toBe('2026-11-22');
    expect(Object.keys(rates)).toHaveLength(200);
    expect(rates).toMatchObject({ EUR: 0.91023, ARS: 1569.15, USD: 1 });
  });

  it('drops rows older than 3 days, then fails the code-count guard', () => {
    // 2026-11-24: rows dated 11-20 (21 of them) are too old → 179 codes, still enough.
    expect(Object.keys(parseFrankfurterV2(frankfurter, '2026-11-24').rates)).toHaveLength(179);
    // 2026-11-25: only the 144 rows of 11-22 remain.
    expectGuard(() => parseFrankfurterV2(frankfurter, '2026-11-25'), 'guard', /only 144 currencies/);
    expectGuard(() => parseFrankfurterV2(frankfurter, '2026-12-30'), 'stale', /no USD rate dated within 3 days/);
    expectGuard(() => parseFrankfurterV2('{"rates":{}}', TODAY), 'json', /not a JSON array/);
  });
});

describe('fetchCurrencies', () => {
  const NOW = '2026-11-22T09:05:00.000Z';
  const [jsdelivr, pagesDev, frankfurterSource] = CURRENCY_SOURCES.map((s) => s.url) as [string, string, string];

  it('tries jsDelivr, then the pages.dev mirror, then Frankfurter v2', async () => {
    const asked: string[] = [];
    const fetch: FetchLike = async (url) => {
      asked.push(url);
      if (url === jsdelivr) return new Response('', { status: 503 });
      if (url === pagesDev) return new Response(withFawaz(() => {}, '2026-11-10'));
      return new Response(frankfurter);
    };
    const result = await fetchCurrencies({ fetch, now: NOW });
    expect(asked).toEqual([jsdelivr, pagesDev, frankfurterSource]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toMatchObject({ provider: 'frankfurter_v2', url: frankfurterSource, date: TODAY });
    expect(result.failures).toEqual([
      'fawazahmed0 (cdn.jsdelivr.net): fetch.http: HTTP 503 from https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
      'fawazahmed0 (latest.currency-api.pages.dev): parse.stale: fawazahmed0: rates are dated 2026-11-10, more than 3 days from 2026-11-22',
    ]);
  });

  it('stops at the first source that passes the guards', async () => {
    const asked: string[] = [];
    const fetch: FetchLike = async (url) => {
      asked.push(url);
      return new Response(fawaz);
    };
    const result = await fetchCurrencies({ fetch, now: NOW });
    expect(asked).toEqual([jsdelivr]);
    expect(result).toMatchObject({ ok: true, result: { provider: 'fawazahmed0', date: TODAY }, failures: [] });
  });

  it('fails with every reason when no provider is usable', async () => {
    const fetch: FetchLike = async () => new Response('[]');
    const result = await fetchCurrencies({ fetch, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(3);
  });
});
