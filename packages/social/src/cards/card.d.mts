// Types of card.mjs. card.mjs (+ fonts.mjs) is plain ESM so the design can be developed and
// rendered outside TypeScript; any replacement must keep these exports and semantics.
import type {
  CardData,
  CardFacts,
  CardKind,
  CardSize,
  FormatDateRangeOptions,
  FormatPercentOptions,
  FormatTimestampOptions,
} from './types.ts';

/** One self-contained HTML document of exactly the canvas size: no scripts, no external URLs. */
export function renderCardHtml(kind: CardKind, size: CardSize, data: CardData): string;
export function computeCardFacts(data: CardData): CardFacts;
/** One Spanish description of the card for screen readers, at most 420 characters, plain text. */
export function cardAltText(kind: CardKind, data: CardData): string;

// Formatters (es-AR). Card typography uses U+2212 minus and no-break spaces; `plainText` turns
// them into ASCII hyphens and ordinary spaces for captions.
export function plainText(s: string): string;
/** 1675 → "1.675". */
export function formatNumber(n: number): string;
/** 1675 → "$ 1.675". */
export function formatPesos(n: number): string;
/** 15 → "+$ 15", −25 → "−$ 25", 0 → "$ 0". */
export function formatSignedPesos(n: number): string;
/** 0.009 → "+0,90%". */
export function formatPercent(ratio: number, options?: FormatPercentOptions): string;
/** Brecha: one decimal, sign only when negative ("4,6%"). */
export function formatGap(ratio: number): string;
/** "20 nov 2026, 15:45 (ART)". */
export function formatTimestamp(iso: string, options?: FormatTimestampOptions): string;
/** "16 – 20 nov 2026". */
export function formatDateRange(days: readonly string[], options?: FormatDateRangeOptions): string;
