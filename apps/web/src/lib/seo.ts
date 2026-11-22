/** Structured data (docs/research/astro-seo.md §8.2): one JSON-LD `@graph` per page. */
import { toArtOffset } from '@bluelytics/core';
import { API_ORIGIN, AUTHOR, OG_IMAGE_KEY, SITE_NAME, SOCIAL } from '../config.ts';
import { absoluteUrl, ROUTES, SITE_ORIGIN, type Locale } from '../i18n/routes.ts';

export interface Crumb {
  name: string;
  path: string;
}

type Node = Record<string, unknown>;

const ORG_ID = `${SITE_ORIGIN}/#organization`;
const SITE_ID = `${SITE_ORIGIN}/#website`;

export function organizationNode(): Node {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: SITE_NAME,
    url: absoluteUrl('/'),
    logo: absoluteUrl('/favicon.svg'),
    sameAs: [SOCIAL.x, SOCIAL.instagram, SOCIAL.facebook, SOCIAL.github],
  };
}

export function websiteNode(locale: Locale): Node {
  return {
    '@type': 'WebSite',
    '@id': SITE_ID,
    name: SITE_NAME,
    alternateName: ['bluelytics.com.ar', locale === 'es' ? 'Bluelytics dólar blue' : 'Bluelytics blue dollar'],
    url: absoluteUrl('/'),
    inLanguage: ['es-AR', 'en'],
    publisher: { '@id': ORG_ID },
  };
}

export function webPageNode(options: { locale: Locale; path: string; title: string; description: string; dateModified?: string | null }): Node {
  const node: Node = {
    '@type': 'WebPage',
    '@id': `${absoluteUrl(options.path)}#webpage`,
    url: absoluteUrl(options.path),
    name: options.title,
    description: options.description,
    inLanguage: options.locale === 'es' ? 'es-AR' : 'en',
    isPartOf: { '@id': SITE_ID },
  };
  if (options.dateModified) node['dateModified'] = toArtOffset(options.dateModified);
  return node;
}

export function breadcrumbNode(crumbs: readonly Crumb[]): Node {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({ '@type': 'ListItem', position: i + 1, name: crumb.name, item: absoluteUrl(crumb.path) })),
  };
}

/** A published rate for other consumers of structured data (no Google feature uses it). */
export function exchangeRateNode(options: { name: string; sell: number; buy: number }): Node {
  return {
    '@type': 'ExchangeRateSpecification',
    name: options.name,
    currency: 'USD',
    currentExchangeRate: { '@type': 'UnitPriceSpecification', price: options.sell, priceCurrency: 'ARS' },
    exchangeRateSpread: options.sell - options.buy,
  };
}

/** The daily history as a Dataset (Dataset Search only). */
export function datasetNode(locale: Locale, coverage: { from: string; to: string }): Node {
  const es = locale === 'es';
  return {
    '@type': 'Dataset',
    name: es ? 'Cotización histórica del dólar blue y oficial en Argentina' : 'Historical blue and official dollar rates in Argentina',
    description: es
      ? 'Valores diarios de compra y venta del dólar blue (mercado informal) y del dólar oficial en Argentina, publicados por Bluelytics. Un registro por día y tipo de cambio, en pesos argentinos por dólar estadounidense.'
      : 'Daily buy and sell values of the blue (informal market) and official US dollar in Argentina, published by Bluelytics. One record per day and rate type, in Argentine pesos per US dollar.',
    url: absoluteUrl(ROUTES.history[locale]),
    temporalCoverage: `${coverage.from}/${coverage.to}`,
    variableMeasured: ['value_buy', 'value_sell'],
    isAccessibleForFree: true,
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    creator: { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url },
    publisher: { '@id': ORG_ID },
    distribution: [
      { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${API_ORIGIN}/v2/evolution.json` },
      { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${API_ORIGIN}/v2/evolution.csv` },
    ],
  };
}

/** Serialised `@graph`, safe inside a `<script>` element. */
export function jsonLd(nodes: readonly Node[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');
}

/** Absolute URL of the Open Graph card on the media host, versioned so link previews refresh. */
export function ogImageUrl(mediaOrigin: string, version: string | null): string {
  const url = `${mediaOrigin.replace(/\/$/, '')}/${OG_IMAGE_KEY}`;
  return version === null ? url : `${url}?v=${version}`;
}
