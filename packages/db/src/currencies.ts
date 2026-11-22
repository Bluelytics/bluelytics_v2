import type { CurrencyRow, ExtraRate } from '@bluelytics/core';
import type { D1DatabaseLike, D1StatementLike } from './d1.ts';
import { insertRowsStatements } from './d1.ts';

interface CurrencyRecord {
  code: string;
  name: string;
  value_hundredths: number | null;
  value_date: string | null;
  position: number;
}

function currencyFromRecord(row: CurrencyRecord): CurrencyRow {
  return { code: row.code, name: row.name, valueHundredths: row.value_hundredths, valueDate: row.value_date, position: row.position };
}

/** Every currency in output order (`position`), including those without a value. */
export async function getCurrencies(db: D1DatabaseLike): Promise<CurrencyRow[]> {
  const { results } = await db.prepare('SELECT * FROM currencies ORDER BY position, code').all<CurrencyRecord>();
  return results.map(currencyFromRecord);
}

/** One currency by code, e.g. `EUR` for the euro derivation (`valueHundredths / 100` = EUR per USD). */
export async function getCurrency(db: D1DatabaseLike, code: string): Promise<CurrencyRow | null> {
  const row = await db.prepare('SELECT * FROM currencies WHERE code = ?').bind(code).first<CurrencyRecord>();
  return row ? currencyFromRecord(row) : null;
}

/** Upserts currencies by code (name, value, date and position are all replaced). */
export function upsertCurrenciesStatements(db: D1DatabaseLike, rows: readonly CurrencyRow[]): D1StatementLike[] {
  return insertRowsStatements(
    db,
    'currencies',
    ['code', 'name', 'value_hundredths', 'value_date', 'position'],
    rows.map((row) => [row.code, row.name, row.valueHundredths, row.valueDate, row.position]),
    ' ON CONFLICT (code) DO UPDATE SET name = excluded.name, value_hundredths = excluded.value_hundredths,' +
      ' value_date = excluded.value_date, position = excluded.position',
  );
}

interface ExtraRateRecord {
  code: string;
  name: string;
  buy_cents: number | null;
  sell_cents: number | null;
  source: string;
  source_ts: string | null;
  updated_at: string;
}

/** Every extra rate (MEP, CCL, …), by code. */
export async function getExtraRates(db: D1DatabaseLike): Promise<ExtraRate[]> {
  const { results } = await db.prepare('SELECT * FROM extra_rates ORDER BY code').all<ExtraRateRecord>();
  return results.map((row) => ({
    code: row.code,
    name: row.name,
    buyCents: row.buy_cents,
    sellCents: row.sell_cents,
    source: row.source,
    sourceTs: row.source_ts,
    updatedAt: row.updated_at,
  }));
}

/** Upserts extra rates by code. */
export function upsertExtraRatesStatements(db: D1DatabaseLike, rates: readonly ExtraRate[]): D1StatementLike[] {
  return insertRowsStatements(
    db,
    'extra_rates',
    ['code', 'name', 'buy_cents', 'sell_cents', 'source', 'source_ts', 'updated_at'],
    rates.map((rate) => [rate.code, rate.name, rate.buyCents, rate.sellCents, rate.source, rate.sourceTs, rate.updatedAt]),
    ' ON CONFLICT (code) DO UPDATE SET name = excluded.name, buy_cents = excluded.buy_cents, sell_cents = excluded.sell_cents,' +
      ' source = excluded.source, source_ts = excluded.source_ts, updated_at = excluded.updated_at',
  );
}
