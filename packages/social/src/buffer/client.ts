import { parseRetryAfter } from '../retry-after.ts';
import { BufferError, graphqlErrorCode } from './errors.ts';
import { CREATE_POST, DELETE_POST, GET_POST, LIST_CHANNELS, LIST_ORGANIZATIONS } from './operations.ts';
import { buildCreatePostInput } from './post-input.ts';
import type { BufferChannel, BufferOrganization, BufferPost, CreateImagePostInput } from './types.ts';

export const BUFFER_ENDPOINT = 'https://api.buffer.com';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface BufferClientOptions {
  /** Personal API key (secret `BUFFER_API_KEY`). */
  apiKey: string;
  fetch?: FetchLike;
  endpoint?: string;
  /** Per-request timeout. Default 15 s. */
  timeoutMs?: number;
  /** Clock for HTTP-date `Retry-After` values. */
  now?: () => number;
}

interface GraphQLErrorJson {
  message?: unknown;
  extensions?: { code?: unknown };
}

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A typed member of a mutation result union: success when `__typename` is `successType`. */
function unwrapPayload(operation: string, payload: unknown, successType: string): Json {
  if (!isRecord(payload) || typeof payload.__typename !== 'string') {
    throw new BufferError('INVALID_RESPONSE', `Buffer ${operation}: result has no __typename`);
  }
  if (payload.__typename === successType) return payload;
  const message = typeof payload.message === 'string' ? payload.message : 'no message';
  throw new BufferError('MUTATION_ERROR', `Buffer ${operation}: ${payload.__typename}: ${message}`, {
    typename: payload.__typename,
  });
}

function requireRecord(operation: string, value: unknown, what: string): Json {
  if (!isRecord(value)) throw new BufferError('INVALID_RESPONSE', `Buffer ${operation}: missing ${what}`);
  return value;
}

function requireArray(operation: string, value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new BufferError('INVALID_RESPONSE', `Buffer ${operation}: missing ${what}`);
  return value;
}

function asPost(operation: string, value: unknown): BufferPost {
  const post = requireRecord(operation, value, 'post');
  if (typeof post.id !== 'string' || typeof post.status !== 'string') {
    throw new BufferError('INVALID_RESPONSE', `Buffer ${operation}: post without id/status`);
  }
  return post as unknown as BufferPost;
}

/**
 * Minimal client for Buffer's GraphQL API (`docs/research/buffer-api.md`). Never retries on its
 * own: Buffer has no idempotency keys, so the caller decides (see {@link BufferError.retryable}).
 */
export class BufferClient {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #now: () => number;

  constructor(options: BufferClientOptions) {
    if (!options.apiKey) throw new TypeError('BufferClient: apiKey is required');
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#endpoint = options.endpoint ?? BUFFER_ENDPOINT;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#now = options.now ?? Date.now;
  }

  async listOrganizations(): Promise<BufferOrganization[]> {
    const data = await this.#request('ListOrganizations', LIST_ORGANIZATIONS, {});
    const account = requireRecord('ListOrganizations', data.account, 'account');
    return requireArray('ListOrganizations', account.organizations, 'organizations') as BufferOrganization[];
  }

  async listChannels(organizationId: string): Promise<BufferChannel[]> {
    const data = await this.#request('ListChannels', LIST_CHANNELS, { organizationId });
    return requireArray('ListChannels', data.channels, 'channels') as BufferChannel[];
  }

  /** Creates (and by default publishes now) one image post. Throws {@link BufferError} on any failure. */
  async createImagePost(post: CreateImagePostInput): Promise<BufferPost> {
    const data = await this.#request('CreatePost', CREATE_POST, { input: buildCreatePostInput(post) });
    const success = unwrapPayload('CreatePost', data.createPost, 'PostActionSuccess');
    return asPost('CreatePost', success.post);
  }

  async getPost(id: string): Promise<BufferPost> {
    const data = await this.#request('GetPost', GET_POST, { id });
    return asPost('GetPost', data.post);
  }

  /** Returns the deleted post's id. */
  async deletePost(id: string): Promise<string> {
    const data = await this.#request('DeletePost', DELETE_POST, { id });
    const success = unwrapPayload('DeletePost', data.deletePost, 'DeletePostSuccess');
    if (typeof success.id !== 'string') throw new BufferError('INVALID_RESPONSE', 'Buffer DeletePost: missing id');
    return success.id;
  }

  async #request(operation: string, query: string, variables: Json): Promise<Json> {
    let res: Response;
    try {
      res = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({ query, variables, operationName: operation }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      throw new BufferError('NETWORK', `Buffer ${operation}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const status = res.status;
    const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'), this.#now());
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }

    const errors = isRecord(body) && Array.isArray(body.errors) ? (body.errors as GraphQLErrorJson[]) : [];
    const details = retryAfterMs === undefined ? { status } : { status, retryAfterMs };
    if (status === 429) {
      throw new BufferError('RATE_LIMIT_EXCEEDED', `Buffer ${operation}: rate limited${describe(errors)}`, details);
    }
    if (status === 401) throw new BufferError('UNAUTHORIZED', `Buffer ${operation}: HTTP 401${describe(errors)}`, details);
    if (status === 403) throw new BufferError('FORBIDDEN', `Buffer ${operation}: HTTP 403${describe(errors)}`, details);
    if (errors.length > 0) {
      const code = graphqlErrorCode(errors[0]?.extensions?.code);
      throw new BufferError(code, `Buffer ${operation}:${describe(errors)}`, details);
    }
    if (!res.ok) {
      throw new BufferError('HTTP_ERROR', `Buffer ${operation}: HTTP ${status}: ${text.slice(0, 200)}`, details);
    }
    if (!isRecord(body) || !isRecord(body.data)) {
      throw new BufferError('INVALID_RESPONSE', `Buffer ${operation}: response has no data`, details);
    }
    return body.data;
  }
}

function describe(errors: readonly GraphQLErrorJson[]): string {
  const parts = errors.map((e) => {
    const code = typeof e.extensions?.code === 'string' ? ` [${e.extensions.code}]` : '';
    return `${typeof e.message === 'string' ? e.message : 'error'}${code}`;
  });
  return parts.length ? ` ${parts.join('; ')}` : '';
}
