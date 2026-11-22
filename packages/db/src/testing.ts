/**
 * Node-only helpers for tests in any package: a real local D1 (Miniflare's SQLite-backed
 * emulation) with the migrations applied, and seeding from the legacy goldens.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { seedAlerts, seedCurrencies, seedDailyRates, seedLatestRates } from '@bluelytics/contract';
import { goldenText } from '@bluelytics/contract/golden';
import { Miniflare } from 'miniflare';
import { insertAlertsStatements } from './alerts.ts';
import { upsertCurrenciesStatements } from './currencies.ts';
import type { D1DatabaseLike } from './d1.ts';
import { runBatch } from './d1.ts';
import { upsertDailyRowsStatements, upsertLatestRatesStatements } from './rates.ts';

/** `packages/db/migrations/`: point `migrations_dir` of every wrangler config here. */
export const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

/**
 * Splits one of this repo's migration files into statements: drops `--` comments and splits on
 * `;`. Not a general SQL parser (no string literal may contain `--` or `;`, which the tests check).
 */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** The migration files in apply order (file name order, like wrangler). */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/** Applies every migration file to `db`, each in one batch; returns the file names applied. */
export async function applyMigrations(db: D1DatabaseLike): Promise<string[]> {
  const files = migrationFiles();
  for (const file of files) {
    const statements = splitSqlStatements(readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'));
    await runBatch(db, statements.map((statement) => db.prepare(statement)));
  }
  return files;
}

export interface LocalD1 {
  db: D1DatabaseLike;
  dispose(): Promise<void>;
}

/** A fresh in-memory D1 database with the migrations applied (`migrate: false` to skip them). */
export async function createLocalD1(options: { migrate?: boolean } = {}): Promise<LocalD1> {
  // Miniflare 5 (the version wrangler 4.166 pins) takes `workers: [{ config }]` in the shape of a
  // Worker config; the flat options its README still documents are rejected.
  const miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: 'bluelytics-db-test',
          compatibilityDate: '2026-11-22',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default { fetch() { return new Response(null, { status: 404 }); } };' },
            },
          },
          env: { DB: { type: 'd1', id: 'bluelytics-test' } },
        },
      },
    ],
  });
  const db: D1DatabaseLike = await miniflare.getD1Database('DB');
  if (options.migrate !== false) await applyMigrations(db);
  return { db, dispose: () => miniflare.dispose() };
}

/** Seeds `daily_rates`, `currencies`, `alerts` and `latest_rates` from the legacy goldens; returns the row counts. */
export async function seedFromGoldens(db: D1DatabaseLike): Promise<{ daily: number; currencies: number; alerts: number; latest: number }> {
  const daily = seedDailyRates(goldenText('evolution_full'));
  const currencies = seedCurrencies(goldenText('currency'));
  const alerts = seedAlerts(goldenText('v2_alerts'));
  const eur = currencies.find((row) => row.code === 'EUR')?.valueHundredths;
  if (eur === undefined || eur === null) throw new Error('seedFromGoldens: the currency golden has no EUR value');
  // The legacy euro figures were computed with this EUR value; seeding consistent raw values keeps them on a re-render.
  const latest = seedLatestRates(goldenText('v2_latest'), { eurPerUsd: eur / 100 });
  await runBatch(
    db,
    upsertDailyRowsStatements(db, daily),
    upsertCurrenciesStatements(db, currencies),
    insertAlertsStatements(db, alerts),
    upsertLatestRatesStatements(db, latest),
  );
  return { daily: daily.length, currencies: currencies.length, alerts: alerts.length, latest: [latest.oficial, latest.blue].filter(Boolean).length };
}
