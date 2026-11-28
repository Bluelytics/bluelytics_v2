// The other dollar rates of the home page (MEP, CCL, cripto, tarjeta, mayorista) as data, in hundredths
// of a peso. Read by the mobile app (apps/android and apps/ios); not part of the public API.
import type { APIRoute } from 'astro';
import { applyCache, SLOW } from '../../lib/cache.ts';
import { loadExtras } from '../../lib/data.ts';
import { otherRates } from '../../lib/extras.ts';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const rates = otherRates(await loadExtras()).map((rate) => ({ code: rate.code, buy: rate.buyCents, sell: rate.sellCents }));
  return new Response(JSON.stringify({ rates }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': applyCache(context, SLOW) } });
};
