import type { RenderedKey, RenderedRow } from '@bluelytics/core';
import { buildRendered, insertRowsStatements, runBatch, type D1DatabaseLike, type D1Value } from '@bluelytics/db';
import { createLocalD1 } from '@bluelytics/db/testing';
import type { BackfillData } from './plan.ts';
import { dataStatements } from './sql.ts';
import type { D1Target } from './target.ts';

/** The tables `buildRendered` reads for each key. */
const KEY_TABLES: Readonly<Record<RenderedKey, readonly string[]>> = {
  latest: ['latest_rates'],
  last_price: ['latest_rates'],
  alerts: ['alerts'],
  currency: ['currencies'],
  evolution_json: ['daily_rates'],
  evolution_csv: ['daily_rates'],
};

export const tablesFor = (keys: readonly RenderedKey[]): string[] => [...new Set(keys.flatMap((key) => KEY_TABLES[key]))];

/**
 * Renders `keys` with `@bluelytics/db` `buildRendered` (the jobs Worker's code) over a throwaway
 * in-memory D1 filled by `seed`.
 */
async function renderInMemory(seed: (db: D1DatabaseLike) => Promise<void>, keys: readonly RenderedKey[], legacyBlueBug: boolean): Promise<RenderedRow[]> {
  const local = await createLocalD1();
  try {
    await seed(local.db);
    return await buildRendered(local.db, { legacyBlueBug, keys });
  } finally {
    await local.dispose();
  }
}

/** Dry run: the bodies as they would be if the target held exactly the downloaded data. */
export function renderFromData(data: BackfillData, keys: readonly RenderedKey[], legacyBlueBug: boolean): Promise<RenderedRow[]> {
  return renderInMemory((db) => runBatch(db, dataStatements(db, data, null)), keys, legacyBlueBug);
}

export interface TargetRender {
  rows: RenderedRow[];
  /** Etags currently stored in the target's `rendered`. */
  stored: Partial<Record<RenderedKey, string>>;
}

/**
 * Real run: copies the tables the keys depend on from the target (after the data was written),
 * so the bodies reflect what the target really holds, including rows a `--since` run left alone.
 */
export async function renderFromTarget(target: D1Target, keys: readonly RenderedKey[], legacyBlueBug: boolean): Promise<TargetRender> {
  const tables = tablesFor(keys);
  const results = await target.query([...tables.map((table) => `SELECT * FROM ${table}`), 'SELECT key, etag FROM rendered'].join('; '));
  if (results.length !== tables.length + 1) throw new Error(`query returned ${results.length} result sets, expected ${tables.length + 1}`);
  const stored = Object.fromEntries((results[tables.length] ?? []).map((row) => [row['key'], row['etag']])) as Partial<Record<RenderedKey, string>>;
  const rows = await renderInMemory(
    (db) =>
      runBatch(
        db,
        tables.flatMap((table, index) => {
          const records = results[index] ?? [];
          const columns = Object.keys(records[0] ?? {});
          return insertRowsStatements(db, table, columns, records.map((record) => columns.map((column): D1Value => record[column] ?? null)));
        }),
      ),
    keys,
    legacyBlueBug,
  );
  return { rows, stored };
}
