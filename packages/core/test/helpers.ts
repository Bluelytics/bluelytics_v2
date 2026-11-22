import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { parseFixed2, toStoredUtc } from '../src/index.ts';
import type { AlertRenderInput, CurrencyRenderInput, EvolutionRenderInput, LatestRenderInput } from '../src/index.ts';

const GOLDEN_DIR = new URL('../../contract/golden/', import.meta.url);
const LIVE_PRETTY_DIR = new URL('./fixtures/live-pretty/', import.meta.url);

export function goldenBytes(name: string): Buffer {
  return readFileSync(new URL(`${name}.body`, GOLDEN_DIR));
}

export function goldenText(name: string): string {
  return goldenBytes(name).toString('utf8');
}

export function livePrettyBytes(name: string): Buffer {
  return readFileSync(new URL(`${name}.body`, LIVE_PRETTY_DIR));
}

/** Asserts that the UTF-8 encoding of `actual` equals `expected` byte for byte. */
export function expectBytes(actual: string, expected: Buffer): void {
  const bytes = Buffer.from(actual, 'utf8');
  if (bytes.equals(expected)) return;
  let offset = 0;
  while (offset < bytes.length && offset < expected.length && bytes[offset] === expected[offset]) offset += 1;
  expect.fail(
    `bodies differ at byte ${offset} (actual ${bytes.length} bytes, expected ${expected.length} bytes): ` +
      `actual …${JSON.stringify(bytes.subarray(Math.max(0, offset - 30), offset + 30).toString('utf8'))}, ` +
      `expected …${JSON.stringify(expected.subarray(Math.max(0, offset - 30), offset + 30).toString('utf8'))}`,
  );
}

function pesos(text: string): number {
  const hundredths = parseFixed2(text);
  if (hundredths % 100 !== 0) throw new Error(`not a whole number of pesos: ${text}`);
  return hundredths / 100;
}

function capture(text: string, pattern: RegExp): string[] {
  const match = text.match(pattern);
  if (!match) throw new Error(`pattern ${pattern} not found`);
  return match.slice(1);
}

const EVOLUTION_ROW = /\{"date":"(\d{4}-\d{2}-\d{2})","source":"(Oficial|Blue)","value_sell":(\d+\.\d{2}),"value_buy":(\d+\.\d{2})\}/g;

export function parseEvolution(body: string): EvolutionRenderInput[] {
  return [...body.matchAll(EVOLUTION_ROW)].map((match) => ({
    day: match[1] as string,
    tipo: match[2] as 'Oficial' | 'Blue',
    sell: pesos(match[3] as string),
    buy: pesos(match[4] as string),
  }));
}

const CURRENCY_ROW = /\{"code":"([^"]*)","name":"([^"]*)","value":(\d+\.\d{2})\}/g;

export function parseCurrency(body: string): CurrencyRenderInput[] {
  return [...body.matchAll(CURRENCY_ROW)].map((match) => ({
    code: match[1] as string,
    name: match[2] as string,
    valueHundredths: parseFixed2(match[3] as string),
  }));
}

function parseRate(body: string, key: string): { buy: number; sell: number } {
  const [sell, buy] = capture(body, new RegExp(`"${key}":\\{"value_avg":[\\d.]+,"value_sell":([\\d.]+),"value_buy":([\\d.]+)\\}`));
  return { buy: pesos(buy as string), sell: pesos(sell as string) };
}

export function parseLatest(body: string): LatestRenderInput {
  const [lastUpdate] = capture(body, /"last_update":"([^"]+)"/);
  const updatedAt = toStoredUtc(lastUpdate as string);
  const rate = (key: string): LatestRenderInput['blue'] => {
    const pesosPair = parseRate(body, key);
    const euroPair = parseRate(body, `${key}_euro`);
    return { updatedAt, ...pesosPair, euroBuy: euroPair.buy, euroSell: euroPair.sell };
  };
  return { oficial: rate('oficial'), blue: rate('blue') };
}

export function parseAlerts(body: string): { current: AlertRenderInput; previous: AlertRenderInput } {
  const [id, alertAt] = capture(body, /"alert_id":(\d+),"alert_at":"([^"]+)"/);
  const current = parseRate(body, 'current');
  const previous = parseRate(body, 'previous');
  return {
    current: { id: Number(id), alertAt: toStoredUtc(alertAt as string), ...current },
    previous: { id: Number(id) - 1, alertAt: '2026-11-20T00:00:00.000Z', ...previous },
  };
}
