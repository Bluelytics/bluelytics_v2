/**
 * Where the iOS app registers for blue dollar alerts (apps/ios): an iPhone that turns alerts on
 * POSTs its APNs device token, and DELETEs it when they are turned off. The jobs Worker sends each
 * alert to every stored token (apps/jobs/src/apns.ts) and drops the ones Apple reports dead.
 * Android uses the FCM topic and never calls this. Not part of the public API.
 *
 *   POST   /app/push/apple  {"token":"<hex>","environment":"production"|"sandbox"}  → 204
 *   DELETE /app/push/apple  {"token":"<hex>"}                                       → 204
 */
import { isApnsEnvironment, isApnsToken } from '@bluelytics/core';
import type { D1DatabaseLike } from '@bluelytics/db';
import { deleteApnsDevice, upsertApnsDevice } from '@bluelytics/db';

export const PUSH_DEVICES_PATH = '/app/push/apple';

/** Far more than a token: anything larger is not a registration. */
const MAX_BODY_BYTES = 1024;

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface PushDevicesContext {
  db: D1DatabaseLike;
  limiter: RateLimiter | undefined;
  now: () => string;
}

export function isPushDevicesRequest(request: Request): boolean {
  return new URL(request.url).pathname === PUSH_DEVICES_PATH;
}

function problem(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function handlePushDevices(request: Request, context: PushDevicesContext): Promise<Response> {
  const { method } = request;
  if (method !== 'POST' && method !== 'DELETE') return problem(405, 'use POST or DELETE', { Allow: 'POST, DELETE' });
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) return problem(415, 'send application/json');

  // Per address: an app registers once per launch at most, so this only stops floods.
  if (context.limiter) {
    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await context.limiter.limit({ key })).success) return problem(429, 'too many requests', { 'Retry-After': '60' });
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return problem(413, 'body too large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return problem(400, 'body is not JSON');
  }
  const { token, environment } = (typeof body === 'object' && body !== null ? body : {}) as { token?: unknown; environment?: unknown };
  if (!isApnsToken(token)) return problem(400, 'token must be the device token in lowercase hex');

  if (method === 'DELETE') {
    await deleteApnsDevice(context.db, token);
  } else {
    if (!isApnsEnvironment(environment)) return problem(400, 'environment must be "production" or "sandbox"');
    await upsertApnsDevice(context.db, { token, environment }, context.now());
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
