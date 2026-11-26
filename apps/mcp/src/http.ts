/**
 * MCP over Streamable HTTP, the stateless way: every `POST` carries JSON-RPC and is answered with JSON
 * in the same response. There is no event stream (the server never sends a message of its own) and
 * no session: `GET` and `DELETE` on the endpoint are refused, and an `Mcp-Session-Id` a client
 * sends anyway is ignored.
 */
import type { JsonObject, JsonRpcResponse, Server } from './protocol.ts';
import { ERROR_CODE, failure, isSupportedProtocolVersion, PROTOCOL_VERSIONS } from './protocol.ts';

/** Paths that speak MCP. `/` too, so the bare host works as the server URL. */
export const ENDPOINTS: ReadonlySet<string> = new Set(['/mcp', '/']);

/** Far above any real message of this server's tools; keeps a hostile body from being buffered. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Messages in one batch (batches exist in the 2025-03-26 revision only). */
export const MAX_BATCH = 20;

/** Transport-level refusals use this code, like the reference implementation. */
const TRANSPORT_ERROR = -32000;

const BASE_HEADERS: Record<string, string> = {
  // Any website may connect a browser-based client: the data is public and there are no credentials.
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
};

const PREFLIGHT_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Max-Age': '86400',
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json', ...extra } });
}

function refuse(status: number, message: string, extra: Record<string, string> = {}): Response {
  return json(status, failure(null, TRANSPORT_ERROR, message), extra);
}

/** Whether an `Accept` header allows a JSON answer. A missing header allows anything. */
function acceptsJson(accept: string | null): boolean {
  if (accept === null || accept.trim() === '') return true;
  return accept.split(',').some((part) => {
    const type = part.split(';')[0]?.trim().toLowerCase();
    return type === 'application/json' || type === 'application/*' || type === '*/*';
  });
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return text.length > MAX_BODY_BYTES ? null : text;
}

export interface HandlerOptions<Context> {
  server: Server<Context>;
  /** What `GET /` answers: a description of the server for whoever opens the URL in a browser. */
  about: JsonObject;
}

export interface Handler<Context> {
  fetch(request: Request, context: Context): Promise<Response>;
}

export function createHandler<Context>(options: HandlerOptions<Context>): Handler<Context> {
  const { server } = options;

  async function post(request: Request, context: Context): Promise<Response> {
    const contentType = (request.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') return refuse(415, 'Unsupported Media Type: Content-Type must be application/json');
    if (!acceptsJson(request.headers.get('Accept'))) return refuse(406, 'Not Acceptable: the client must accept application/json');
    const version = request.headers.get('MCP-Protocol-Version');
    if (version !== null && !isSupportedProtocolVersion(version)) {
      return refuse(400, `Bad Request: Unsupported protocol version: ${version} (supported versions: ${PROTOCOL_VERSIONS.join(', ')})`);
    }

    const body = await readBody(request);
    if (body === null) return refuse(413, `Payload Too Large: at most ${MAX_BODY_BYTES} bytes`);
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      return json(400, failure(null, ERROR_CODE.parse, 'Parse error: the body is not JSON'));
    }

    if (Array.isArray(message)) {
      if (message.length === 0 || message.length > MAX_BATCH) {
        return json(400, failure(null, ERROR_CODE.invalidRequest, `A batch holds 1 to ${MAX_BATCH} messages`));
      }
      const answers = await Promise.all(message.map((entry) => server.handle(entry, context)));
      const responses = answers.filter((answer): answer is JsonRpcResponse => answer !== null);
      // Only notifications and responses: accepted, nothing to say.
      return responses.length === 0 ? new Response(null, { status: 202, headers: BASE_HEADERS }) : json(200, responses);
    }

    const response = await server.handle(message, context);
    if (response === null) return new Response(null, { status: 202, headers: BASE_HEADERS });
    // A message without a usable id is the transport's problem; an error for a request is a normal answer.
    return json(response.id === null ? 400 : 200, response);
  }

  return {
    async fetch(request, context) {
      const url = new URL(request.url);
      const { method } = request;
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: PREFLIGHT_HEADERS });
      if (!ENDPOINTS.has(url.pathname)) return json(404, { error: 'Not found', endpoint: '/mcp' });
      if (method === 'POST') return post(request, context);
      // Opening the bare host in a browser explains what this is. On `/mcp` a GET asks for an event
      // stream, which this server does not offer.
      if (url.pathname === '/' && (method === 'GET' || method === 'HEAD')) {
        return method === 'HEAD' ? new Response(null, { status: 200, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' } }) : json(200, options.about);
      }
      return refuse(405, 'Method not allowed.', { Allow: 'POST, OPTIONS' });
    },
  };
}
