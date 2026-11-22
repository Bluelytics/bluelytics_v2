import { toStoredUtc } from '@bluelytics/core';
import { describeError } from '../errors.ts';
import { getText } from '../http.ts';
import type { FetchDeps } from '../types.ts';
import { parseFawazahmed0 } from './fawazahmed0.ts';
import { parseFrankfurterV2 } from './frankfurter.ts';
import type { CurrencyProviderId, CurrencyRates } from './guards.ts';

export interface CurrencySource {
  provider: CurrencyProviderId;
  url: string;
  timeoutMs: number;
  parse(text: string, today: string): { date: string; rates: Record<string, number> };
}

/** In order of preference: fawazahmed0 on jsDelivr, its Cloudflare Pages mirror (the project asks for one), then Frankfurter v2. */
export const CURRENCY_SOURCES: readonly CurrencySource[] = [
  {
    provider: 'fawazahmed0',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
    timeoutMs: 8000,
    parse: parseFawazahmed0,
  },
  {
    provider: 'fawazahmed0',
    url: 'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
    timeoutMs: 8000,
    parse: parseFawazahmed0,
  },
  {
    provider: 'frankfurter_v2',
    url: 'https://api.frankfurter.dev/v2/rates?base=USD',
    timeoutMs: 8000,
    parse: parseFrankfurterV2,
  },
];

/** One provider, guards applied; throws `FetchError` / `ParseError`. `today` = UTC date of `deps.now`. */
export async function fetchCurrencySource(source: CurrencySource, deps: FetchDeps): Promise<CurrencyRates> {
  const text = await getText(source.url, 'json', deps.timeoutMs ?? source.timeoutMs, deps.fetch);
  const { date, rates } = source.parse(text, utcDay(deps.now));
  return { provider: source.provider, url: source.url, date, rates };
}

export type CurrencyFetchResult =
  | { ok: true; result: CurrencyRates; failures: string[] }
  | { ok: false; failures: string[] };

/** The first source whose answer passes every guard; `failures` lists the ones skipped before it, with reasons. */
export async function fetchCurrencies(deps: FetchDeps, sources: readonly CurrencySource[] = CURRENCY_SOURCES): Promise<CurrencyFetchResult> {
  const failures: string[] = [];
  for (const source of sources) {
    try {
      return { ok: true, result: await fetchCurrencySource(source, deps), failures };
    } catch (error) {
      failures.push(`${source.provider} (${new URL(source.url).host}): ${describeError(error)}`);
    }
  }
  return { ok: false, failures };
}

function utcDay(iso: string): string {
  return toStoredUtc(iso).slice(0, 10);
}
