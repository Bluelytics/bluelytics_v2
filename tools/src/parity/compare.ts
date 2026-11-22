import type { GoldenCapture } from '@bluelytics/contract';
import { diffEvolution } from './rows.ts';
import { bodyShape, valueChanges } from './shape.ts';

export type Verdict = 'ok' | 'warn' | 'fail';

export type Fetched = { ok: true; status: number; headers: Headers; body: Uint8Array } | { ok: false; error: string };

export interface CheckResult {
  name: string;
  request: string;
  status: string;
  verdict: Verdict;
  details: string[];
}

/** Response headers that must match: content type and the legacy CORS set. `vary` is compared as a token set. */
export const COMPARED_HEADERS = ['content-type', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'vary'] as const;

/**
 * How a capture's body is compared:
 * - `bytes`: must be identical (static bodies, errors, historical days);
 * - `rows`: evolution bodies; differences limited to recent days are expected until the cutover sync;
 * - `shape`: same keys, key order, number formats, wrapper and newline; values may differ
 *   (the time-varying captures, and currency.json once the jobs Worker refreshed the rates).
 */
export type BodyMode = 'bytes' | 'rows' | 'shape';

export function bodyMode(capture: GoldenCapture): BodyMode {
  if (capture.path.startsWith('/v2/evolution.')) return 'rows';
  if (capture.body === 'time-varying' || capture.name === 'currency') return 'shape';
  return 'bytes';
}

export const describeRequest = (capture: GoldenCapture): string => {
  const origin = capture.requestHeaders['Origin'];
  return `${capture.method} ${capture.path}${capture.query === null ? '' : `?${capture.query}`}${origin === undefined ? '' : ` (Origin: ${origin})`}`;
};

const varyTokens = (value: string | null): string =>
  (value ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(', ');

function headerDifferences(before: Headers, after: Headers): string[] {
  return COMPARED_HEADERS.flatMap((name) => {
    const a = name === 'vary' ? varyTokens(before.get(name)) : before.get(name);
    const b = name === 'vary' ? varyTokens(after.get(name)) : after.get(name);
    return a === b ? [] : [`${name}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
  });
}

const decoder = new TextDecoder();
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

function compareBodies(capture: GoldenCapture, before: Uint8Array, after: Uint8Array): { verdict: Verdict; details: string[] } {
  if (sameBytes(before, after)) return { verdict: 'ok', details: [] };
  const a = decoder.decode(before);
  const b = decoder.decode(after);
  const mode = bodyMode(capture);
  if (mode === 'rows') {
    const diff = diffEvolution(a, b, capture.path.endsWith('.csv'));
    return { verdict: diff.recentOnly ? 'warn' : 'fail', details: diff.details };
  }
  if (mode === 'shape' && bodyShape(a) === bodyShape(b)) return { verdict: 'warn', details: ['values differ', ...valueChanges(a, b)] };
  const size = `${before.length} → ${after.length} bytes`;
  return { verdict: 'fail', details: [mode === 'shape' ? `structure differs (${size})` : `body differs (${size})`] };
}

const rank: Record<Verdict, number> = { ok: 0, warn: 1, fail: 2 };

/** Compares one capture fetched from both systems. `strict` turns every expected difference into a failure. */
export function compareCapture(capture: GoldenCapture, before: Fetched, after: Fetched, strict: boolean): CheckResult {
  const base = { name: capture.name, request: describeRequest(capture) };
  if (!before.ok || !after.ok) {
    const errors = [!before.ok && `old: ${before.error}`, !after.ok && `new: ${after.error}`].filter((error): error is string => typeof error === 'string');
    return { ...base, status: `${before.ok ? before.status : 'error'} → ${after.ok ? after.status : 'error'}`, verdict: 'fail', details: errors };
  }
  const status = before.status === after.status ? String(after.status) : `${before.status} → ${after.status}`;
  if (before.status !== after.status) return { ...base, status, verdict: 'fail', details: ['status differs'] };

  const headers = headerDifferences(before.headers, after.headers);
  const body = compareBodies(capture, before.body, after.body);
  let verdict: Verdict = headers.length > 0 ? 'fail' : 'ok';
  if (rank[body.verdict] > rank[verdict]) verdict = body.verdict;
  const details = [...headers, ...body.details];
  if (strict && verdict === 'warn') return { ...base, status, verdict: 'fail', details: [...details, '(--strict)'] };
  return { ...base, status, verdict, details };
}
