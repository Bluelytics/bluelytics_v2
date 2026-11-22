/** Why a page could not be turned into a quote. Parsers throw it instead of returning a guess. */
export type ParseErrorCode =
  | 'anchor' // an expected label, element or key is missing
  | 'number' // a value is not in the source's declared number format
  | 'timestamp' // the source's own date is malformed
  | 'inverted' // sell below buy: labels swapped or values misread
  | 'mismatch' // two copies of the quote in one page disagree
  | 'stale' // the source's date is too old or in the future
  | 'json' // not JSON, or not the expected shape
  | 'guard'; // currency table fails a sanity guard

export type FetchErrorCode = 'timeout' | 'http' | 'network';

export class ParseError extends Error {
  override readonly name = 'ParseError';
  readonly code: ParseErrorCode;

  constructor(code: ParseErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class FetchError extends Error {
  override readonly name = 'FetchError';
  readonly code: FetchErrorCode;

  constructor(code: FetchErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const MAX_ERROR_LENGTH = 300;

/** One log-friendly line for `observations.error`: `parse.anchor: …`, `fetch.timeout: …`, `error: …`. */
export function describeError(error: unknown): string {
  const prefix =
    error instanceof ParseError ? `parse.${error.code}` : error instanceof FetchError ? `fetch.${error.code}` : 'error';
  const message = error instanceof Error ? error.message : String(error);
  const line = `${prefix}: ${message}`.replace(/\s+/g, ' ').trim();
  return line.length <= MAX_ERROR_LENGTH ? line : `${line.slice(0, MAX_ERROR_LENGTH - 3)}...`;
}
