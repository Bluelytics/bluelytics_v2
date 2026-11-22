/**
 * Why a Buffer call failed. GraphQL system errors keep Buffer's `extensions.code`
 * (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `UNEXPECTED`, `RATE_LIMIT_EXCEEDED`, …); the others are
 * added by this client.
 */
export type BufferErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'UNEXPECTED'
  | 'RATE_LIMIT_EXCEEDED'
  /** `errors[]` entry without `extensions.code`, or a code this list does not name. */
  | 'GRAPHQL_ERROR'
  /** A typed member of a mutation's result union (`... on MutationError`); see `typename`. */
  | 'MUTATION_ERROR'
  /** Non-2xx status without a GraphQL error body. */
  | 'HTTP_ERROR'
  /** `fetch` rejected (DNS, TLS, timeout). The request may or may not have reached Buffer. */
  | 'NETWORK'
  /** 2xx response that is not the expected GraphQL shape. */
  | 'INVALID_RESPONSE';

const KNOWN_CODES: ReadonlySet<string> = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'UNEXPECTED', 'RATE_LIMIT_EXCEEDED']);

export function graphqlErrorCode(code: unknown): BufferErrorCode {
  return typeof code === 'string' && KNOWN_CODES.has(code) ? (code as BufferErrorCode) : 'GRAPHQL_ERROR';
}

export interface BufferErrorDetails {
  status?: number;
  /** From `Retry-After` (seconds or HTTP date), when Buffer sent one. */
  retryAfterMs?: number;
  /** `__typename` of the mutation error member, e.g. `LimitReachedError`. */
  typename?: string;
}

export class BufferError extends Error {
  override readonly name = 'BufferError';
  readonly code: BufferErrorCode;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly typename: string | undefined;

  constructor(code: BufferErrorCode, message: string, details: BufferErrorDetails = {}) {
    super(message);
    this.code = code;
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
    this.typename = details.typename;
  }

  /**
   * True when the same request may succeed later. Buffer has no idempotency keys: before retrying a
   * `createPost` that failed with `NETWORK` or `UNEXPECTED`, check whether the post exists.
   */
  get retryable(): boolean {
    return (
      this.code === 'RATE_LIMIT_EXCEEDED' ||
      this.code === 'NETWORK' ||
      this.code === 'UNEXPECTED' ||
      (this.code === 'HTTP_ERROR' && (this.status ?? 0) >= 500)
    );
  }
}
