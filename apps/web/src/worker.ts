/**
 * Worker entry (docs/research/astro-seo.md §1.4, §3.4). `Site` renders Astro and is the only cached
 * entrypoint (wrangler.jsonc `exports`); the default export is the uncached gateway that strips
 * tracking parameters and adds host-dependent headers such as `X-Robots-Tag: noindex`.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { cacheableRequest, finalizeResponse, legacyResponse } from './lib/gateway.ts';

export class Site extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return handle(request, this.env, this.ctx);
  }
}

export default {
  async fetch(request, env, ctx) {
    const response = legacyResponse(request) ?? (await ctx.exports.Site.fetch(cacheableRequest(request)));
    return finalizeResponse(request, response, env.PRODUCTION_HOSTNAME);
  },
} satisfies ExportedHandler<Env>;
