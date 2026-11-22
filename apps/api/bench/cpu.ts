/**
 * Rough CPU cost per request of the hot path: `createApi` in Node (same V8 as workerd) on a seeded
 * local D1, caches warm, clock frozen so no background recheck runs. Prints µs of process CPU per
 * request for each path. Run: `pnpm --filter @bluelytics/api bench`.
 */
import { buildRendered, writeRendered } from '@bluelytics/db';
import { createLocalD1, seedFromGoldens } from '@bluelytics/db/testing';
import { createApi } from '../src/api.ts';

const PATHS = [
  '/v2/latest',
  '/v2/latest?callback=cb',
  '/json/last_price',
  '/v2/alerts',
  '/data/json/currency.json',
  '/v2/evolution.json',
  '/v2/evolution.json?days=30',
  '/v2/evolution.csv?days=30',
  '/v2/historical?day=2024-01-06',
  '/v2/latest?pretty',
  '/v2/evolution.json?pretty',
  '/nope',
];

const ITERATIONS = 2_000;

const local = await createLocalD1();
try {
  await seedFromGoldens(local.db);
  await writeRendered(local.db, await buildRendered(local.db, { legacyBlueBug: false }));
  const now = Date.parse('2026-11-20T18:00:00.000Z');
  const api = createApi({ now: () => now });
  const env = { DB: local.db };
  const ctx = { waitUntil: () => undefined };
  const request = async (path: string) => {
    const response = await api.fetch(new Request(`https://api.test${path}`), env, ctx);
    // Consuming the body is part of serving it; workerd streams it out the same way.
    await response.arrayBuffer();
  };

  for (const path of PATHS) await request(path);
  console.log(`${'path'.padEnd(32)} µs CPU/request (${ITERATIONS} iterations, warm)`);
  for (const path of PATHS) {
    for (let i = 0; i < 200; i++) await request(path);
    const start = process.cpuUsage();
    for (let i = 0; i < ITERATIONS; i++) await request(path);
    const used = process.cpuUsage(start);
    console.log(`${path.padEnd(32)} ${((used.user + used.system) / ITERATIONS).toFixed(1).padStart(8)}`);
  }
} finally {
  await local.dispose();
}
