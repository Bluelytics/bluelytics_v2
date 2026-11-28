import type { ApnsEnvironment } from '@bluelytics/core';
import { toStoredUtc } from '@bluelytics/core';
import type { D1DatabaseLike } from './d1.ts';

export interface ApnsDevice {
  token: string;
  environment: ApnsEnvironment;
}

/** Adds an iPhone's token, or updates its environment when the same token registers again. */
export async function upsertApnsDevice(db: D1DatabaseLike, device: ApnsDevice, now: string): Promise<void> {
  const at = toStoredUtc(now);
  await db
    .prepare(
      'INSERT INTO apns_devices (token, environment, created_at, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT (token) DO UPDATE SET environment = excluded.environment, updated_at = excluded.updated_at',
    )
    .bind(device.token, device.environment, at, at)
    .run();
}

export async function deleteApnsDevice(db: D1DatabaseLike, token: string): Promise<void> {
  await db.prepare('DELETE FROM apns_devices WHERE token = ?').bind(token).run();
}

/** Removes the tokens APNs reported as no longer valid. */
export async function deleteApnsDevices(db: D1DatabaseLike, tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.batch(tokens.map((token) => db.prepare('DELETE FROM apns_devices WHERE token = ?').bind(token)));
}

export async function listApnsDevices(db: D1DatabaseLike): Promise<ApnsDevice[]> {
  const { results } = await db.prepare('SELECT token, environment FROM apns_devices ORDER BY created_at, token').all<ApnsDevice>();
  return results;
}

export async function countApnsDevices(db: D1DatabaseLike): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM apns_devices').first<{ n: number }>())?.n ?? 0;
}
