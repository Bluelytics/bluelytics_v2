import { getLatestRates, getRendered } from '@bluelytics/db';
import { TICK_SOURCES } from '@bluelytics/scrapers';
import { afterEach, describe, expect, it } from 'vitest';
import { STATIC_API_OBJECTS, staticApiKey } from '../src/static-api.ts';
import type { Harness } from './support/harness.ts';
import { art, createHarness, fixture } from './support/harness.ts';

/** The pages saved on 2026-11-22, served verbatim at each real source URL. */
const PAGES: Record<string, string> = {
  ambito: 'ambito_informal.json',
  ambito_oficial: 'ambito_oficial.json',
  dolarhoy: 'dolarhoy_blue.html',
  cronista: 'cronista.html',
  infodolar: 'infodolar_blue.html',
  lanacion: 'lanacion.html',
  infobae: 'infobae_dolar_libre.html',
  bna: 'bna_personas.html',
  criptoya: 'criptoya_dolar.json',
};

describe('tick with the real parsers', () => {
  let h: Harness;
  afterEach(() => h.dispose());

  it('publishes the fixtures\' consensus through TICK_SOURCES', async () => {
    h = await createHarness();
    h.deps.sources = TICK_SOURCES;
    for (const source of TICK_SOURCES) h.net.pages.set(source.url, fixture(PAGES[source.id] as string));
    await h.run(art('2026-11-23', '06:00'));
    const report = await h.run(art('2026-11-23', '12:00'));
    expect(report.sources?.every((source) => source.ok)).toBe(true);
    expect(report.voters).toEqual({ blue: ['ambito', 'dolarhoy', 'cronista', 'infodolar'], oficial: ['bna'] });
    const latest = await getLatestRates(h.db);
    expect([latest.blue?.buy, latest.blue?.sell, latest.oficial?.buy, latest.oficial?.sell]).toEqual([1655, 1675, 1550, 1600]);
    const userAgents = new Set(h.net.calls.filter((call) => call.method === 'GET').map((call) => call.headers.get('user-agent')));
    expect(userAgents).toEqual(new Set(['bluelytics-bot/2.0 (+https://bluelytics.com.ar)']));
  });
});

describe('API_MODE=static-first', () => {
  let h: Harness;
  afterEach(() => h.dispose());

  async function staticHarness(): Promise<Harness> {
    const harness = await createHarness({ API_MODE: 'static-first', CLOUDFLARE_ZONE_ID: 'zone-1', CLOUDFLARE_PURGE_TOKEN: 'purge-token' });
    harness.setBlue({ buy: 1660, sell: 1680 });
    harness.net.market.set('ambito_oficial', { buy: 1550, sell: 1600 });
    await harness.run(art('2026-11-23', '06:00'));
    return harness;
  }

  it('copies every body to R2 as api/<path> and purges both path forms', async () => {
    h = await staticHarness();
    const report = await h.run(art('2026-11-23', '10:00'));
    expect(report.staticApi?.copied.sort()).toEqual(['alerts', 'currency', 'evolution_csv', 'evolution_json', 'last_price', 'latest']);
    const latest = h.bucket.objects.get('api/v2/latest');
    expect(latest).toMatchObject({ contentType: 'application/json; charset=UTF-8', cacheControl: 'public, max-age=30' });
    expect(latest?.value).toBe((await getRendered(h.db, 'latest'))?.body);
    expect(h.bucket.objects.get(staticApiKey('evolution_csv'))?.cacheControl).toBe(STATIC_API_OBJECTS.evolution_csv.cacheControl);
    const purges = h.net.callsTo('api.cloudflare.com');
    expect(purges.map((call) => call.url)).toEqual(['https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache']);
    expect(purges[0]?.headers.get('authorization')).toBe('Bearer purge-token');
    expect(JSON.parse(purges[0]?.body ?? '').prefixes).toEqual(expect.arrayContaining(['api.bluelytics.com.ar/v2/latest', 'api.bluelytics.com.ar/api/v2/latest']));
  });

  it('copies only what changed on later runs, and repeats a failed purge', async () => {
    h = await staticHarness();
    await h.run(art('2026-11-23', '10:00'));
    const second = await h.run(art('2026-11-23', '10:05'));
    expect(second.staticApi?.copied.sort()).toEqual(['last_price', 'latest']);
    h.net.pages.set('https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache', () => new Response('rate limited', { status: 429 }));
    const failed = await h.run(art('2026-11-23', '10:10'));
    expect(failed.errors).toEqual([expect.stringMatching(/^static-api: purge failed: HTTP 429/)]);
    h.net.pages.delete('https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache');
    const healed = await h.run(art('2026-11-23', '10:15'));
    expect(healed.staticApi?.copied.sort()).toEqual(['last_price', 'latest']);
    expect(healed.errors).toEqual([]);
  });

  it('copies nothing while the zone id or the purge token is missing (MIGRATION.md 7.3)', async () => {
    h = await createHarness({ API_MODE: 'static-first', CLOUDFLARE_PURGE_TOKEN: 'purge-token' });
    h.setBlue({ buy: 1650, sell: 1670 });
    h.net.market.set('ambito_oficial', { buy: 1550, sell: 1600 });
    const report = await h.run(art('2026-11-23', '10:00'));
    expect(report.errors).toEqual(['static-api: static-first purge needs CLOUDFLARE_ZONE_ID']);
    expect([...h.bucket.objects.keys()].filter((key) => key.startsWith('api/'))).toEqual([]);
  });
});
