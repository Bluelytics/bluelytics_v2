import { etag, renderHistorical } from '@bluelytics/core';
import type { D1DatabaseLike } from '@bluelytics/db';
import { getDayRates } from '@bluelytics/db';

/** Lifetime in memory of today's row and of every "day not found" (it may appear later). */
export const HISTORICAL_SHORT_TTL_MS = 60_000;

/**
 * Lifetime in memory of a past day's row. Final in practice, but `pnpm backfill -- --since` may rewrite
 * recent days (MIGRATION.md 4.5), so a warm isolate picks the new values up within this bound.
 */
export const HISTORICAL_PAST_DAY_TTL_MS = 3_600_000;

/** Bound on remembered days; the map is simply cleared when it is reached (valid dates are unbounded). */
export const HISTORICAL_MAX_ENTRIES = 10_000;

export interface HistoricalEntry {
  readonly status: 200 | 404;
  readonly body: string;
  readonly etag: string;
  /** A past day's row: final for browsers (`max-age=86400`), re-read hourly here. */
  readonly final: boolean;
  readonly expiresAt: number;
}

/** `/v2/historical` answers per lookup day (after the weekend remap), read with one D1 point lookup. */
export class HistoricalCache {
  private readonly entries = new Map<string, HistoricalEntry>();

  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  /**
   * The answer for `lookupDay`; `today` is the current Argentine date. On a D1 error the last
   * answer in memory is served even if expired; `null` when there is none.
   */
  async get(db: D1DatabaseLike, lookupDay: string, today: string): Promise<HistoricalEntry | null> {
    const cached = this.entries.get(lookupDay);
    const now = this.now();
    if (cached !== undefined && cached.expiresAt > now) return cached;
    let rates: Awaited<ReturnType<typeof getDayRates>>;
    try {
      rates = await getDayRates(db, lookupDay);
    } catch (error) {
      console.error(`historical: reading ${lookupDay} failed`, error);
      return cached ?? null;
    }
    const { status, body } = renderHistorical(rates);
    const final = status === 200 && lookupDay < today;
    const entry: HistoricalEntry = {
      status,
      body,
      etag: await etag(body),
      final,
      expiresAt: now + (final ? HISTORICAL_PAST_DAY_TTL_MS : HISTORICAL_SHORT_TTL_MS),
    };
    if (this.entries.size >= HISTORICAL_MAX_ENTRIES) this.entries.clear();
    this.entries.set(lookupDay, entry);
    return entry;
  }
}
