import { ParseError } from '../errors.ts';
import { parsePriceCents } from '../number.ts';
import { twoSidedQuote } from '../quote.ts';
import { DOLAR, matchGroups } from '../text.ts';
import { epochToUtc } from '../timestamps.ts';
import type { Quote, Source } from '../types.ts';

/**
 * The `Fusion.contentCache` entry of the blue. `"Ultimo"` right after `"Venta"` keeps it off the
 * `historico` rows (`"Venta":…,"Ric":…`), and `[^{}]` keeps the match inside one JSON object, so the
 * values always belong to the `ARSB=` entry even when another instrument (`ARS=`, BNA) comes first.
 */
const EMBEDDED_RE =
  /"Compra":(\d+(?:\.\d+)?),"Venta":(\d+(?:\.\d+)?),"Ultimo":[^{}]{0,300}?"Ric":"ARSB=","UltimaActualizacion":"\\?\/Date\((\d{13})\)\\?\/"/;
const TABLE_NAME_RE = new RegExp(`<span class="markets-online__table__name">\\s*${DOLAR} Blue\\s*</span>`, 'i');
const TABLE_BODY = '<div class="markets-online__table__body">';
const MARKUP_BUY_RE = /Valor de compra<\/div>\s*<div>((?:\$|\s|<!-- -->)*[^<]*)<\/div>/;
const MARKUP_SELL_RE = /Valor de venta<\/div>\s*<div>((?:\$|\s|<!-- -->)*[^<]*)<\/div>/;
/** JSON and markup come from the same render; more than 1 % apart means one of them is stale. */
const MAX_GAP_PERCENT = 1;

function parseEmbedded(html: string): Quote | null {
  const match = EMBEDDED_RE.exec(html);
  if (!match) return null;
  const [buy, sell, epoch] = match.slice(1) as [string, string, string];
  return twoSidedQuote(parsePriceCents(buy, 'en'), parsePriceCents(sell, 'en'), epochToUtc(Number(epoch), 'ms'));
}

/** The rendered "Dólar Blue" table; its footer time is UTC printed as local, so it gives no `sourceTs`. */
function parseMarkup(html: string): Quote {
  const name = matchGroups(TABLE_NAME_RE, html, 'cronista "Dólar Blue" table');
  const start = html.indexOf(TABLE_BODY, name.end);
  if (start < 0 || start > name.end + 400) throw new ParseError('anchor', 'cronista "Dólar Blue" table body not found');
  const table = html.slice(start, start + 900);
  const [buy] = matchGroups(MARKUP_BUY_RE, table, 'cronista "Valor de compra"').groups as [string];
  const [sell] = matchGroups(MARKUP_SELL_RE, table, 'cronista "Valor de venta"').groups as [string];
  return twoSidedQuote(parsePriceCents(buy, 'ar'), parsePriceCents(sell, 'ar'), null);
}

/** Embedded JSON first (plain numbers, real timestamp), cross-checked against the markup when both exist. */
export function parseCronista(html: string): Quote {
  const embedded = parseEmbedded(html);
  if (embedded === null) {
    try {
      return parseMarkup(html);
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      throw new ParseError(error.code, `embedded JSON for "Ric":"ARSB=" not found and the markup fallback failed: ${error.message}`);
    }
  }
  let shown: Quote;
  try {
    shown = parseMarkup(html);
  } catch (error) {
    if (error instanceof ParseError) return embedded; // markup redesigned: the JSON alone is still a sound answer
    throw error;
  }
  for (const side of ['buyCents', 'sellCents'] as const) {
    if (Math.abs(embedded[side] - shown[side]) * 100 > shown[side] * MAX_GAP_PERCENT) {
      throw new ParseError('mismatch', `cronista embedded ${side} ${embedded[side]} disagrees with the rendered ${shown[side]}`);
    }
  }
  return embedded;
}

export const cronista: Source = {
  id: 'cronista',
  kind: 'blue',
  // The page, not the robots-disallowed /pf/api content API. The legacy ?id=ARSB URL 301s here.
  url: 'https://www.cronista.com/MercadosOnline/moneda/ARSB/',
  format: 'html',
  timeoutMs: 8000,
  parse: parseCronista,
};
