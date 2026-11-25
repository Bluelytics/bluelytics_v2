// The reference rates published by third parties (MEP, CCL, …): which ones are shown, and in what order.
// Shared by the home page and by `/data/extras.json`, which the mobile app reads.
import type { ExtraRate } from '@bluelytics/core';

export const EXTRA_ORDER = ['mep', 'ccl', 'cripto', 'tarjeta', 'mayorista'] as const;
export type ExtraCode = (typeof EXTRA_ORDER)[number];

export interface OtherRate {
  code: ExtraCode;
  /** Hundredths of a peso; some rates (tarjeta) have no buy side. */
  buyCents: number | null;
  sellCents: number;
}

/** The known rates that have a sell price, in display order. */
export function otherRates(extras: readonly ExtraRate[]): OtherRate[] {
  return EXTRA_ORDER.flatMap((code) => {
    const rate = extras.find((extra) => extra.code === code);
    return rate && rate.sellCents !== null && rate.sellCents > 0 ? [{ code, buyCents: rate.buyCents, sellCents: rate.sellCents }] : [];
  });
}
