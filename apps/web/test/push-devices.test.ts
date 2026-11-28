import type { LocalD1 } from '@bluelytics/db/testing';
import { createLocalD1 } from '@bluelytics/db/testing';
import { listApnsDevices } from '@bluelytics/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RateLimiter } from '../src/lib/push-devices.ts';
import { handlePushDevices, isPushDevicesRequest } from '../src/lib/push-devices.ts';

const URL = 'https://bluelytics.com.ar/app/push/apple';
const TOKEN = 'ab'.repeat(32);

function request(method: string, body: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }): Request {
  return new Request(URL, { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

describe('iPhone alert registrations (/app/push/apple)', () => {
  let local: LocalD1;
  let allowed = true;
  const limiter: RateLimiter = { limit: async () => ({ success: allowed }) };
  const call = (req: Request) => handlePushDevices(req, { db: local.db, limiter, now: () => '2026-11-28T12:00:00Z' });

  beforeAll(async () => {
    local = await createLocalD1();
  });
  afterAll(() => local.dispose());

  it('is routed only on its exact path', () => {
    expect(isPushDevicesRequest(new Request(URL, { method: 'POST' }))).toBe(true);
    expect(isPushDevicesRequest(new Request(`${URL}/x`))).toBe(false);
    expect(isPushDevicesRequest(new Request('https://bluelytics.com.ar/app/push'))).toBe(false);
  });

  it('stores a token, updates its environment on a second registration, and deletes it', async () => {
    expect((await call(request('POST', { token: TOKEN, environment: 'sandbox' }))).status).toBe(204);
    expect((await call(request('POST', { token: TOKEN, environment: 'production' }))).status).toBe(204);
    expect(await listApnsDevices(local.db)).toEqual([{ token: TOKEN, environment: 'production' }]);
    const deleted = await call(request('DELETE', { token: TOKEN }));
    expect(deleted.status).toBe(204);
    expect(deleted.headers.get('Cache-Control')).toBe('no-store');
    expect(await listApnsDevices(local.db)).toEqual([]);
    // Unknown tokens delete quietly.
    expect((await call(request('DELETE', { token: TOKEN }))).status).toBe(204);
  });

  it('rejects anything that is not a registration', async () => {
    const cases: [Request, number][] = [
      [new Request(URL), 405],
      [request('PUT', { token: TOKEN, environment: 'production' }), 405],
      [request('POST', { token: TOKEN, environment: 'production' }, { 'Content-Type': 'text/plain' }), 415],
      [request('POST', 'not json'), 400],
      [request('POST', { token: TOKEN.toUpperCase(), environment: 'production' }), 400],
      [request('POST', { token: 'abc', environment: 'production' }), 400],
      [request('POST', { token: `${TOKEN}0`, environment: 'production' }), 400],
      [request('POST', { token: TOKEN, environment: 'staging' }), 400],
      [request('POST', { token: TOKEN }), 400],
      [request('POST', { token: TOKEN, environment: 'production', padding: 'x'.repeat(2000) }), 413],
    ];
    for (const [req, status] of cases) expect([req.method, (await call(req)).status]).toEqual([req.method, status]);
    expect(await listApnsDevices(local.db)).toEqual([]);
  });

  it('answers 429 when the address is over its limit', async () => {
    allowed = false;
    const response = await call(request('POST', { token: TOKEN, environment: 'production' }));
    allowed = true;
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(await listApnsDevices(local.db)).toEqual([]);
  });
});
