/**
 * The part of the D1 binding this package uses, declared structurally so that the real Workers
 * binding (`env.DB`), Miniflare's `getD1Database()` and any compatible emulator all fit without
 * depending on `@cloudflare/workers-types` at runtime.
 */

/** Values D1 can bind. Booleans are stored as 0/1 by the callers, never bound directly. */
export type D1Value = string | number | null;

export interface D1ResultLike<T> {
  results: T[];
  success: boolean;
  meta: { changes: number; last_row_id: number };
}

export interface D1StatementLike {
  bind(...values: D1Value[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
  /** Runs the statements in order inside one transaction (all or nothing). */
  batch<T = unknown>(statements: D1StatementLike[]): Promise<D1ResultLike<T>[]>;
}

/** D1 accepts at most 100 bound parameters per statement. */
export const MAX_BOUND_PARAMETERS = 100;

/**
 * Multi-row `INSERT` statements for `rows`, split so that no statement binds more than
 * {@link MAX_BOUND_PARAMETERS} values. `suffix` is appended verbatim (e.g. an `ON CONFLICT` clause).
 */
export function insertRowsStatements(
  db: D1DatabaseLike,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly D1Value[])[],
  suffix = '',
): D1StatementLike[] {
  const perStatement = Math.max(1, Math.floor(MAX_BOUND_PARAMETERS / columns.length));
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  const statements: D1StatementLike[] = [];
  for (let start = 0; start < rows.length; start += perStatement) {
    const chunk = rows.slice(start, start + perStatement);
    for (const row of chunk) {
      if (row.length !== columns.length) throw new RangeError(`insert into ${table}: expected ${columns.length} values, got ${row.length}`);
    }
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${chunk.map(() => tuple).join(', ')}${suffix}`;
    statements.push(db.prepare(sql).bind(...chunk.flat()));
  }
  return statements;
}

/** `db.batch()` over the concatenation of statement groups; an empty list is a no-op. */
export async function runBatch(db: D1DatabaseLike, ...groups: readonly (readonly D1StatementLike[])[]): Promise<void> {
  const statements = groups.flat();
  if (statements.length > 0) await db.batch(statements);
}

/** SQLite 0/1 → boolean. */
export function toBoolean(value: unknown): boolean {
  return value === 1 || value === true;
}
