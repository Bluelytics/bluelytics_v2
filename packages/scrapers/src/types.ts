import type { ObservationKind, SourceId } from '@bluelytics/core';

/** What a parser extracts from one response: integer centavos and the source's own "as of" time, if any. */
export interface Quote {
  buyCents: number;
  sellCents: number;
  /** Storage-form UTC instant, or `null` when the source does not publish one. */
  sourceTs: string | null;
}

export type ResponseFormat = 'json' | 'html';

/** One scraped source: one GET per run, a pure parser over the response text. */
export interface Source {
  id: SourceId;
  kind: ObservationKind;
  url: string;
  format: ResponseFormat;
  timeoutMs: number;
  parse(text: string): Quote;
}

/** The subset of `fetch` the scrapers use; the global `fetch` of Workers and Node fits. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchDeps {
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** The run's instant (ISO-8601): becomes `runAt` and is the reference for the staleness check. */
  now: string;
  /** Overrides every source's own timeout. */
  timeoutMs?: number;
}
