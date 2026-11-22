import { toStoredUtc, type ExtraRate, type Observation } from '@bluelytics/core';
import { describeError } from './errors.ts';
import { getText } from './http.ts';
import type { ExtraQuote, ExtrasSource } from './sources/ambito-extras.ts';
import { assertFresh } from './timestamps.ts';
import type { FetchDeps, Source } from './types.ts';

/**
 * One GET + parse + staleness check. Never throws: a timeout, a non-200, a missing anchor or a stale
 * page becomes `ok: false` with `error` set and no prices. The result is an `observations` row.
 */
export async function fetchSource(source: Source, deps: FetchDeps): Promise<Observation> {
  const runAt = toStoredUtc(deps.now);
  const startedAt = Date.now();
  const base = { runAt, source: source.id, kind: source.kind };
  try {
    const text = await getText(source.url, source.format, deps.timeoutMs ?? source.timeoutMs, deps.fetch);
    const quote = source.parse(text);
    assertFresh(quote.sourceTs, runAt);
    return { ...base, ok: true, ...quote, error: null, durationMs: Date.now() - startedAt };
  } catch (error) {
    return failed(base, error, Date.now() - startedAt);
  }
}

/** Every source in parallel (`Promise.allSettled`); one observation per source, in input order. */
export async function fetchAll(sources: readonly Source[], deps: FetchDeps): Promise<Observation[]> {
  const settled = await Promise.allSettled(sources.map((source) => fetchSource(source, deps)));
  const runAt = toStoredUtc(deps.now);
  return settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    const source = sources[i] as Source;
    return failed({ runAt, source: source.id, kind: source.kind }, result.reason, null);
  });
}

export interface ExtrasResult {
  /** Health row for `observations` (no prices); `ok` when at least one request produced rates. */
  observation: Observation;
  /** `extra_rates` rows, `updatedAt` = the run. */
  rates: ExtraRate[];
}

/**
 * The daily `extra_rates` capture. Requests are independent: one failing (or an item dated more than
 * 7 days ago) drops only its rates and is reported in `observation.error`.
 */
export async function fetchExtras(source: ExtrasSource, deps: FetchDeps): Promise<ExtrasResult> {
  const runAt = toStoredUtc(deps.now);
  const startedAt = Date.now();
  const problems: string[] = [];
  const perRequest = await Promise.all(
    source.requests.map(async (request): Promise<ExtraQuote[]> => {
      try {
        const text = await getText(request.url, 'json', deps.timeoutMs ?? source.timeoutMs, deps.fetch);
        return request.parse(text).filter((quote) => {
          try {
            assertFresh(quote.sourceTs, runAt);
            return true;
          } catch (error) {
            problems.push(`${quote.code}: ${describeError(error)}`);
            return false;
          }
        });
      } catch (error) {
        problems.push(`${request.url}: ${describeError(error)}`);
        return [];
      }
    }),
  );
  const rates = perRequest.flat().map((quote): ExtraRate => ({ ...quote, source: source.publisher, updatedAt: runAt }));
  return {
    observation: {
      runAt,
      source: source.id,
      kind: source.kind,
      ok: rates.length > 0,
      buyCents: null,
      sellCents: null,
      sourceTs: null,
      error: problems.length > 0 ? problems.join('; ') : null,
      durationMs: Date.now() - startedAt,
    },
    rates,
  };
}

function failed(base: Pick<Observation, 'runAt' | 'source' | 'kind'>, error: unknown, durationMs: number | null): Observation {
  return { ...base, ok: false, buyCents: null, sellCents: null, sourceTs: null, error: describeError(error), durationMs };
}
