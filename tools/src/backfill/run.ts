import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RenderedKey, RenderedRow } from '@bluelytics/core';
import { CliError, formatTable } from '../cli.ts';
import type { FetchLike } from '../http.ts';
import { downloadLegacy } from './legacy.ts';
import { bodiesFor, planBackfill, type BackfillPlan } from './plan.ts';
import { renderFromData, renderFromTarget } from './render.ts';
import { dataStatements, renderedStatements, sqlScript, SqlRecorder } from './sql.ts';
import type { D1Target } from './target.ts';

export interface BackfillOptions {
  from: URL;
  /** Only `daily_rates` days ≥ this and the alerts (MIGRATION.md C8); `null` = full run. */
  since: string | null;
  /** `null` = dry run: write the SQL files and touch no database. */
  target: D1Target | null;
  /** Directory for the generated SQL files. */
  outDir: string;
  legacyBlueBug: boolean;
  fetch?: FetchLike;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface BackfillReport {
  plan: BackfillPlan;
  dataFile: string;
  /** `null` when every body was already up to date. */
  renderedFile: string | null;
  rendered: RenderedRow[];
  /** Keys written to the target (a dry run lists every rendered key). */
  written: RenderedKey[];
  unchanged: RenderedKey[];
}

const kb = (text: string): string => `${Math.ceil(new TextEncoder().encode(text).byteLength / 1024)} KB`;

function summary(plan: BackfillPlan, rendered: readonly RenderedKey[]): string {
  const { daily, alerts, currencies, latest } = plan.write;
  const days = [...new Set(daily.map((row) => row.day))].sort();
  const range = days.length === 0 ? 'none' : `${days.length} days, ${days[0]} … ${days[days.length - 1]}`;
  const rows: string[][] = [
    ['daily_rates', String(daily.length), plan.since === null ? range : `${range}; rows from ${plan.since} on that legacy lacks are deleted`],
    ['alerts', String(alerts.length), alerts.length === 0 ? 'legacy has none' : `ids ${alerts.map((alert) => alert.id).join(', ')}`],
  ];
  if (currencies) rows.push(['currencies', String(currencies.length), `${currencies.filter((row) => row.valueHundredths !== null).length} with a value`]);
  if (latest) {
    const rates = [latest.oficial, latest.blue].filter((rate) => rate !== null);
    rows.push(['latest_rates', String(rates.length), `blue last_update ${latest.blue?.updatedAt ?? 'none'}`]);
  }
  rows.push(['rendered', String(rendered.length), rendered.join(', ')]);
  return formatTable(['table', 'rows', 'detail'], rows);
}

const fileStamp = (now: Date): string => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/**
 * Downloads the legacy bodies, writes them with idempotent upserts (`origin = 'backfill_api'`) and
 * re-renders the API bodies that depend on them.
 */
export async function runBackfill(options: BackfillOptions): Promise<BackfillReport> {
  const log = options.log ?? ((line: string) => console.log(line));
  const now = (options.now ?? (() => new Date()))();
  const mode = `${options.since === null ? 'full' : `since ${options.since}`}, ${options.target === null ? 'dry run' : options.target.label}`;
  log(`backfill from ${options.from.href} (${mode}; LEGACY_V1_BLUE_BUG=${options.legacyBlueBug})`);

  const bodies = await downloadLegacy(options.from, bodiesFor(options.since), { ts: now.getTime(), ...(options.fetch && { fetch: options.fetch }) });
  const plan = planBackfill(bodies, options.since);

  mkdirSync(options.outDir, { recursive: true });
  const base = join(options.outDir, `backfill-${fileStamp(now)}`);
  const recorder = new SqlRecorder();
  const dataSql = sqlScript(recorder.toSql(dataStatements(recorder, plan.write, plan.since)));
  const dataFile = `${base}-data.sql`;
  writeFileSync(dataFile, dataSql);

  const nowIso = now.toISOString();
  const writeRendered = (rows: readonly RenderedRow[]): string | null => {
    if (rows.length === 0) return null;
    const file = `${base}-rendered.sql`;
    writeFileSync(file, sqlScript(renderedStatements(rows, nowIso)));
    return file;
  };

  if (options.target === null) {
    const rendered = await renderFromData(plan.all, plan.keys, options.legacyBlueBug);
    const renderedFile = writeRendered(rendered);
    log(summary(plan, plan.keys));
    log(`SQL: ${dataFile} (${kb(dataSql)})${renderedFile === null ? '' : `, ${renderedFile}`}`);
    log('dry run: nothing was written to any database');
    return { plan, dataFile, renderedFile, rendered, written: [...plan.keys], unchanged: [] };
  }

  const target = options.target;
  log(`writing ${dataFile} (${kb(dataSql)}) to ${target.label} …`);
  await target.executeFile(dataFile);
  const { rows, stored } = await renderFromTarget(target, plan.keys, options.legacyBlueBug);
  const changed = rows.filter((row) => stored[row.key] !== row.etag);
  const renderedFile = writeRendered(changed);
  if (renderedFile !== null) {
    log(`writing ${renderedFile} (${changed.map((row) => row.key).join(', ')}) to ${target.label} …`);
    await target.executeFile(renderedFile);
    const [check = []] = await target.query('SELECT key, etag FROM rendered');
    const after = new Map(check.map((row) => [row['key'], row['etag']]));
    const broken = changed.filter((row) => after.get(row.key) !== row.etag).map((row) => row.key);
    if (broken.length > 0) throw new CliError(`rendered bodies not stored intact: ${broken.join(', ')} (re-run the backfill)`);
  }
  const written = changed.map((row) => row.key);
  const unchanged = rows.filter((row) => !written.includes(row.key)).map((row) => row.key);
  log(summary(plan, plan.keys));
  log(`rendered: ${written.length > 0 ? `wrote ${written.join(', ')}` : 'nothing changed'}${unchanged.length > 0 ? `; unchanged ${unchanged.join(', ')}` : ''}`);
  log(`done: ${target.label}`);
  return { plan, dataFile, renderedFile, rendered: rows, written, unchanged };
}
