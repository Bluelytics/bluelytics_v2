import { describe, expect, it } from 'vitest';
import {
  averageHundredths,
  centsToPesos,
  decimalToHundredths,
  formatFixed2,
  median,
  numberToHundredths,
  parseFixed2,
  pesosToHundredths,
  rint,
} from '../src/index.ts';

describe('rint (round half to even)', () => {
  it('rounds exact .5 ties to the even neighbour', () => {
    const ties: [number, number][] = [
      [0.5, 0],
      [1.5, 2],
      [2.5, 2],
      [3.5, 4],
      [4.5, 4],
      [5.5, 6],
      [6.5, 6],
      [7.5, 8],
      [114.5, 114],
      [115.5, 116],
      [1634.5, 1634],
      [1635.5, 1636],
      [1669.5, 1670],
      [1670.5, 1670],
      [999999.5, 1000000],
      [1000000.5, 1000000],
    ];
    for (const [input, expected] of ties) expect(rint(input), `rint(${input})`).toBe(expected);
  });

  it('agrees with half-even and disagrees with Math.round on every even-floor tie up to 2000.5', () => {
    for (let whole = 0; whole <= 2000; whole++) {
      const tie = whole + 0.5;
      expect(rint(tie)).toBe(whole % 2 === 0 ? whole : whole + 1);
      if (whole % 2 === 0) expect(rint(tie)).not.toBe(Math.round(tie));
    }
  });

  it('reproduces the legacy ties documented in the spec (C.2)', () => {
    expect(rint(4.5)).toBe(4); // 2011-10-27 Blue buy: half-up would have published 5.00
    expect(rint(4.4)).toBe(4);
    expect(rint(4.6)).toBe(5); // 2012-07-25 Oficial buy
    expect(rint(1635.025)).toBe(1635);
    expect(rint(1740.5652173913043)).toBe(1741);
  });

  it('rounds non-ties to the nearest integer', () => {
    expect(rint(1601.32)).toBe(1601);
    expect(rint(1548.41)).toBe(1548);
    expect(rint(0.49999999999999994)).toBe(0);
    expect(rint(0.5000000000000001)).toBe(1);
    expect(rint(2.4999999999999996)).toBe(2);
    expect(rint(2.5000000000000004)).toBe(3);
    expect(rint(7)).toBe(7);
  });

  it('handles the largest values that still have a .5', () => {
    expect(rint(4503599627370494.5)).toBe(4503599627370494);
    expect(rint(4503599627370495.5)).toBe(4503599627370496);
    expect(rint(2251799813685247.5)).toBe(2251799813685248);
    expect(rint(2251799813685246.5)).toBe(2251799813685246);
    expect(rint(9007199254740991)).toBe(9007199254740991);
  });

  it('is symmetric for negative values', () => {
    expect(rint(-0.5)).toBe(0);
    expect(rint(-1.5)).toBe(-2);
    expect(rint(-2.5)).toBe(-2);
    expect(rint(-3.5)).toBe(-4);
    expect(rint(-2.4)).toBe(-2);
    expect(rint(-2.6)).toBe(-3);
  });

  it('rejects non-finite input', () => {
    expect(() => rint(Number.NaN)).toThrow(RangeError);
    expect(() => rint(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('median (PERCENTILE_CONT 0.5)', () => {
  it('returns the middle value for odd n', () => {
    expect(median([7])).toBe(7);
    expect(median([1675, 1655, 1665])).toBe(1665);
    expect(median([5, 1, 4, 2, 3])).toBe(3);
  });

  it('interpolates between the two middle values for even n', () => {
    expect(median([1665, 1675])).toBe(1670);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([1675, 1655, 1655, 1675])).toBe(1665);
  });

  it('reproduces the legacy worked examples', () => {
    // C.1: blue buy of the golden /v2/latest = median(1615.05, 1655.00) -> 1635.025 -> 1635
    expect(median([1615.05, 1655.0])).toBeCloseTo(1635.025, 9);
    expect(rint(median([1615.05, 1655.0]))).toBe(1635);
    // C.2: 2020-05-12 blue = 114.85 + 0.5 * (115.05 - 114.85)
    expect(median([115.05, 114.85])).toBe(114.85 + 0.5 * (115.05 - 114.85));
    expect(rint(median([115.05, 114.85]))).toBe(115);
    expect(rint(median([125.05, 124.85]))).toBe(125);
  });

  it('sorts numerically and leaves the input untouched', () => {
    const input = [100, 9, 25];
    expect(median(input)).toBe(25);
    expect(input).toEqual([100, 9, 25]);
  });

  it('rejects an empty list', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('formatFixed2', () => {
  it('prints integer hundredths like "%.2f"', () => {
    expect(formatFixed2(157450)).toBe('1574.50');
    expect(formatFixed2(167000)).toBe('1670.00');
    expect(formatFixed2(400)).toBe('4.00');
    expect(formatFixed2(0)).toBe('0.00');
    expect(formatFixed2(5)).toBe('0.05');
    expect(formatFixed2(92)).toBe('0.92');
    expect(formatFixed2(2348000)).toBe('23480.00');
    expect(formatFixed2(123456789012345)).toBe('1234567890123.45');
    expect(formatFixed2(-1800)).toBe('-18.00');
    expect(formatFixed2(-5)).toBe('-0.05');
  });

  it('refuses floats and unsafe integers', () => {
    expect(() => formatFixed2(1574.5)).toThrow(RangeError);
    expect(() => formatFixed2(Number.NaN)).toThrow(RangeError);
    expect(() => formatFixed2(2 ** 53)).toThrow(RangeError);
  });
});

describe('parseFixed2', () => {
  it('is the inverse of formatFixed2', () => {
    for (const hundredths of [0, 5, 92, 400, 157450, 23241, 2348000, -1800]) {
      expect(parseFixed2(formatFixed2(hundredths))).toBe(hundredths);
    }
  });

  it('accepts exactly two decimals and nothing else', () => {
    for (const bad of ['1574.5', '1574', '1574.500', ' 1.00', '1.00 ', '1,00', '1e3', '.50', '+1.00', '']) {
      expect(() => parseFixed2(bad), bad).toThrow(RangeError);
    }
  });
});

describe('decimalToHundredths / numberToHundredths', () => {
  it('parses decimal text exactly', () => {
    expect(decimalToHundredths('1548.41')).toBe(154841);
    expect(decimalToHundredths('1675')).toBe(167500);
    expect(decimalToHundredths('1615.5')).toBe(161550);
    expect(decimalToHundredths('0.29')).toBe(29); // 0.29 * 100 is 28.999999999999996 in floats
    expect(decimalToHundredths('1571.0000')).toBe(157100);
    expect(decimalToHundredths('-18.00')).toBe(-1800);
  });

  it('rounds half away from zero beyond two decimals, like numeric(30,2)', () => {
    expect(decimalToHundredths('0.925')).toBe(93);
    expect(decimalToHundredths('0.9249999')).toBe(92);
    expect(decimalToHundredths('232.414999')).toBe(23241);
    expect(decimalToHundredths('1.005')).toBe(101); // (1.005).toFixed(2) would give 1.00
    expect(decimalToHundredths('-0.925')).toBe(-93);
    expect(decimalToHundredths('0.0000372')).toBe(0);
  });

  it('rejects anything that is not a plain decimal', () => {
    for (const bad of ['', '1,5', '1e3', 'abc', '1.2.3', ' 1', '$1']) {
      expect(() => decimalToHundredths(bad), bad).toThrow(RangeError);
    }
  });

  it('converts JSON numbers through their shortest decimal text', () => {
    expect(numberToHundredths(0.92)).toBe(92);
    expect(numberToHundredths(232.41)).toBe(23241);
    expect(numberToHundredths(1.005)).toBe(101);
    expect(numberToHundredths(137.965)).toBe(13797);
    expect(numberToHundredths(3.72e-8)).toBe(0);
    expect(numberToHundredths(1550)).toBe(155000);
    expect(() => numberToHundredths(Number.NaN)).toThrow(RangeError);
  });
});

describe('unit helpers', () => {
  it('converts between centavos, pesos and hundredths', () => {
    expect(centsToPesos(161505)).toBe(1615.05);
    expect(pesosToHundredths(1670)).toBe(167000);
    expect(averageHundredths(1548, 1601)).toBe(157450);
    expect(formatFixed2(averageHundredths(1635, 1670))).toBe('1652.50');
    expect(formatFixed2(averageHundredths(975, 1025))).toBe('1000.00');
  });

  it('refuses non-integers', () => {
    expect(() => centsToPesos(1.5)).toThrow(RangeError);
    expect(() => pesosToHundredths(1670.5)).toThrow(RangeError);
    expect(() => averageHundredths(1.5, 2)).toThrow(RangeError);
  });
});
