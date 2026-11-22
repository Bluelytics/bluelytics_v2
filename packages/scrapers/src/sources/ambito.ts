import { ParseError } from '../errors.ts';
import { parsePriceCents } from '../number.ts';
import { twoSidedQuote } from '../quote.ts';
import { isRecord, parseJson } from '../text.ts';
import { parseAmbitoFecha } from '../timestamps.ts';
import type { Quote, Source } from '../types.ts';

/**
 * Body of an Ámbito `…/variacion` endpoint:
 * `{"compra":"1655,00","venta":"1675,00","fecha":"20\/11\/2026 - 18:55",…}`.
 * Its 404 handler also answers JSON, so the keys are required, not just valid JSON.
 */
export function parseAmbitoVariacion(text: string): Quote {
  const data = parseJson(text);
  if (!isRecord(data)) throw new ParseError('json', 'Ámbito answer is not a JSON object');
  return parseAmbitoItem(data);
}

/** One Ámbito quote object (a `…/variacion` body or an item of `/mercados/monedas`). */
export function parseAmbitoItem(item: Record<string, unknown>): Quote {
  const { compra, venta } = item;
  if (typeof compra !== 'string' || typeof venta !== 'string') {
    throw new ParseError('anchor', `no "compra"/"venta" strings (keys: ${Object.keys(item).slice(0, 8).join(', ')})`);
  }
  return twoSidedQuote(parsePriceCents(compra, 'ar'), parsePriceCents(venta, 'ar'), parseAmbitoFecha(item['fecha']));
}

const TIMEOUT_MS = 8000;

export const ambito: Source = {
  id: 'ambito',
  kind: 'blue',
  url: 'https://mercados.ambito.com/dolar/informal/variacion',
  format: 'json',
  timeoutMs: TIMEOUT_MS,
  parse: parseAmbitoVariacion,
};

export const ambitoOficial: Source = {
  id: 'ambito_oficial',
  kind: 'oficial',
  url: 'https://mercados.ambito.com/dolar/oficial/variacion',
  format: 'json',
  timeoutMs: TIMEOUT_MS,
  parse: parseAmbitoVariacion,
};
