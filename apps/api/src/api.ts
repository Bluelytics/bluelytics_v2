import {
  artDate,
  BODY,
  CONTENT_TYPE,
  historicalLookupDay,
  isValidDay,
  isValidJsonpCallback,
  parseDaysParam,
  prettyJson,
  sliceEvolutionCsv,
  sliceEvolutionJson,
  wrapJsonp,
} from '@bluelytics/core';
import type { Env, ExecutionContextLike } from './env.ts';
import { HistoricalCache } from './historical-cache.ts';
import { prettyBody, RenderedCache } from './rendered-cache.ts';
import type { RequestMeta } from './responses.ts';
import { CACHE_CONTROL, fixedJson, internalError, preflight, root, send, variantEtag } from './responses.ts';
import type { Route } from './routes.ts';
import { ROUTES, splitUrl } from './routes.ts';

export interface ApiOptions {
  /** Clock in epoch milliseconds (tests drive the cache lifetimes with it). */
  now?: () => number;
}

export interface Api {
  fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response>;
}

type RenderedRoute = Extract<Route, { kind: 'rendered' }>;

/** The public API: one instance per isolate holds the in-memory caches. */
export function createApi(options: ApiOptions = {}): Api {
  const now = options.now ?? Date.now;
  const rendered = new RenderedCache(now);
  const historical = new HistoricalCache(now);

  async function serveRendered(
    route: RenderedRoute,
    meta: RequestMeta,
    params: URLSearchParams | null,
    env: Env,
    ctx: ExecutionContextLike,
  ): Promise<Response> {
    const callback = route.jsonp ? (params?.get('callback') ?? '') : '';
    if (callback !== '' && !isValidJsonpCallback(callback)) return fixedJson(meta, 400, 'badRequest', CACHE_CONTROL.none);

    const cached = await rendered.get(env.DB, route.key, ctx);
    if (cached === null) return internalError(meta);

    let text: string | null = null;
    let suffix = '';
    if (route.days !== null) {
      const limit = parseDaysParam(params?.get('days'));
      if (limit.kind === 'none') {
        text = route.days === 'json' ? BODY.null : BODY.csvHeader;
        suffix = '-r0';
      } else if (limit.kind === 'rows') {
        const sliced = route.days === 'json' ? sliceEvolutionJson(cached.body, limit.rows) : sliceEvolutionCsv(cached.body, limit.rows);
        if (sliced !== cached.body) {
          text = sliced;
          suffix = `-r${limit.rows}`;
        }
      }
    }
    const json = cached.contentType === CONTENT_TYPE.json;
    if (meta.pretty && json) {
      text = text === null ? prettyBody(cached) : prettyJson(text);
      suffix += '-p';
    }
    let contentType = cached.contentType;
    if (callback !== '') {
      text = wrapJsonp(callback, text ?? cached.body);
      suffix += `-j${callback}`;
      contentType = CONTENT_TYPE.javascript;
    }
    return send(meta, {
      status: 200,
      contentType,
      cacheControl: route.cacheControl,
      etag: suffix === '' ? cached.etag : variantEtag(cached.etag, suffix),
      body: text ?? cached.bytes,
    });
  }

  async function serveHistorical(meta: RequestMeta, params: URLSearchParams | null, env: Env): Promise<Response> {
    const day = params?.get('day') ?? '';
    if (!isValidDay(day)) return fixedJson(meta, 404, 'badDay', CACHE_CONTROL.short);
    const lookupDay = historicalLookupDay(day);
    if (lookupDay === null) return fixedJson(meta, 404, 'dayNotFound', CACHE_CONTROL.short);
    const entry = await historical.get(env.DB, lookupDay, artDate(new Date(now()).toISOString()));
    if (entry === null) return internalError(meta);
    return send(meta, {
      status: entry.status,
      contentType: CONTENT_TYPE.json,
      cacheControl: entry.final ? CACHE_CONTROL.pastDay : CACHE_CONTROL.short,
      etag: meta.pretty ? variantEtag(entry.etag, '-p') : entry.etag,
      body: meta.pretty ? prettyJson(entry.body) : entry.body,
    });
  }

  async function handle(request: Request, env: Env, ctx: ExecutionContextLike, meta: RequestMeta, path: string, params: URLSearchParams | null): Promise<Response> {
    const route = ROUTES.get(path);
    if (route === undefined) return fixedJson(meta, 404, 'notFound', CACHE_CONTROL.short);
    if (request.method !== 'GET' && request.method !== 'HEAD') return fixedJson(meta, 405, 'methodNotAllowed', CACHE_CONTROL.none);
    switch (route.kind) {
      case 'root':
        return root(meta);
      case 'historical':
        return serveHistorical(meta, params, env);
      case 'rendered':
        return serveRendered(route, meta, params, env, ctx);
    }
  }

  return {
    async fetch(request, env, ctx) {
      const { host, path, query } = splitUrl(request.url);
      const noindex = env.SHADOW_HOSTNAME !== undefined && host === env.SHADOW_HOSTNAME;
      if (request.method === 'OPTIONS') return preflight(request, noindex);
      const params = query === null ? null : new URLSearchParams(query);
      const meta: RequestMeta = {
        head: request.method === 'HEAD',
        ifNoneMatch: request.headers.get('If-None-Match'),
        noindex,
        pretty: params?.has('pretty') ?? false,
      };
      try {
        return await handle(request, env, ctx, meta, path, params);
      } catch (error) {
        console.error('api: unhandled error', error);
        return internalError(meta);
      }
    },
  };
}
