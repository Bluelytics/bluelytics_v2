import type { RenderedRow } from '@bluelytics/core';
import {
  insertRowsStatements,
  upsertCurrenciesStatements,
  upsertDailyRowsStatements,
  upsertLatestRatesStatements,
  type D1DatabaseLike,
  type D1ResultLike,
  type D1StatementLike,
  type D1Value,
} from '@bluelytics/db';
import type { BackfillData } from './plan.ts';

/** D1 rejects SQL statements over 100 KB; stay well below. */
export const MAX_STATEMENT_BYTES = 50_000;

/** Holds a rendered body while it is assembled from chunks; dropped at the end of the script. */
export const STAGE_TABLE = 'backfill_rendered_stage';

/** A SQL literal: strings quoted with `''` escaping, finite numbers as their shortest round-trip text. */
export function sqlLiteral(value: D1Value): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`cannot write ${value} as SQL`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

/** Replaces each `?` of `sql` (which must have none inside literals) with the matching value. */
export function inlineParameters(sql: string, values: readonly D1Value[]): string {
  let next = 0;
  const text = sql.replaceAll('?', () => {
    if (next >= values.length) throw new RangeError(`too few values for: ${sql.slice(0, 80)}`);
    return sqlLiteral(values[next++] as D1Value);
  });
  if (next !== values.length) throw new RangeError(`${values.length - next} unused values for: ${sql.slice(0, 80)}`);
  return text;
}

class RecordedStatement implements D1StatementLike {
  readonly sql: string;
  readonly values: readonly D1Value[];
  constructor(sql: string, values: readonly D1Value[] = []) {
    this.sql = sql;
    this.values = values;
  }
  bind(...values: D1Value[]): D1StatementLike {
    return new RecordedStatement(this.sql, values);
  }
  first<T>(): Promise<T | null> {
    return Promise.reject(new Error('the SQL recorder cannot execute statements'));
  }
  all<T>(): Promise<D1ResultLike<T>> {
    return Promise.reject(new Error('the SQL recorder cannot execute statements'));
  }
  run<T>(): Promise<D1ResultLike<T>> {
    return Promise.reject(new Error('the SQL recorder cannot execute statements'));
  }
}

/**
 * A `D1DatabaseLike` that only records: lets the `@bluelytics/db` statement builders (the same ones
 * the Workers use) produce SQL text for `wrangler d1 execute --file`.
 */
export class SqlRecorder implements D1DatabaseLike {
  prepare(query: string): D1StatementLike {
    return new RecordedStatement(query);
  }
  batch<T>(): Promise<D1ResultLike<T>[]> {
    return Promise.reject(new Error('the SQL recorder cannot execute statements'));
  }
  /** The statements as literal SQL, each checked against {@link MAX_STATEMENT_BYTES}. */
  toSql(statements: readonly D1StatementLike[]): string[] {
    return statements.map((statement) => {
      if (!(statement instanceof RecordedStatement)) throw new TypeError('statement was not prepared by this recorder');
      return checkedLength(inlineParameters(statement.sql, statement.values));
    });
  }
}

const utf8Length = (text: string): number => new TextEncoder().encode(text).byteLength;

function checkedLength(sql: string): string {
  const bytes = utf8Length(sql);
  if (bytes > MAX_STATEMENT_BYTES) throw new RangeError(`SQL statement of ${bytes} bytes exceeds ${MAX_STATEMENT_BYTES}: ${sql.slice(0, 80)}`);
  return sql;
}

const ALERT_UPSERT = ' ON CONFLICT (id) DO UPDATE SET alert_at = excluded.alert_at, buy = excluded.buy, sell = excluded.sell, push_status = excluded.push_status';

/**
 * Idempotent writes of `data`. With `since`, rows of `daily_rates` from that day on that legacy
 * does not have (they are not `backfill_api` once legacy's rows are upserted) are deleted, so the
 * range equals legacy exactly; earlier days are not touched.
 */
export function dataStatements(db: D1DatabaseLike, data: BackfillData, since: string | null): D1StatementLike[] {
  const alerts = insertRowsStatements(
    db,
    'alerts',
    ['id', 'alert_at', 'buy', 'sell', 'push_status'],
    data.alerts.map((alert) => [alert.id, alert.alertAt, alert.buy, alert.sell, alert.pushStatus]),
    ALERT_UPSERT,
  );
  return [
    ...upsertDailyRowsStatements(db, data.daily),
    ...(since === null ? [] : [db.prepare("DELETE FROM daily_rates WHERE day >= ? AND origin <> 'backfill_api'").bind(since)]),
    ...alerts,
    ...(data.currencies ? upsertCurrenciesStatements(db, data.currencies) : []),
    ...(data.latest ? upsertLatestRatesStatements(db, data.latest) : []),
  ];
}

/** Splits `text` into pieces whose SQL literal is at most `maxBytes` (never inside a surrogate pair). */
export function literalChunks(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let bytes = 2;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const size = char === "'" ? 2 : code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + size > maxBytes && current.length > 0) {
      chunks.push(current.join(''));
      current = [];
      bytes = 2;
    }
    current.push(char);
    bytes += size;
  }
  if (current.length > 0 || chunks.length === 0) chunks.push(current.join(''));
  return chunks;
}

/**
 * Upserts pre-rendered bodies. An evolution body (~720 KB) is far above D1's statement limit, so
 * each body is assembled in {@link STAGE_TABLE} chunk by chunk and copied into `rendered` by one
 * statement that only matches when the assembled length is complete: a script that stops halfway
 * never leaves a truncated body in `rendered`.
 */
export function renderedStatements(rows: readonly RenderedRow[], now: string): string[] {
  const chunkBytes = MAX_STATEMENT_BYTES - 1_000;
  const statements = [`CREATE TABLE IF NOT EXISTS ${STAGE_TABLE} (key TEXT PRIMARY KEY, body TEXT NOT NULL) WITHOUT ROWID`, `DELETE FROM ${STAGE_TABLE}`];
  for (const row of rows) {
    const key = sqlLiteral(row.key);
    const [first = '', ...rest] = literalChunks(row.body, chunkBytes);
    statements.push(`INSERT INTO ${STAGE_TABLE} (key, body) VALUES (${key}, ${sqlLiteral(first)})`);
    for (const chunk of rest) statements.push(`UPDATE ${STAGE_TABLE} SET body = body || ${sqlLiteral(chunk)} WHERE key = ${key}`);
    statements.push(
      `INSERT INTO rendered (key, content_type, body, etag, updated_at) SELECT key, ${sqlLiteral(row.contentType)}, body, ${sqlLiteral(row.etag)}, ${sqlLiteral(now)} ` +
        `FROM ${STAGE_TABLE} WHERE key = ${key} AND length(body) = ${[...row.body].length} ` +
        'ON CONFLICT (key) DO UPDATE SET content_type = excluded.content_type, body = excluded.body, etag = excluded.etag, updated_at = excluded.updated_at',
    );
  }
  statements.push(`DROP TABLE ${STAGE_TABLE}`);
  return statements.map(checkedLength);
}

/** One script for `wrangler d1 execute --file`. */
export const sqlScript = (statements: readonly string[]): string => statements.map((statement) => `${statement};\n`).join('');
