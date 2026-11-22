/**
 * `pnpm --filter @bluelytics/web seed:local`: fills the local D1 that `astro dev` / `astro preview`
 * use (wrangler's state under apps/web/.wrangler) with the legacy goldens, then extends the history
 * with synthetic weekdays up to today and adds extra rates and source observations, so every page
 * has something to show. Local only: never pass --remote anything here.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addDays, isoWeekday, type DailyRow, type ExtraRate, type Observation, type PublishedState, type SourceId } from '@bluelytics/core';
import {
  getLatestRates,
  insertObservationsStatements,
  runBatch,
  upsertDailyRowsStatements,
  upsertExtraRatesStatements,
  upsertLatestRatesStatements,
  type D1DatabaseLike,
} from '@bluelytics/db';
import { seedFromGoldens } from '@bluelytics/db/testing';
import { getPlatformProxy } from 'wrangler';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const TABLES = ['observations', 'ticks', 'latest_rates', 'daily_rates', 'extra_rates', 'currencies', 'alerts', 'social_posts', 'rendered', 'state'];

/** Deterministic pseudo-random numbers in [0, 1) (the same synthetic data on every run). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function artDay(date: Date): string {
  return new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Weekday rows from the day after the goldens' last day to today, as a small random walk. */
function syntheticDays(state: PublishedState, lastDay: string, today: string, next: () => number): DailyRow[] {
  const rows: DailyRow[] = [];
  let blue = state.blue?.sell ?? 1500;
  let oficial = state.oficial?.sell ?? 1450;
  for (let day = addDays(lastDay, 1); day <= today; day = addDays(day, 1)) {
    if (isoWeekday(day) > 5) continue;
    blue = Math.round(blue * (1 + (next() - 0.48) * 0.02));
    oficial = Math.round(oficial * (1 + (next() - 0.48) * 0.006));
    const updatedAt = `${day}T22:55:00.000Z`;
    rows.push({ day, tipo: 'Oficial', buy: oficial - 50, sell: oficial, updatedAt, origin: 'live' });
    rows.push({ day, tipo: 'Blue', buy: blue - 35, sell: blue, updatedAt, origin: 'live' });
  }
  return rows;
}

function withLatest(state: PublishedState, rows: readonly DailyRow[], updatedAt: string, eurPerUsd: number): PublishedState {
  const latest = (tipo: DailyRow['tipo']) => rows.filter((row) => row.tipo === tipo).at(-1);
  const rate = (row: DailyRow | undefined, previous: PublishedState['blue']) =>
    row === undefined
      ? previous
      : { updatedAt, buy: row.buy, sell: row.sell, buyRaw: row.buy, sellRaw: row.sell, euroBuy: Math.round(row.buy / eurPerUsd), euroSell: Math.round(row.sell / eurPerUsd) };
  return { oficial: rate(latest('Oficial'), state.oficial), blue: rate(latest('Blue'), state.blue) };
}

function extraRates(blueSell: number, updatedAt: string): ExtraRate[] {
  const quote = (code: string, name: string, factor: number): ExtraRate => {
    const sell = Math.round(blueSell * factor * 100);
    return { code, name, buyCents: sell - 2000, sellCents: sell, source: 'ambito_extras', sourceTs: updatedAt, updatedAt };
  };
  return [
    quote('mep', 'Dólar MEP', 0.985),
    quote('ccl', 'Dólar CCL', 1.004),
    quote('cripto', 'Dólar cripto', 1.012),
    quote('tarjeta', 'Dólar tarjeta', 1.27),
    quote('mayorista', 'Dólar mayorista', 0.93),
  ];
}

/** 24 hours of 5-minute runs per source; `lanacion` keeps failing, so the status page shows an alert. */
function observations(state: PublishedState, now: Date): Observation[] {
  const sources: { source: SourceId; kind: Observation['kind']; offset: number }[] = [
    { source: 'ambito', kind: 'blue', offset: 0 },
    { source: 'dolarhoy', kind: 'blue', offset: 5 },
    { source: 'cronista', kind: 'blue', offset: -5 },
    { source: 'infodolar', kind: 'blue', offset: 10 },
    { source: 'lanacion', kind: 'blue', offset: 0 },
    { source: 'ambito_oficial', kind: 'oficial', offset: 0 },
    { source: 'bna', kind: 'oficial', offset: 0 },
  ];
  const rows: Observation[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const runAt = new Date(now.getTime() - minutes * 60_000).toISOString();
    for (const { source, kind, offset } of sources) {
      const rate = kind === 'blue' ? state.blue : state.oficial;
      const failing = source === 'lanacion' && minutes < 600;
      rows.push({
        runAt,
        source,
        kind,
        ok: !failing,
        buyCents: failing || rate === null ? null : (rate.buy + offset) * 100,
        sellCents: failing || rate === null ? null : (rate.sell + offset) * 100,
        sourceTs: null,
        error: failing ? 'parse: anchor "Dólar Blue" not found' : null,
        durationMs: 300 + ((minutes + offset) % 7) * 90,
      });
    }
  }
  return rows;
}

async function seed(db: D1DatabaseLike): Promise<void> {
  await runBatch(db, TABLES.map((table) => db.prepare(`DELETE FROM ${table}`)));
  const counts = await seedFromGoldens(db);
  const golden = await getLatestRates(db);
  const lastDay = (await db.prepare('SELECT MAX(day) AS day FROM daily_rates').first<{ day: string }>())?.day;
  if (lastDay == null) throw new Error('seed: no daily rows after seeding the goldens');

  const now = new Date();
  const next = random(20_261_122);
  const added = syntheticDays(golden, lastDay, artDay(now), next);
  const eur = (await db.prepare("SELECT value_hundredths AS v FROM currencies WHERE code = 'EUR'").first<{ v: number }>())?.v ?? 92;
  const state = withLatest(golden, added, new Date(now.getTime() - 4 * 60_000).toISOString(), eur / 100);
  await runBatch(
    db,
    upsertDailyRowsStatements(db, added),
    upsertLatestRatesStatements(db, state),
    upsertExtraRatesStatements(db, extraRates(state.blue?.sell ?? 1500, now.toISOString())),
    insertObservationsStatements(db, observations(state, now)),
  );
  console.log(`seeded ${counts.daily} golden daily rows + ${added.length} synthetic, ${counts.currencies} currencies, ${counts.alerts} alerts`);
}

execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'bluelytics', '--local'], { cwd: APP_DIR, stdio: 'inherit' });
const proxy = await getPlatformProxy<{ DB: D1DatabaseLike }>({ configPath: `${APP_DIR}wrangler.jsonc`, persist: true });
try {
  await seed(proxy.env.DB);
} finally {
  await proxy.dispose();
}
