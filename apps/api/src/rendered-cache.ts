import type { RenderedKey } from '@bluelytics/core';
import { prettyJson } from '@bluelytics/core';
import type { D1DatabaseLike } from '@bluelytics/db';
import { getRendered, getRenderedEtags } from '@bluelytics/db';
import type { ExecutionContextLike } from './env.ts';

/** How long a body is served before the stored etags are checked again (ARCHITECTURE §6). */
export const RENDERED_RECHECK_MS = 15_000;

/** A pre-rendered body held in isolate memory, UTF-8 encoded once. */
export interface CachedBody {
  readonly body: string;
  readonly bytes: Uint8Array;
  readonly etag: string;
  readonly contentType: string;
}

const encoder = new TextEncoder();

const prettyBodies = new WeakMap<CachedBody, string>();

/**
 * `?pretty` text of a whole cached body, computed once per body: indenting the full evolution body
 * costs milliseconds, slicing (`?days`) first is cheap and is not memoised.
 */
export function prettyBody(cached: CachedBody): string {
  let pretty = prettyBodies.get(cached);
  if (pretty === undefined) {
    pretty = prettyJson(cached.body);
    prettyBodies.set(cached, pretty);
  }
  return pretty;
}

/**
 * Isolate-level cache of the `rendered` table. A body is read from D1 once; afterwards one small
 * query for all six etags runs at most every {@link RENDERED_RECHECK_MS}, in the background, and
 * only bodies whose etag changed are read again (the evolution bodies are hundreds of KB). On any
 * D1 error the copy already in memory keeps being served.
 *
 * Concurrent cold reads are deliberately not coalesced: in workerd, awaiting a promise whose I/O
 * belongs to another request's context can hang when that request is cancelled.
 */
export class RenderedCache {
  private readonly bodies = new Map<RenderedKey, CachedBody>();
  private checkedAt = Number.NEGATIVE_INFINITY;

  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  /** The current body of `key`, or `null` when none could ever be read (not rendered yet, or D1 down). */
  get(db: D1DatabaseLike, key: RenderedKey, ctx: ExecutionContextLike): CachedBody | Promise<CachedBody | null> {
    const cached = this.bodies.get(key);
    const now = this.now();
    if (cached === undefined) {
      // A cold read is as fresh as a check: the first recheck is due 15 s after the isolate's first read.
      if (this.checkedAt === Number.NEGATIVE_INFINITY) this.checkedAt = now;
      return this.read(db, key);
    }
    if (now - this.checkedAt >= RENDERED_RECHECK_MS) {
      this.checkedAt = now;
      ctx.waitUntil(this.reloadChanged(db));
    }
    return cached;
  }

  private async reloadChanged(db: D1DatabaseLike): Promise<void> {
    try {
      const etags = await getRenderedEtags(db);
      const reloads: Promise<unknown>[] = [];
      for (const [key, cached] of this.bodies) {
        const stored = etags[key];
        if (stored !== undefined && stored !== cached.etag) reloads.push(this.read(db, key));
      }
      await Promise.all(reloads);
    } catch (error) {
      console.error('rendered: etag check failed, serving the copies in memory', error);
    }
  }

  private async read(db: D1DatabaseLike, key: RenderedKey): Promise<CachedBody | null> {
    try {
      const row = await getRendered(db, key);
      if (row !== null && row.etag !== this.bodies.get(key)?.etag) {
        this.bodies.set(key, { body: row.body, bytes: encoder.encode(row.body), etag: row.etag, contentType: row.contentType });
      }
    } catch (error) {
      console.error(`rendered: reading ${key} failed`, error);
    }
    return this.bodies.get(key) ?? null;
  }
}
