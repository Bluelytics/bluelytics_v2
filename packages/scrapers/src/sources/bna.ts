import { parsePriceCents } from '../number.ts';
import { twoSidedQuote } from '../quote.ts';
import { matchGroups, windowAfter } from '../text.ts';
import { artWallClockToUtc } from '../timestamps.ts';
import type { Quote, Source } from '../types.ts';

const BILLETES_RE =
  /id="billetes"[\s\S]{0,400}?<th class="fechaCot">(\d{1,2})\/(\d{1,2})\/(\d{4})<\/th>[\s\S]{0,400}?<td class="tit">Dolar U\.S\.A<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>[\s\S]{0,1500}?Hora Actualizaci(?:ó|o)n:\s*(\d{1,2}):(\d{2})/;

/** Banco Nación counter rate ("billetes" tab, `ar` numbers); date and time from the table, Argentine time. */
export function parseBna(html: string): Quote {
  const tab = windowAfter(html, 'id="billetes"', 2500);
  const [d, mo, y, buy, sell, h, mi] = matchGroups(BILLETES_RE, tab, 'BNA billetes "Dolar U.S.A" row').groups as [
    string, string, string, string, string, string, string,
  ];
  const sourceTs = artWallClockToUtc(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, h, mi);
  return twoSidedQuote(parsePriceCents(buy, 'ar'), parsePriceCents(sell, 'ar'), sourceTs);
}

export const bna: Source = {
  id: 'bna',
  kind: 'oficial',
  url: 'https://www.bna.com.ar/Personas',
  format: 'html',
  // Erratic latency (0.5–19 s observed): ARCHITECTURE §7 gives it 20 s.
  timeoutMs: 20000,
  parse: parseBna,
};
