import { toStoredUtc } from '@bluelytics/core';
import type { DailyOrigin, DailyRow, DailyTipo, PublishedRate, PublishedState, RatePair, Tick, TickVoters } from '@bluelytics/core';
import type { D1DatabaseLike, D1StatementLike } from './d1.ts';
import { insertRowsStatements, toBoolean } from './d1.ts';

interface LatestRateRecord {
  tipo: 'oficial' | 'blue';
  updated_at: string;
  buy: number;
  sell: number;
  buy_raw: number;
  sell_raw: number;
  euro_buy: number;
  euro_sell: number;
}

/** The whole `latest_rates` table; a missing row is `null`. */
export async function getLatestRates(db: D1DatabaseLike): Promise<PublishedState> {
  const { results } = await db.prepare('SELECT * FROM latest_rates').all<LatestRateRecord>();
  const state: PublishedState = { oficial: null, blue: null };
  for (const row of results) {
    state[row.tipo] = {
      updatedAt: row.updated_at,
      buy: row.buy,
      sell: row.sell,
      buyRaw: row.buy_raw,
      sellRaw: row.sell_raw,
      euroBuy: row.euro_buy,
      euroSell: row.euro_sell,
    };
  }
  return state;
}

/** Upserts the non-null rates of `state` into `latest_rates`. */
export function upsertLatestRatesStatements(db: D1DatabaseLike, state: PublishedState): D1StatementLike[] {
  const rows = (['oficial', 'blue'] as const).flatMap((tipo) => {
    const rate: PublishedRate | null = state[tipo];
    return rate ? [[tipo, rate.updatedAt, rate.buy, rate.sell, rate.buyRaw, rate.sellRaw, rate.euroBuy, rate.euroSell]] : [];
  });
  return insertRowsStatements(
    db,
    'latest_rates',
    ['tipo', 'updated_at', 'buy', 'sell', 'buy_raw', 'sell_raw', 'euro_buy', 'euro_sell'],
    rows,
    ' ON CONFLICT (tipo) DO UPDATE SET updated_at = excluded.updated_at, buy = excluded.buy, sell = excluded.sell,' +
      ' buy_raw = excluded.buy_raw, sell_raw = excluded.sell_raw, euro_buy = excluded.euro_buy, euro_sell = excluded.euro_sell',
  );
}

interface DailyRecord {
  day: string;
  tipo: DailyTipo;
  buy: number;
  sell: number;
  updated_at: string | null;
  origin: DailyOrigin;
}

export function dailyFromRecord(row: DailyRecord): DailyRow {
  return { day: row.day, tipo: row.tipo, buy: row.buy, sell: row.sell, updatedAt: row.updated_at, origin: row.origin };
}

/** Upserts `daily_rates` rows (a live run replaces whatever the day held). */
export function upsertDailyRowsStatements(db: D1DatabaseLike, rows: readonly DailyRow[]): D1StatementLike[] {
  return insertRowsStatements(
    db,
    'daily_rates',
    ['day', 'tipo', 'buy', 'sell', 'updated_at', 'origin'],
    rows.map((row) => [row.day, row.tipo, row.buy, row.sell, row.updatedAt, row.origin]),
    ' ON CONFLICT (day, tipo) DO UPDATE SET buy = excluded.buy, sell = excluded.sell, updated_at = excluded.updated_at, origin = excluded.origin',
  );
}

/** Every `daily_rates` row in API order: `day DESC`, Oficial before Blue. */
export async function getEvolutionRows(db: D1DatabaseLike): Promise<DailyRow[]> {
  const { results } = await db.prepare('SELECT * FROM daily_rates ORDER BY day DESC, tipo DESC').all<DailyRecord>();
  return results.map(dailyFromRecord);
}

/** Both rates of one day for `/v2/historical` (weekend remapping is the caller's job). */
export async function getDayRates(db: D1DatabaseLike, day: string): Promise<{ oficial: RatePair | null; blue: RatePair | null }> {
  const { results } = await db.prepare('SELECT tipo, buy, sell FROM daily_rates WHERE day = ?').bind(day).all<DailyRecord>();
  const find = (tipo: DailyTipo): RatePair | null => {
    const row = results.find((record) => record.tipo === tipo);
    return row ? { buy: row.buy, sell: row.sell } : null;
  };
  return { oficial: find('Oficial'), blue: find('Blue') };
}

/**
 * The close of the previous trading day: the newest Monday–Friday row of `tipo` strictly before
 * `day`. On a Monday that is Friday's row (holidays have rows, like legacy).
 */
export async function getPreviousClose(db: D1DatabaseLike, day: string, tipo: DailyTipo = 'Blue'): Promise<DailyRow | null> {
  const row = await db
    .prepare(
      "SELECT * FROM daily_rates WHERE tipo = ? AND day < ? AND strftime('%w', day) NOT IN ('0', '6') ORDER BY day DESC LIMIT 1",
    )
    .bind(tipo, day)
    .first<DailyRecord>();
  return row ? dailyFromRecord(row) : null;
}

interface TickRecord {
  run_at: string;
  day: string;
  blue_buy: number;
  blue_sell: number;
  blue_buy_raw: number | null;
  blue_sell_raw: number | null;
  oficial_buy: number;
  oficial_sell: number;
  oficial_buy_raw: number | null;
  oficial_sell_raw: number | null;
  voters: string;
  changed: number;
}

function tickFromRecord(row: TickRecord): Tick {
  return {
    runAt: row.run_at,
    day: row.day,
    blueBuy: row.blue_buy,
    blueSell: row.blue_sell,
    blueBuyRaw: row.blue_buy_raw,
    blueSellRaw: row.blue_sell_raw,
    oficialBuy: row.oficial_buy,
    oficialSell: row.oficial_sell,
    oficialBuyRaw: row.oficial_buy_raw,
    oficialSellRaw: row.oficial_sell_raw,
    voters: JSON.parse(row.voters) as TickVoters,
    changed: toBoolean(row.changed),
  };
}

/** Inserts a tick; re-running the same `runAt` replaces it (idempotent). `runAt` is stored in storage form. */
export function insertTickStatement(db: D1DatabaseLike, tick: Tick): D1StatementLike {
  const columns =
    'run_at, day, blue_buy, blue_sell, blue_buy_raw, blue_sell_raw, oficial_buy, oficial_sell, oficial_buy_raw, oficial_sell_raw, voters, changed';
  return db
    .prepare(`INSERT OR REPLACE INTO ticks (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      toStoredUtc(tick.runAt),
      tick.day,
      tick.blueBuy,
      tick.blueSell,
      tick.blueBuyRaw,
      tick.blueSellRaw,
      tick.oficialBuy,
      tick.oficialSell,
      tick.oficialBuyRaw,
      tick.oficialSellRaw,
      JSON.stringify(tick.voters),
      tick.changed ? 1 : 0,
    );
}

/** Ticks with `after < run_at < before` (both exclusive), oldest first. Bounds may be any ISO instant. */
export async function getTicksBetween(db: D1DatabaseLike, after: string, before: string): Promise<Tick[]> {
  const { results } = await db
    .prepare('SELECT * FROM ticks WHERE run_at > ? AND run_at < ? ORDER BY run_at')
    .bind(toStoredUtc(after), toStoredUtc(before))
    .all<TickRecord>();
  return results.map(tickFromRecord);
}

/** The newest tick with `run_at <= at`, i.e. the last one before an exclusive window that starts at `at`. */
export async function getLastTickAtOrBefore(db: D1DatabaseLike, at: string): Promise<Tick | null> {
  const row = await db
    .prepare('SELECT * FROM ticks WHERE run_at <= ? ORDER BY run_at DESC LIMIT 1')
    .bind(toStoredUtc(at))
    .first<TickRecord>();
  return row ? tickFromRecord(row) : null;
}

