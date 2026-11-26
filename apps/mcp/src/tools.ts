/**
 * The tools: read-only views of the data the public API and the website publish, from the same D1
 * database. Prices are Argentine pesos per unit; dates are Argentine calendar days; instants are
 * given in Argentine time (UTC−3).
 */
import { artDate, historicalLookupDay, isValidDay, toArtOffset, type DailyRow, type RatePair } from '@bluelytics/core';
import {
  getCurrencies,
  getDailyRowsBetween,
  getDayRates,
  getExtraRates,
  getLatestRates,
  getPreviousClose,
  type D1DatabaseLike,
} from '@bluelytics/db';
import type { Json, JsonObject, Tool } from './protocol.ts';
import { ToolError } from './protocol.ts';

export interface ToolContext {
  db: D1DatabaseLike;
  /** Current instant (ISO); tests fix it. */
  now(): string;
}

/** First day of the history. */
export const FIRST_DAY = '2011-01-03';

/** Longest range `get_rate_history` returns day by day. */
export const MAX_DAILY_DAYS = 400;

const ATTRIBUTION = { source: 'Bluelytics (https://bluelytics.com.ar)', license: 'CC BY 4.0' } as const;

/** The other dollar rates, in display order, with their names. */
const EXTRA_NAMES: Record<string, string> = {
  mep: 'Dólar MEP (bolsa)',
  ccl: 'Contado con liquidación (CCL)',
  cripto: 'Dólar cripto',
  tarjeta: 'Dólar tarjeta',
  mayorista: 'Dólar mayorista',
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pair(rate: RatePair): JsonObject {
  return { buy: rate.buy, sell: rate.sell, average: round2((rate.buy + rate.sell) / 2) };
}

function gap(blueSell: number | undefined, oficialSell: number | undefined): number | null {
  if (!blueSell || !oficialSell) return null;
  return round2((blueSell / oficialSell - 1) * 100);
}

function change(current: number, previous: number | undefined): JsonObject | null {
  if (!previous) return null;
  return { previous, delta: current - previous, percent: round2(((current - previous) / previous) * 100) };
}

function today(context: ToolContext): string {
  return artDate(context.now());
}

function requireDay(value: unknown, name: string, context: ToolContext): string {
  if (typeof value !== 'string' || !isValidDay(value)) throw new ToolError(`${name} must be a date as YYYY-MM-DD, got ${JSON.stringify(value)}`);
  if (value < FIRST_DAY) throw new ToolError(`${name} is before ${FIRST_DAY}, the first day of the history`);
  const last = today(context);
  if (value > last) throw new ToolError(`${name} is in the future (today in Argentina is ${last})`);
  return value;
}

// ------------------------------------------------------------------------------------ get_current_rates

const currentRates: Tool<ToolContext> = {
  definition: {
    name: 'get_current_rates',
    title: 'Current dollar rates in Argentina',
    description:
      'The blue (informal) and official US dollar rates in Argentina right now, in pesos: buy, sell and average, the ' +
      'move since the previous trading day, the gap between them, both euros, and other dollar rates (MEP, CCL, ' +
      'crypto, card, wholesale). Updated every 5 minutes on weekdays from 7:00 to 20:00 Argentine time.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async call(_args, { db }) {
    const state = await getLatestRates(db);
    const { blue, oficial } = state;
    if (blue === null && oficial === null) throw new Error('latest_rates is empty');
    const updatedAt = blue?.updatedAt ?? oficial?.updatedAt ?? null;
    const base = updatedAt === null ? null : artDate(updatedAt);
    const [blueClose, oficialClose, extras] = await Promise.all([
      base === null ? null : getPreviousClose(db, base, 'Blue'),
      base === null ? null : getPreviousClose(db, base, 'Oficial'),
      getExtraRates(db),
    ]);
    const others: Json[] = Object.keys(EXTRA_NAMES).flatMap((code) => {
      const rate = extras.find((row) => row.code === code);
      if (!rate || !rate.sellCents) return [];
      return [{ code, name: EXTRA_NAMES[code] ?? code, buy: rate.buyCents ? rate.buyCents / 100 : null, sell: rate.sellCents / 100, updated_at: toArtOffset(rate.updatedAt) }];
    });
    return {
      currency: 'ARS',
      updated_at: updatedAt === null ? null : toArtOffset(updatedAt),
      blue: blue === null ? null : { ...pair(blue), change_since_previous_close: change(blue.sell, blueClose?.sell) },
      official: oficial === null ? null : { ...pair(oficial), change_since_previous_close: change(oficial.sell, oficialClose?.sell) },
      previous_close_day: blueClose?.day ?? oficialClose?.day ?? null,
      gap_percent: gap(blue?.sell, oficial?.sell),
      blue_euro: blue !== null && blue.euroSell > 0 ? pair({ buy: blue.euroBuy, sell: blue.euroSell }) : null,
      official_euro: oficial !== null && oficial.euroSell > 0 ? pair({ buy: oficial.euroBuy, sell: oficial.euroSell }) : null,
      other_dollar_rates: others,
      other_dollar_rates_source: 'Ámbito (reference values)',
      notes:
        'buy = what you get selling one dollar; sell = what you pay buying one. Blue is the median of several public ' +
        'sources for the informal market; official is Banco Nación’s counter rate. gap_percent = blue sell over official sell.',
      ...ATTRIBUTION,
    };
  },
};

// ------------------------------------------------------------------------------------ get_rates_on_date

const ratesOnDate: Tool<ToolContext> = {
  definition: {
    name: 'get_rates_on_date',
    title: 'Dollar rates on a past date',
    description:
      'The closing blue and official US dollar rates in Argentina on one day since 2011-01-03, in pesos. ' +
      'A Saturday or Sunday returns the Friday before.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', format: 'date', description: 'The day, YYYY-MM-DD (Argentine calendar).' } },
      required: ['date'],
      additionalProperties: false,
    },
  },
  async call(args, context) {
    const day = requireDay(args['date'], 'date', context);
    const lookup = historicalLookupDay(day) ?? day;
    const { blue, oficial } = await getDayRates(context.db, lookup);
    if (blue === null && oficial === null) throw new ToolError(`No rates were published for ${lookup}.`);
    return {
      currency: 'ARS',
      requested_date: day,
      date: lookup,
      blue: blue === null ? null : pair(blue),
      official: oficial === null ? null : pair(oficial),
      gap_percent: gap(blue?.sell, oficial?.sell),
      ...ATTRIBUTION,
    };
  },
};

// ------------------------------------------------------------------------------------ get_rate_history

interface Day {
  day: string;
  blue: RatePair | null;
  oficial: RatePair | null;
}

function groupByDay(rows: readonly DailyRow[]): Day[] {
  const byDay = new Map<string, Day>();
  for (const row of rows) {
    const entry = byDay.get(row.day) ?? { day: row.day, blue: null, oficial: null };
    if (row.sell > 0) {
      if (row.tipo === 'Blue') entry.blue = { buy: row.buy, sell: row.sell };
      else entry.oficial = { buy: row.buy, sell: row.sell };
    }
    byDay.set(row.day, entry);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

function summary(days: readonly Day[]): JsonObject | null {
  const withBlue = days.filter((d) => d.blue !== null);
  const first = withBlue[0];
  const last = withBlue[withBlue.length - 1];
  if (first === undefined || last === undefined) return null;
  let low = first;
  let high = first;
  for (const d of withBlue) {
    if (d.blue!.sell < low.blue!.sell) low = d;
    if (d.blue!.sell > high.blue!.sell) high = d;
  }
  return {
    days_with_data: days.length,
    blue_sell_first: { date: first.day, value: first.blue!.sell },
    blue_sell_last: { date: last.day, value: last.blue!.sell },
    blue_sell_change_percent: round2(((last.blue!.sell - first.blue!.sell) / first.blue!.sell) * 100),
    blue_sell_low: { date: low.day, value: low.blue!.sell },
    blue_sell_high: { date: high.day, value: high.blue!.sell },
  };
}

function dailyRow(d: Day): JsonObject {
  return { date: d.day, blue_buy: d.blue?.buy ?? null, blue_sell: d.blue?.sell ?? null, official_buy: d.oficial?.buy ?? null, official_sell: d.oficial?.sell ?? null, gap_percent: gap(d.blue?.sell, d.oficial?.sell) };
}

function monthlyRows(days: readonly Day[]): JsonObject[] {
  const months = new Map<string, Day[]>();
  for (const d of days) {
    const key = d.day.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), d]);
  }
  return [...months].map(([month, list]) => {
    const blues = list.flatMap((d) => (d.blue ? [d.blue.sell] : []));
    const lastBlue = [...list].reverse().find((d) => d.blue !== null);
    const lastOficial = [...list].reverse().find((d) => d.oficial !== null);
    return {
      month,
      blue_sell_close: lastBlue?.blue?.sell ?? null,
      blue_sell_low: blues.length ? Math.min(...blues) : null,
      blue_sell_high: blues.length ? Math.max(...blues) : null,
      official_sell_close: lastOficial?.oficial?.sell ?? null,
      gap_percent_at_close: gap(lastBlue?.blue?.sell, lastOficial?.oficial?.sell),
    };
  });
}

const rateHistory: Tool<ToolContext> = {
  definition: {
    name: 'get_rate_history',
    title: 'Dollar rate history',
    description:
      'Blue and official US dollar rates in Argentina between two dates (history since 2011-01-03), in pesos, with ' +
      'a summary: first, last, change, low and high of the blue sell rate. Day by day for ranges up to ' +
      `${MAX_DAILY_DAYS} days, or one row per month (close, low, high).`,
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', format: 'date', description: 'First day, YYYY-MM-DD.' },
        to: { type: 'string', format: 'date', description: 'Last day, YYYY-MM-DD. Default: today.' },
        granularity: {
          type: 'string',
          enum: ['auto', 'daily', 'monthly'],
          description: `"auto" (default): daily up to 92 days, monthly beyond. "daily" allows up to ${MAX_DAILY_DAYS} days.`,
        },
      },
      required: ['from'],
      additionalProperties: false,
    },
  },
  async call(args, context) {
    const from = requireDay(args['from'], 'from', context);
    const to = args['to'] === undefined ? today(context) : requireDay(args['to'], 'to', context);
    if (from > to) throw new ToolError('from must not be after to');
    const granularity = args['granularity'] ?? 'auto';
    if (granularity !== 'auto' && granularity !== 'daily' && granularity !== 'monthly') throw new ToolError('granularity must be auto, daily or monthly');
    const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    const daily = granularity === 'daily' || (granularity === 'auto' && span <= 92);
    if (daily && span > MAX_DAILY_DAYS) throw new ToolError(`Daily rows cover at most ${MAX_DAILY_DAYS} days (asked for ${span}); use granularity "monthly" or a shorter range.`);
    const days = groupByDay(await getDailyRowsBetween(context.db, { from, to }));
    return {
      currency: 'ARS',
      from,
      to,
      granularity: daily ? 'daily' : 'monthly',
      summary: summary(days),
      rows: daily ? days.map(dailyRow) : monthlyRows(days),
      ...ATTRIBUTION,
    };
  },
};

// ------------------------------------------------------------------------------------ convert_currency

const convert: Tool<ToolContext> = {
  definition: {
    name: 'convert_currency',
    title: 'Convert to or from Argentine pesos',
    description:
      'Converts an amount of a foreign currency to Argentine pesos (or pesos to it) at the current blue and official ' +
      'rates, for buying and for selling. US dollar and euro use the published rates; any other currency (about 160 ' +
      'ISO 4217 codes) is converted through the dollar with international reference rates.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', exclusiveMinimum: 0, description: 'The amount to convert.' },
        currency: { type: 'string', description: 'ISO 4217 code of the foreign currency, e.g. USD, EUR, BRL. Default USD.' },
        direction: {
          type: 'string',
          enum: ['to_ars', 'from_ars'],
          description: '"to_ars" (default): amount is in the foreign currency, result in pesos. "from_ars": amount is in pesos.',
        },
      },
      required: ['amount'],
      additionalProperties: false,
    },
  },
  async call(args, { db }) {
    const raw = args['amount'];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > 1e15) throw new ToolError('amount must be a positive number');
    const amount: number = raw;
    const code = typeof args['currency'] === 'string' ? args['currency'].trim().toUpperCase() : args['currency'] === undefined ? 'USD' : '';
    if (!/^[A-Z]{3}$/.test(code)) throw new ToolError('currency must be a three-letter ISO 4217 code, e.g. USD');
    if (code === 'ARS') throw new ToolError('currency is the foreign currency; pesos are the other side of the conversion');
    const direction = args['direction'] ?? 'to_ars';
    if (direction !== 'to_ars' && direction !== 'from_ars') throw new ToolError('direction must be to_ars or from_ars');

    const { blue, oficial } = await getLatestRates(db);
    let name = code === 'USD' ? 'US dollar' : 'Euro';
    let perUsd = 1;
    if (code !== 'USD' && code !== 'EUR') {
      const currencies = await getCurrencies(db);
      const row = currencies.find((c) => c.code === code && c.valueHundredths);
      if (row === undefined) {
        const known = currencies.filter((c) => c.valueHundredths).map((c) => c.code);
        throw new ToolError(`Unknown currency ${code}. Known codes: ${['USD', 'EUR', ...known.filter((k) => k !== 'USD' && k !== 'EUR')].join(', ')}`);
      }
      name = row.name;
      perUsd = row.valueHundredths! / 100;
    }

    // Pesos per unit of the currency at one market: [buy, sell].
    function rates(rate: typeof blue): { buy: number; sell: number } | null {
      if (rate === null) return null;
      if (code === 'EUR') return rate.euroSell > 0 ? { buy: rate.euroBuy, sell: rate.euroSell } : null;
      return { buy: rate.buy / perUsd, sell: rate.sell / perUsd };
    }
    function result(rate: typeof blue): JsonObject | null {
      const r = rates(rate);
      if (r === null) return null;
      // Buying the foreign currency costs the sell price; selling it pays the buy price.
      const convertAt = (perUnit: number): number => round2(direction === 'to_ars' ? amount * perUnit : amount / perUnit);
      return {
        rate_buy: round2(r.buy),
        rate_sell: round2(r.sell),
        if_you_buy: convertAt(r.sell),
        if_you_sell: convertAt(r.buy),
      };
    }
    return {
      amount,
      currency: code,
      currency_name: name,
      direction,
      result_currency: direction === 'to_ars' ? 'ARS' : code,
      blue: result(blue),
      official: result(oficial),
      via_dollar: code !== 'USD' && code !== 'EUR',
      notes:
        'if_you_buy uses the sell rate (what buying the foreign currency costs); if_you_sell uses the buy rate. ' +
        'rate_buy/rate_sell are pesos per unit of the currency.',
      updated_at: blue === null ? null : toArtOffset(blue.updatedAt),
      ...ATTRIBUTION,
    };
  },
};

export const TOOLS: readonly Tool<ToolContext>[] = [currentRates, ratesOnDate, rateHistory, convert];
