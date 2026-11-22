import { parsePriceCents } from '../number.ts';
import { twoSidedQuote } from '../quote.ts';
import { DOLAR, matchGroups, windowAfter } from '../text.ts';
import { isoToUtc } from '../timestamps.ts';
import type { Quote, Source } from '../types.ts';

const TABLE_ANCHOR = '<table class="cotizaciones" id="CompraVenta">';
/** `(?:(?!</tr>)[\s\S])` = any character not starting `</tr>`: both cells come from the "Dólar Blue" row itself. */
const IN_ROW = '(?:(?!</tr>)[\\s\\S])';
const BLUE_ROW_RE = new RegExp(
  `<a href="/cotizacion-dolar-blue\\.aspx">\\s*${DOLAR} Blue\\s*</a>` +
    `${IN_ROW}{0,400}?class="colCompraVenta" data-order="([^"]*)"` +
    `${IN_ROW}{0,600}?class="colCompraVenta" data-order="([^"]*)"` +
    `(${IN_ROW}{0,1500})`,
  'i',
);
const DATETIME_RE = /datetime="([^"]+)"/;

/** The "Dólar Blue" row of the `CompraVenta` table (their own survey), with its `datetime` stamp. */
export function parseInfodolar(html: string): Quote {
  const table = windowAfter(html, TABLE_ANCHOR, 3000);
  const row = matchGroups(BLUE_ROW_RE, table, 'infodolar "Dólar Blue" row with two colCompraVenta cells');
  const [buy, sell, rest] = row.groups as [string, string, string];
  const stamp = DATETIME_RE.exec(rest)?.[1];
  return twoSidedQuote(parsePriceCents(buy, 'ar'), parsePriceCents(sell, 'ar'), stamp === undefined ? null : isoToUtc(stamp));
}

export const infodolar: Source = {
  id: 'infodolar',
  kind: 'blue',
  url: 'https://www.infodolar.com/cotizacion-dolar-blue.aspx',
  format: 'html',
  timeoutMs: 8000,
  parse: parseInfodolar,
};
