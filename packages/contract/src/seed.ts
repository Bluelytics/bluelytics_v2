import { GO_ZERO_TIME, addSeconds, averageHundredths, compareInstants, parseFixed2, rint, toStoredUtc } from '@bluelytics/core';
import type { AlertRow, CurrencyRow, DailyRow, PublishedRate, PublishedState } from '@bluelytics/core';

/** A JSON number kept as its exact source text, so `1574.50` never passes through a float. */
class JsonNumber {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}

type Json = null | boolean | string | JsonNumber | Json[] | { [key: string]: Json };

type SourceReviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;

/**
 * `JSON.parse` with numbers replaced by their source text (ES2025 "JSON.parse source text access",
 * available in V8/Node 21+ and workerd). Strings are decoded exactly, including non-ASCII.
 */
function parseJson(text: string, what: string): Json {
  const reviver: SourceReviver = (_key, value, context) => {
    if (typeof value !== 'number') return value;
    if (context?.source === undefined) throw new Error('seed: this runtime lacks JSON.parse source text access');
    return new JsonNumber(context.source);
  };
  try {
    return JSON.parse(text, reviver as Parameters<typeof JSON.parse>[1]) as Json;
  } catch (error) {
    throw new Error(`seed: ${what} is not valid JSON`, { cause: error });
  }
}

function fail(what: string, problem: string): never {
  throw new Error(`seed: ${what}: ${problem}`);
}

function asObject(value: Json | undefined, what: string): { [key: string]: Json } {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value) || value instanceof JsonNumber) {
    fail(what, 'expected an object');
  }
  return value;
}

function asArray(value: Json, what: string): Json[] {
  if (!Array.isArray(value)) fail(what, 'expected an array or null');
  return value;
}

function asString(value: Json | undefined, what: string): string {
  if (typeof value !== 'string') fail(what, 'expected a string');
  return value;
}

/** A `%.2f` number → integer hundredths, from its text. */
function asHundredths(value: Json | undefined, what: string): number {
  if (!(value instanceof JsonNumber)) fail(what, 'expected a number');
  return parseFixed2(value.text);
}

/** A `%.2f` number that must be a whole number of pesos → integer pesos. */
function asPesos(value: Json | undefined, what: string): number {
  const hundredths = asHundredths(value, what);
  if (hundredths % 100 !== 0) fail(what, `expected whole pesos, got ${hundredths / 100}`);
  return hundredths / 100;
}

/** `{value_avg, value_sell, value_buy}` → integer pesos, checking that the average is consistent. */
function asRatePair(value: Json | undefined, what: string): { buy: number; sell: number } {
  const object = asObject(value, what);
  const buy = asPesos(object.value_buy, `${what}.value_buy`);
  const sell = asPesos(object.value_sell, `${what}.value_sell`);
  if (asHundredths(object.value_avg, `${what}.value_avg`) !== averageHundredths(buy, sell)) {
    fail(what, 'value_avg is not (value_buy + value_sell) / 2');
  }
  return { buy, sell };
}

/** `null` (a Go nil slice) or an array. */
function listBody(text: string, what: string): Json[] {
  const parsed = parseJson(text, what);
  return parsed === null ? [] : asArray(parsed, what);
}

/**
 * `GET /v2/evolution.json` body → `daily_rates` rows in response order (`day DESC`, Oficial
 * first), with `origin: 'backfill_api'` and no `updatedAt`. `null` → no rows.
 */
export function seedDailyRates(evolutionJson: string): DailyRow[] {
  return listBody(evolutionJson, 'evolution').map((item, index) => {
    const what = `evolution[${index}]`;
    const row = asObject(item, what);
    const tipo = asString(row.source, `${what}.source`);
    if (tipo !== 'Oficial' && tipo !== 'Blue') fail(`${what}.source`, `unexpected ${JSON.stringify(tipo)}`);
    return {
      day: asString(row.date, `${what}.date`),
      tipo,
      buy: asPesos(row.value_buy, `${what}.value_buy`),
      sell: asPesos(row.value_sell, `${what}.value_sell`),
      updatedAt: null,
      origin: 'backfill_api',
    };
  });
}

export interface SeedCurrenciesOptions {
  /** `value_date` to store; the legacy body carries none. */
  valueDate?: string | null;
}

/**
 * `GET /data/json/currency.json` body → `currencies` rows; `position` is the 0-based order in the
 * response (the legacy order is not sorted and must be kept for byte parity). Names are kept
 * exactly as decoded, including U+02BB and U+200B.
 */
export function seedCurrencies(currencyJson: string, options: SeedCurrenciesOptions = {}): CurrencyRow[] {
  return listBody(currencyJson, 'currency').map((item, index) => {
    const what = `currency[${index}]`;
    const row = asObject(item, what);
    return {
      code: asString(row.code, `${what}.code`),
      name: asString(row.name, `${what}.name`),
      valueHundredths: asHundredths(row.value, `${what}.value`),
      valueDate: options.valueDate ?? null,
      position: index,
    };
  });
}

export interface SeedAlertsOptions {
  /** `alert_at` for the previous alert, whose real time is not public. Default: one hour before the current one. */
  previousAlertAt?: string;
}

const DEFAULT_PREVIOUS_ALERT_GAP_SECONDS = -3600;

/**
 * `GET /v2/alerts` body → the two `alerts` rows that reproduce it, in insert order: the previous
 * alert (`id − 1`, an earlier `alert_at`) and the current one. The autoincrement then continues
 * the legacy sequence. An empty legacy table (`alert_id` 0) → no rows.
 */
export function seedAlerts(alertsJson: string, options: SeedAlertsOptions = {}): AlertRow[] {
  const body = asObject(parseJson(alertsJson, 'alerts'), 'alerts');
  const idValue = body.alert_id;
  if (!(idValue instanceof JsonNumber) || !/^\d+$/.test(idValue.text)) fail('alerts.alert_id', 'expected a non-negative integer');
  const id = Number(idValue.text);
  if (id === 0) return [];
  if (id < 2 || !Number.isSafeInteger(id)) fail('alerts.alert_id', `cannot seed a predecessor for id ${id}`);
  const alertAt = toStoredUtc(asString(body.alert_at, 'alerts.alert_at'));
  const previousAlertAt = toStoredUtc(options.previousAlertAt ?? addSeconds(alertAt, DEFAULT_PREVIOUS_ALERT_GAP_SECONDS));
  if (compareInstants(previousAlertAt, alertAt) >= 0) fail('alerts', 'previousAlertAt must be earlier than alert_at');
  return [
    { id: id - 1, alertAt: previousAlertAt, ...asRatePair(body.previous, 'alerts.previous'), pushStatus: null },
    { id, alertAt, ...asRatePair(body.current, 'alerts.current'), pushStatus: null },
  ];
}

export interface SeedLatestRatesOptions {
  /**
   * The EUR value (units per USD) the legacy euro figures were computed with: `0.92`, the
   * `currency.json` EUR of the capture. When given, `buyRaw`/`sellRaw` are chosen so that both
   * `rint(raw)` and `rint(raw / eurPerUsd)` reproduce the published pesos and euros, so a later
   * `withEuro(state, eurPerUsd)` republishes the same bytes. Without it, raw = the published pesos.
   */
  eurPerUsd?: number;
}

/**
 * A raw peso value consistent with both published figures: the midpoint of
 * `[pesos − ½, pesos + ½] ∩ [(euro − ½)·eurPerUsd, (euro + ½)·eurPerUsd]`.
 */
function consistentRaw(pesos: number, euro: number, eurPerUsd: number, what: string): number {
  const low = Math.max(pesos - 0.5, (euro - 0.5) * eurPerUsd);
  const high = Math.min(pesos + 0.5, (euro + 0.5) * eurPerUsd);
  const raw = (low + high) / 2;
  if (low > high || rint(raw) !== pesos || rint(raw / eurPerUsd) !== euro) {
    fail(what, `no unrounded value gives ${pesos} pesos and ${euro} euros at EUR ${eurPerUsd}`);
  }
  return raw;
}

/**
 * `GET /v2/latest` body → the `latest_rates` content. Both rows get the blue `last_update` (the
 * legacy API discards the oficial timestamp). The unrounded values are not public: see
 * {@link SeedLatestRatesOptions.eurPerUsd}. A Go zero `last_update` means the legacy rows were missing.
 */
export function seedLatestRates(latestJson: string, options: SeedLatestRatesOptions = {}): PublishedState {
  const { eurPerUsd } = options;
  if (eurPerUsd !== undefined && !(Number.isFinite(eurPerUsd) && eurPerUsd > 0)) fail('latest', `invalid eurPerUsd ${eurPerUsd}`);
  const body = asObject(parseJson(latestJson, 'latest'), 'latest');
  const lastUpdate = asString(body.last_update, 'latest.last_update');
  if (lastUpdate === GO_ZERO_TIME) return { oficial: null, blue: null };
  const updatedAt = toStoredUtc(lastUpdate);
  const rate = (key: 'oficial' | 'blue'): PublishedRate => {
    const pesos = asRatePair(body[key], `latest.${key}`);
    const euro = asRatePair(body[`${key}_euro`], `latest.${key}_euro`);
    const raw = (side: 'buy' | 'sell'): number =>
      eurPerUsd === undefined ? pesos[side] : consistentRaw(pesos[side], euro[side], eurPerUsd, `latest.${key}.${side}`);
    return { updatedAt, ...pesos, buyRaw: raw('buy'), sellRaw: raw('sell'), euroBuy: euro.buy, euroSell: euro.sell };
  };
  return { oficial: rate('oficial'), blue: rate('blue') };
}
