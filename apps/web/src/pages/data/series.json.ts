// Every daily sell close, for the chart enhancer's range presets (src/client/chart.ts).
import type { APIRoute } from 'astro';
import { applyCache, SLOW } from '../../lib/cache.ts';
import { loadFullSeries } from '../../lib/data.ts';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const body = JSON.stringify(await loadFullSeries());
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': applyCache(context, SLOW) } });
};
