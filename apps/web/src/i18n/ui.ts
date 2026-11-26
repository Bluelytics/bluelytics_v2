/** Shared interface copy. Page-specific text lives with each view. */
import type { Locale, RouteId } from './routes.ts';

export interface UiStrings {
  nav: Record<RouteId, string>;
  skip: string;
  menuLabel: string;
  languageName: string;
  otherLanguage: string;
  buy: string;
  sell: string;
  average: string;
  blue: string;
  oficial: string;
  euroBlue: string;
  euroOficial: string;
  gap: string;
  updated: string;
  vsPrevious: (day: string) => string;
  noData: string;
  perDollar: string;
  footer: {
    tagline: string;
    disclaimer: string;
    sources: string;
    madeBy: string;
    license: string;
    data: string;
    follow: string;
    more: string;
  };
  chart: {
    ranges: Record<'1m' | '3m' | '6m' | '1y' | '5y' | 'max', string>;
    rangeLabel: string;
    loading: string;
  };
  breadcrumbHome: string;
}

export const UI: Record<Locale, UiStrings> = {
  es: {
    nav: {
      home: 'Dólar blue',
      official: 'Oficial',
      euro: 'Euro blue',
      gap: 'Brecha',
      calculator: 'Calculadora',
      history: 'Histórico',
      api: 'API',
      mcp: 'MCP',
      about: 'Acerca de',
      status: 'Estado',
    },
    skip: 'Ir al contenido',
    menuLabel: 'Secciones',
    languageName: 'Español',
    otherLanguage: 'English',
    buy: 'Compra',
    sell: 'Venta',
    average: 'Promedio',
    blue: 'Dólar blue',
    oficial: 'Dólar oficial',
    euroBlue: 'Euro blue',
    euroOficial: 'Euro oficial',
    gap: 'Brecha',
    updated: 'Actualizado',
    vsPrevious: (day) => `vs. cierre del ${day}`,
    noData: 'Sin datos',
    perDollar: 'por dólar',
    footer: {
      tagline: 'Cotización del dólar blue y oficial en Argentina, actualizada cada 5 minutos.',
      disclaimer:
        'Bluelytics publica valores tomados de sitios públicos; no compra ni vende divisas y no tiene relación con ninguna casa de cambio. Información de referencia, no es asesoramiento financiero.',
      sources: 'Cómo se calcula',
      madeBy: 'Hecho por',
      license: 'Código abierto (AGPL-3.0)',
      data: 'Datos',
      follow: 'Seguinos',
      more: 'Más',
    },
    chart: {
      ranges: { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1A', '5y': '5A', max: 'Todo' },
      rangeLabel: 'Período',
      loading: 'Cargando…',
    },
    breadcrumbHome: 'Inicio',
  },
  en: {
    nav: {
      home: 'Blue dollar',
      official: 'Official',
      euro: 'Blue euro',
      gap: 'Gap',
      calculator: 'Calculator',
      history: 'History',
      api: 'API',
      mcp: 'MCP',
      about: 'About',
      status: 'Status',
    },
    skip: 'Skip to content',
    menuLabel: 'Sections',
    languageName: 'English',
    otherLanguage: 'Español',
    buy: 'Buy',
    sell: 'Sell',
    average: 'Average',
    blue: 'Blue dollar',
    oficial: 'Official dollar',
    euroBlue: 'Blue euro',
    euroOficial: 'Official euro',
    gap: 'Gap',
    updated: 'Updated',
    vsPrevious: (day) => `vs. ${day} close`,
    noData: 'No data',
    perDollar: 'per dollar',
    footer: {
      tagline: 'Blue and official US dollar rates in Argentina, updated every 5 minutes.',
      disclaimer:
        'Bluelytics publishes values collected from public websites; it does not buy or sell currency and has no ties to any exchange house. Reference information, not financial advice.',
      sources: 'How it is computed',
      madeBy: 'Made by',
      license: 'Open source (AGPL-3.0)',
      data: 'Data',
      follow: 'Follow',
      more: 'More',
    },
    chart: {
      ranges: { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', '5y': '5Y', max: 'All' },
      rangeLabel: 'Range',
      loading: 'Loading…',
    },
    breadcrumbHome: 'Home',
  },
};

/** The Spanish or English variant of a piece of page copy. */
export function pick<T>(locale: Locale, es: T, en: T): T {
  return locale === 'es' ? es : en;
}
