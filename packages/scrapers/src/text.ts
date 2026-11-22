import { ParseError } from './errors.ts';

/** "Dólar" as the pages write it: precomposed ó, o + combining acute, or a plain o. */
export const DOLAR = 'D(?:ó|ó|o)lar';

/** The `length` characters starting at the first `anchor` (no DOM: pages are up to 760 KB). */
export function windowAfter(text: string, anchor: string, length: number, from = 0): string {
  const start = text.indexOf(anchor, from);
  if (start < 0) throw new ParseError('anchor', `not found: ${anchor}`);
  return text.slice(start, start + length);
}

/** `re.exec(text)` with every capture group required, or `ParseError('anchor', what)`. */
export function matchGroups(re: RegExp, text: string, what: string): { groups: string[]; index: number; end: number } {
  const match = re.exec(text);
  if (!match) throw new ParseError('anchor', `${what} not found`);
  const groups = match.slice(1);
  if (groups.some((group) => group === undefined)) throw new ParseError('anchor', `${what}: incomplete match`);
  return { groups: groups as string[], index: match.index, end: match.index + match[0].length };
}

/** `JSON.parse` that throws `ParseError('json')`. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ParseError('json', `response is not JSON: ${JSON.stringify(text.slice(0, 80))}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
