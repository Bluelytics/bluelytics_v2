import { seedDailyRates } from '@bluelytics/contract';
import { goldenText } from '@bluelytics/contract/golden';
import { etag, RENDERED_CONTENT_TYPE } from '@bluelytics/core';
import { getRendered, runBatch, type D1DatabaseLike } from '@bluelytics/db';
import { createLocalD1, type LocalD1 } from '@bluelytics/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dataStatements, inlineParameters, literalChunks, MAX_STATEMENT_BYTES, renderedStatements, sqlLiteral, SqlRecorder, STAGE_TABLE } from '../src/backfill/sql.ts';

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

async function execAll(db: D1DatabaseLike, statements: readonly string[]): Promise<void> {
  for (const statement of statements) await db.prepare(statement).run();
}

describe('SQL text', () => {
  it('writes literals exactly', () => {
    expect(sqlLiteral(null)).toBe('NULL');
    expect(sqlLiteral(1601.38)).toBe('1601.38');
    expect(sqlLiteral("O'Higgins ʻ​")).toBe("'O''Higgins ʻ​'");
    expect(() => sqlLiteral(Number.NaN)).toThrow(RangeError);
  });

  it('inlines parameters and checks their count', () => {
    expect(inlineParameters('INSERT INTO t VALUES (?, ?)', ['a', 1])).toBe("INSERT INTO t VALUES ('a', 1)");
    expect(() => inlineParameters('SELECT ?', [])).toThrow(/too few/);
    expect(() => inlineParameters('SELECT ?', [1, 2])).toThrow(/unused/);
  });

  it('chunks by escaped UTF-8 size without splitting characters', () => {
    const text = "a'ñ€😀".repeat(50);
    const chunks = literalChunks(text, 40);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) expect(bytes(sqlLiteral(chunk))).toBeLessThanOrEqual(40);
    expect(literalChunks('', 40)).toEqual(['']);
  });
});

describe('generated statements on a real D1', () => {
  let local: LocalD1;
  beforeEach(async () => {
    local = await createLocalD1();
  });
  afterEach(() => local.dispose());

  it('records the db package statements as literal SQL that D1 accepts, idempotently', async () => {
    const daily = seedDailyRates(goldenText('evolution_full'));
    const recorder = new SqlRecorder();
    const sql = recorder.toSql(dataStatements(recorder, { daily, alerts: [{ id: 7, alertAt: '2026-11-20T20:00:54.374497Z', buy: 1, sell: 2, pushStatus: null }] }, null));
    for (const statement of sql) expect(bytes(statement)).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
    // One batch per pass: 600 single round trips to Miniflare would take seconds.
    await runBatch(local.db, sql.map((statement) => local.db.prepare(statement)));
    await runBatch(local.db, sql.map((statement) => local.db.prepare(statement)));
    const count = await local.db.prepare("SELECT COUNT(*) AS n FROM daily_rates WHERE origin = 'backfill_api'").first<{ n: number }>();
    expect(count?.n).toBe(daily.length);
  });

  it('with since, replaces the range by legacy rows and leaves earlier days alone', async () => {
    const db = local.db;
    await runBatch(db, [
      db.prepare("INSERT INTO daily_rates VALUES ('2026-11-21', 'Blue', 1, 2, NULL, 'live')"),
      db.prepare("INSERT INTO daily_rates VALUES ('2026-11-20', 'Blue', 1, 2, NULL, 'live')"),
      db.prepare("INSERT INTO daily_rates VALUES ('2020-01-04', 'Blue', 1, 2, NULL, 'live')"),
    ]);
    const recorder = new SqlRecorder();
    const daily = [{ day: '2026-11-20', tipo: 'Blue' as const, buy: 1615, sell: 1665, updatedAt: null, origin: 'backfill_api' as const }];
    await execAll(db, recorder.toSql(dataStatements(recorder, { daily, alerts: [] }, '2026-11-01')));
    const { results } = await db.prepare('SELECT day, sell, origin FROM daily_rates ORDER BY day').all();
    expect(results).toEqual([
      { day: '2020-01-04', sell: 2, origin: 'live' },
      { day: '2026-11-20', sell: 1665, origin: 'backfill_api' },
    ]);
  });

  it('assembles a body far above the statement limit and only publishes it when complete', async () => {
    const body = goldenText('evolution_full');
    const row = { key: 'evolution_json' as const, contentType: RENDERED_CONTENT_TYPE.evolution_json, body, etag: await etag(body) };
    const statements = renderedStatements([row], '2026-11-22T12:00:00.000Z');
    expect(statements.length).toBeGreaterThan(10);
    for (const statement of statements) expect(bytes(statement)).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);

    // A script that died after its first chunk: nothing reaches `rendered`.
    await execAll(local.db, statements.slice(0, 3));
    expect(await getRendered(local.db, 'evolution_json')).toBeNull();

    await execAll(local.db, statements);
    expect(await getRendered(local.db, 'evolution_json')).toMatchObject({ body, etag: row.etag, contentType: row.contentType });
    expect(await local.db.prepare('SELECT name FROM sqlite_master WHERE name = ?').bind(STAGE_TABLE).first()).toBeNull();
  });

  it('refuses statements from another database', () => {
    expect(() => new SqlRecorder().toSql([local.db.prepare('SELECT 1')])).toThrow(/not prepared by this recorder/);
  });
});
