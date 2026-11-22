import { goldenManifest, goldenText } from '@bluelytics/contract/golden';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bodyMode } from '../src/parity/compare.ts';
import { formatReport, runParity } from '../src/parity/main.ts';
import { diffEvolution } from '../src/parity/rows.ts';
import { bodyShape, valueChanges } from '../src/parity/shape.ts';
import { startGoldenServer, type GoldenServer, type Override } from './golden-server.ts';

const encode = (text: string) => new TextEncoder().encode(text);
const replaceBody = (from: string, to: string): Override => (_capture, served) => ({ ...served, body: encode(new TextDecoder().decode(served.body).replace(from, to)) });

let old: GoldenServer;
beforeAll(async () => {
  old = await startGoldenServer();
});
afterAll(() => old.close());

async function parityAgainst(override: Override, strict = false) {
  const next = await startGoldenServer(override);
  try {
    const options = { oldUrl: new URL(old.url), newUrl: new URL(next.url), strict };
    const results = await runParity(options);
    return { results, report: formatReport(results, options), byName: (name: string) => results.find((result) => result.name === name) };
  } finally {
    await next.close();
  }
}

describe('shapes', () => {
  it('keeps keys, order, formats and wrappers but not values', () => {
    const a = goldenText('v2_latest_jsonp');
    expect(bodyShape(a)).toBe(bodyShape(a.replaceAll('1670.00', '1675.00').replace('19:45:51.758024', '19:50:00.1')));
    expect(bodyShape(a)).not.toBe(bodyShape(a.replace('1670.00', '1670.0')));
    expect(bodyShape(a)).not.toBe(bodyShape(a.replace('-03:00', 'Z')));
    expect(bodyShape(a)).not.toBe(bodyShape(a.replace('myCb(', 'cb(')));
    expect(bodyShape(a)).not.toBe(bodyShape(a.replace('\n);', ');')));
    const currency = goldenText('currency');
    expect(bodyShape(currency)).not.toBe(bodyShape(currency.replace('"Balboa"', '"Balboa panameño"')));
    expect(valueChanges(goldenText('v2_alerts'), goldenText('v2_alerts').replace('1670.00', '1680.00'))).toEqual(['value_sell 1670.00 → 1680.00']);
  });

  it('classifies captures', () => {
    const modes = Object.fromEntries(goldenManifest().map((capture) => [capture.name, bodyMode(capture)]));
    expect(modes).toMatchObject({ v2_latest: 'shape', currency: 'shape', evolution_full: 'rows', evolution_csv_days3: 'rows', historical_weekday: 'bytes', options: 'bytes' });
  });

  it('accepts evolution changes in recent days only', () => {
    const json = goldenText('evolution_full');
    expect(diffEvolution(json, json.replace('"value_sell":1665.00', '"value_sell":1670.00'), false)).toEqual({ recentOnly: true, details: ['1 rows changed', 'days 2026-11-20 … 2026-11-20'] });
    expect(diffEvolution(json, json.replace(/("date":"2011-01-03","source":"Blue","value_sell":)4\.00/, '$15.00'), false).recentOnly).toBe(false);
    expect(diffEvolution(json, json.replace('"value_sell":1665.00', '"value_sell":1670'), false).recentOnly).toBe(false);
    const csv = goldenText('evolution_csv_full');
    expect(diffEvolution(csv, csv.replace('2026-11-20,Blue,1615.00,1665.00\n', ''), true)).toMatchObject({ recentOnly: true, details: ['1 rows missing', 'days 2026-11-20 … 2026-11-20'] });
    expect(diffEvolution(csv, csv.replace('day,type', 'day,tipo'), true).recentOnly).toBe(false);
  });
});

describe('parity between two local servers', () => {
  it('passes every capture when both serve the goldens, with the ts cache-buster', async () => {
    const { results, report } = await parityAgainst((_capture, served) => served);
    expect(results).toHaveLength(goldenManifest().length);
    expect(results.filter((result) => result.verdict !== 'ok')).toEqual([]);
    expect(report).toContain(`${results.length} checks: ${results.length} ok, 0 warn, 0 fail`);
    expect(old.requests.every((request) => /[?&]ts=\d+$/.test(request))).toBe(true);
  });

  it('warns on new values of time-varying bodies, and fails on them with --strict', async () => {
    const override = replaceBody('"value_sell":1670.00', '"value_sell":1675.00');
    const lenient = await parityAgainst(override);
    expect(lenient.byName('v2_latest')).toMatchObject({ verdict: 'warn', details: ['values differ', 'value_sell 1670.00 → 1675.00'] });
    expect(lenient.byName('v2_alerts')?.verdict).toBe('warn');
    expect(lenient.results.some((result) => result.verdict === 'fail')).toBe(false);
    const strict = await parityAgainst(override, true);
    expect(strict.byName('v2_latest')?.verdict).toBe('fail');
    expect(strict.report).toMatch(/FAIL\s+v2_latest/);
  });

  it('fails on structure, static bodies, status, content type and CORS', async () => {
    const { byName } = await parityAgainst((capture, served) => {
      if (capture.name === 'v2_latest') return replaceBody('"last_update":', '"lastUpdate":')(capture, served);
      if (capture.name === 'historical_weekday') return replaceBody('1025.00', '1026.00')(capture, served);
      if (capture.name === 'historical_old') return { ...served, status: 200 };
      if (capture.name === 'evolution_csv_full') return { ...served, headers: served.headers.map(([name, value]) => [name, name === 'content-type' ? 'text/csv; charset=UTF-8' : value]) };
      if (capture.name === 'options') return { ...served, headers: served.headers.filter(([, value]) => value !== 'Access-Control-Request-Headers') };
      if (capture.name === 'origin') return { ...served, headers: served.headers.filter(([name]) => name !== 'access-control-allow-origin') };
      return served;
    });
    expect(byName('v2_latest')).toMatchObject({ verdict: 'fail', details: [expect.stringMatching(/^structure differs/)] });
    expect(byName('historical_weekday')).toMatchObject({ verdict: 'fail', details: ['body differs (141 → 141 bytes)'] });
    expect(byName('historical_old')).toMatchObject({ verdict: 'fail', status: '404 → 200' });
    expect(byName('evolution_csv_full')?.details).toEqual(['content-type: "text/csv" → "text/csv; charset=UTF-8"']);
    expect(byName('options')?.details[0]).toMatch(/^vary:/);
    expect(byName('origin')?.details).toEqual(['access-control-allow-origin: "*" → null']);
  });

  it('reports an unreachable API as a failure', async () => {
    const results = await runParity({ oldUrl: new URL(old.url), newUrl: new URL('http://127.0.0.1:9/'), strict: false, captures: goldenManifest().slice(0, 1) });
    expect(results[0]).toMatchObject({ verdict: 'fail', status: '200 → error' });
  });
});
