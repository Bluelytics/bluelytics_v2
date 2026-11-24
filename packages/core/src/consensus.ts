import { median, rint } from './money.ts';
import { artDate, epochMs } from './time.ts';
import type { DailyRow, Observation, PublishedRate, PublishedState, RateKind, SourceId, Tick, TickVoters } from './types.ts';

export interface ConsensusConfig {
  /** A source votes with an observation at most this old (relative to the run). */
  freshnessMs: number;
  /** Plausible range for a quote, in pesos; both bounds are exclusive. */
  minPesos: number;
  maxPesos: number;
  /** Largest accepted `(sell - buy) / sell`, in percent (inclusive). Integer. */
  maxSpreadPercent: number;
  /** Largest accepted `|quote / lastPublished - 1|`, in percent (inclusive), without confirmation. Integer. */
  maxJumpPercent: number;
  /** A jump is confirmed when this many independent sources (vendor groups) that may vote for the kind show it… */
  jumpAgreementSources: number;
  /** …with buy and sell within this relative distance of each other, in percent (inclusive). Integer. */
  jumpAgreementTolerancePercent: number;
  bluePrimaries: readonly SourceId[];
  /** Stand-ins that vote for a primary only while that primary has no usable quote (same vendor feed). */
  blueSubstitutes: Readonly<Partial<Record<SourceId, SourceId>>>;
  blueReserve: SourceId;
  /** The reserve votes only when fewer primaries than this are voting. */
  reserveBelowPrimaries: number;
  blueLastResort: SourceId;
  /** The last resort votes only when fewer voters than this are voting. */
  lastResortBelowVoters: number;
  /** Official rate: the first source of this chain with a usable quote is published. */
  oficialChain: readonly SourceId[];
}

export const CONSENSUS_CONFIG: ConsensusConfig = {
  freshnessMs: 30 * 60_000,
  minPesos: 100,
  maxPesos: 1_000_000,
  maxSpreadPercent: 10,
  maxJumpPercent: 15,
  jumpAgreementSources: 2,
  jumpAgreementTolerancePercent: 5,
  bluePrimaries: ['ambito', 'dolarhoy', 'cronista', 'infodolar'],
  blueSubstitutes: { cronista: 'infobae' },
  blueReserve: 'lanacion',
  reserveBelowPrimaries: 3,
  blueLastResort: 'criptoya',
  lastResortBelowVoters: 2,
  // Banco Nación's counter rate is the official reference; Ámbito's official quote is the fallback.
  oficialChain: ['bna', 'ambito_oficial'],
};

export type ConsensusObservation = Pick<Observation, 'runAt' | 'source' | 'kind' | 'ok' | 'buyCents' | 'sellCents'>;

/**
 * Why an observation was not allowed to vote: `future` = `runAt` after the run's `now`,
 * `invalid` = not two integer cent values, `range` = outside (minPesos, maxPesos), `inverted` =
 * sell < buy, `spread` = spread above maxSpreadPercent, `jump` = more than maxJumpPercent away from
 * the last published value and unconfirmed.
 */
export type RejectReason = 'future' | 'invalid' | 'range' | 'inverted' | 'spread' | 'jump';

export interface RejectedObservation {
  source: SourceId;
  kind: RateKind;
  runAt: string;
  reason: RejectReason;
}

export interface ConsensusInput {
  /** Instant of this run (UTC ISO); becomes `updatedAt` of every rate that had a voter. */
  now: string;
  /** This run's observations, failures included. */
  observations: readonly ConsensusObservation[];
  /** Observations of earlier runs; only successful ones inside the freshness window are used. */
  recent: readonly ConsensusObservation[];
  previous: PublishedState;
  /** Current EUR value in units per 1 USD (e.g. `0.92`); `null` keeps the previous euro values. */
  eurPerUsd: number | null;
}

export interface ConsensusResult {
  /** The new `latest_rates` content. A rate without voters keeps its previous values and `updatedAt`. */
  state: PublishedState;
  /** Sources whose quotes produced each rate; empty = held. */
  voters: TickVoters;
  held: Record<RateKind, boolean>;
  /** Whether any published integer (buy, sell, euro buy, euro sell of either rate) differs from `previous`. */
  changed: boolean;
  rejected: RejectedObservation[];
}

interface Quote {
  source: SourceId;
  runAt: string;
  buyCents: number;
  sellCents: number;
}

function staticRejection(observation: ConsensusObservation, config: ConsensusConfig): RejectReason | null {
  const { buyCents: buy, sellCents: sell } = observation;
  if (buy === null || sell === null || !Number.isSafeInteger(buy) || !Number.isSafeInteger(sell)) return 'invalid';
  const min = config.minPesos * 100;
  const max = config.maxPesos * 100;
  if (buy <= min || buy >= max || sell <= min || sell >= max) return 'range';
  if (sell < buy) return 'inverted';
  if (exceedsPercent(sell - buy, sell, config.maxSpreadPercent)) return 'spread';
  return null;
}

/**
 * `|difference / reference| * 100 > percent`, cross-multiplied on integers: `1 - 0.85` is
 * `0.15000000000000002` in floats, which would reject an exact −15 % move.
 */
function exceedsPercent(difference: number, reference: number, percent: number): boolean {
  return Math.abs(difference) * 100 > percent * reference;
}

function isJump(quote: Quote, previous: PublishedRate | null, config: ConsensusConfig): boolean {
  if (!previous) return false;
  const jumps = (cents: number, pesos: number): boolean => pesos > 0 && exceedsPercent(cents - pesos * 100, pesos * 100, config.maxJumpPercent);
  return jumps(quote.buyCents, previous.buy) || jumps(quote.sellCents, previous.sell);
}

function agree(a: Quote, b: Quote, config: ConsensusConfig): boolean {
  const tolerance = config.jumpAgreementTolerancePercent;
  return !exceedsPercent(a.buyCents - b.buyCents, b.buyCents, tolerance) && !exceedsPercent(a.sellCents - b.sellCents, b.sellCents, tolerance);
}

/** Every source that may vote for `kind` under some availability; nothing else is read or can confirm a jump. */
function candidateSources(kind: RateKind, config: ConsensusConfig): Set<SourceId> {
  if (kind === 'oficial') return new Set(config.oficialChain);
  return new Set([
    ...config.bluePrimaries,
    ...Object.values(config.blueSubstitutes),
    config.blueReserve,
    config.blueLastResort,
  ]);
}

/** Sources that republish one vendor feed share a group and count once when confirming a jump. */
function vendorGroup(source: SourceId, config: ConsensusConfig): SourceId {
  for (const [primary, substitute] of Object.entries(config.blueSubstitutes)) {
    if (substitute === source) return primary as SourceId;
  }
  return source;
}

/**
 * One usable quote per source of `kind`: the newest fresh observation that passes every rule.
 * An unconfirmed jump makes the source fall back to its newest older quote that is not a jump.
 */
function usableQuotes(
  kind: RateKind,
  input: ConsensusInput,
  config: ConsensusConfig,
  rejected: RejectedObservation[],
): Map<SourceId, Quote> {
  const nowMs = epochMs(input.now);
  const candidates = candidateSources(kind, config);
  const seen = new Set<string>();
  const bySource = new Map<SourceId, Quote[]>();
  for (const observation of [...input.observations, ...input.recent]) {
    const id = `${observation.source}|${observation.runAt}`;
    if (observation.kind !== kind || !observation.ok || !candidates.has(observation.source) || seen.has(id)) continue;
    seen.add(id);
    const ageMs = nowMs - epochMs(observation.runAt);
    if (ageMs > config.freshnessMs) continue;
    const reason = ageMs < 0 ? 'future' : staticRejection(observation, config);
    if (reason) {
      rejected.push({ source: observation.source, kind, runAt: observation.runAt, reason });
      continue;
    }
    const quotes = bySource.get(observation.source) ?? [];
    quotes.push({
      source: observation.source,
      runAt: observation.runAt,
      buyCents: observation.buyCents as number,
      sellCents: observation.sellCents as number,
    });
    bySource.set(observation.source, quotes);
  }
  for (const quotes of bySource.values()) quotes.sort((a, b) => epochMs(b.runAt) - epochMs(a.runAt));

  const previous = input.previous[kind];
  const jumpers: Quote[] = [];
  for (const quotes of bySource.values()) {
    const newest = quotes[0] as Quote;
    if (isJump(newest, previous, config)) jumpers.push(newest);
  }
  const confirmed = new Set<Quote>();
  for (const jumper of jumpers) {
    const groups = new Set(jumpers.filter((other) => agree(jumper, other, config)).map((other) => vendorGroup(other.source, config)));
    if (groups.size >= config.jumpAgreementSources) confirmed.add(jumper);
  }

  const usable = new Map<SourceId, Quote>();
  for (const [source, quotes] of bySource) {
    const newest = quotes[0] as Quote;
    if (!isJump(newest, previous, config) || confirmed.has(newest)) {
      usable.set(source, newest);
      continue;
    }
    rejected.push({ source, kind, runAt: newest.runAt, reason: 'jump' });
    const fallback = quotes.slice(1).find((quote) => !isJump(quote, previous, config));
    if (fallback) usable.set(source, fallback);
  }
  return usable;
}

function blueVoters(usable: Map<SourceId, Quote>, config: ConsensusConfig): Quote[] {
  const voters: Quote[] = [];
  for (const primary of config.bluePrimaries) {
    const substitute = config.blueSubstitutes[primary];
    const quote = usable.get(primary) ?? (substitute ? usable.get(substitute) : undefined);
    if (quote) voters.push(quote);
  }
  if (voters.length < config.reserveBelowPrimaries) {
    const reserve = usable.get(config.blueReserve);
    if (reserve) voters.push(reserve);
  }
  if (voters.length < config.lastResortBelowVoters) {
    const lastResort = usable.get(config.blueLastResort);
    if (lastResort) voters.push(lastResort);
  }
  return voters;
}

function oficialVoters(usable: Map<SourceId, Quote>, config: ConsensusConfig): Quote[] {
  for (const source of config.oficialChain) {
    const quote = usable.get(source);
    if (quote) return [quote];
  }
  return [];
}

function euro(rawPesos: number, eurPerUsd: number | null, fallback: number): number {
  return eurPerUsd !== null && Number.isFinite(eurPerUsd) && eurPerUsd > 0 ? rint(rawPesos / eurPerUsd) : fallback;
}

/**
 * Re-derives the euro values of a state from its unrounded peso values: `rint(raw / eurPerUsd)`.
 * With an unusable EUR value the state is returned unchanged.
 */
export function withEuro(state: PublishedState, eurPerUsd: number | null): PublishedState {
  const convert = (rate: PublishedRate | null): PublishedRate | null =>
    rate && {
      ...rate,
      euroBuy: euro(rate.buyRaw, eurPerUsd, rate.euroBuy),
      euroSell: euro(rate.sellRaw, eurPerUsd, rate.euroSell),
    };
  return { oficial: convert(state.oficial), blue: convert(state.blue) };
}

/**
 * A held rate (no voters) is returned untouched, euro values included: re-deriving them would let a
 * run without any voter rewrite a published number (e.g. a rate seeded from rounded pesos). A new EUR
 * value reaches held rates only through an explicit {@link withEuro} (the daily currency step).
 */
function publish(voters: readonly Quote[], previous: PublishedRate | null, now: string, eurPerUsd: number | null): PublishedRate | null {
  if (voters.length === 0) return previous;
  const buyRaw = median(voters.map((quote) => quote.buyCents / 100));
  const sellRaw = median(voters.map((quote) => quote.sellCents / 100));
  return {
    updatedAt: now,
    buy: rint(buyRaw),
    sell: rint(sellRaw),
    buyRaw,
    sellRaw,
    euroBuy: euro(buyRaw, eurPerUsd, previous?.euroBuy ?? 0),
    euroSell: euro(sellRaw, eurPerUsd, previous?.euroSell ?? 0),
  };
}

function sameIntegers(a: PublishedRate | null, b: PublishedRate | null): boolean {
  if (a === null || b === null) return a === b;
  return a.buy === b.buy && a.sell === b.sell && a.euroBuy === b.euroBuy && a.euroSell === b.euroSell;
}

/**
 * One run of the publishing rule (ARCHITECTURE §4). Pure: the caller supplies this run's
 * observations, the recent ones, the previous state and the EUR value, and persists the result.
 */
export function computeConsensus(input: ConsensusInput, config: ConsensusConfig = CONSENSUS_CONFIG): ConsensusResult {
  const rejected: RejectedObservation[] = [];
  const blue = blueVoters(usableQuotes('blue', input, config, rejected), config);
  const oficial = oficialVoters(usableQuotes('oficial', input, config, rejected), config);
  const state: PublishedState = {
    oficial: publish(oficial, input.previous.oficial, input.now, input.eurPerUsd),
    blue: publish(blue, input.previous.blue, input.now, input.eurPerUsd),
  };
  return {
    state,
    voters: { blue: blue.map((quote) => quote.source), oficial: oficial.map((quote) => quote.source) },
    held: { blue: blue.length === 0, oficial: oficial.length === 0 },
    changed: !sameIntegers(state.oficial, input.previous.oficial) || !sameIntegers(state.blue, input.previous.blue),
    rejected,
  };
}

/** The `ticks` row of a run, or `null` while either rate has never been published. */
export function tickFromConsensus(runAt: string, result: ConsensusResult): Tick | null {
  const { blue, oficial } = result.state;
  if (!blue || !oficial) return null;
  return {
    runAt,
    day: artDate(runAt),
    blueBuy: blue.buy,
    blueSell: blue.sell,
    blueBuyRaw: blue.buyRaw,
    blueSellRaw: blue.sellRaw,
    oficialBuy: oficial.buy,
    oficialSell: oficial.sell,
    oficialBuyRaw: oficial.buyRaw,
    oficialSellRaw: oficial.sellRaw,
    voters: result.voters,
    changed: result.changed,
  };
}

/** The `daily_rates` rows (Oficial, then Blue) that a run upserts for its Argentine trading day. */
export function dailyRowsFromState(runAt: string, state: PublishedState): DailyRow[] {
  const day = artDate(runAt);
  const rows: DailyRow[] = [];
  if (state.oficial) {
    rows.push({ day, tipo: 'Oficial', buy: state.oficial.buy, sell: state.oficial.sell, updatedAt: runAt, origin: 'live' });
  }
  if (state.blue) {
    rows.push({ day, tipo: 'Blue', buy: state.blue.buy, sell: state.blue.sell, updatedAt: runAt, origin: 'live' });
  }
  return rows;
}
