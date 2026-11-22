import { parsePriceCents } from '../number.ts';
import { twoSidedQuote } from '../quote.ts';
import { DOLAR, matchGroups, windowAfter } from '../text.ts';
import type { Quote, Source } from '../types.ts';

const LIST_ANCHOR = '<ul class="dolar-subgroup';
/** Found by its label, never by position; the Compra/Venta pair must sit in the same `<li>` as the label. */
const BLUE_ROW_RE = new RegExp(
  `<h2[^>]*>\\s*${DOLAR} blue\\s*</h2>(?:(?!</li>)[\\s\\S]){0,200}?` +
    '<span>Compra</span><strong[^>]*>([^<]*(?:<!-- -->[^<]*)*)</strong>' +
    '<span>Venta</span><strong[^>]*>([^<]*(?:<!-- -->[^<]*)*)</strong>',
  'i',
);

/** Reserve source: its buy is derived (sell × 0.97) and it publishes no timestamp. */
export function parseLanacion(html: string): Quote {
  const list = windowAfter(html, LIST_ANCHOR, 3000);
  const [buy, sell] = matchGroups(BLUE_ROW_RE, list, 'lanacion "Dólar blue" row with Compra and Venta').groups as [string, string];
  return twoSidedQuote(parsePriceCents(buy, 'ar'), parsePriceCents(sell, 'ar'), null);
}

export const lanacion: Source = {
  id: 'lanacion',
  kind: 'blue',
  url: 'https://www.lanacion.com.ar/tema/dolar-blue-tid67294/',
  format: 'html',
  timeoutMs: 8000,
  parse: parseLanacion,
};
