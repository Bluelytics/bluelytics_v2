/**
 * Worker entry (docs/research/astro-seo.md §1.4, §3.4). `Site` renders Astro and is the only cached
 * entrypoint (wrangler.jsonc `exports`); the default export is the uncached gateway that strips
 * tracking parameters and adds host-dependent headers such as `X-Robots-Tag: noindex`.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { cacheableRequest, finalizeResponse, isMcpRequest, legacyResponse } from './lib/gateway.ts';
import { handlePushDevices, isPushDevicesRequest } from './lib/push-devices.ts';

export class Site extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return handle(request, this.env, this.ctx);
  }
}

export default {
  async fetch(request, env, ctx) {
    // Straight through: the MCP server's answers are not pages (no caching, its own headers).
    if (isMcpRequest(request)) return env.MCP.fetch(request);
    // The iOS app's alert registrations: data, not pages (lib/push-devices.ts).
    if (isPushDevicesRequest(request)) {
      const response = await handlePushDevices(request, { db: env.DB, limiter: env.PUSH_LIMIT, now: () => new Date().toISOString() });
      return finalizeResponse(request, response, env.PRODUCTION_HOSTNAME);
    }
    const response = legacyResponse(request) ?? (await ctx.exports.Site.fetch(cacheableRequest(request)));
    return finalizeResponse(request, response, env.PRODUCTION_HOSTNAME);
  },
} satisfies ExportedHandler<Env>;
