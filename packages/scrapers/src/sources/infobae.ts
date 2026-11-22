import { parsePriceCents } from '../number.ts';
import { twoSidedQuote } from '../quote.ts';
import { matchGroups } from '../text.ts';
import { isoToUtc } from '../timestamps.ts';
import type { Quote, Source } from '../types.ts';

/**
 * Cached `timeSeriesV2` answer embedded in the page. Note the order: sell, then buy. The summary item
 * `{"ric":"ARSB=","title":"Dólar blue",…,"buy":"",…}` that precedes it has an empty buy and does not match.
 */
const SERIES_RE =
  /"ric":"ARSB=","sellValue":(\d+(?:\.\d+)?),"buyValue":(\d+(?:\.\d+)?),"closeValue":[^,{}]*,"diff":[^,{}]*,"utcDate":"([^"]+)"/;

/** Same vendor feed as Cronista (`ARSB=`): standby that votes only when cronista is not usable. */
export function parseInfobae(html: string): Quote {
  const [sell, buy, utcDate] = matchGroups(SERIES_RE, html, 'infobae "ric":"ARSB=" series').groups as [string, string, string];
  return twoSidedQuote(parsePriceCents(buy, 'en'), parsePriceCents(sell, 'en'), isoToUtc(utcDate));
}

export const infobae: Source = {
  id: 'infobae',
  kind: 'blue',
  url: 'https://www.infobae.com/economia/divisas/dolar-libre/',
  format: 'html',
  timeoutMs: 8000,
  parse: parseInfobae,
};
