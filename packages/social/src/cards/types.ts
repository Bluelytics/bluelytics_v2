/** What a card shows: a price move, the Friday summary, or the website's link-preview image. */
export type CardKind = 'update' | 'weekly' | 'og';

/** Canvas names. `landscape` is X, `portrait` the Instagram/Facebook feed, `story` 9:16 stories, `og` link previews. */
export type CardSize = 'landscape' | 'portrait' | 'story' | 'og';

export interface Viewport {
  width: number;
  height: number;
}

export const CARD_SIZES: Readonly<Record<CardSize, Viewport>> = {
  landscape: { width: 1600, height: 900 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  og: { width: 1200, height: 630 },
};

/** The sizes each kind is designed for: `update` and `weekly` in the three post sizes, `og` only as `og`. */
export const CARD_KIND_SIZES: Readonly<Record<CardKind, readonly CardSize[]>> = {
  update: ['landscape', 'portrait', 'story'],
  weekly: ['landscape', 'portrait', 'story'],
  og: ['og'],
};

/** Whole pesos. */
export interface CardRate {
  buy: number;
  sell: number;
}

/** One trading day's blue sell close. */
export interface CardSeriesPoint {
  /** `YYYY-MM-DD`, Argentine calendar day. */
  day: string;
  sell: number;
}

/**
 * Input of every card, caption and alt text. All values are whole pesos; the card derives delta,
 * percent, gap, labels and dates itself (see `computeCardFacts`).
 */
export interface CardData {
  /** Published dólar blue. */
  blue: CardRate;
  /** Published dólar oficial. */
  oficial: CardRate;
  /**
   * Reference blue sell: the previous trading day's close (`update`, `og`) or the previous week's
   * last close (`weekly`). `null`/non-positive means "no reference": no move is shown.
   */
  prevSell: number | null;
  /** UTC ISO-8601 time of the published value. */
  updatedAt: string;
  /**
   * Blue sell daily closes, oldest first. `update`/`og`: the last ≤ 30 trading days ending today
   * (last item = today = `blue.sell`); `weekly`: this week's 1–5 trading days.
   */
  series: readonly CardSeriesPoint[];
}

export type CardDirection = 'up' | 'down' | 'flat' | 'unknown';

/** Everything the card, captions and alt text derive from {@link CardData}. Ratios are fractions (0.009 = 0,9 %). */
export interface CardFacts {
  sell: number;
  buy: number;
  prevSell: number | null;
  hasRef: boolean;
  deltaAbs: number | null;
  deltaPct: number | null;
  direction: CardDirection;
  oficialSell: number | null;
  /** blue sell / official sell − 1. */
  gapPct: number | null;
  /** The valid points of `series`. */
  series: CardSeriesPoint[];
  points: number;
  min: number;
  max: number;
  firstDay: string | null;
  lastDay: string | null;
  updatedAt: string;
  /** 0..1, how loud the move is (design use). */
  intensity: number;
}

export interface FormatPercentOptions {
  digits?: number;
  signed?: boolean;
  /** Add decimals (up to 4) instead of printing a non-zero move as "+0,00%". Default true. */
  escalate?: boolean;
}

export interface FormatTimestampOptions {
  /** Prose form for alt text: "20 de noviembre de 2026, 15:45, hora de Argentina". */
  plain?: boolean;
}

export interface FormatDateRangeOptions {
  /** "del 16 al 20 de noviembre de 2026". */
  prose?: boolean;
  /** `true` (default): always a year; `false`: only when the range crosses one; `'end'`: once, at the end. */
  year?: boolean | 'end';
}
