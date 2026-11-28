import type { AlertNotification, ApnsEnvironment } from '@bluelytics/core';
import { APNS, buildApnsPayload } from '@bluelytics/core';
import type { ApnsDevice } from '@bluelytics/db';
import type { FetchLike } from '@bluelytics/scrapers';
import { errorText } from './errors.ts';
import { signEs256Jwt } from './jwt.ts';

/**
 * Alerts for the iOS app straight through APNs (no Firebase on iOS). APNs only speaks HTTP/2;
 * a Worker's `fetch` negotiates it (checked from Cloudflare's network on 2026-11-28).
 */
export class ApnsError extends Error {
  override readonly name = 'ApnsError';
}

export interface ApnsCredentials {
  /** The `.p8` key from the Apple Developer account (PEM, `PRIVATE KEY`). Secret `APNS_KEY_P8`. */
  keyP8: string | undefined;
  /** Its 10-character Key ID. Secret `APNS_KEY_ID`. */
  keyId: string | undefined;
}

export interface SendApnsOptions extends ApnsCredentials {
  fetch: FetchLike;
  nowMs: number;
  /** Requests in flight at once. */
  concurrency?: number;
}

export interface ApnsReport {
  sent: number;
  /** Tokens APNs says are dead (app removed, wrong environment, bad token): delete them. */
  invalid: string[];
  /** Other failures, `reason` per device, for the alert's push_status. */
  failed: { token: string; reason: string }[];
}

/** Reasons that mean the token will never work again. */
const INVALID_TOKEN = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

/** The provider token (valid up to an hour; Apple rejects one renewed more often than every 20 minutes, so sign once per alert). */
export async function apnsProviderToken(credentials: ApnsCredentials, nowMs: number): Promise<string> {
  const { keyP8, keyId } = credentials;
  if (!keyP8 || !keyId) throw new ApnsError('APNS_KEY_P8 and APNS_KEY_ID are not set');
  try {
    return await signEs256Jwt({ kid: keyId }, { iss: APNS.teamId, iat: Math.floor(nowMs / 1000) }, keyP8);
  } catch (error) {
    throw new ApnsError(`APNS_KEY_P8 is not a usable .p8 key: ${errorText(error)}`);
  }
}

export interface ApnsResult {
  status: number;
  /** APNs `reason`, or the network error. */
  reason: string | null;
}

export async function postApns(fetch: FetchLike, providerToken: string, environment: ApnsEnvironment, token: string, body: string, nowMs: number): Promise<ApnsResult> {
  try {
    const response = await fetch(`https://${APNS.hosts[environment]}/3/device/${token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${providerToken}`,
        'apns-topic': APNS.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(nowMs / 1000) + APNS.ttlSeconds),
        'apns-collapse-id': APNS.collapseId,
        'content-type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { status: response.status, reason: null };
    const text = await response.text();
    let reason = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { reason?: unknown };
      if (typeof parsed.reason === 'string') reason = parsed.reason;
    } catch {
      // Not JSON: keep the status.
    }
    return { status: response.status, reason };
  } catch (error) {
    return { status: 0, reason: errorText(error) };
  }
}

/** Sends one notification to every device; never throws for a single device's failure. */
export async function sendApns(notification: AlertNotification, devices: readonly ApnsDevice[], options: SendApnsOptions): Promise<ApnsReport> {
  const report: ApnsReport = { sent: 0, invalid: [], failed: [] };
  if (devices.length === 0) return report;
  const providerToken = await apnsProviderToken(options, options.nowMs);
  const body = JSON.stringify(buildApnsPayload(notification));
  const concurrency = options.concurrency ?? 20;
  for (let start = 0; start < devices.length; start += concurrency) {
    const batch = devices.slice(start, start + concurrency);
    const results = await Promise.all(batch.map((device) => postApns(options.fetch, providerToken, device.environment, device.token, body, options.nowMs)));
    results.forEach((result, index) => {
      const token = batch[index]?.token ?? '';
      if (result.reason === null) report.sent++;
      else if (INVALID_TOKEN.has(result.reason)) report.invalid.push(token);
      else report.failed.push({ token, reason: result.reason });
    });
    // A rejected provider token fails every request the same way: stop instead of repeating it.
    if (results.some((result) => result.status === 403)) {
      for (const device of devices.slice(start + concurrency)) report.failed.push({ token: device.token, reason: 'skipped' });
      break;
    }
  }
  return report;
}
