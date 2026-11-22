import { ParseError } from '../errors.ts';
import { jsonPriceCents } from '../number.ts';
import { twoSidedQuote } from '../quote.ts';
import { isRecord, parseJson } from '../text.ts';
import { epochToUtc } from '../timestamps.ts';
import type { Quote, Source } from '../types.ts';

/** `{"blue":{"ask":1675,"bid":1655,"timestamp":1795357439},…}`: ask = sell, bid = buy; `timestamp` is their poll time in seconds. */
export function parseCriptoya(text: string): Quote {
  const data = parseJson(text);
  const blue = isRecord(data) ? data['blue'] : undefined;
  if (!isRecord(blue)) throw new ParseError('anchor', 'criptoya answer has no "blue" object');
  const { timestamp } = blue;
  if (typeof timestamp !== 'number') throw new ParseError('timestamp', 'criptoya "blue.timestamp" is not a number');
  return twoSidedQuote(jsonPriceCents(blue['bid'], 'blue.bid'), jsonPriceCents(blue['ask'], 'blue.ask'), epochToUtc(timestamp, 's'));
}

export const criptoya: Source = {
  id: 'criptoya',
  kind: 'blue',
  url: 'https://criptoya.com/api/dolar',
  format: 'json',
  timeoutMs: 8000,
  parse: parseCriptoya,
};
