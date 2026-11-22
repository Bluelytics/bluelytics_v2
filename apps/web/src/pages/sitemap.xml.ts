import type { APIRoute } from 'astro';
import { applyCache, SITEMAP } from '../lib/cache.ts';
import { loadSnapshot } from '../lib/data.ts';
import { sitemapIndex } from '../lib/sitemap.ts';
import { xmlResponse } from '../lib/responses.ts';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const { updatedAt } = await loadSnapshot();
  return xmlResponse(sitemapIndex(updatedAt ?? undefined), applyCache(context, SITEMAP));
};
