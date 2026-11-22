/** Runs the real Worker bundle in workerd (Miniflare) against a local D1 seeded from the goldens. */
import { fileURLToPath } from 'node:url';
import type { RenderedKey } from '@bluelytics/core';
import type { D1DatabaseLike } from '@bluelytics/db';
import { buildRendered, writeRendered } from '@bluelytics/db';
import { applyMigrations, seedFromGoldens } from '@bluelytics/db/testing';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

let bundle: Promise<string> | undefined;

/** The Worker as wrangler would upload it: one ESM bundle of `src/index.ts`. */
export function bundleWorker(): Promise<string> {
  bundle ??= build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2023',
    conditions: ['workerd', 'worker', 'browser'],
    write: false,
  }).then((result) => {
    const [output] = result.outputFiles;
    if (output === undefined) throw new Error('esbuild produced no output');
    return output.text;
  });
  return bundle;
}

export interface LocalWorker {
  db: D1DatabaseLike;
  /** `path` (raw, may include a query string) is appended to `base` without URL normalisation. */
  fetch(path: string, init?: { method?: string; headers?: Record<string, string> }, base?: string): Promise<Response>;
  dispose(): Promise<void>;
}

export interface LocalWorkerOptions {
  /** Render bodies with this `LEGACY_V1_BLUE_BUG` value (`true` reproduces the `v1_last_price*` goldens). */
  legacyBlueBug?: boolean;
  /** Seed `daily_rates`, `currencies`, `alerts`, `latest_rates` from the goldens and render every body. */
  seed?: boolean;
  shadowHostname?: string;
  keys?: readonly RenderedKey[];
}

export async function startWorker(options: LocalWorkerOptions = {}): Promise<LocalWorker> {
  const miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: 'bluelytics-api',
          compatibilityDate: '2026-11-22',
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: await bundleWorker() } } },
          env: {
            DB: { type: 'd1', id: 'bluelytics' },
            ...(options.shadowHostname !== undefined && { SHADOW_HOSTNAME: { type: 'text', value: options.shadowHostname } }),
          },
        },
      },
    ],
  });
  const db: D1DatabaseLike = await miniflare.getD1Database('DB');
  await applyMigrations(db);
  if (options.seed !== false) {
    await seedFromGoldens(db);
    await writeRendered(
      db,
      await buildRendered(db, { legacyBlueBug: options.legacyBlueBug ?? false, ...(options.keys && { keys: options.keys }) }),
    );
  }
  return {
    db,
    async fetch(path, init = {}, base = 'https://api.test') {
      const response = await miniflare.dispatchFetch(base + path, init);
      return response as unknown as Response;
    },
    dispose: () => miniflare.dispose(),
  };
}
