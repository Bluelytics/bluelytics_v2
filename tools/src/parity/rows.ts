import { addDays } from '@bluelytics/core';
import { bodyShape } from './shape.ts';

/** One row of an evolution body, keyed by day and type. */
interface EvolutionRow {
  key: string;
  day: string;
  text: string;
}

/** Evolution differences in the last days are expected before the cutover sync: v2 computed those closes itself (MIGRATION.md 2.5). */
export const RECENT_DAYS = 31;

const JSON_ROW = /^\{"date":"(\d{4}-\d{2}-\d{2})","source":"([^"]+)",/;

/** The rows of `/v2/evolution.json` or `.csv`, or `null` when the body is not in the expected form. */
function evolutionRows(body: string, csv: boolean): { head: string; rows: EvolutionRow[] } | null {
  if (csv) {
    if (!body.endsWith('\n')) return null;
    const [head = '', ...lines] = body.slice(0, -1).split('\n');
    const rows = lines.map((text) => {
      const [day = '', type = ''] = text.split(',');
      return { key: `${day}|${type}`, day, text };
    });
    return { head, rows };
  }
  if (body === 'null\n') return { head: 'null', rows: [] };
  if (!body.startsWith('[{') || !body.endsWith('}]\n')) return null;
  const rows: EvolutionRow[] = [];
  for (const piece of body.slice(2, -3).split('},{')) {
    const text = `{${piece}}`;
    const match = text.match(JSON_ROW);
    if (!match) return null;
    rows.push({ key: `${match[1]}|${match[2]}`, day: match[1] ?? '', text });
  }
  return { head: '[]', rows };
}

export interface RowDiff {
  /** `true` when every difference is in the last {@link RECENT_DAYS} days and the rows keep their form and order. */
  recentOnly: boolean;
  details: string[];
}

/** Row-level comparison of two evolution bodies that are not byte-identical. */
export function diffEvolution(before: string, after: string, csv: boolean): RowDiff {
  const a = evolutionRows(before, csv);
  const b = evolutionRows(after, csv);
  if (a === null || b === null) return { recentOnly: false, details: [`${a === null ? 'old' : 'new'} body is not an evolution body`] };
  if (a.head !== b.head) return { recentOnly: false, details: [`header differs: ${JSON.stringify(a.head)} → ${JSON.stringify(b.head)}`] };

  const oldRows = new Map(a.rows.map((row) => [row.key, row]));
  const newRows = new Map(b.rows.map((row) => [row.key, row]));
  const changed = b.rows.filter((row) => oldRows.has(row.key) && oldRows.get(row.key)?.text !== row.text);
  const missing = a.rows.filter((row) => !newRows.has(row.key));
  const extra = b.rows.filter((row) => !oldRows.has(row.key));
  const details: string[] = [];
  if (changed.length) details.push(`${changed.length} rows changed`);
  if (missing.length) details.push(`${missing.length} rows missing`);
  if (extra.length) details.push(`${extra.length} rows added`);

  const days = [...changed, ...missing, ...extra].map((row) => row.day).sort();
  if (days.length) details.push(`days ${days[0]} … ${days[days.length - 1]}`);

  const common = (rows: EvolutionRow[], other: Map<string, EvolutionRow>) => rows.filter((row) => other.has(row.key)).map((row) => row.key);
  const ordered = common(a.rows, newRows).join() === common(b.rows, oldRows).join();
  if (!ordered) details.push('row order differs');

  // A changed row keeps the form of its old version; an added row that of an old row of its type.
  const typeOf = (row: EvolutionRow) => row.key.slice(row.key.indexOf('|'));
  const reference = (row: EvolutionRow) => oldRows.get(row.key) ?? a.rows.find((other) => typeOf(other) === typeOf(row));
  const sameForm = [...changed, ...extra].every((row) => {
    const other = reference(row);
    return other === undefined || bodyShape(row.text) === bodyShape(other.text);
  });
  if (!sameForm) details.push('a changed row has another format');

  const newest = a.rows.map((row) => row.day).sort().at(-1);
  const cutoff = newest === undefined ? null : addDays(newest, -RECENT_DAYS);
  const recent = cutoff !== null && days.every((day) => day >= cutoff);
  return { recentOnly: recent && ordered && sameForm, details };
}
