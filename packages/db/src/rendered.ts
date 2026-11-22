import type { RenderedKey, RenderedRow } from '@bluelytics/core';
import type { D1DatabaseLike, D1StatementLike } from './d1.ts';

export interface StoredRendered extends RenderedRow {
  updatedAt: string;
}

interface RenderedRecord {
  key: RenderedKey;
  content_type: string;
  body: string;
  etag: string;
  updated_at: string;
}

/** One pre-rendered body with its content type and etag, or `null` before the first render. */
export async function getRendered(db: D1DatabaseLike, key: RenderedKey): Promise<StoredRendered | null> {
  const row = await db.prepare('SELECT * FROM rendered WHERE key = ?').bind(key).first<RenderedRecord>();
  return row && { key: row.key, contentType: row.content_type, body: row.body, etag: row.etag, updatedAt: row.updated_at };
}

/** The etag of every stored body (cheap: lets a reader skip re-reading the large evolution bodies). */
export async function getRenderedEtags(db: D1DatabaseLike): Promise<Partial<Record<RenderedKey, string>>> {
  const { results } = await db.prepare('SELECT key, etag FROM rendered').all<Pick<RenderedRecord, 'key' | 'etag'>>();
  return Object.fromEntries(results.map((row) => [row.key, row.etag]));
}

/** Upserts bodies unconditionally (use `writeRendered` to skip unchanged ones). */
export function upsertRenderedStatements(db: D1DatabaseLike, rows: readonly RenderedRow[], now: string): D1StatementLike[] {
  // One statement per body: the evolution bodies are hundreds of KB each.
  return rows.map((row) =>
    db
      .prepare(
        'INSERT INTO rendered (key, content_type, body, etag, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET ' +
          'content_type = excluded.content_type, body = excluded.body, etag = excluded.etag, updated_at = excluded.updated_at',
      )
      .bind(row.key, row.contentType, row.body, row.etag, now),
  );
}
