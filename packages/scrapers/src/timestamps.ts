import { epochMs, isValidDay, toStoredUtc } from '@bluelytics/core';
import { ParseError } from './errors.ts';

/** A source date older than this is a frozen page; a week covers long weekends (Carnival, Easter). */
export const MAX_SOURCE_AGE_MS = 7 * 24 * 3600_000;
/** A source date further ahead than this is wrong (bad clock or mislabelled zone). */
export const MAX_SOURCE_SKEW_MS = 6 * 3600_000;

/** Argentine wall-clock time (UTC−3, no DST) → storage-form UTC instant. */
export function artWallClockToUtc(day: string, hour: string, minute: string): string {
  if (!isValidDay(day) || Number(hour) > 23 || Number(minute) > 59) {
    throw new ParseError('timestamp', `not a valid Argentine date/time: ${day} ${hour}:${minute}`);
  }
  return toStoredUtc(`${day}T${hour.padStart(2, '0')}:${minute}:00-03:00`);
}

/** `DD/MM/YYYY - HH:MM` or `DD/MM/YYYY HH:MM` (Ámbito `fecha`, Argentine time) → UTC, or `null` if it has another shape. */
export function parseAmbitoFecha(fecha: unknown): string | null {
  if (typeof fecha !== 'string') return null;
  const match = fecha.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s*-\s*|\s+)(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [d, mo, y, h, mi] = match.slice(1) as [string, string, string, string, string];
  return artWallClockToUtc(`${y}-${mo}-${d}`, h, mi);
}

/** Epoch milliseconds or seconds → storage-form UTC. */
export function epochToUtc(value: number, unit: 'ms' | 's'): string {
  const ms = unit === 'ms' ? value : value * 1000;
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new ParseError('timestamp', `not an epoch ${unit} value: ${value}`);
  return new Date(ms).toISOString();
}

/** ISO-8601 with `Z` or an offset → storage-form UTC. */
export function isoToUtc(text: string): string {
  try {
    return toStoredUtc(text);
  } catch {
    throw new ParseError('timestamp', `not an ISO-8601 instant: ${JSON.stringify(text)}`);
  }
}

/** Throws `ParseError('stale')` when the source's own date is more than 7 days old or 6 hours ahead of `now`. */
export function assertFresh(sourceTs: string | null, now: string): void {
  if (sourceTs === null) return;
  const age = epochMs(now) - epochMs(sourceTs);
  if (age > MAX_SOURCE_AGE_MS) throw new ParseError('stale', `quote is dated ${sourceTs}, more than 7 days before ${now}`);
  if (-age > MAX_SOURCE_SKEW_MS) throw new ParseError('stale', `quote is dated ${sourceTs}, in the future of ${now}`);
}
