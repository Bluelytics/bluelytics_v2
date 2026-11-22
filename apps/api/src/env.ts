import type { D1DatabaseLike } from '@bluelytics/db';

/** Bindings of `wrangler.jsonc` that this Worker reads. */
export interface Env {
  DB: D1DatabaseLike;
  /** Responses on this hostname carry `X-Robots-Tag: noindex`. */
  SHADOW_HOSTNAME?: string;
}

/** The part of the Workers `ExecutionContext` used here (declared structurally so tests can supply one). */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}
