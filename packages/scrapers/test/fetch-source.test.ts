import { describe, expect, it } from 'vitest';
import {
  TICK_SOURCES,
  USER_AGENT,
  ambito,
  bna,
  cronista,
  fetchAll,
  fetchSource,
  type FetchLike,
  type Source,
} from '../src/index.ts';
import { fixture } from './fixtures.ts';

const NOW = '2026-11-20T22:00:00.000Z';

const FIXTURE_BY_URL: Record<string, string> = {
  [ambito.url]: 'ambito_informal.json',
  'https://mercados.ambito.com/dolar/oficial/variacion': 'ambito_oficial.json',
  'https://dolarhoy.com/cotizaciondolarblue': 'dolarhoy_blue.html',
  [cronista.url]: 'cronista.html',
  'https://www.infodolar.com/cotizacion-dolar-blue.aspx': 'infodolar_blue.html',
  'https://www.lanacion.com.ar/tema/dolar-blue-tid67294/': 'lanacion.html',
  'https://www.infobae.com/economia/divisas/dolar-libre/': 'infobae_dolar_libre.html',
  [bna.url]: 'bna_personas.html',
  'https://criptoya.com/api/dolar': 'criptoya_dolar.json',
};

const fixtureFetch: FetchLike = async (url) => {
  const name = FIXTURE_BY_URL[url];
  return name === undefined ? new Response('not found', { status: 404 }) : new Response(fixture(name));
};

describe('fetchSource', () => {
  it('sends the honest User-Agent, one GET per source, and returns an observations row', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return new Response(fixture('ambito_informal.json'));
    };
    const observation = await fetchSource(ambito, { fetch, now: '2026-11-20T19:00:00-03:00' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(ambito.url);
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('user-agent')).toBe(USER_AGENT);
    expect(USER_AGENT).toBe('bluelytics-bot/2.0 (+https://bluelytics.com.ar)');
    expect(headers.get('accept')).toBe('application/json');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(observation).toEqual({
      runAt: NOW,
      source: 'ambito',
      kind: 'blue',
      ok: true,
      buyCents: 165500,
      sellCents: 167500,
      sourceTs: '2026-11-20T21:55:00.000Z',
      error: null,
      durationMs: expect.any(Number),
    });
  });

  it('turns a non-200 into a failed observation without prices', async () => {
    const fetch: FetchLike = async () => new Response('{"error":"404","trace":"…"}', { status: 404 });
    expect(await fetchSource(ambito, { fetch, now: NOW })).toMatchObject({
      ok: false,
      buyCents: null,
      sellCents: null,
      sourceTs: null,
      error: 'fetch.http: HTTP 404 from https://mercados.ambito.com/dolar/informal/variacion',
    });
  });

  it('times out on a hanging server, using the override timeout', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const observation = await fetchSource(bna, { fetch, now: NOW, timeoutMs: 30 });
    expect(observation.ok).toBe(false);
    expect(observation.error).toMatch(/^fetch\.timeout: no complete response from https:\/\/www\.bna\.com\.ar\/Personas within 30 ms$/);
  });

  it('reports network errors and parse errors with their codes', async () => {
    const broken: FetchLike = async () => {
      throw new TypeError('connection reset');
    };
    expect((await fetchSource(ambito, { fetch: broken, now: NOW })).error).toBe(
      'fetch.network: GET https://mercados.ambito.com/dolar/informal/variacion failed: connection reset',
    );
    const page: FetchLike = async () => new Response('<html>Attention Required! | Cloudflare</html>');
    expect((await fetchSource(cronista, { fetch: page, now: NOW })).error).toMatch(/^parse\.anchor: /);
  });

  it('refuses a quote dated more than 7 days before the run or more than 6 hours after it', async () => {
    const late = await fetchSource(ambito, { fetch: fixtureFetch, now: '2026-11-27T22:00:00Z' });
    expect(late).toMatchObject({ ok: false, buyCents: null, error: expect.stringMatching(/^parse\.stale: /) });
    expect((await fetchSource(ambito, { fetch: fixtureFetch, now: '2026-11-27T21:55:00Z' })).ok).toBe(true);
    const early = await fetchSource(ambito, { fetch: fixtureFetch, now: '2026-11-20T15:54:00Z' });
    expect(early.error).toMatch(/in the future/);
  });

  it('never lets a parser exception escape', async () => {
    const exploding: Source = { ...ambito, parse: () => { throw new RangeError('boom'); } };
    expect((await fetchSource(exploding, { fetch: fixtureFetch, now: NOW })).error).toBe('error: boom');
  });
});

describe('fetchAll', () => {
  it('fetches every tick source in parallel and keeps input order', async () => {
    const observations = await fetchAll(TICK_SOURCES, { fetch: fixtureFetch, now: NOW });
    expect(observations.map((o) => [o.source, o.kind, o.ok, o.buyCents, o.sellCents, o.sourceTs, o.error])).toEqual([
      ['ambito', 'blue', true, 165500, 167500, '2026-11-20T21:55:00.000Z', null],
      ['ambito_oficial', 'oficial', true, 154841, 160132, '2026-11-20T19:46:00.000Z', null],
      ['dolarhoy', 'blue', true, 165500, 167500, null, null],
      ['cronista', 'blue', true, 165500, 167500, '2026-11-20T21:25:13.970Z', null],
      ['infodolar', 'blue', true, 165500, 167500, '2026-11-20T21:00:00.000Z', null],
      ['lanacion', 'blue', true, 161505, 166500, null, null],
      ['infobae', 'blue', true, 165500, 167500, '2026-11-20T19:05:16.000Z', null],
      ['bna', 'oficial', true, 155000, 160000, '2026-11-20T20:03:00.000Z', null],
      // criptoya's timestamp is its poll time (Sunday), ahead of this Friday run by more than 6 hours.
      ['criptoya', 'blue', false, null, null, null, expect.stringMatching(/^parse\.stale: .*in the future/)],
    ]);
    expect(new Set(observations.map((o) => o.runAt))).toEqual(new Set([NOW]));
  });

  it('isolates failures: one source down does not affect the others', async () => {
    const fetch: FetchLike = async (url, init) => (url === cronista.url ? new Response('', { status: 503 }) : fixtureFetch(url, init));
    const observations = await fetchAll([ambito, cronista], { fetch, now: NOW });
    expect(observations.map((o) => o.ok)).toEqual([true, false]);
  });

  it('uses the per-source timeouts of ARCHITECTURE §7 (8 s, 20 s for BNA)', () => {
    expect(Object.fromEntries(TICK_SOURCES.map((s) => [s.id, s.timeoutMs]))).toEqual({
      ambito: 8000,
      ambito_oficial: 8000,
      dolarhoy: 8000,
      cronista: 8000,
      infodolar: 8000,
      lanacion: 8000,
      infobae: 8000,
      bna: 20000,
      criptoya: 8000,
    });
  });
});
