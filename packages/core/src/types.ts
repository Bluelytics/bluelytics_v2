/**
 * Shared data shapes. Conventions that hold everywhere:
 * - money is an integer: `*Cents` = centavos, `buy`/`sell`/`euro*` = whole pesos, `*Hundredths` = 1/100 units;
 * - `*Raw` values are unrounded pesos (floats) kept for audit and for the euro derivation;
 * - instants are UTC ISO-8601 strings in storage form (`toStoredUtc`), days are `YYYY-MM-DD` Argentine dates.
 */

export type RateKind = 'blue' | 'oficial';

/** What an observation measures; `extra` rows (MEP, CCL, …) never take part in the consensus. */
export type ObservationKind = RateKind | 'extra';

export const SOURCE_IDS = [
  'ambito',
  'ambito_oficial',
  'dolarhoy',
  'cronista',
  'infodolar',
  'lanacion',
  'infobae',
  'bna',
  'criptoya',
  'ambito_extras',
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const NETWORKS = ['twitter', 'instagram', 'facebook', 'linkedin'] as const;
export type Network = (typeof NETWORKS)[number];

/** One row of `observations`: what one source returned in one run, success or failure. */
export interface Observation {
  runAt: string;
  source: SourceId;
  kind: ObservationKind;
  ok: boolean;
  buyCents: number | null;
  sellCents: number | null;
  /** The source's own "as of" time, when it publishes one. */
  sourceTs: string | null;
  error: string | null;
  durationMs: number | null;
}

/** One row of `latest_rates` (without its `tipo` key). */
export interface PublishedRate {
  updatedAt: string;
  buy: number;
  sell: number;
  buyRaw: number;
  sellRaw: number;
  euroBuy: number;
  euroSell: number;
}

/** The whole `latest_rates` table; `null` = that rate has never been published. */
export interface PublishedState {
  oficial: PublishedRate | null;
  blue: PublishedRate | null;
}

/** Integer pesos. */
export interface RatePair {
  buy: number;
  sell: number;
}

export type DailyTipo = 'Oficial' | 'Blue';
export type DailyOrigin = 'backfill_api' | 'live';

/** One row of `daily_rates`. */
export interface DailyRow {
  day: string;
  tipo: DailyTipo;
  buy: number;
  sell: number;
  updatedAt: string | null;
  origin: DailyOrigin;
}

/** One row of `currencies`; `valueHundredths` = units per 1 USD × 100, `null` = hidden from the API. */
export interface CurrencyRow {
  code: string;
  name: string;
  valueHundredths: number | null;
  valueDate: string | null;
  position: number;
}

/** One row of `alerts`. */
export interface AlertRow {
  id: number;
  alertAt: string;
  buy: number;
  sell: number;
  pushStatus: string | null;
}

export interface TickVoters {
  blue: SourceId[];
  oficial: SourceId[];
}

/** One row of `ticks`: the published values of one run inside the trading window. */
export interface Tick {
  runAt: string;
  day: string;
  blueBuy: number;
  blueSell: number;
  blueBuyRaw: number | null;
  blueSellRaw: number | null;
  oficialBuy: number;
  oficialSell: number;
  oficialBuyRaw: number | null;
  oficialSellRaw: number | null;
  voters: TickVoters;
  changed: boolean;
}

/** One row of `extra_rates` (site only, not in the API). */
export interface ExtraRate {
  code: string;
  name: string;
  buyCents: number | null;
  sellCents: number | null;
  source: string;
  sourceTs: string | null;
  updatedAt: string;
}

export type SocialPostKind = 'update' | 'weekly';
export type SocialPostStatus = 'pending' | 'sent' | 'failed' | 'dry_run';

/** One row of `social_posts`. */
export interface SocialPost {
  id: number;
  network: Network;
  kind: SocialPostKind;
  eventKey: string;
  createdAt: string;
  sentAt: string | null;
  buy: number | null;
  sell: number | null;
  status: SocialPostStatus;
  attempts: number;
  externalId: string | null;
  imageKey: string | null;
  error: string | null;
}

export const RENDERED_KEYS = ['latest', 'last_price', 'alerts', 'currency', 'evolution_json', 'evolution_csv'] as const;
export type RenderedKey = (typeof RENDERED_KEYS)[number];

/** One pre-rendered API body, as stored in `rendered` (without `updated_at`). */
export interface RenderedRow {
  key: RenderedKey;
  contentType: string;
  body: string;
  etag: string;
}
