import { ParseError } from './errors.ts';
import type { Quote } from './types.ts';

/** A two-sided quote; sell below buy means swapped labels or a misread value, never a market. */
export function twoSidedQuote(buyCents: number, sellCents: number, sourceTs: string | null): Quote {
  if (sellCents < buyCents) throw new ParseError('inverted', `sell ${sellCents} is below buy ${buyCents} (centavos)`);
  return { buyCents, sellCents, sourceTs };
}
