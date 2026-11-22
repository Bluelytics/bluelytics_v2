import { BODY, CONTENT_TYPE, CORS, etag, prettyJson } from '@bluelytics/core';

/** `Cache-Control` values (ARCHITECTURE §6). */
export const CACHE_CONTROL = {
  live: 'public, max-age=30',
  slow: 'public, max-age=300',
  pastDay: 'public, max-age=86400',
  short: 'public, max-age=60',
  none: 'no-store',
} as const;

/** What every response of one request shares. */
export interface RequestMeta {
  /** `HEAD`: same status and headers as `GET`, no body. */
  readonly head: boolean;
  readonly ifNoneMatch: string | null;
  /** Answer on the shadow hostname: add `X-Robots-Tag: noindex`. */
  readonly noindex: boolean;
  /** `?pretty` present: JSON bodies are indented (legacy echo behaviour, error bodies included). */
  readonly pretty: boolean;
}

export interface Reply {
  readonly status: number;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly etag: string | null;
  readonly body: string | Uint8Array;
}

/** `If-None-Match` (weak comparison, as RFC 9110 requires for this header) against a strong etag. */
export function etagMatches(ifNoneMatch: string, current: string): boolean {
  if (ifNoneMatch.trim() === '*') return true;
  for (const candidate of ifNoneMatch.split(',')) {
    const tag = candidate.trim();
    if (tag === current || (tag.startsWith('W/') && tag.slice(2) === current)) return true;
  }
  return false;
}

/**
 * The etag of a byte-different variant (`?days`, `?pretty`, `?callback`) of a body with etag `base`:
 * `suffix` (e.g. `-r5-p`) goes inside the quotes.
 */
export function variantEtag(base: string, suffix: string): string {
  return `${base.slice(0, -1)}${suffix}"`;
}

/** Serialises a reply: CORS as legacy, the added caching headers, `304` and `HEAD` handling. */
export function send(info: RequestMeta, reply: Reply): Response {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', CORS.allowOrigin);
  headers.set('Vary', CORS.vary);
  headers.set('Cache-Control', reply.cacheControl);
  if (reply.etag !== null) headers.set('ETag', reply.etag);
  if (info.noindex) headers.set('X-Robots-Tag', 'noindex');
  if (reply.status === 200 && reply.etag !== null && info.ifNoneMatch !== null && etagMatches(info.ifNoneMatch, reply.etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers.set('Content-Type', reply.contentType);
  if (!info.head) return new Response(reply.body, { status: reply.status, headers });
  // What GET would send, as RFC 9110 allows for HEAD (the runtime only adds it when a body is present).
  const length = typeof reply.body === 'string' ? new TextEncoder().encode(reply.body).byteLength : reply.body.byteLength;
  headers.set('Content-Length', String(length));
  return new Response(null, { status: reply.status, headers });
}

/** `OPTIONS` on any path: legacy echo preflight answer. */
export function preflight(request: Request, noindex: boolean): Response {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', CORS.allowOrigin);
  headers.set('Access-Control-Allow-Methods', CORS.allowMethods);
  for (const vary of CORS.preflightVary) headers.append('Vary', vary);
  const requested = request.headers.get('Access-Control-Request-Headers');
  if (requested) headers.set('Access-Control-Allow-Headers', requested);
  if (noindex) headers.set('X-Robots-Tag', 'noindex');
  return new Response(null, { status: 204, headers });
}

type FixedBody = keyof typeof BODY;

let fixedEtags: Promise<Record<FixedBody, string>> | undefined;

// Computed on first use: module scope should not start async work in a Worker.
function fixedEtag(name: FixedBody): Promise<string> {
  fixedEtags ??= Promise.all(Object.entries(BODY).map(async ([key, body]) => [key, await etag(body)] as const)).then(
    (pairs) => Object.fromEntries(pairs) as Record<FixedBody, string>,
  );
  return fixedEtags.then((tags) => tags[name]);
}

/** A fixed JSON body (`BODY.*`), indented under `?pretty`. */
export async function fixedJson(info: RequestMeta, status: number, name: FixedBody, cacheControl: string): Promise<Response> {
  const tag = await fixedEtag(name);
  return send(info, {
    status,
    contentType: CONTENT_TYPE.json,
    cacheControl,
    etag: info.pretty ? variantEtag(tag, '-p') : tag,
    body: info.pretty ? prettyJson(BODY[name]) : BODY[name],
  });
}

/** `GET /`: liveness, `OK` as plain text, never touches D1. */
export async function root(info: RequestMeta): Promise<Response> {
  return send(info, { status: 200, contentType: CONTENT_TYPE.text, cacheControl: CACHE_CONTROL.short, etag: await fixedEtag('root'), body: BODY.root });
}

/** Last resort: legacy panic body, never cached. */
export function internalError(info: RequestMeta): Response {
  return send(info, { status: 500, contentType: CONTENT_TYPE.json, cacheControl: CACHE_CONTROL.none, etag: null, body: BODY.internalServerError });
}
