import type { D1DatabaseLike } from '@bluelytics/db';
import type { BrowserRunBinding } from '@bluelytics/social';

/** The subset of the R2 binding the jobs Worker uses (structural, so tests can pass an in-memory bucket). */
export interface MediaBucket {
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

/** Bindings, vars and secrets of `bluelytics-jobs` (wrangler.jsonc; secrets by name, ARCHITECTURE §11). */
export interface Env {
  DB: D1DatabaseLike;
  MEDIA: MediaBucket;
  BROWSER: BrowserRunBinding;
  PUSH_ENABLED?: string;
  SOCIAL_ENABLED?: string;
  API_MODE?: string;
  LEGACY_V1_BLUE_BUG?: string;
  BUFFER_CHANNELS?: string;
  MEDIA_HOSTNAME?: string;
  API_HOSTNAME?: string;
  CLOUDFLARE_ZONE_ID?: string;
  BUFFER_API_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  ADMIN_TOKEN?: string;
  OPS_WEBHOOK_URL?: string;
  CLOUDFLARE_PURGE_TOKEN?: string;
}

export type ApiMode = 'worker' | 'static-first';

/** Plain configuration: flags and names. Secrets stay in {@link Secrets} and are read only where used. */
export interface JobsConfig {
  pushEnabled: boolean;
  socialEnabled: boolean;
  apiMode: ApiMode;
  legacyBlueBug: boolean;
  /** Raw `BUFFER_CHANNELS`; parsed by the social step so a typo fails that step, not the tick. */
  bufferChannels: string;
  mediaHostname: string;
  apiHostname: string;
  zoneId: string;
}

export interface Secrets {
  bufferApiKey: string | undefined;
  firebaseServiceAccountJson: string | undefined;
  /** iOS alerts (apps/jobs/src/apns.ts): the `.p8` key and its Key ID. */
  apnsKeyP8: string | undefined;
  apnsKeyId: string | undefined;
  opsWebhookUrl: string | undefined;
  purgeToken: string | undefined;
}

/** A flag is on only for the exact string `"true"` (MIGRATION.md C2): `"false"`, `"TRUE"`, empty or missing are off. */
export function isEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export function readConfig(env: Env): JobsConfig {
  return {
    pushEnabled: isEnabled(env.PUSH_ENABLED),
    socialEnabled: isEnabled(env.SOCIAL_ENABLED),
    apiMode: env.API_MODE === 'static-first' ? 'static-first' : 'worker',
    legacyBlueBug: isEnabled(env.LEGACY_V1_BLUE_BUG),
    bufferChannels: env.BUFFER_CHANNELS?.trim() || '{}',
    mediaHostname: env.MEDIA_HOSTNAME ?? 'media.bluelytics.com.ar',
    apiHostname: env.API_HOSTNAME ?? 'api.bluelytics.com.ar',
    zoneId: env.CLOUDFLARE_ZONE_ID ?? '',
  };
}

export function readSecrets(env: Env): Secrets {
  return {
    bufferApiKey: env.BUFFER_API_KEY,
    firebaseServiceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    apnsKeyP8: env.APNS_KEY_P8 || undefined,
    apnsKeyId: env.APNS_KEY_ID || undefined,
    opsWebhookUrl: env.OPS_WEBHOOK_URL || undefined,
    purgeToken: env.CLOUDFLARE_PURGE_TOKEN || undefined,
  };
}
