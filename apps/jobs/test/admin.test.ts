/** The admin API as docs/MIGRATION.md uses it (2.4, 2.6, 2.7, 4.6, 4.10; checks C3, C6, C10). */
import { getLatestRates, getRendered, insertAlert } from '@bluelytics/db';
import { afterEach, describe, expect, it } from 'vitest';
import { handleAdmin } from '../src/admin.ts';
import type { Env } from '../src/env.ts';
import type { Harness } from './support/harness.ts';
import { art, createHarness } from './support/harness.ts';
import { testServiceAccount } from './support/keys.ts';

const TOKEN = 'test-admin-token';
const SATURDAY_NOON = art('2026-11-28', '12:00');

async function admin(h: Harness, method: string, path: string, options: { token?: string | null; adminToken?: string; now?: string } = {}) {
  const token = options.token === undefined ? TOKEN : options.token;
  const headers: Record<string, string> = token === null ? {} : { authorization: `Bearer ${token}` };
  const response = await handleAdmin(new Request(`https://jobs.example${path}`, { method, headers }), h.deps, options.adminToken ?? TOKEN, options.now ?? SATURDAY_NOON);
  return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
}

async function harness(env: Partial<Env> = {}): Promise<Harness> {
  const h = await createHarness({ BUFFER_API_KEY: 'test-buffer-key', ...env });
  h.setBlue({ buy: 1660, sell: 1680 });
  h.net.market.set('ambito_oficial', { buy: 1550, sell: 1600 });
  return h;
}

describe('admin API', () => {
  let h: Harness;
  afterEach(() => h.dispose());

  it('answers 404 without the exact bearer token, or when ADMIN_TOKEN is not set', async () => {
    h = await harness();
    expect((await admin(h, 'GET', '/admin/health', { token: null })).status).toBe(404);
    expect((await admin(h, 'GET', '/admin/health', { token: 'wrong' })).status).toBe(404);
    expect((await admin(h, 'GET', '/admin/health', { token: '', adminToken: '' })).status).toBe(404);
    expect((await admin(h, 'GET', '/admin/nothing')).status).toBe(404);
    expect((await admin(h, 'GET', '/admin/health')).status).toBe(200);
  });

  it('reports the effective flags in /admin/health (C3)', async () => {
    h = await harness({ PUSH_ENABLED: 'TRUE', SOCIAL_ENABLED: 'true', API_MODE: 'static-first' });
    const health = JSON.parse((await admin(h, 'GET', '/admin/health')).text);
    expect(health.flags).toEqual({ PUSH_ENABLED: false, SOCIAL_ENABLED: true, API_MODE: 'static-first', LEGACY_V1_BLUE_BUG: false });
    expect(health.channels).toEqual(['twitter', 'instagram']);
    expect(health.staticFirstMissing).toEqual(['CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_PURGE_TOKEN']);
  });

  it('runs a tick inside the window and lists every source in /admin/health', async () => {
    h = await harness();
    const at = art('2026-11-23', '11:00');
    const run = JSON.parse((await admin(h, 'POST', '/admin/run?force=1', { now: at })).text);
    expect(run).toMatchObject({ mode: 'tick', forced: true, errors: [] });
    const health = JSON.parse((await admin(h, 'GET', '/admin/health', { now: at })).text);
    expect(health.lastRun).toMatchObject({ at, mode: 'tick', failedSources: ['bna', 'criptoya'] });
    expect(health.sources.map((s: { source: string; status: string }) => [s.source, s.status])).toEqual(
      expect.arrayContaining([['ambito', 'ok'], ['bna', 'degraded']]),
    );
    expect(Object.keys(health.rendered).sort()).toEqual(['alerts', 'currency', 'evolution_csv', 'evolution_json', 'last_price', 'latest']);
  });

  it('a forced run outside the window writes only observations and re-renders the bodies (C6)', async () => {
    h = await harness();
    await h.run(art('2026-11-28', '06:00')); // Saturday's daily step
    const before = await getLatestRates(h.db);
    // MIGRATION.md 4.6: a baseline alert row, then a forced run re-renders /v2/alerts.
    await insertAlert(h.db, { alertAt: '2026-11-28T14:00:00.000Z', buy: 1650, sell: 1670, pushStatus: 'baseline' });
    const run = JSON.parse((await admin(h, 'POST', '/admin/run?force=1')).text);
    expect(run).toMatchObject({ mode: 'observe', forced: true, errors: [] });
    expect(run.sources).toHaveLength(9);
    expect(await h.rows('SELECT COUNT(*) AS n FROM observations WHERE run_at = ?', SATURDAY_NOON)).toEqual([{ n: 9 }]);
    for (const table of ['ticks', 'social_posts']) expect(await h.rows(`SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
    expect(await h.rows("SELECT COUNT(*) AS n FROM daily_rates WHERE day >= '2026-11-21'")).toEqual([{ n: 0 }]);
    expect(await h.rows('SELECT id FROM alerts ORDER BY id')).toEqual([{ id: 1884 }, { id: 1885 }, { id: 1886 }]);
    expect(await getLatestRates(h.db)).toEqual(before);
    expect((await getRendered(h.db, 'alerts'))?.body).toContain('"alert_id":1886');
  });

  it('without force=1, a run outside the window does nothing', async () => {
    h = await harness();
    await h.run(art('2026-11-28', '06:00'));
    const run = JSON.parse((await admin(h, 'POST', '/admin/run')).text);
    expect(run.mode).toBe('idle');
  });

  it('serves card HTML for preview and validates kind and size', async () => {
    h = await harness();
    await h.run(art('2026-11-23', '11:00'));
    const card = await admin(h, 'GET', '/admin/card?kind=update&size=portrait');
    expect(card.status).toBe(200);
    expect(card.type).toBe('text/html; charset=UTF-8');
    expect(card.text).toContain('<html');
    expect((await admin(h, 'GET', '/admin/card?kind=weekly&size=story')).status).toBe(200);
    expect((await admin(h, 'GET', '/admin/card?kind=og&size=portrait')).status).toBe(400);
    expect((await admin(h, 'GET', '/admin/card?kind=meme&size=og')).status).toBe(400);
  });

  it('social/test creates Buffer drafts only, even with SOCIAL_ENABLED off', async () => {
    h = await harness();
    await h.run(art('2026-11-23', '11:00'));
    const posts = await h.rows('SELECT * FROM social_posts');
    const result = JSON.parse((await admin(h, 'POST', '/admin/social/test')).text);
    expect(result.drafts.map((d: { network: string; ok: boolean; status: string }) => [d.network, d.ok, d.status])).toEqual([
      ['instagram', true, 'draft'],
      ['twitter', true, 'draft'],
    ]);
    const inputs = h.net.callsTo('api.buffer.com').map((call) => JSON.parse(call.body).variables.input);
    expect(inputs.every((input) => input.saveToDraft === true && input.mode === 'addToQueue')).toBe(true);
    expect(inputs[0].assets[0].image.url).toMatch(/^https:\/\/media\.bluelytics\.com\.ar\/social\/2026\/11\/test-instagram-post-\d{8}T\d{6}Z\.jpg$/);
    expect(await h.rows('SELECT * FROM social_posts')).toEqual(posts);
  });

  it('push/test validates the deployed Firebase secret with validate_only and sends nothing (C10)', async () => {
    const account = await testServiceAccount();
    h = await harness({ FIREBASE_SERVICE_ACCOUNT_JSON: account.json });
    await h.run(art('2026-11-23', '11:00'));
    const result = JSON.parse((await admin(h, 'POST', '/admin/push/test')).text);
    expect(result).toMatchObject({ ok: true, validateOnly: true, name: 'projects/bluelytics-mobile/messages/0:1' });
    const [push] = h.net.callsTo('fcm.googleapis.com');
    expect(JSON.parse(push?.body ?? '').validate_only).toBe(true);
  });

  it('push/test reports the shadow placeholder as an error instead of failing (C5)', async () => {
    h = await harness({ FIREBASE_SERVICE_ACCOUNT_JSON: '{"placeholder":"shadow mode, not a key"}' });
    await h.run(art('2026-11-23', '11:00'));
    const result = JSON.parse((await admin(h, 'POST', '/admin/push/test')).text);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('not a service-account key') });
    expect(h.net.callsTo('oauth2.googleapis.com')).toHaveLength(0);
  });
});
