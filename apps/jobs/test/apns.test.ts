import { APNS, buildAlertNotification, buildApnsPayload } from '@bluelytics/core';
import { describe, expect, it } from 'vitest';
import { ApnsError, sendApns } from '../src/apns.ts';
import { testApnsKey } from './support/keys.ts';

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(text, 'base64url'));
const token = (digit: string) => digit.repeat(64);
const nowMs = Date.parse('2026-11-23T13:00:00Z');

type Answer = { status: number; reason?: string };
function fakeApple(answers: Record<string, Answer> = {}) {
  const calls: { url: string; headers: Headers; body: string }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, headers: new Headers(init.headers), body: String(init.body) });
    const answer = answers[url.split('/').pop() ?? ''] ?? { status: 200 };
    return answer.reason ? Response.json({ reason: answer.reason }, { status: answer.status }) : new Response(null, { status: answer.status });
  };
  return { calls, fetch };
}

describe('APNs sender (iOS alerts without Firebase)', () => {
  const notification = buildAlertNotification(1680, 1670);

  it('signs an ES256 provider token and posts the alert to each device on its own host', async () => {
    const key = await testApnsKey();
    const apple = fakeApple();
    const report = await sendApns(
      notification,
      [
        { token: token('a'), environment: 'production' },
        { token: token('b'), environment: 'sandbox' },
      ],
      { fetch: apple.fetch, keyP8: key.p8, keyId: 'ABC123DEFG', nowMs },
    );
    expect(report).toEqual({ sent: 2, invalid: [], failed: [] });
    expect(apple.calls.map((call) => call.url)).toEqual([
      `https://api.push.apple.com/3/device/${token('a')}`,
      `https://api.sandbox.push.apple.com/3/device/${token('b')}`,
    ]);
    const [call] = apple.calls;
    expect(JSON.parse(call?.body ?? '')).toEqual(buildApnsPayload(notification));
    expect(JSON.parse(call?.body ?? '')).toEqual({ aps: { alert: { title: 'Subió el Dólar Blue', body: 'Venta: 1680.00 (+10.00 / +0.60%)' }, sound: 'default' } });
    const headers = call?.headers ?? new Headers();
    expect(Object.fromEntries(['apns-topic', 'apns-push-type', 'apns-priority', 'apns-collapse-id', 'apns-expiration'].map((name) => [name, headers.get(name)]))).toEqual({
      'apns-topic': 'com.bluelytics.mobile',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-collapse-id': 'dolar-blue',
      'apns-expiration': String(nowMs / 1000 + APNS.ttlSeconds),
    });

    const jwt = (headers.get('authorization') ?? '').replace(/^bearer /, '');
    const [header, claims, signature] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'ABC123DEFG' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ iss: '9AGK8J3LYF', iat: nowMs / 1000 });
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.publicKey,
      fromBase64Url(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
    // One provider token for the whole alert.
    expect(new Set(apple.calls.map((c) => c.headers.get('authorization'))).size).toBe(1);
  });

  it('sorts dead tokens from other failures', async () => {
    const key = await testApnsKey();
    const apple = fakeApple({
      [token('1')]: { status: 410, reason: 'Unregistered' },
      [token('2')]: { status: 400, reason: 'BadDeviceToken' },
      [token('3')]: { status: 429, reason: 'TooManyRequests' },
    });
    const devices = ['1', '2', '3', '4'].map((digit) => ({ token: token(digit), environment: 'production' as const }));
    const report = await sendApns(notification, devices, { fetch: apple.fetch, keyP8: key.p8, keyId: 'K', nowMs });
    expect(report).toEqual({ sent: 1, invalid: [token('1'), token('2')], failed: [{ token: token('3'), reason: 'TooManyRequests' }] });
  });

  it('stops at the first batch when Apple rejects the key', async () => {
    const key = await testApnsKey();
    const devices = ['1', '2', '3'].map((digit) => ({ token: token(digit), environment: 'production' as const }));
    const apple = fakeApple(Object.fromEntries(devices.map((device) => [device.token, { status: 403, reason: 'InvalidProviderToken' }])));
    const report = await sendApns(notification, devices, { fetch: apple.fetch, keyP8: key.p8, keyId: 'K', nowMs, concurrency: 1 });
    expect(apple.calls).toHaveLength(1);
    expect(report.failed.map((failure) => failure.reason)).toEqual(['InvalidProviderToken', 'skipped', 'skipped']);
  });

  it('needs no key when no iPhone is registered, and says which secret is missing otherwise', async () => {
    const apple = fakeApple();
    expect(await sendApns(notification, [], { fetch: apple.fetch, keyP8: undefined, keyId: undefined, nowMs })).toEqual({ sent: 0, invalid: [], failed: [] });
    await expect(sendApns(notification, [{ token: token('a'), environment: 'production' }], { fetch: apple.fetch, keyP8: undefined, keyId: 'K', nowMs })).rejects.toThrow(ApnsError);
    await expect(sendApns(notification, [{ token: token('a'), environment: 'production' }], { fetch: apple.fetch, keyP8: 'not a key', keyId: 'K', nowMs })).rejects.toThrow(/not a usable \.p8 key/);
    expect(apple.calls).toEqual([]);
  });
});
