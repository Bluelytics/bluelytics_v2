import {
  cardAltText,
  computeCardFacts,
  formatDateRange,
  formatGap,
  formatPercent,
  formatPesos,
  formatSignedPesos,
  formatTimestamp,
  plainText,
} from './cards/index.ts';
import type { CardData, CardFacts } from './cards/types.ts';
import type { PostingService } from './buffer/types.ts';

/** The card kinds that are posted (`og` is only for link previews). */
export type PostCardKind = 'update' | 'weekly';

export const SITE_URL = 'https://bluelytics.com.ar';
export const TWITTER_MAX_LENGTH = 280;
/** Instagram and X accept up to 1000 characters; `cardAltText` stays under 420. */
export const ALT_TEXT_MAX_LENGTH = 1000;

const INSTAGRAM_TAGS = '#dólarblue #dolarblue #dólar #dolar #argentina #economía #bluelytics';
const TWITTER_TAGS = '#DólarBlue';
const LINKEDIN_TAGS = '#DólarBlue #Argentina #Economía #TipoDeCambio';

const pesos = (n: number) => plainText(formatPesos(n));
const signedPesos = (n: number) => plainText(formatSignedPesos(n));
const percent = (ratio: number) => plainText(formatPercent(ratio));

function headline(kind: PostCardKind, f: CardFacts): string {
  if (kind === 'weekly') {
    const range = formatDateRange(f.series.map((p) => p.day), { prose: true });
    const intro = `Resumen semanal del dólar blue${range ? ` (${range})` : ''}: cerró en ${pesos(f.sell)}`;
    if (f.deltaAbs === null || f.deltaPct === null) return `${intro}.`;
    if (f.direction === 'flat') return `${intro}, sin cambios respecto de la semana anterior.`;
    const move = f.direction === 'up' ? 'una suba' : 'una baja';
    return `${intro}, con ${move} de ${pesos(Math.abs(f.deltaAbs))} (${percent(f.deltaPct)}) respecto de la semana anterior.`;
  }
  if (f.deltaAbs === null || f.deltaPct === null) return `Dólar blue: ${pesos(f.sell)} (venta).`;
  if (f.direction === 'flat') return `El dólar blue se mantiene en ${pesos(f.sell)}, sin cambios respecto del cierre anterior.`;
  const verb = f.direction === 'up' ? 'subió' : 'bajó';
  return `El dólar blue ${verb} a ${pesos(f.sell)}: ${signedPesos(f.deltaAbs)} (${percent(f.deltaPct)}) respecto del cierre anterior.`;
}

function detailLines(kind: PostCardKind, f: CardFacts): string[] {
  const lines = [`Compra ${pesos(f.buy)} · Venta ${pesos(f.sell)}`];
  if (kind === 'weekly' && f.points > 1 && f.min !== f.max) lines.push(`Mínimo ${pesos(f.min)} · Máximo ${pesos(f.max)}`);
  if (f.oficialSell !== null && f.gapPct !== null) {
    lines.push(`Oficial ${pesos(f.oficialSell)} · Brecha ${plainText(formatGap(f.gapPct))}`);
  }
  return lines;
}

const stamp = (f: CardFacts) => `Actualizado: ${plainText(formatTimestamp(f.updatedAt))}`;

/**
 * X counts every code point outside a few Latin/punctuation ranges as 2 (twitter-text v3 weights).
 * URLs are not special-cased: captions for X never contain one.
 */
export function twitterLength(text: string): number {
  let length = 0;
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0) ?? 0;
    const light =
      cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    length += light ? 1 : 2;
  }
  return length;
}

/**
 * X: no link and no bare domain (X bills posts with a URL in the text at the higher rate; the
 * domain is on the card). Optional lines are dropped from the end until it fits in 280.
 */
function twitterCaption(kind: PostCardKind, f: CardFacts): string {
  const required = [headline(kind, f)];
  const optional = [...detailLines(kind, f), stamp(f)];
  for (let keep = optional.length; keep >= 0; keep--) {
    const text = [...required, ...optional.slice(0, keep), TWITTER_TAGS].join('\n');
    if (twitterLength(text) <= TWITTER_MAX_LENGTH) return text;
  }
  return required.join('\n');
}

/** Caption for a feed post on `network`, in Spanish (es-AR formatting, plain ASCII signs). */
export function buildCaption(network: PostingService, kind: PostCardKind, data: CardData): string {
  const f = computeCardFacts(data);
  switch (network) {
    case 'twitter':
      return twitterCaption(kind, f);
    case 'instagram':
      return [headline(kind, f), ...detailLines(kind, f), stamp(f), '', 'Histórico, gráficos y API gratuita: link en la bio.', '', INSTAGRAM_TAGS].join('\n');
    case 'facebook':
      return [headline(kind, f), ...detailLines(kind, f), stamp(f), '', `Más datos e histórico: ${SITE_URL}`].join('\n');
    case 'linkedin':
      return [headline(kind, f), ...detailLines(kind, f), stamp(f), '', `Histórico, gráficos y API gratuita: ${SITE_URL}`, '', LINKEDIN_TAGS].join('\n');
  }
}

/** Alt text of the card image (same wording on every network). */
export function buildAltText(kind: PostCardKind, data: CardData): string {
  return cardAltText(kind, data).slice(0, ALT_TEXT_MAX_LENGTH);
}
