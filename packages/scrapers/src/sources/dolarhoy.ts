import { ParseError } from '../errors.ts';
import { parsePriceCents } from '../number.ts';
import { twoSidedQuote } from '../quote.ts';
import { DOLAR, matchGroups, windowAfter } from '../text.ts';
import type { Quote, Source } from '../types.ts';

const TILE_ANCHOR = '<div class="tile cotizacion_value">';
const TITLE_RE = /<div class="tile is-child title">\s*([^<]*?)\s*<\/div>/;
const BLUE_TITLE_RE = new RegExp(`^${DOLAR}\\s+(?:Libre|Blue|Informal)$`, 'i');
const VALUES_RE =
  /<div class="topic">Compra<\/div>\s*<div class="value">([^<]*)<\/div>[\s\S]{0,160}?<div class="topic">Venta<\/div>\s*<div class="value">([^<]*)<\/div>/;

/**
 * The first quote tile of `/cotizaciondolarblue`, titled "Dólar Libre". Its "Actualizado por última
 * vez" line is the page render time, not the quote time, so there is no `sourceTs`.
 */
export function parseDolarhoy(html: string): Quote {
  const tile = windowAfter(html, TILE_ANCHOR, 600);
  const title = matchGroups(TITLE_RE, tile, 'dolarhoy tile title');
  const [titleText] = title.groups as [string];
  if (!BLUE_TITLE_RE.test(titleText)) throw new ParseError('anchor', `dolarhoy first tile is "${titleText}", not "Dólar Libre"`);
  const values = matchGroups(VALUES_RE, tile.slice(title.end), 'dolarhoy Compra/Venta values');
  const [buy, sell] = values.groups as [string, string];
  return twoSidedQuote(parsePriceCents(buy, 'ar'), parsePriceCents(sell, 'ar'), null);
}

export const dolarhoy: Source = {
  id: 'dolarhoy',
  kind: 'blue',
  url: 'https://dolarhoy.com/cotizaciondolarblue',
  format: 'html',
  timeoutMs: 8000,
  parse: parseDolarhoy,
};
