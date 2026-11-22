// Verification of the NO-DOM extraction recipes against the saved fixtures.
// usage: node recipes.mjs <fixtures-dir>
// (uses String.prototype.match only; no DOM, no dependencies -> portable to Cloudflare Workers)
import { readFileSync } from 'node:fs';
const FX = process.argv[2];
const read = (f) => readFileSync(`${FX}/${f}`, 'utf8');

// ---------- number normalisation ----------
/** 'ar'  : Argentine format, '.' thousands and ',' decimals  -> "$ 1.655,00", "1548,41", "$1.675"
 *  'en'  : '.' decimals, no thousands separator               -> "1571.0000"
 */
export function parseNum(raw, fmt) {
  let s = String(raw).replace(/<!--[\s\S]*?-->/g, '').replace(/&nbsp;/g, '').replace(/[^\d.,-]/g, '');
  if (fmt === 'ar') s = s.replace(/\./g, '').replace(',', '.');
  else if (fmt !== 'en') throw new Error('fmt required');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`unparseable number: ${JSON.stringify(raw)}`);
  return Number(s);
}

/** "20/11/2026 - 18:55" or "20/11/2026 17:00" (Argentina local, UTC-3, no DST) -> ISO UTC */
export function parseArDateTime(s) {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s*-\s*|\s+)(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`bad date: ${s}`);
  const [, d, mo, y, h, mi] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:00-03:00`).toISOString();
}


/** CPU-cheap scanning: locate a literal anchor with indexOf, then run the regex only on a small window after it. */
export function windowAfter(html, anchor, len, from = 0) {
  const i = html.indexOf(anchor, from);
  if (i < 0) throw new Error(`anchor not found: ${anchor}`);
  return html.slice(i, i + len);
}

export function validate(q, { min = 100, max = 1_000_000, maxSpread = 0.1 } = {}) {
  const { buy, sell } = q;
  if (!(buy > min && sell > min && buy < max && sell < max)) throw new Error(`out of bounds ${buy}/${sell}`);
  if (sell < buy) throw new Error(`sell < buy ${buy}/${sell}`);
  if ((sell - buy) / sell > maxSpread) throw new Error(`spread too wide ${buy}/${sell}`);
  return q;
}

// ---------- recipes ----------
export function ambito(body) {
  const j = JSON.parse(body);
  return validate({ buy: parseNum(j.compra, 'ar'), sell: parseNum(j.venta, 'ar'), asOf: parseArDateTime(j.fecha) });
}

const CRONISTA_JSON_RE =
  /"Compra":(\d+(?:\.\d+)?),"Venta":(\d+(?:\.\d+)?),"Ultimo":[^{}]{0,300}?"Ric":"ARSB=","UltimaActualizacion":"\\?\/Date\((\d{13})\)\\?\/"/;
const CRONISTA_HTML_SELL_RE = /markets-online__card--sell">\s*<div[^>]*>Valor de venta<\/div>\s*<div>\$(?:\s|<!-- -->)*([\d.,]+)<\/div>/;
const CRONISTA_HTML_BUY_RE = /<div[^>]*>Valor de compra<\/div>\s*<div>\$(?:\s|<!-- -->)*([\d.,]+)<\/div>/;
export function cronistaHtml(body) {
  const m = body.match(CRONISTA_JSON_RE);
  if (m) return validate({ buy: Number(m[1]), sell: Number(m[2]), asOf: new Date(Number(m[3])).toISOString(), via: 'embedded-json' });
  const s = body.match(CRONISTA_HTML_SELL_RE), b = body.match(CRONISTA_HTML_BUY_RE);
  if (!s || !b) throw new Error('cronista: markers not found');
  return validate({ buy: parseNum(b[1], 'ar'), sell: parseNum(s[1], 'ar'), asOf: null, via: 'rendered-markup' });
}
export function cronistaApi(body, urlId = 'ARSB') {
  const it = JSON.parse(body).find((x) => x && x.UrlId === urlId);
  if (!it) throw new Error('cronista api: token not found');
  const ts = String(it.UltimaActualizacion).match(/\/Date\((\d{13})\)\//);
  return validate({ buy: it.Compra, sell: it.Venta, asOf: ts ? new Date(Number(ts[1])).toISOString() : null });
}

const LANACION_RE = (title) =>
  new RegExp(
    `<h2[^>]*>${title}</h2>[\\s\\S]{0,200}?<span>Compra</span><strong[^>]*>\\$(?:<!-- -->)?([\\d.,]+)</strong><span>Venta</span><strong[^>]*>\\$(?:<!-- -->)?([\\d.,]+)</strong>`,
  );
export function lanacion(body, title = 'D[oó]lar blue') {
  const m = body.match(LANACION_RE(title));
  if (!m) throw new Error('lanacion: markers not found');
  return validate({ buy: parseNum(m[1], 'ar'), sell: parseNum(m[2], 'ar'), asOf: null });
}
/** single-value rows (tarjeta, CCL, MEP, mayorista) */
export function lanacionSingle(body, title) {
  const m = body.match(new RegExp(`<h2[^>]*>${title}</h2>[\\s\\S]{0,200}?<span>Venta</span><strong[^>]*>\\$(?:<!-- -->)?([\\d.,]+)</strong>`));
  return m ? parseNum(m[1], 'ar') : null;
}

const DOLARHOY_RE =
  /<div class="topic">Compra<\/div>\s*<div class="value">\$?\s*([\d.,]+)<\/div>[\s\S]{0,160}?<div class="topic">Venta<\/div>\s*<div class="value">\$?\s*([\d.,]+)<\/div>/;
export function dolarhoy(body) {
  const m = body.match(DOLARHOY_RE);
  if (!m) throw new Error('dolarhoy: markers not found');
  return validate({ buy: parseNum(m[1], 'ar'), sell: parseNum(m[2], 'ar'), asOf: null });
}

const INFODOLAR_RE =
  /<a href="\/cotizacion-dolar-blue\.aspx">D[oó]lar Blue<\/a>[\s\S]{0,400}?class="colCompraVenta" data-order="\$?\s*([\d.,]+)"[\s\S]{0,600}?class="colCompraVenta" data-order="\$?\s*([\d.,]+)"[\s\S]{0,1500}?datetime="([^"]+)"/;
export function infodolar(body) {
  const m = body.match(INFODOLAR_RE);
  if (!m) throw new Error('infodolar: markers not found');
  return validate({ buy: parseNum(m[1], 'ar'), sell: parseNum(m[2], 'ar'), asOf: new Date(m[3]).toISOString() });
}

const INFOBAE_RE = /"ric":"ARSB=","sellValue":(\d+(?:\.\d+)?),"buyValue":(\d+(?:\.\d+)?),"closeValue":[^,{}]*,"diff":[^,{}]*,"utcDate":"([^"]+)"/;
export function infobae(body) {
  const m = body.match(INFOBAE_RE);
  if (!m) throw new Error('infobae: markers not found');
  return validate({ buy: Number(m[2]), sell: Number(m[1]), asOf: new Date(m[3]).toISOString() });
}

const BNA_RE =
  /id="billetes"[\s\S]{0,400}?<th class="fechaCot">(\d{1,2})\/(\d{1,2})\/(\d{4})<\/th>[\s\S]{0,400}?<td class="tit">Dolar U\.S\.A<\/td>\s*<td>([\d.,]+)<\/td>\s*<td>([\d.,]+)<\/td>[\s\S]{0,1500}?Hora Actualizaci[oó]n:\s*(\d{1,2}):(\d{2})/;
export function bna(body) {
  const m = body.match(BNA_RE);
  if (!m) throw new Error('bna: markers not found');
  const [, d, mo, y, buy, sell, h, mi] = m;
  const asOf = new Date(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:00-03:00`).toISOString();
  return validate({ buy: parseNum(buy, 'ar'), sell: parseNum(sell, 'ar'), asOf });
}
const BNA_DIVISA_RE = /id="divisas"[\s\S]{0,900}?<td class="tit">Dolar U\.S\.A<\/td>\s*<td>([\d.]+)<\/td>\s*<td>([\d.]+)<\/td>/;
export function bnaDivisa(body) {
  const m = body.match(BNA_DIVISA_RE);
  return m ? { buy: parseNum(m[1], 'en'), sell: parseNum(m[2], 'en') } : null;
}

export function bcraVar(body) {
  const j = JSON.parse(body);
  const d = j.results[0].detalle[0]; // newest first
  return { date: d.fecha, value: d.valor };
}
export function criptoya(body) {
  const j = JSON.parse(body);
  return {
    blue: validate({ buy: j.blue.bid, sell: j.blue.ask, asOf: new Date(j.blue.timestamp * 1000).toISOString() }),
    oficial: validate({ buy: j.oficial.bid, sell: j.oficial.ask, asOf: new Date(j.oficial.timestamp * 1000).toISOString() }),
  };
}
export function dolarapi(body, casa) {
  const it = JSON.parse(body).find((x) => x.casa === casa);
  return validate({ buy: it.compra, sell: it.venta, asOf: it.fechaActualizacion });
}

// ---------- run ----------
const run = (name, fn) => {
  try { const t0 = performance.now(); const r = fn(); const ms = (performance.now() - t0).toFixed(2); console.log(name.padEnd(34), JSON.stringify(r), `[${ms} ms]`); }
  catch (e) { console.log(name.padEnd(34), 'FAILED:', e.message); }
};
if (FX) {
  run('ambito informal (blue)', () => ambito(read('ambito_informal.json')));
  run('ambito oficial', () => ambito(read('ambito_oficial.json')));
  run('ambito mayorista', () => ambito(read('ambito_mayorista.json')));
  run('ambito dolarnacion (BNA)', () => ambito(read('ambito_dolarnacion.json')));
  run('cronista html (embedded json)', () => cronistaHtml(read('cronista.html')));
  run('cronista html (markup fallback)', () => cronistaHtml(read('cronista.html').replace(/"Ric":"ARSB="/g, '"Ric":"X"')));
  run('cronista api ARSB', () => cronistaApi(read('cronista_api_markets_list_ARSB.json')));
  run('cronista api multi ARS (BNA)', () => cronistaApi(read('cronista_api_markets_list_multi.json'), 'ARS'));
  run('lanacion blue', () => lanacion(read('lanacion.html')));
  run('lanacion oficial', () => lanacion(read('lanacion.html'), 'D[oó]lar oficial'));
  run('lanacion MEP/CCL/mayor/tarjeta', () => ['D[oó]lar MEP', 'D[oó]lar CCL', 'D[oó]lar mayorista', 'D[oó]lar tarjeta'].map((t) => lanacionSingle(read('lanacion.html'), t)));
  run('dolarhoy blue', () => dolarhoy(read('dolarhoy_blue.html')));
  run('infodolar blue', () => infodolar(read('infodolar_blue.html')));
  run('infobae blue', () => infobae(read('infobae_dolar_libre.html')));
  run('bna billete', () => bna(read('bna_personas.html')));
  run('bna divisa', () => bnaDivisa(read('bna_personas.html')));
  run('bcra var4 minorista vendedor', () => bcraVar(read('bcra_monetarias_var4_minorista.json')));
  run('bcra var5 A3500', () => bcraVar(read('bcra_monetarias_var5_mayorista_a3500.json')));
  run('criptoya', () => criptoya(read('criptoya_dolar.json')));
  run('dolarapi blue', () => dolarapi(read('dolarapi_dolares.json'), 'blue'));
  run('dolarapi oficial', () => dolarapi(read('dolarapi_dolares.json'), 'oficial'));
  // anchor + window variants (recommended for Workers: regex only touches ~1-3 KB)
  run('WINDOW lanacion blue', () => lanacion(windowAfter(read('lanacion.html'), '<ul class="dolar-subgroup', 3000)));
  run('WINDOW cronista markup', () => { const w = windowAfter(read('cronista.html'), '<div class="markets-online__table__body">', 900); return validate({ buy: parseNum(w.match(CRONISTA_HTML_BUY_RE)[1], 'ar'), sell: parseNum(w.match(/Valor de venta<\/div>\s*<div>\$(?:\s|<!-- -->)*([\d.,]+)<\/div>/)[1], 'ar') }); });
  run('WINDOW dolarhoy blue', () => dolarhoy(windowAfter(read('dolarhoy_blue.html'), '<div class="tile cotizacion_value">', 600)));
  run('WINDOW infodolar blue', () => infodolar(windowAfter(read('infodolar_blue.html'), '<table class="cotizaciones" id="CompraVenta">', 3000)));
  run('WINDOW bna billete', () => bna(windowAfter(read('bna_personas.html'), 'id="billetes"', 2500)));
  run('WINDOW bna divisa', () => bnaDivisa(windowAfter(read('bna_personas.html'), 'id="divisas"', 1200)));
  // number-normalisation unit checks
  for (const [raw, fmt, exp] of [['$ 1.655,00', 'ar', 1655], ['1548,41', 'ar', 1548.41], ['$1.675', 'ar', 1675], ['$<!-- -->1615,05', 'ar', 1615.05], ['1571.0000', 'en', 1571], ['24600,00', 'ar', 24600], ['1.234.567,89', 'ar', 1234567.89]]) {
    const got = parseNum(raw, fmt);
    console.log('parseNum', JSON.stringify(raw), fmt, '->', got, got === exp ? 'OK' : `MISMATCH (expected ${exp})`);
  }
}
