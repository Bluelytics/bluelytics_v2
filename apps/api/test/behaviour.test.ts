/** v2 additions (ARCHITECTURE §2 item 9, §6) and legacy edge cases beyond the captures. */
import { BODY, CONTENT_TYPE, prettyJson } from '@bluelytics/core';
import { goldenText } from '@bluelytics/contract/golden';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HISTORICAL_PAST_DAY_TTL_MS, HISTORICAL_SHORT_TTL_MS } from '../src/historical-cache.ts';
import { RENDERED_RECHECK_MS } from '../src/rendered-cache.ts';
import type { Harness } from './support/harness.ts';
import { SHADOW, startHarness } from './support/harness.ts';

const queriesOf = (h: Harness, pattern: RegExp) => h.db.queries.filter((query) => pattern.test(query.sql));

describe('read-only behaviour on the seeded database', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.dispose());

  it.each([
    ['/v2/latest', 'public, max-age=30'],
    ['/v2/alerts', 'public, max-age=30'],
    ['/json/last_price', 'public, max-age=30'],
    ['/v2/evolution.json', 'public, max-age=300'],
    ['/v2/evolution.csv?days=3', 'public, max-age=300'],
    ['/data/json/currency.json', 'public, max-age=300'],
    ['/v2/historical?day=2024-01-05', 'public, max-age=86400'],
    ['/v2/historical?day=2026-11-20', 'public, max-age=60'],
    ['/v2/historical?day=2026-11-19', 'public, max-age=86400'],
    ['/v2/historical?day=2026-11-22', 'public, max-age=60'],
    ['/v2/historical?day=2011-01-02', 'public, max-age=60'],
    ['/v2/historical?day=2024-1-5', 'public, max-age=60'],
    ['/nope', 'public, max-age=60'],
    ['/', 'public, max-age=60'],
  ])('Cache-Control of %s is %s', async (path, value) => {
    const response = await h.fetch(path);
    expect(response.headers.get('cache-control')).toBe(value);
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{16}(-[^"]+)?"$/);
  });

  it('sends no-store for 405, 400 and leaves the 405 without an Allow header', async () => {
    const post = await h.fetch('/v2/latest', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('cache-control')).toBe('no-store');
    expect(post.headers.get('allow')).toBeNull();
    const bad = await h.fetch('/v2/latest?callback=alert(1)');
    expect(bad.headers.get('cache-control')).toBe('no-store');
  });

  it('answers HEAD like GET without a body, with the Content-Length GET would send', async () => {
    for (const path of ['/', '/v2/latest', '/v2/evolution.csv', '/v2/historical?day=2024-01-05', '/v2/latest?pretty', '/nope']) {
      const [get, head] = [await h.fetch(path), await h.fetch(path, { method: 'HEAD' })];
      const getBytes = (await get.arrayBuffer()).byteLength;
      expect(head.status, path).toBe(get.status);
      expect(head.headers.get('content-length'), path).toBe(String(getBytes));
      const withoutLength = (response: Response) => [...response.headers].filter(([name]) => name !== 'content-length').sort();
      expect(withoutLength(head), path).toEqual(withoutLength(get));
      expect(await head.text(), path).toBe('');
    }
  });

  it('answers If-None-Match with 304 (strong, weak, list, *) and ignores it on errors', async () => {
    const first = await h.fetch('/v2/latest');
    const tag = first.headers.get('etag') ?? '';
    for (const header of [tag, `W/${tag}`, `"other", ${tag}`, '*']) {
      const response = await h.fetch('/v2/latest', { headers: { 'If-None-Match': header } });
      expect(response.status, header).toBe(304);
      expect(response.headers.get('etag')).toBe(tag);
      expect(response.headers.get('cache-control')).toBe('public, max-age=30');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.text()).toBe('');
    }
    expect((await h.fetch('/v2/latest', { headers: { 'If-None-Match': '"nope"' } })).status).toBe(200);
    const notFound = await h.fetch('/nope', { headers: { 'If-None-Match': '*' } });
    expect(notFound.status).toBe(404);
  });

  it('gives every byte-different variant its own etag', async () => {
    const tags = new Set<string | null>();
    for (const path of ['/v2/evolution.json', '/v2/evolution.json?days=5', '/v2/evolution.json?days=0', '/v2/evolution.json?pretty', '/v2/latest', '/v2/latest?pretty', '/v2/latest?callback=cb', '/v2/latest?callback=cb&pretty']) {
      tags.add((await h.fetch(path)).headers.get('etag'));
    }
    expect(tags.size).toBe(8);
    const full = (await h.fetch('/v2/evolution.json')).headers.get('etag');
    for (const days of ['abc', '10000', '9999', '']) {
      expect((await h.fetch(`/v2/evolution.json?days=${days}`)).headers.get('etag'), days).toBe(full);
    }
  });

  it('restricts JSONP callbacks to [A-Za-z0-9_$.[\\]]{1,128} with a JSON 400', async () => {
    for (const callback of ['alert(1)', 'a.b[0]<x>', 'a%20b', 'x'.repeat(129), '%E2%80%A8']) {
      const response = await h.fetch(`/v2/latest?callback=${callback}`);
      expect(response.status, callback).toBe(400);
      expect(response.headers.get('content-type')).toBe(CONTENT_TYPE.json);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.text()).toBe(BODY.badRequest);
    }
    for (const callback of ['jQuery1124_1690000000000', 'angular.callbacks._0', 'a.b[0]', '$', 'x'.repeat(128)]) {
      const response = await h.fetch(`/json/last_price?callback=${callback}`);
      expect(response.status, callback).toBe(200);
      expect(response.headers.get('content-type')).toBe(CONTENT_TYPE.javascript);
      expect((await response.text()).startsWith(`${callback}([{`)).toBe(true);
    }
  });

  it('ignores an empty callback and callbacks on endpoints without JSONP', async () => {
    expect(await (await h.fetch('/v2/latest?callback=')).text()).toBe(goldenText('v2_latest'));
    const alerts = await h.fetch('/v2/alerts?callback=alert(1)');
    expect(alerts.status).toBe(200);
    expect(await alerts.text()).toBe(goldenText('v2_alerts'));
  });

  it('pretty-prints JSON, JSONP and error bodies but not CSV', async () => {
    expect(await (await h.fetch('/v2/latest?pretty')).text()).toBe(prettyJson(goldenText('v2_latest')));
    expect(await (await h.fetch('/v2/latest?pretty=0&callback=cb')).text()).toBe(`cb(${prettyJson(goldenText('v2_latest'))});`);
    expect(await (await h.fetch('/v2/evolution.json?days=5&pretty')).text()).toBe(prettyJson(goldenText('evolution_days5')));
    expect(await (await h.fetch('/v2/historical?pretty&day=2024-01-06')).text()).toBe(prettyJson(goldenText('historical_sat')));
    expect(await (await h.fetch('/nope?pretty')).text()).toBe(prettyJson(BODY.notFound));
    expect(await (await h.fetch('/v2/evolution.csv?days=3&pretty')).text()).toBe(goldenText('evolution_csv_days3'));
    expect(await (await h.fetch('/?pretty')).text()).toBe('OK');
  });

  it('takes the first ?days value and accepts what strconv.Atoi accepts', async () => {
    const rows = async (query: string) => (JSON.parse(await (await h.fetch(`/v2/evolution.json?${query}`)).text()) as unknown[] | null)?.length ?? 0;
    expect(await rows('days=3&days=1')).toBe(3);
    expect(await rows('days=%2B2')).toBe(2);
    expect(await rows('days=02')).toBe(2);
    expect(await rows('days=-0')).toBe(0);
    expect(await rows('days=3.0')).toBe(9365);
    const csv = await (await h.fetch('/v2/evolution.csv?days=0')).text();
    expect(csv).toBe(BODY.csvHeader);
    expect((await (await h.fetch('/v2/evolution.csv?days=-1')).text())).toBe(BODY.csvHeader);
  });

  it('routes exactly and case-sensitively', async () => {
    for (const path of ['/v2/latest/', '/V2/latest', '//v2/latest', '/v2/latest.json', '/v2']) {
      const response = await h.fetch(path);
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe(BODY.notFound);
    }
    expect((await h.fetch('/nope', { method: 'POST' })).status).toBe(404);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const response = await h.fetch('/v2/historical', { method });
      expect(response.status, method).toBe(405);
      expect(await response.text()).toBe(BODY.methodNotAllowed);
    }
  });

  it('answers OPTIONS on any path with the legacy preflight', async () => {
    const response = await h.fetch('/anything/at/all', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.org', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'X-Foo, Content-Type' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET,HEAD,PUT,PATCH,POST,DELETE');
    expect(response.headers.get('access-control-allow-headers')).toBe('X-Foo, Content-Type');
    expect(response.headers.get('vary')).toBe('Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    expect(response.headers.get('access-control-max-age')).toBeNull();
    expect((await h.fetch('/', { method: 'OPTIONS' })).headers.get('access-control-allow-headers')).toBeNull();
  });

  it('marks responses on the shadow hostname noindex, and only there', async () => {
    expect((await h.fetch('/v2/latest', {}, `https://${SHADOW}`)).headers.get('x-robots-tag')).toBe('noindex');
    expect((await h.fetch('/v2/latest', { method: 'OPTIONS' }, `https://${SHADOW}`)).headers.get('x-robots-tag')).toBe('noindex');
    expect((await h.fetch('/v2/latest')).headers.get('x-robots-tag')).toBeNull();
  });

  it('keeps the legacy historical edge cases', async () => {
    const blueOnly = await h.fetch('/v2/historical?day=2013-04-05');
    expect(blueOnly.status).toBe(200);
    expect(await blueOnly.text()).toBe(
      '{"oficial":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00},"blue":{"value_avg":8.00,"value_sell":8.00,"value_buy":8.00}}\n',
    );
    const before = h.db.queries.length;
    for (const day of ['0000-01-01', '0000-01-02']) {
      const response = await h.fetch(`/v2/historical?day=${day}`);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(BODY.dayNotFound);
    }
    for (const day of ['2024-02-30', '20240105', '2024-01-05T00:00:00', '%202024-01-05']) {
      expect(await (await h.fetch(`/v2/historical?day=${day}`)).text(), day).toBe(BODY.badDay);
    }
    expect(h.db.queries.length).toBe(before);
  });
});

describe('in-isolate caching', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.dispose());

  it('re-reads small bodies only after 15 s, in the background, and evolution only when its etag changed', async () => {
    await h.fetch('/v2/latest');
    await h.fetch('/v2/evolution.json');
    await h.settle();
    const bodyReads = (key: string) => queriesOf(h, /FROM rendered WHERE key/).filter((query) => query.values[0] === key).length;
    expect(bodyReads('latest')).toBe(1);
    expect(bodyReads('evolution_json')).toBe(1);

    await h.publish('latest', '{"changed":true}\n');
    h.advance(RENDERED_RECHECK_MS - 1);
    expect(await (await h.fetch('/v2/latest')).text()).toBe(goldenText('v2_latest'));
    await h.settle();
    expect(queriesOf(h, /SELECT key, etag FROM rendered/)).toHaveLength(0);

    h.advance(1);
    expect(await (await h.fetch('/v2/latest')).text()).toBe(goldenText('v2_latest'));
    await h.settle();
    expect(queriesOf(h, /SELECT key, etag FROM rendered/)).toHaveLength(1);
    expect(await (await h.fetch('/v2/latest')).text()).toBe('{"changed":true}\n');
    expect(bodyReads('latest')).toBe(2);
    expect(bodyReads('evolution_json')).toBe(1);

    await h.publish('evolution_json', '[{"date":"2026-11-23","source":"Oficial","value_sell":1.00,"value_buy":1.00}]\n');
    h.advance(RENDERED_RECHECK_MS);
    await h.fetch('/v2/evolution.json');
    await h.settle();
    expect(bodyReads('evolution_json')).toBe(2);
    expect(await (await h.fetch('/v2/evolution.json?days=1')).text()).toContain('2026-11-23');
  });

  it('keeps past historical days for an hour and re-reads today and misses after 60 s', async () => {
    const lookups = (day: string) => queriesOf(h, /FROM daily_rates WHERE day/).filter((query) => query.values[0] === day).length;
    for (let i = 0; i < 3; i++) {
      await h.fetch('/v2/historical?day=2024-01-05');
      await h.fetch('/v2/historical?day=2024-01-06');
      await h.fetch('/v2/historical?day=2026-11-20');
      await h.fetch('/v2/historical?day=2030-01-01');
    }
    expect([lookups('2024-01-05'), lookups('2026-11-20'), lookups('2030-01-01')]).toEqual([1, 1, 1]);
    h.advance(HISTORICAL_SHORT_TTL_MS);
    await h.fetch('/v2/historical?day=2024-01-07');
    await h.fetch('/v2/historical?day=2026-11-20');
    await h.fetch('/v2/historical?day=2030-01-01');
    expect([lookups('2024-01-05'), lookups('2026-11-20'), lookups('2030-01-01')]).toEqual([1, 2, 2]);
    // A past day is re-read hourly, so a later `backfill --since` reaches warm isolates.
    h.advance(HISTORICAL_PAST_DAY_TTL_MS);
    await h.fetch('/v2/historical?day=2024-01-05');
    expect(lookups('2024-01-05')).toBe(2);
  });
});

describe('D1 failures', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.dispose());

  it('serves the last copy in memory, and a JSON 500 when there is none', async () => {
    const latest = await (await h.fetch('/v2/latest')).text();
    const todayBody = await (await h.fetch('/v2/historical?day=2026-11-20')).text();
    h.db.failing = true;
    h.advance(RENDERED_RECHECK_MS + HISTORICAL_SHORT_TTL_MS);

    const served = await h.fetch('/v2/latest');
    await h.settle();
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(latest);
    expect((await h.fetch('/v2/latest')).status).toBe(200);

    const today = await h.fetch('/v2/historical?day=2026-11-20');
    expect(today.status).toBe(200);
    expect(await today.text()).toBe(todayBody);

    for (const path of ['/v2/alerts', '/v2/historical?day=2020-01-02']) {
      const response = await h.fetch(path);
      expect(response.status, path).toBe(500);
      expect(response.headers.get('content-type')).toBe(CONTENT_TYPE.json);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.text()).toBe(BODY.internalServerError);
    }

    h.db.failing = false;
    expect((await h.fetch('/v2/alerts')).status).toBe(200);
    expect(await (await h.fetch('/')).text()).toBe('OK');
  });

  it('answers a JSON 500 before the first render', async () => {
    const empty = await startHarness({ seed: false });
    try {
      const response = await empty.fetch('/v2/latest');
      expect(response.status).toBe(500);
      expect(await response.text()).toBe(BODY.internalServerError);
      expect((await empty.fetch('/')).status).toBe(200);
    } finally {
      await empty.dispose();
    }
  });
});
