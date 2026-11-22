import type { D1DatabaseLike } from '@bluelytics/db';
import type { FetchLike, Source } from '@bluelytics/scrapers';
import { TICK_SOURCES } from '@bluelytics/scrapers';
import type { Renderer } from '@bluelytics/social';
import { BrowserRunRenderer } from '@bluelytics/social';
import type { Env, JobsConfig, MediaBucket, Secrets } from './env.ts';
import { readConfig, readSecrets } from './env.ts';

export type LogLevel = 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string, data?: Record<string, unknown>) => void;

/**
 * Everything with an effect outside the function: storage, the network (sources, currencies,
 * Buffer, FCM, the ops webhook, cache purges all go through `fetch`) and image rendering.
 */
export interface Deps {
  db: D1DatabaseLike;
  bucket: MediaBucket;
  renderer: Renderer;
  fetch: FetchLike;
  config: JobsConfig;
  secrets: Secrets;
  /** The tick's sources (default `TICK_SOURCES`). */
  sources: readonly Source[];
  log: Logger;
}

export const consoleLogger: Logger = (level, message, data) => {
  const line = JSON.stringify({ level, message, ...data });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export function depsFromEnv(env: Env): Deps {
  return {
    db: env.DB,
    bucket: env.MEDIA,
    renderer: new BrowserRunRenderer(env.BROWSER),
    fetch: (url, init) => fetch(url, init),
    config: readConfig(env),
    secrets: readSecrets(env),
    sources: TICK_SOURCES,
    log: consoleLogger,
  };
}
