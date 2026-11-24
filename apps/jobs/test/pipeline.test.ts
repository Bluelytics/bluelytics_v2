/**
 * Multi-tick scenario (ARCHITECTURE §12) on a real local D1 seeded from the legacy goldens:
 * Friday 2026-11-20 closed at blue 1615/1665, the last legacy alert (id 1885) was at sell 1670.
 * The week under test is Monday 2026-11-23 … Friday 2026-11-27, with push and social enabled.
 */
import { buildAlertNotification, buildFcmMessage } from '@bluelytics/core';
import { getLatestRates, getRendered } from '@bluelytics/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Harness } from './support/harness.ts';
import { art, createHarness } from './support/harness.ts';
import { testServiceAccount } from './support/keys.ts';

const MON = '2026-11-23';
const TUE = '2026-11-24';
const FRI = '2026-11-27';

describe('a trading week with push and social enabled', () => {
  let h: Harness;
  beforeAll(async () => {
    const account = await testServiceAccount();
    h = await createHarness({
      PUSH_ENABLED: 'true',
      SOCIAL_ENABLED: 'true',
      BUFFER_API_KEY: 'test-buffer-key',
      FIREBASE_SERVICE_ACCOUNT_JSON: account.json,
      OPS_WEBHOOK_URL: 'https://ops.example/hook',
    });
    h.setBlue({ buy: 1650, sell: 1670 });
    h.net.market.set('criptoya', { buy: 1650, sell: 1670 });
    h.net.market.set('ambito_oficial', { buy: 1550, sell: 1600 });
    h.net.market.set('bna', { buy: 1550, sell: 1600 });
  });
  afterAll(() => h.dispose());

  it('does nothing at all outside the window before the daily step is due', async () => {
    const report = await h.run(art('2026-11-22', '05:00'));
    expect(report).toEqual({ at: art('2026-11-22', '05:00'), forced: false, mode: 'idle', errors: [] });
    expect(h.net.calls).toEqual([]);
    expect(await h.rows('SELECT * FROM observations')).toEqual([]);
    expect(await h.rows('SELECT * FROM state')).toEqual([]);
  });

  it('runs only the daily step on a Sunday after 06:00, once', async () => {
    const report = await h.run(art('2026-11-22', '06:00'));
    expect(report.mode).toBe('daily');
    expect(report.daily?.day).toBe('2026-11-22');
    expect(await h.rows('SELECT * FROM ticks')).toEqual([]);
    const calls = h.net.calls.length;
    expect((await h.run(art('2026-11-22', '12:00'))).mode).toBe('idle');
    expect(h.net.calls.length).toBe(calls);
  });

  it('publishes the opening tick: consensus, daily rows, tick and bodies in one go', async () => {
    const at = art(MON, '07:00');
    const report = await h.run(at);
    expect(report.mode).toBe('tick');
    expect(report.errors).toEqual([]);
    expect(report.voters).toEqual({ blue: ['ambito', 'dolarhoy', 'cronista', 'infodolar'], oficial: ['bna'] });
    const latest = await getLatestRates(h.db);
    expect(latest.blue).toMatchObject({ buy: 1650, sell: 1670, updatedAt: at });
    expect(latest.oficial).toMatchObject({ buy: 1550, sell: 1600 });
    expect(await h.rows("SELECT tipo, buy, sell, origin FROM daily_rates WHERE day = ? ORDER BY tipo", MON)).toEqual([
      { tipo: 'Blue', buy: 1650, sell: 1670, origin: 'live' },
      { tipo: 'Oficial', buy: 1550, sell: 1600, origin: 'live' },
    ]);
    expect(await h.rows('SELECT run_at, day, blue_sell, oficial_sell FROM ticks')).toEqual([{ run_at: at, day: MON, blue_sell: 1670, oficial_sell: 1600 }]);
    expect(await h.rows("SELECT COUNT(*) AS n FROM observations WHERE run_at = ? AND kind != 'extra'", at)).toEqual([{ n: 9 }]);
    expect(report.rendered).toEqual(expect.arrayContaining(['latest', 'last_price', 'evolution_json', 'evolution_csv']));
    const body = (await getRendered(h.db, 'latest'))?.body ?? '';
    expect(body).toContain('"blue":{"value_avg":1660.00,"value_sell":1670.00,"value_buy":1650.00}');
    expect((await getRendered(h.db, 'evolution_json'))?.body.startsWith(`[{"date":"${MON}","source":"Oficial","value_sell":1600.00`)).toBe(true);
    // 1670 is within 0.5 % of the last alert: no alert; 07:00 is before the social window.
    expect(report.alert).toEqual({ fired: false, reason: 'small_change' });
    expect(report.social?.attempts).toEqual({});
    expect(report.ogRefreshed).toBe(true);
    expect(h.bucket.objects.get('og/latest.jpg')?.contentType).toBe('image/jpeg');
  });

  it('does not rebuild the evolution bodies while today\'s values stay put', async () => {
    const report = await h.run(art(MON, '07:05'));
    expect(report.rendered).toEqual(['latest', 'last_price']);
    expect(report.ogRefreshed).toBe(false);
  });

  it('fires one alert with the legacy payload and posts once per network (Monday compares with Friday)', async () => {
    h.setBlue({ buy: 1660, sell: 1680 });
    const at = art(MON, '10:00');
    const report = await h.run(at);
    expect(report.errors).toEqual([]);
    expect(report.alert).toEqual({ fired: true, id: 1886, sell: 1680, pushStatus: 'sent' });
    expect(await h.rows('SELECT id, alert_at, buy, sell, push_status FROM alerts WHERE id > 1885')).toEqual([
      { id: 1886, alert_at: at, buy: 1660, sell: 1680, push_status: 'sent' },
    ]);
    expect((await getRendered(h.db, 'alerts'))?.body).toContain('"alert_id":1886');

    const [push] = h.net.callsTo('fcm.googleapis.com');
    expect(push?.url).toBe('https://fcm.googleapis.com/v1/projects/bluelytics-mobile/messages:send');
    expect(push?.headers.get('authorization')).toBe('Bearer test-access-token');
    expect(JSON.parse(push?.body ?? '')).toEqual(buildFcmMessage(buildAlertNotification(1680, 1670)));
    expect(JSON.parse(push?.body ?? '').message.notification).toEqual({ title: 'Subió el Dólar Blue', body: 'Venta: 1680.00 (+10.00 / +0.60%)' });

    // 1680 is +0.9 % on Friday's close (1665) but only +0.6 % on the last published 1670: posting proves the Friday baseline.
    expect(report.social?.attempts).toEqual({ 'twitter/update-2026-11-23-1680': 'sent', 'instagram/update-2026-11-23-1680': 'sent' });
    const posts = await h.rows<{ network: string; status: string; image_key: string; external_id: string; attempts: number }>(
      'SELECT network, status, image_key, external_id, attempts FROM social_posts ORDER BY id',
    );
    expect(posts).toEqual([
      { network: 'twitter', status: 'sent', image_key: 'social/2026/11/twitter-update-2026-11-23-1680.jpg', external_id: 'post-1', attempts: 1 },
      { network: 'instagram', status: 'sent', image_key: 'social/2026/11/instagram-update-2026-11-23-1680.jpg', external_id: 'post-2', attempts: 1 },
    ]);
    const creates = h.net.callsTo('api.buffer.com').map((call) => JSON.parse(call.body).variables.input);
    expect(creates.map((input) => [input.channelId, input.mode, input.assets[0].image.url])).toEqual([
      ['chan-x', 'shareNow', 'https://media.bluelytics.com.ar/social/2026/11/twitter-update-2026-11-23-1680.jpg'],
      ['chan-ig', 'shareNow', 'https://media.bluelytics.com.ar/social/2026/11/instagram-update-2026-11-23-1680.jpg'],
    ]);
    expect(h.bucket.objects.get('social/2026/11/twitter-update-2026-11-23-1680.jpg')?.contentType).toBe('image/jpeg');
  });

  it('does not alert or post again for the same move', async () => {
    for (const time of ['10:05', '10:15', '10:30']) {
      const report = await h.run(art(MON, time));
      expect(report.alert?.fired).toBe(false);
      expect(report.social?.attempts).toEqual({});
    }
    expect(h.net.callsTo('fcm.googleapis.com')).toHaveLength(1);
    expect(h.net.callsTo('api.buffer.com')).toHaveLength(2);
  });

  it('keeps voting with fresh quotes, substitutes infobae for cronista and holds when nobody is fresh', async () => {
    h.net.market.set('cronista', 'down');
    const substituted = await h.run(art(TUE, '07:00'));
    expect(substituted.voters?.blue).toEqual(['ambito', 'dolarhoy', 'infobae', 'infodolar']);
    for (const id of ['ambito', 'dolarhoy', 'cronista', 'infodolar', 'infobae', 'lanacion', 'criptoya']) h.net.market.set(id, 'down');
    const before = await getLatestRates(h.db);
    // 07:05: the 07:00 quotes are still fresh (≤ 30 min) and keep voting.
    expect((await h.run(art(TUE, '07:05'))).voters?.blue).toHaveLength(4);
    const held = await h.run(art(TUE, '07:40'));
    expect(held.held).toEqual({ blue: true, oficial: false });
    expect(held.voters?.blue).toEqual([]);
    const after = await getLatestRates(h.db);
    expect(after.blue).toEqual({ ...before.blue, updatedAt: art(TUE, '07:05') });
    expect(held.alert).toBeUndefined();
    expect(await h.rows('SELECT blue_sell, voters FROM ticks WHERE run_at = ?', art(TUE, '07:40'))).toEqual([
      { blue_sell: 1680, voters: JSON.stringify({ blue: [], oficial: ['bna'] }) },
    ]);
  });

  it('sends one ops message when a source has failed six runs in a row', async () => {
    for (const time of ['07:45', '07:50', '07:55']) await h.run(art(TUE, time));
    const hooks = h.net.callsTo('ops.example').map((call) => JSON.parse(call.body).text as string);
    expect(hooks.filter((text) => text.includes('source cronista'))).toHaveLength(1);
    expect(hooks.find((text) => text.includes('source cronista'))).toMatch(/failed \d+ consecutive runs \(last error: fetch\.http: HTTP 503/);
    await h.run(art(TUE, '08:00'));
    expect(h.net.callsTo('ops.example').filter((call) => call.body.includes('source cronista'))).toHaveLength(1);
  });

  it('posts the weekly chart once per network on Friday from 18:00', async () => {
    h.setBlue({ buy: 1660, sell: 1680 });
    h.net.market.set('criptoya', { buy: 1660, sell: 1680 });
    const thursday = await h.run(art('2026-11-26', '18:00'));
    expect(Object.keys(thursday.social?.attempts ?? {})).toEqual([]);
    const friday = await h.run(art(FRI, '18:00'));
    expect(friday.social?.attempts).toEqual({ 'twitter/weekly-2026-W48': 'sent', 'instagram/weekly-2026-W48': 'sent' });
    const again = await h.run(art(FRI, '18:05'));
    expect(again.social?.attempts).toEqual({});
    expect(await h.rows("SELECT network, status FROM social_posts WHERE kind = 'weekly' ORDER BY id")).toEqual([
      { network: 'twitter', status: 'sent' },
      { network: 'instagram', status: 'sent' },
    ]);
    const weeklyHtml = h.renderer.renders.at(-1)?.html ?? '';
    expect(weeklyHtml).toContain('<html');
  });

  it('stops at the end of the window', async () => {
    const calls = h.net.calls.length;
    expect((await h.run(art(FRI, '20:00'))).mode).toBe('idle');
    expect(h.net.calls.length).toBe(calls);
  });
});

describe('a crash between the pending claim and the result', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ SOCIAL_ENABLED: 'true', BUFFER_API_KEY: 'test-buffer-key', BUFFER_CHANNELS: '{"twitter":"chan-x"}' });
    h.setBlue({ buy: 1660, sell: 1680 });
    h.net.market.set('ambito_oficial', { buy: 1550, sell: 1600 });
    await h.run(art(MON, '06:00')); // daily step out of the way
  });
  afterAll(() => h.dispose());

  it('never sends twice, and retries the stale claim once it is 15 minutes old', async () => {
    h.renderer.mode = 'hang';
    void h.run(art(MON, '10:00')); // the invocation "dies" while rendering the claimed post
    await expect.poll(() => h.renderer.renders.length).toBeGreaterThan(0);
    expect(await h.rows('SELECT event_key, status FROM social_posts')).toEqual([{ event_key: 'update-2026-11-23-1680', status: 'pending' }]);
    h.renderer.mode = 'ok';

    const overlapping = await h.run(art(MON, '10:05'));
    expect(overlapping.social?.attempts).toEqual({});
    expect(h.net.callsTo('api.buffer.com')).toHaveLength(0);

    const retried = await h.run(art(MON, '10:20'));
    expect(retried.social).toEqual({ staleFailed: 1, attempts: { 'twitter/update-2026-11-23-1680': 'sent' } });
    expect(await h.rows('SELECT status, attempts, external_id FROM social_posts')).toEqual([{ status: 'sent', attempts: 2, external_id: 'post-1' }]);

    await h.run(art(MON, '10:25'));
    expect(h.net.callsTo('api.buffer.com')).toHaveLength(1);
  });

  it('retries a failed post at most twice', async () => {
    h.setBlue({ buy: 1680, sell: 1700 });
    h.renderer.mode = 'fail';
    const first = await h.run(art(MON, '10:40'));
    expect(first.social?.attempts).toEqual({ 'twitter/update-2026-11-23-1700-after-20261123T132000Z': 'failed' });
    await h.run(art(MON, '10:45'));
    await h.run(art(MON, '10:50'));
    await h.run(art(MON, '10:55'));
    expect(await h.rows("SELECT status, attempts, error FROM social_posts WHERE sell = 1700")).toEqual([
      { status: 'failed', attempts: 3, error: 'Browser Run 429: Browser time limit exceeded for today' },
    ]);
  });
});

describe('shadow mode (both flags off)', () => {
  let h: Harness;
  beforeAll(async () => {
    const account = await testServiceAccount();
    h = await createHarness({ FIREBASE_SERVICE_ACCOUNT_JSON: account.json, BUFFER_API_KEY: 'a-real-looking-key' });
    h.setBlue({ buy: 1660, sell: 1680 });
    h.net.market.set('ambito_oficial', { buy: 1550, sell: 1600 });
  });
  afterAll(() => h.dispose());

  it('records the alert as disabled and the posts as dry_run without calling Buffer or FCM', async () => {
    const report = await h.run(art(MON, '10:00'));
    expect(report.alert).toEqual({ fired: true, id: 1886, sell: 1680, pushStatus: 'disabled' });
    expect(await h.rows('SELECT network, status, sent_at, external_id, image_key FROM social_posts ORDER BY id')).toEqual([
      { network: 'twitter', status: 'dry_run', sent_at: art(MON, '10:00'), external_id: null, image_key: 'social/2026/11/twitter-update-2026-11-23-1680-dry.jpg' },
      { network: 'instagram', status: 'dry_run', sent_at: art(MON, '10:00'), external_id: null, image_key: 'social/2026/11/instagram-update-2026-11-23-1680-dry.jpg' },
    ]);
    const hosts = new Set(h.net.calls.map((call) => call.host));
    for (const host of ['api.buffer.com', 'oauth2.googleapis.com', 'fcm.googleapis.com']) expect(hosts.has(host)).toBe(false);
  });

  it('applies the cooldowns and the 0.75 % baseline to dry runs, as live posting would', async () => {
    h.setBlue({ buy: 1670, sell: 1690 });
    expect((await h.run(art(MON, '10:05'))).social?.attempts).toEqual({});
    h.setBlue({ buy: 1680, sell: 1700 });
    // X's 15-minute cooldown has passed and 1700 is 1.2 % above the dry-run 1680; Instagram's 60 minutes have not.
    expect((await h.run(art(MON, '10:20'))).social?.attempts).toEqual({ 'twitter/update-2026-11-23-1700-after-20261123T130000Z-dry': 'dry_run' });
  });

  it('posts for real on the day SOCIAL_ENABLED is switched on: dry_run rows never block or seed a live post (C9)', async () => {
    h.deps.config.socialEnabled = true;
    const report = await h.run(art(MON, '10:25'));
    expect(report.social?.attempts).toEqual({ 'twitter/update-2026-11-23-1700': 'sent', 'instagram/update-2026-11-23-1700': 'sent' });
    expect(h.net.callsTo('api.buffer.com')).toHaveLength(2);
  });
});
