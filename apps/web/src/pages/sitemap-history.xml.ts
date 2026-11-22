import type { APIRoute } from 'astro';
import { applyCache, SITEMAP } from '../lib/cache.ts';
import { loadFullSeries, loadSnapshot } from '../lib/data.ts';
import { historyEntries, urlset } from '../lib/sitemap.ts';
import { xmlResponse } from '../lib/responses.ts';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const [series, { updatedAt }] = await Promise.all([loadFullSeries(), loadSnapshot()]);
  const days = series.days.filter((_, i) => series.blue[i] != null || series.oficial[i] != null);
  return xmlResponse(urlset(historyEntries(days, updatedAt)), applyCache(context, SITEMAP));
};
