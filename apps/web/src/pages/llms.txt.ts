import type { APIRoute } from 'astro';
import { API_ORIGIN, MCP_URL } from '../config.ts';
import { absoluteUrl, ROUTES } from '../i18n/routes.ts';

export const prerender = true;

const body = `# Bluelytics

> Argentine blue (informal market) and official US dollar exchange rates, published every 5 minutes on weekdays (07:00-20:00 America/Argentina/Buenos_Aires), with daily history since 2011 and a free JSON API. Values are in Argentine pesos per US dollar.

The published blue value is the median of several public sources (Ámbito, DolarHoy, El Cronista, Infodolar). Each historical day is the last value published that day.

## API (no authentication, CORS *)

- [Latest values](${API_ORIGIN}/v2/latest): oficial, blue, oficial_euro, blue_euro (value_buy, value_avg, value_sell) and last_update
- [One day](${API_ORIGIN}/v2/historical?day=2026-11-20): ?day=YYYY-MM-DD; weekends answer the previous Friday
- [Full history, JSON](${API_ORIGIN}/v2/evolution.json): items {date, source: Oficial|Blue, value_sell, value_buy}, newest first; ?days=N limits rows
- [Full history, CSV](${API_ORIGIN}/v2/evolution.csv): columns day,type,value_buy,value_sell
- [Currencies](${API_ORIGIN}/data/json/currency.json): {code, name, value} units per US dollar

## MCP server (no authentication)

Model Context Protocol server at ${MCP_URL} (stateless Streamable HTTP, JSON responses, read-only). Tools:

- get_current_rates: blue and official buy/sell/average, change since the previous close, gap, euros, MEP/CCL/crypto/card/wholesale
- get_rates_on_date {date}: one day since 2011-01-03 (weekends answer the previous Friday)
- get_rate_history {from, to?, granularity?}: a period with summary; daily up to 400 days or monthly
- convert_currency {amount, currency?, direction?}: any of ~160 currencies to pesos or back, blue and official

- [MCP documentation and setup for Claude, ChatGPT and Gemini](${absoluteUrl(ROUTES.mcp.en)})

## Pages

- [Blue dollar today (Spanish)](${absoluteUrl(ROUTES.home.es)}), [English](${absoluteUrl(ROUTES.home.en)})
- [Official dollar](${absoluteUrl(ROUTES.official.es)})
- [Exchange gap](${absoluteUrl(ROUTES.gap.es)})
- [History by year, month and day](${absoluteUrl(ROUTES.history.es)})
- [API documentation](${absoluteUrl(ROUTES.api.en)})
- [How values are computed](${absoluteUrl(ROUTES.about.en)})
`;

export const GET: APIRoute = () => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
