import { FCM, buildAlertNotification, buildFcmMessage } from '@bluelytics/core';
import { describe, expect, it } from 'vitest';
import { isEnabled, readConfig } from '../src/env.ts';
import type { Env } from '../src/env.ts';
import { GOOGLE_TOKEN_URL, sendPush } from '../src/fcm.ts';
import { testServiceAccount } from './support/keys.ts';

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(text, 'base64url'));

describe('flags (MIGRATION.md C2)', () => {
  it('are on only for the exact string "true"', () => {
    expect([undefined, '', 'false', 'TRUE', 'True', ' true', '1', 'yes'].map(isEnabled)).toEqual(Array(8).fill(false));
    expect(isEnabled('true')).toBe(true);
    const config = readConfig({ PUSH_ENABLED: 'true', SOCIAL_ENABLED: 'True' } as Env);
    expect([config.pushEnabled, config.socialEnabled, config.apiMode, config.bufferChannels]).toEqual([true, false, 'worker', '{}']);
  });
});

describe('FCM HTTP v1 sender', () => {
  it('signs an RS256 service-account JWT with WebCrypto and posts the exact legacy message', async () => {
    const account = await testServiceAccount();
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url === GOOGLE_TOKEN_URL
        ? Response.json({ access_token: 'ya29.test', expires_in: 3599 })
        : Response.json({ name: 'projects/bluelytics-mobile/messages/42' });
    };
    const notification = buildAlertNotification(1670, 1658);
    const nowMs = Date.parse('2026-11-23T13:00:00Z');
    expect(await sendPush(notification, { fetch, serviceAccountJson: account.json, nowMs })).toBe('projects/bluelytics-mobile/messages/42');

    const form = new URLSearchParams(String(calls[0]?.init.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = (form.get('assertion') ?? '').split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'test-key-id' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: 'firebase-adminsdk-test@bluelytics-mobile.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: GOOGLE_TOKEN_URL,
      iat: nowMs / 1000,
      exp: nowMs / 1000 + 3600,
    });
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', account.publicKey, fromBase64Url(signature), new TextEncoder().encode(`${header}.${claims}`));
    expect(valid).toBe(true);

    expect(calls[1]?.url).toBe(FCM.endpoint);
    expect(new Headers(calls[1]?.init.headers).get('authorization')).toBe('Bearer ya29.test');
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual(buildFcmMessage(notification));
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      message: {
        topic: 'alertas-blue',
        notification: { title: 'Subió el Dólar Blue', body: 'Venta: 1670.00 (+12.00 / +0.72%)' },
        android: {
          collapse_key: 'dolar-blue',
          priority: 'high',
          ttl: '1200s',
          notification: { title: 'Subió el Dólar Blue', body: 'Venta: 1670.00 (+12.00 / +0.72%)', color: '#221199', channel_id: 'Dolar Blue' },
        },
      },
    });
  });

  it('refuses a key of another project before calling Google', async () => {
    const account = await testServiceAccount('someone-else');
    let called = false;
    const fetch = async () => {
      called = true;
      return new Response('{}');
    };
    await expect(sendPush(buildAlertNotification(1, 2), { fetch, serviceAccountJson: account.json, nowMs: 0 })).rejects.toThrow(/project someone-else/);
    expect(called).toBe(false);
  });

  it('reports an FCM rejection with its status', async () => {
    const account = await testServiceAccount();
    const fetch = async (url: string) =>
      url === GOOGLE_TOKEN_URL ? Response.json({ access_token: 't' }) : Response.json({ error: { message: 'Permission denied' } }, { status: 403 });
    await expect(sendPush(buildAlertNotification(1, 2), { fetch, serviceAccountJson: account.json, nowMs: 0 })).rejects.toThrow(/^fcm 403: .*Permission denied/);
  });
});
