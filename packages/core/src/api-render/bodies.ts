import { averageHundredths, formatFixed2, pesosToHundredths } from '../money.ts';
import { GO_ZERO_TIME, toArtOffset, toUtcZ } from '../time.ts';
import type { AlertRow, CurrencyRow, PublishedRate, RatePair } from '../types.ts';
import { BODY } from './constants.ts';
import { goJsonString } from './json.ts';

export type LatestRateRenderInput = Pick<PublishedRate, 'updatedAt' | 'buy' | 'sell' | 'euroBuy' | 'euroSell'>;

/** The two `latest_rates` rows; a missing row renders as zeros, like the legacy API. */
export interface LatestRenderInput {
  oficial: LatestRateRenderInput | null;
  blue: LatestRateRenderInput | null;
}

export type AlertRenderInput = Pick<AlertRow, 'id' | 'alertAt' | 'buy' | 'sell'>;
export type CurrencyRenderInput = Pick<CurrencyRow, 'code' | 'name' | 'valueHundredths'>;

export interface LastPriceOptions {
  /** `true` reproduces legacy v1.go:23: the `"blue"` entry carries the oficial values. */
  legacyBlueBug: boolean;
}

export interface HistoricalRenderInput {
  oficial: RatePair | null;
  blue: RatePair | null;
}

export interface HistoricalResponse {
  status: 200 | 404;
  body: string;
}

const ZERO: RatePair = { buy: 0, sell: 0 };

/** `"value_avg":A,"value_sell":S,"value_buy":B` for integer pesos. */
function rateFields(pair: RatePair): string {
  const avg = formatFixed2(averageHundredths(pair.buy, pair.sell));
  const sell = formatFixed2(pesosToHundredths(pair.sell));
  const buy = formatFixed2(pesosToHundredths(pair.buy));
  return `"value_avg":${avg},"value_sell":${sell},"value_buy":${buy}`;
}

function euroPair(rate: LatestRateRenderInput | null): RatePair {
  return rate ? { buy: rate.euroBuy, sell: rate.euroSell } : ZERO;
}

/** `last_update` / `date`: the blue row's instant in Argentine time, or Go's zero time without a blue row. */
function lastUpdate(blue: LatestRateRenderInput | null): string {
  return goJsonString(blue ? toArtOffset(blue.updatedAt) : GO_ZERO_TIME);
}

/** Body of `GET /v2/latest`. */
export function renderLatest(state: LatestRenderInput): string {
  const { oficial, blue } = state;
  return (
    `{"oficial":{${rateFields(oficial ?? ZERO)}},"blue":{${rateFields(blue ?? ZERO)}},` +
    `"oficial_euro":{${rateFields(euroPair(oficial))}},"blue_euro":{${rateFields(euroPair(blue))}},` +
    `"last_update":${lastUpdate(blue)}}\n`
  );
}

/** Body of `GET /json/last_price` (legacy v1): two entries sharing the blue timestamp. */
export function renderLastPrice(state: LatestRenderInput, options: LastPriceOptions): string {
  const date = lastUpdate(state.blue);
  const oficial = rateFields(state.oficial ?? ZERO);
  const blue = options.legacyBlueBug ? oficial : rateFields(state.blue ?? ZERO);
  return `[{"date":${date},"source":"oficial",${oficial}},{"date":${date},"source":"blue",${blue}}]\n`;
}

/**
 * Body of `GET /v2/alerts`: the newest alert and the values of the one before it. Missing alerts
 * render as zeros (`alert_id` 0, Go zero time); `alert_at` stays in UTC with a `Z` suffix.
 */
export function renderAlerts(current: AlertRenderInput | null, previous: AlertRenderInput | null): string {
  const id = current ? current.id : 0;
  const alertAt = goJsonString(current ? toUtcZ(current.alertAt) : GO_ZERO_TIME);
  return (
    `{"alert_id":${id},"alert_at":${alertAt},` +
    `"current":{${rateFields(current ?? ZERO)}},"previous":{${rateFields(previous ?? ZERO)}}}\n`
  );
}

/**
 * Body of `GET /data/json/currency.json`, in the order given. Rows without a value are skipped;
 * no rows at all renders `null`, like a Go nil slice.
 */
export function renderCurrency(rows: readonly CurrencyRenderInput[]): string {
  const items: string[] = [];
  for (const row of rows) {
    if (row.valueHundredths === null) continue;
    items.push(
      `{"code":${goJsonString(row.code)},"name":${goJsonString(row.name)},"value":${formatFixed2(row.valueHundredths)}}`,
    );
  }
  return items.length === 0 ? BODY.null : `[${items.join(',')}]\n`;
}

/**
 * Response of `GET /v2/historical` for the rows of one day. Legacy keys "not found" on the blue
 * sell being missing or zero; a blue-only day answers 200 with oficial zeros.
 */
export function renderHistorical(day: HistoricalRenderInput): HistoricalResponse {
  if (!day.blue || day.blue.sell === 0) return { status: 404, body: BODY.dayNotFound };
  return {
    status: 200,
    body: `{"oficial":{${rateFields(day.oficial ?? ZERO)}},"blue":{${rateFields(day.blue)}}}\n`,
  };
}
