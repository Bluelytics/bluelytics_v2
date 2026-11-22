import type { AlertNotification } from '@bluelytics/core';
import { FCM, buildFcmMessage } from '@bluelytics/core';
import type { FetchLike } from '@bluelytics/scrapers';
import { errorText } from './errors.ts';
import { signRs256Jwt } from './jwt.ts';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class FcmError extends Error {
  override readonly name = 'FcmError';
}

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | undefined;
}

/** Parsed only when a push is sent (MIGRATION.md C5): the shadow-mode placeholder is harmless until then. */
export function parseServiceAccount(json: string | undefined): ServiceAccount {
  if (!json) throw new FcmError('FIREBASE_SERVICE_ACCOUNT_JSON is not set');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new FcmError('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  const { project_id, client_email, private_key, private_key_id } = raw;
  if (typeof client_email !== 'string' || typeof private_key !== 'string' || typeof project_id !== 'string') {
    throw new FcmError('FIREBASE_SERVICE_ACCOUNT_JSON is not a service-account key (client_email, private_key, project_id)');
  }
  if (project_id !== FCM.projectId) throw new FcmError(`service account belongs to project ${project_id}, not ${FCM.projectId}`);
  return {
    projectId: project_id,
    clientEmail: client_email,
    privateKey: private_key,
    privateKeyId: typeof private_key_id === 'string' ? private_key_id : undefined,
  };
}

async function accessToken(account: ServiceAccount, fetch: FetchLike, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const assertion = await signRs256Jwt(
    account.privateKeyId ? { kid: account.privateKeyId } : {},
    { iss: account.clientEmail, scope: FCM.scope, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 },
    account.privateKey,
  );
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) throw new FcmError(`oauth ${response.status}: ${errorText(text)}`);
  const token = (JSON.parse(text) as { access_token?: unknown }).access_token;
  if (typeof token !== 'string') throw new FcmError('oauth: response has no access_token');
  return token;
}

export interface SendPushOptions {
  fetch: FetchLike;
  serviceAccountJson: string | undefined;
  nowMs: number;
  /** FCM `validate_only`: the request is checked end to end and nothing is delivered. */
  validateOnly?: boolean;
}

/** Sends the legacy-format topic message (core `buildFcmMessage`) with FCM HTTP v1; returns the message name. */
export async function sendPush(notification: AlertNotification, options: SendPushOptions): Promise<string> {
  const account = parseServiceAccount(options.serviceAccountJson);
  const token = await accessToken(account, options.fetch, options.nowMs);
  const body = options.validateOnly ? { validate_only: true, ...buildFcmMessage(notification) } : buildFcmMessage(notification);
  const response = await options.fetch(FCM.endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) throw new FcmError(`fcm ${response.status}: ${errorText(text)}`);
  const name = (JSON.parse(text) as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}
