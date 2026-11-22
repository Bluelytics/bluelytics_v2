import type { D1DatabaseLike, D1StatementLike } from './d1.ts';

export interface StateEntry {
  value: string;
  updatedAt: string;
}

/** A small named value of the `state` table (e.g. the last daily-job date), or `null`. */
export async function getState(db: D1DatabaseLike, key: string): Promise<StateEntry | null> {
  const row = await db.prepare('SELECT value, updated_at FROM state WHERE key = ?').bind(key).first<{ value: string; updated_at: string }>();
  return row ? { value: row.value, updatedAt: row.updated_at } : null;
}

/** Upserts a `state` entry. */
export function setStateStatement(db: D1DatabaseLike, key: string, value: string, now: string): D1StatementLike {
  return db
    .prepare('INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, now);
}

/** Upserts a `state` entry immediately. */
export async function setState(db: D1DatabaseLike, key: string, value: string, now: string): Promise<void> {
  await setStateStatement(db, key, value, now).run();
}
