import { formatFixed2, pesosToHundredths } from '../money.ts';
import type { DailyRow } from '../types.ts';
import { BODY } from './constants.ts';

export type EvolutionRenderInput = Pick<DailyRow, 'day' | 'tipo' | 'buy' | 'sell'>;

/** What `?days=` asks for: everything, nothing (`null` / header only), or the first `rows` rows. */
export type DaysLimit = { kind: 'all' } | { kind: 'none' } | { kind: 'rows'; rows: number };

/** Legacy `days_num < 10000` guard: at or above it the parameter is ignored. */
export const DAYS_LIMIT_CEILING = 10_000;

const ATOI = /^[+-]?\d+$/;
const INT64_MAX_DIGITS = '9223372036854775807';
const INT64_MIN_DIGITS = '9223372036854775808';

/**
 * Body of `GET /v2/evolution.json` for rows already in contract order (`day DESC`, `Oficial`
 * before `Blue`). JSON puts sell before buy. No rows renders `null`, like a Go nil slice.
 */
export function renderEvolutionJson(rows: readonly EvolutionRenderInput[]): string {
  if (rows.length === 0) return BODY.null;
  const items = rows.map(
    (row) =>
      `{"date":"${row.day}","source":"${row.tipo}","value_sell":${formatFixed2(pesosToHundredths(row.sell))},"value_buy":${formatFixed2(pesosToHundredths(row.buy))}}`,
  );
  return `[${items.join(',')}]\n`;
}

/** Body of `GET /v2/evolution.csv` for the same rows: LF line endings, buy before sell. */
export function renderEvolutionCsv(rows: readonly EvolutionRenderInput[]): string {
  const lines = rows.map(
    (row) => `${row.day},${row.tipo},${formatFixed2(pesosToHundredths(row.buy))},${formatFixed2(pesosToHundredths(row.sell))}\n`,
  );
  return BODY.csvHeader + lines.join('');
}

/**
 * Interprets the raw `?days=` value (first occurrence; `null` when absent) exactly like legacy
 * `strconv.Atoi` + `days_num < 10000` + SQL `LIMIT`: absent, empty, non-integer, out of int64
 * range or >= 10000 → everything; zero or negative → nothing; otherwise the first N rows.
 */
export function parseDaysParam(raw: string | null | undefined): DaysLimit {
  if (raw === null || raw === undefined || !ATOI.test(raw)) return { kind: 'all' };
  const negative = raw.startsWith('-');
  const digits = raw.replace(/^[+-]?0*/, '');
  const maxDigits = negative ? INT64_MIN_DIGITS : INT64_MAX_DIGITS;
  if (digits.length > maxDigits.length || (digits.length === maxDigits.length && digits > maxDigits)) {
    return { kind: 'all' };
  }
  if (negative || digits === '') return { kind: 'none' };
  if (digits.length > 4) return { kind: 'all' };
  const rows = Number(digits);
  return rows < DAYS_LIMIT_CEILING ? { kind: 'rows', rows } : { kind: 'all' };
}

/**
 * The first `rows` rows of a pre-rendered evolution JSON body, by scanning for row terminators
 * (rows contain no nested objects), without parsing. Fewer rows available → the body unchanged.
 */
export function sliceEvolutionJson(fullBody: string, rows: number): string {
  if (!Number.isInteger(rows) || rows < 1) throw new RangeError(`sliceEvolutionJson: invalid row count ${rows}`);
  if (!fullBody.startsWith('[')) return fullBody;
  let end = -1;
  for (let i = 0; i < rows; i++) {
    end = fullBody.indexOf('}', end + 1);
    if (end === -1) return fullBody;
  }
  return fullBody.startsWith(']', end + 1) ? fullBody : `${fullBody.slice(0, end + 1)}]\n`;
}

/** The header line plus the first `rows` data lines of a pre-rendered evolution CSV body. */
export function sliceEvolutionCsv(fullBody: string, rows: number): string {
  if (!Number.isInteger(rows) || rows < 1) throw new RangeError(`sliceEvolutionCsv: invalid row count ${rows}`);
  let end = -1;
  for (let i = 0; i <= rows; i++) {
    end = fullBody.indexOf('\n', end + 1);
    if (end === -1) return fullBody;
  }
  return fullBody.slice(0, end + 1);
}

/** `/v2/evolution.json` body for a raw `?days=` value, from the pre-rendered full body. */
export function limitEvolutionJson(fullBody: string, rawDays: string | null | undefined): string {
  const limit = parseDaysParam(rawDays);
  if (limit.kind === 'all') return fullBody;
  return limit.kind === 'none' ? BODY.null : sliceEvolutionJson(fullBody, limit.rows);
}

/** `/v2/evolution.csv` body for a raw `?days=` value, from the pre-rendered full body. */
export function limitEvolutionCsv(fullBody: string, rawDays: string | null | undefined): string {
  const limit = parseDaysParam(rawDays);
  if (limit.kind === 'all') return fullBody;
  return limit.kind === 'none' ? BODY.csvHeader : sliceEvolutionCsv(fullBody, limit.rows);
}
