import { describe, expect, it } from 'vitest';
import { ParseError, ambitoExtras, fetchExtras, parseAmbitoMonedas, type FetchLike } from '../src/index.ts';
import { fixture, mutate } from './fixtures.ts';

const NOW = '2026-11-22T15:00:00.000Z';
const monedas = fixture('ambito_mercados_monedas.json');

describe('parseAmbitoMonedas', () => {
  it('maps the known items to extra_rates codes; sell-only items have no buy', () => {
    expect(parseAmbitoMonedas(monedas)).toEqual([
      { code: 'bna', name: 'Dólar BNA', buyCents: 155000, sellCents: 160000, sourceTs: '2026-11-20T21:55:00.000Z' },
      { code: 'tarjeta', name: 'Dólar tarjeta', buyCents: null, sellCents: 208000, sourceTs: '2026-11-20T21:55:00.000Z' },
      { code: 'importador', name: 'Dólar importador', buyCents: null, sellCents: 185650, sourceTs: '2026-11-20T19:44:00.000Z' },
      { code: 'mep', name: 'Dólar MEP', buyCents: 170105, sellCents: 170105, sourceTs: '2026-11-20T22:55:00.000Z' },
      { code: 'mayorista', name: 'Dólar mayorista', buyCents: 157100, sellCents: 158000, sourceTs: '2026-11-20T19:44:00.000Z' },
      { code: 'cripto', name: 'Dólar cripto', buyCents: 176365, sellCents: 176365, sourceTs: '2026-11-22T14:40:00.000Z' },
      { code: 'euro', name: 'Euro oficial', buyCents: 169809, sellCents: 179807, sourceTs: '2026-11-20T19:49:00.000Z' },
      { code: 'euro_blue', name: 'Euro blue', buyCents: 182232, sellCents: 184434, sourceTs: '2026-11-20T20:00:00.000Z' },
    ]);
  });

  it('throws on a malformed number of a known item instead of dropping or guessing it', () => {
    expect(() => parseAmbitoMonedas(mutate(monedas, '"compra":"1701,05"', '"compra":"1701.05"'))).toThrow(ParseError);
    expect(() => parseAmbitoMonedas('[{"nombre":"Merval","compra":"1,00","venta":"2,00"}]')).toThrow(/no known item/);
    expect(() => parseAmbitoMonedas('{"nombre":"Dólar Mep"}')).toThrow(ParseError);
  });
});

describe('fetchExtras', () => {
  const fetch: FetchLike = async (url) =>
    new Response(fixture(url.endsWith('/mercados/monedas') ? 'ambito_mercados_monedas.json' : 'ambito_ccl.json'));

  it('captures monedas + CCL as extra_rates rows and one health observation', async () => {
    const { observation, rates } = await fetchExtras(ambitoExtras, { fetch, now: NOW });
    expect(rates.map((r) => r.code)).toEqual(['bna', 'tarjeta', 'importador', 'mep', 'mayorista', 'cripto', 'euro', 'euro_blue', 'ccl']);
    expect(rates.at(-1)).toEqual({
      code: 'ccl',
      name: 'Dólar CCL',
      buyCents: 179914,
      sellCents: 179914,
      sourceTs: '2026-11-20T22:55:00.000Z',
      source: 'ambito',
      updatedAt: NOW,
    });
    expect(observation).toMatchObject({ source: 'ambito_extras', kind: 'extra', ok: true, buyCents: null, error: null });
  });

  it('keeps what succeeded and reports the rest', async () => {
    const half: FetchLike = async (url, init) => (url.endsWith('/cl/variacion') ? new Response('', { status: 500 }) : fetch(url, init));
    const { observation, rates } = await fetchExtras(ambitoExtras, { fetch: half, now: '2026-11-28T15:00:00Z' });
    // 2026-11-28: only cripto (dated 22/11) is within 7 days; the CCL request failed.
    expect(rates.map((r) => r.code)).toEqual(['cripto']);
    expect(observation.ok).toBe(true);
    expect(observation.error).toContain('fetch.http: HTTP 500');
    expect(observation.error).toContain('mep: parse.stale');
  });

  it('is a failed observation when nothing could be captured', async () => {
    const down: FetchLike = async () => new Response('', { status: 503 });
    const { observation, rates } = await fetchExtras(ambitoExtras, { fetch: down, now: NOW });
    expect(rates).toEqual([]);
    expect(observation.ok).toBe(false);
  });
});
