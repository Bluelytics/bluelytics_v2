import { ParseError } from '../errors.ts';
import { parsePriceCents } from '../number.ts';
import { isRecord, parseJson } from '../text.ts';
import { parseAmbitoFecha } from '../timestamps.ts';
import { parseAmbitoVariacion } from './ambito.ts';

/** One `extra_rates` value as parsed; `buyCents: null` for sell-only items (tarjeta, importador). */
export interface ExtraQuote {
  code: string;
  name: string;
  buyCents: number | null;
  sellCents: number;
  sourceTs: string | null;
}

/** `/mercados/monedas` item `nombre` (accents and case folded) → `extra_rates` code and display name. */
const MONEDAS_ITEMS: Readonly<Record<string, { code: string; name: string }>> = {
  'dolar bna': { code: 'bna', name: 'Dólar BNA' },
  'dolar tarjeta': { code: 'tarjeta', name: 'Dólar tarjeta' },
  'dolar importador': { code: 'importador', name: 'Dólar importador' },
  'dolar mep': { code: 'mep', name: 'Dólar MEP' },
  'dolar mayorista': { code: 'mayorista', name: 'Dólar mayorista' },
  'dolar cripto': { code: 'cripto', name: 'Dólar cripto' },
  euro: { code: 'euro', name: 'Euro oficial' },
  'euro informal': { code: 'euro_blue', name: 'Euro blue' },
};

function foldName(nombre: string): string {
  return nombre
    .replace(/&([a-z])acute;/gi, '$1')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * The `/mercados/monedas` array (BNA, tarjeta, importador, MEP, mayorista, cripto, euro, euro blue;
 * "Dólar Informal" is skipped: it is the `ambito` source). Unknown items are ignored; a known item
 * with a malformed number fails the whole answer rather than dropping or guessing a value.
 */
export function parseAmbitoMonedas(text: string): ExtraQuote[] {
  const data = parseJson(text);
  if (!Array.isArray(data)) throw new ParseError('json', 'Ámbito /mercados/monedas answer is not a JSON array');
  const quotes: ExtraQuote[] = [];
  for (const item of data) {
    if (!isRecord(item) || typeof item['nombre'] !== 'string') continue;
    const known = MONEDAS_ITEMS[foldName(item['nombre'])];
    if (known === undefined) continue;
    const { compra, venta } = item;
    if (typeof venta !== 'string') throw new ParseError('anchor', `"${item['nombre']}" has no "venta" string`);
    // `data-valor-descripcion: "Venta"` marks a sell-only quote whose `compra` is another rate's.
    let buyCents: number | null = null;
    if (item['data-valor-descripcion'] !== 'Venta') {
      if (typeof compra !== 'string') throw new ParseError('anchor', `"${item['nombre']}" has no "compra" string`);
      buyCents = parsePriceCents(compra, 'ar');
    }
    quotes.push({
      ...known,
      buyCents,
      sellCents: parsePriceCents(venta, 'ar'),
      sourceTs: parseAmbitoFecha(item['fecha']),
    });
  }
  if (quotes.length === 0) throw new ParseError('anchor', 'no known item in Ámbito /mercados/monedas');
  return quotes;
}

/** `/dolarrava/cl/variacion` (CCL is not part of `/mercados/monedas`). */
export function parseAmbitoCcl(text: string): ExtraQuote[] {
  const quote = parseAmbitoVariacion(text);
  return [{ code: 'ccl', name: 'Dólar CCL', ...quote }];
}

export interface ExtrasRequest {
  url: string;
  parse(text: string): ExtraQuote[];
}

/** Daily capture for `extra_rates` (site only): two small JSON GETs. */
export interface ExtrasSource {
  id: 'ambito_extras';
  kind: 'extra';
  /** Value of `extra_rates.source`. */
  publisher: string;
  timeoutMs: number;
  requests: readonly ExtrasRequest[];
}

export const ambitoExtras: ExtrasSource = {
  id: 'ambito_extras',
  kind: 'extra',
  publisher: 'ambito',
  timeoutMs: 8000,
  requests: [
    { url: 'https://mercados.ambito.com/mercados/monedas', parse: parseAmbitoMonedas },
    { url: 'https://mercados.ambito.com/dolarrava/cl/variacion', parse: parseAmbitoCcl },
  ],
};
