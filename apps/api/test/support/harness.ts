/** The API (`createApi`) in Node on a real local D1, with a controllable clock and `waitUntil`. */
import type { RenderedKey } from '@bluelytics/core';
import { etag, RENDERED_CONTENT_TYPE } from '@bluelytics/core';
import type { D1DatabaseLike } from '@bluelytics/db';
import { buildRendered, writeRendered } from '@bluelytics/db';
import { createLocalD1, seedFromGoldens } from '@bluelytics/db/testing';
import { createApi } from '../../src/api.ts';
import type { Env } from '../../src/env.ts';
import type { SpyDb } from './spy-db.ts';
import { spyDb } from './spy-db.ts';

/** Friday 2026-11-20 15:00 ART: the newest day of the goldens is "today". */
export const START = Date.parse('2026-11-20T18:00:00.000Z');

export const SHADOW = 'api-v2.bluelytics.test';

export interface Harness {
  db: SpyDb;
  /** The database without the spy (for writes). */
  raw: D1DatabaseLike;
  advance(ms: number): void;
  fetch(path: string, init?: RequestInit, origin?: string): Promise<Response>;
  /** Waits for every `waitUntil` promise handed out so far. */
  settle(): Promise<void>;
  /** Replaces one stored body, as the jobs Worker would. */
  publish(key: RenderedKey, body: string): Promise<void>;
  dispose(): Promise<void>;
}

export async function startHarness(options: { seed?: boolean } = {}): Promise<Harness> {
  const local = await createLocalD1();
  if (options.seed !== false) {
    await seedFromGoldens(local.db);
    await writeRendered(local.db, await buildRendered(local.db, { legacyBlueBug: false }));
  }
  const db = spyDb(local.db);
  let clock = START;
  const pending: Promise<unknown>[] = [];
  const api = createApi({ now: () => clock });
  const env: Env = { DB: db, SHADOW_HOSTNAME: SHADOW };
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
  return {
    db,
    raw: local.db,
    advance(ms) {
      clock += ms;
    },
    fetch: (path, init, origin = 'https://api.test') => api.fetch(new Request(origin + path, init), env, ctx),
    async settle() {
      while (pending.length > 0) await pending.shift();
    },
    async publish(key, body) {
      await writeRendered(local.db, [{ key, contentType: RENDERED_CONTENT_TYPE[key], body, etag: await etag(body) }]);
    },
    dispose: () => local.dispose(),
  };
}
