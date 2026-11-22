/** The daily step: currencies with their guards, `extra_rates`, pruning (ARCHITECTURE §7). */
import { getCurrency, getLatestRates, getRendered, insertObservationsStatements, runBatch } from '@bluelytics/db';
import { CURRENCY_SOURCES, ambitoExtras } from '@bluelytics/scrapers';
import { afterEach, describe, expect, it } from 'vitest';
import type { Harness } from './support/harness.ts';
import { art, createHarness, fixture } from './support/harness.ts';

const MONDAY_6 = art('2026-11-23', '06:00');
const [JSDELIVR, PAGES, FRANKFURTER] = CURRENCY_SOURCES.map((source) => source.url) as [string, string, string];

function fawaz(edit: (usd: Record<string, number>) => void = () => {}): string {
  const table = JSON.parse(fixture('fawazahmed0_usd_jsdelivr.json')) as { date: string; usd: Record<string, number> };
  edit(table.usd);
  return JSON.stringify(table);
}

function frankfurter(edit: (rows: { quote: string; rate: number }[]) => void = () => {}): string {
  const rows = JSON.parse(fixture('frankfurter_v2_rates_usd.json')) as { quote: string; rate: number }[];
  edit(rows);
  return JSON.stringify(rows);
}

function serveProviders(h: Harness, pages: { fawaz?: string; frankfurter?: string }): void {
  if (pages.fawaz) {
    h.net.pages.set(JSDELIVR, pages.fawaz);
    h.net.pages.set(PAGES, pages.fawaz);
  }
  if (pages.frankfurter) h.net.pages.set(FRANKFURTER, pages.frankfurter);
}

describe('daily step', () => {
  let h: Harness;
  afterEach(() => h.dispose());

  it('refreshes currencies, re-renders the euro figures, captures extra rates and prunes old observations', async () => {
    h = await createHarness();
    serveProviders(h, { fawaz: fawaz(), frankfurter: frankfurter() });
    const [monedas, ccl] = ambitoExtras.requests.map((request) => request.url) as [string, string];
    h.net.pages.set(monedas, fixture('ambito_mercados_monedas.json'));
    h.net.pages.set(ccl, fixture('ambito_ccl.json'));
    const old = { runAt: '2026-08-01T15:00:00.000Z', source: 'ambito' as const, kind: 'blue' as const, ok: true, buyCents: 1, sellCents: 1, sourceTs: null, error: null, durationMs: 1 };
    await runBatch(h.db, insertObservationsStatements(h.db, [old]));

    const report = await h.run(MONDAY_6);
    expect(report.mode).toBe('daily');
    expect(report.daily).toMatchObject({ day: '2026-11-23', currencies: { ok: true, provider: 'fawazahmed0', date: '2026-11-22' }, extraRates: 9, pruned: 1 });
    // Redenominated since 2023 and absent from Frankfurter: unconfirmed jumps, so they keep their stored value.
    expect((report.daily?.currencies as { rejected: string[] }).rejected).toEqual(['ZWL', 'SLL', 'SYP']);
    expect(await getCurrency(h.db, 'EUR')).toMatchObject({ valueHundredths: 91, valueDate: '2026-11-22' });
    // ARS moved far more than 30 % since legacy froze it in 2023, and Frankfurter confirms the new level.
    expect((await getCurrency(h.db, 'ARS'))?.valueHundredths).toBe(157969);
    expect(h.net.callsTo('api.frankfurter.dev')).toHaveLength(1);
    expect((await getRendered(h.db, 'currency'))?.body).toContain('{"code":"EUR","name":"Euro","value":0.91}');
    const blue = (await getLatestRates(h.db)).blue;
    expect(blue?.euroSell).toBe(Math.round(1670 / 0.91));
    expect((await getRendered(h.db, 'latest'))?.body).toContain(`"blue_euro":{"value_avg":`);
    expect(await h.rows('SELECT COUNT(*) AS n FROM extra_rates')).toEqual([{ n: 9 }]);
    expect((await h.run(art('2026-11-23', '06:05'))).mode).toBe('idle');
  });

  it('rejects one code that jumps more than 30 % when the other provider disagrees', async () => {
    h = await createHarness();
    serveProviders(h, { fawaz: fawaz((usd) => (usd.jpy = 317.12)), frankfurter: frankfurter() });
    const report = await h.run(MONDAY_6);
    expect((report.daily?.currencies as { rejected: string[] }).rejected).toContain('JPY');
    expect((await getCurrency(h.db, 'JPY'))?.valueHundredths).toBe(13797);
    expect((await getCurrency(h.db, 'EUR'))?.valueHundredths).toBe(91);
  });

  it('keeps every stored value when no provider passes the table guards', async () => {
    h = await createHarness();
    const before = await getLatestRates(h.db);
    serveProviders(h, {
      fawaz: fawaz((usd) => (usd.eur = 3)),
      frankfurter: frankfurter((rows) => {
        for (const row of rows) if (row.quote === 'EUR') row.rate = 3;
      }),
    });
    const report = await h.run(MONDAY_6);
    expect(report.daily?.currencies).toMatchObject({ ok: false });
    const failures = (report.daily?.currencies as { failures: string[] }).failures;
    expect(failures).toHaveLength(3);
    expect(failures.every((failure) => failure.includes('EUR'))).toBe(true);
    expect((await getCurrency(h.db, 'EUR'))?.valueHundredths).toBe(92);
    expect(await getLatestRates(h.db)).toEqual(before);
  });
});
