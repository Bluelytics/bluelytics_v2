import type { ExtraRate } from '@bluelytics/core';
import { describe, expect, it } from 'vitest';
import { otherRates } from '../src/lib/extras.ts';

function rate(code: string, buyCents: number | null, sellCents: number | null): ExtraRate {
  return { code, name: code, buyCents, sellCents, source: 'ambito', sourceTs: null, updatedAt: '2026-11-25T22:00:00.000Z' };
}

describe('other dollar rates', () => {
  it('lists the known rates in display order, whatever the order of the rows', () => {
    const rows = [rate('tarjeta', null, 211900), rate('ccl', 168930, 168930), rate('mayorista', 159950, 160150), rate('mep', 165250, 165250), rate('cripto', 169800, 170200)];
    expect(otherRates(rows).map((r) => r.code)).toEqual(['mep', 'ccl', 'cripto', 'tarjeta', 'mayorista']);
    expect(otherRates(rows)[3]).toEqual({ code: 'tarjeta', buyCents: null, sellCents: 211900 });
  });

  it('leaves out rates without a sell price and codes it does not know', () => {
    const rows = [rate('mep', 165250, null), rate('ccl', null, 0), rate('turista', 1, 1), rate('cripto', 169800, 170200)];
    expect(otherRates(rows)).toEqual([{ code: 'cripto', buyCents: 169800, sellCents: 170200 }]);
    expect(otherRates([])).toEqual([]);
  });
});
