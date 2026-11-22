import { describe, expect, it } from 'vitest';
import {
  addDays,
  addSeconds,
  artDate,
  artParts,
  compareInstants,
  epochMs,
  GO_ZERO_TIME,
  historicalLookupDay,
  isoWeekday,
  isoWeekKey,
  isoWeekTradingDays,
  isTradingWindow,
  isValidDay,
  parseInstant,
  previousTradingDay,
  toArtOffset,
  toStoredUtc,
  toUtcZ,
} from '../src/index.ts';

describe('toArtOffset', () => {
  it('re-emits the legacy microsecond timestamp without losing digits', () => {
    expect(toArtOffset('2026-11-20T22:45:51.758024Z')).toBe('2026-11-20T19:45:51.758024-03:00');
  });

  it('moves 00:00–02:59 UTC to the previous Argentine day', () => {
    expect(toArtOffset('2026-11-21T00:00:00Z')).toBe('2026-11-20T21:00:00-03:00');
    expect(toArtOffset('2026-11-21T02:59:59.999Z')).toBe('2026-11-20T23:59:59.999-03:00');
    expect(toArtOffset('2026-11-21T03:00:00Z')).toBe('2026-11-21T00:00:00-03:00');
  });

  it('rolls over month, year and leap day boundaries', () => {
    expect(toArtOffset('2026-12-01T01:30:00Z')).toBe('2026-11-30T22:30:00-03:00');
    expect(toArtOffset('2027-01-01T00:00:00.5Z')).toBe('2026-12-31T21:00:00.5-03:00');
    expect(toArtOffset('2024-03-01T02:00:00Z')).toBe('2024-02-29T23:00:00-03:00');
    expect(toArtOffset('2026-03-01T02:00:00Z')).toBe('2026-02-28T23:00:00-03:00');
    expect(toArtOffset('2000-03-01T00:00:00Z')).toBe('2000-02-29T21:00:00-03:00');
    expect(toArtOffset('1900-03-01T00:00:00Z')).toBe('1900-02-28T21:00:00-03:00');
  });

  it('trims fractional digits like Go RFC3339Nano (0 to 9 digits)', () => {
    const cases: [string, string][] = [
      ['', ''],
      ['.0', ''],
      ['.000', ''],
      ['.000000', ''],
      ['.7', '.7'],
      ['.70', '.7'],
      ['.75', '.75'],
      ['.758', '.758'],
      ['.7580', '.758'],
      ['.75802', '.75802'],
      ['.758024', '.758024'],
      ['.758020', '.75802'],
      ['.7580240', '.758024'],
      ['.75802412', '.75802412'],
      ['.758024123', '.758024123'],
      ['.000001', '.000001'],
      ['.7580241239', '.758024123'],
    ];
    for (const [input, output] of cases) {
      expect(toArtOffset(`2026-11-20T22:45:51${input}Z`), input).toBe(`2026-11-20T19:45:51${output}-03:00`);
      expect(toUtcZ(`2026-11-20T22:45:51${input}Z`), input).toBe(`2026-11-20T22:45:51${output}Z`);
    }
  });

  it('accepts offset inputs and is idempotent', () => {
    expect(toArtOffset('2026-11-20T19:45:51.758024-03:00')).toBe('2026-11-20T19:45:51.758024-03:00');
    expect(toArtOffset('2026-11-21T00:15:51+01:30')).toBe('2026-11-20T19:45:51-03:00');
  });

  it("converts Go's zero time without failing", () => {
    expect(toUtcZ(GO_ZERO_TIME)).toBe('0001-01-01T00:00:00Z');
    expect(toArtOffset(GO_ZERO_TIME)).toBe('0000-12-31T21:00:00-03:00');
  });
});

describe('toUtcZ / toStoredUtc', () => {
  it('converts offsets back to UTC keeping every digit', () => {
    expect(toUtcZ('2026-11-20T19:45:51.758024-03:00')).toBe('2026-11-20T22:45:51.758024Z');
    expect(toUtcZ('2026-11-20T21:30:00-03:00')).toBe('2026-11-21T00:30:00Z');
    expect(toUtcZ('2026-12-31T23:00:00.120-03:00')).toBe('2027-01-01T02:00:00.12Z');
    expect(toUtcZ('2026-11-20T20:00:54.374497Z')).toBe('2026-11-20T20:00:54.374497Z');
  });

  it('stores at least milliseconds so that strings sort chronologically', () => {
    expect(toStoredUtc('2026-11-20T19:45:51-03:00')).toBe('2026-11-20T22:45:51.000Z');
    expect(toStoredUtc('2026-11-20T19:45:51.7-03:00')).toBe('2026-11-20T22:45:51.700Z');
    expect(toStoredUtc('2026-11-20T19:45:51.758024-03:00')).toBe('2026-11-20T22:45:51.758024Z');
    expect(toStoredUtc(new Date(Date.UTC(2026, 10, 20, 22, 45, 51, 7)).toISOString())).toBe('2026-11-20T22:45:51.007Z');
  });

  it('round-trips storage form through the wire formats', () => {
    for (const wire of ['2026-11-20T19:45:51-03:00', '2026-11-20T19:45:51.7-03:00', '2026-11-20T19:45:51.758024-03:00']) {
      expect(toArtOffset(toStoredUtc(wire))).toBe(wire);
    }
  });

  it('rejects malformed instants', () => {
    for (const bad of [
      '',
      '2026-11-20',
      '2026-11-20 22:45:51Z',
      '2026-11-20T22:45:51',
      '2026-11-20T24:00:00Z',
      '2026-11-20T22:60:00Z',
      '2026-11-20T22:45:60Z',
      '2026-02-30T00:00:00Z',
      '2026-11-20T22:45:51.Z',
      '2026-11-20T22:45:51z',
      '2026-11-20T22:45:51+0300',
      '2026-11-20T22:45:51+24:00',
    ]) {
      expect(() => parseInstant(bad), bad).toThrow(RangeError);
    }
  });
});

describe('instant arithmetic', () => {
  it('matches Date for epoch milliseconds', () => {
    for (const iso of ['1970-01-01T00:00:00.000Z', '2026-11-20T22:45:51.758Z', '2000-02-29T12:00:00.001Z', '1969-12-31T23:59:59.999Z', '2100-03-01T00:00:00.000Z']) {
      expect(epochMs(iso), iso).toBe(Date.parse(iso));
    }
    expect(epochMs('2026-11-20T19:45:51.758024-03:00')).toBe(Date.parse('2026-11-20T22:45:51.758Z'));
  });

  it('adds seconds across day boundaries, keeping the fraction', () => {
    expect(addSeconds('2026-11-20T22:45:51.758024Z', -6 * 3600)).toBe('2026-11-20T16:45:51.758024Z');
    expect(addSeconds('2026-11-21T00:10:00.000Z', -15 * 60)).toBe('2026-11-20T23:55:00.000Z');
    expect(addSeconds('2026-12-31T23:59:59Z', 1)).toBe('2027-01-01T00:00:00.000Z');
    expect(() => addSeconds('2026-12-31T23:59:59Z', 0.5)).toThrow(RangeError);
  });

  it('compares at full precision, where plain string comparison would fail', () => {
    expect(compareInstants('2026-11-20T22:45:51Z', '2026-11-20T22:45:51.5Z')).toBeLessThan(0);
    expect(compareInstants('2026-11-20T22:45:51.758024Z', '2026-11-20T22:45:51.758Z')).toBeGreaterThan(0);
    expect(compareInstants('2026-11-20T19:45:51-03:00', '2026-11-20T22:45:51.000Z')).toBe(0);
    expect(compareInstants('2026-11-20T22:45:52Z', '2026-11-20T22:45:51.999999Z')).toBeGreaterThan(0);
  });
});

describe('Argentine calendar', () => {
  it('derives the trading day from a UTC instant', () => {
    expect(artDate('2026-11-20T22:45:51.758024Z')).toBe('2026-11-20');
    expect(artDate('2026-11-21T02:59:59Z')).toBe('2026-11-20');
    expect(artDate('2026-11-21T03:00:00Z')).toBe('2026-11-21');
    expect(artDate('2027-01-01T01:00:00Z')).toBe('2026-12-31');
    expect(artParts('2026-11-20T22:45:51.758Z')).toEqual({ day: '2026-11-20', isoWeekday: 5, hour: 19, minute: 45, second: 51 });
  });

  it('knows the trading window: Monday–Friday 07:00–19:59 ART', () => {
    expect(isTradingWindow('2026-11-20T09:59:59Z')).toBe(false); // Fri 06:59:59
    expect(isTradingWindow('2026-11-20T10:00:00Z')).toBe(true); // Fri 07:00
    expect(isTradingWindow('2026-11-20T22:59:59Z')).toBe(true); // Fri 19:59:59
    expect(isTradingWindow('2026-11-20T23:00:00Z')).toBe(false); // Fri 20:00
    expect(isTradingWindow('2026-11-21T15:00:00Z')).toBe(false); // Sat
    expect(isTradingWindow('2026-11-22T15:00:00Z')).toBe(false); // Sun
    expect(isTradingWindow('2026-11-23T10:00:00Z')).toBe(true); // Mon 07:00
    expect(isTradingWindow('2026-11-21T01:00:00Z')).toBe(false); // Fri 22:00 ART (Saturday in UTC)
    expect(isTradingWindow('2026-11-23T02:30:00Z')).toBe(false); // Sun 23:30 ART (Monday in UTC)
  });
});

describe('days', () => {
  it('validates like Go time.Parse("2006-01-02")', () => {
    for (const good of ['2024-01-05', '2011-01-03', '2024-02-29', '2000-02-29', '9999-12-31', '0000-01-01', '0001-01-01']) {
      expect(isValidDay(good), good).toBe(true);
    }
    for (const bad of [
      '',
      '2024-1-5',
      '20240105',
      '2024-01-05T00:00:00',
      ' 2024-01-05',
      '2024-01-05 ',
      '2024-01-05\n',
      '2024-02-30',
      '2023-02-29',
      '1900-02-29',
      '2024-13-01',
      '2024-00-10',
      '2024-01-00',
      '2024-01-32',
      '2024-04-31',
      '24-01-05',
      '2024/01/05',
      '٢٠٢٤-01-05',
      '+2024-01-05',
      '2024-01-05Z',
    ]) {
      expect(isValidDay(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('computes weekdays', () => {
    expect(isoWeekday('1970-01-01')).toBe(4);
    expect(isoWeekday('2026-11-20')).toBe(5);
    expect(isoWeekday('2026-11-22')).toBe(7);
    expect(isoWeekday('2026-11-23')).toBe(1);
    expect(isoWeekday('2024-02-29')).toBe(4);
    expect(isoWeekday('2011-01-03')).toBe(1);
    expect(isoWeekday('1969-12-31')).toBe(3);
  });

  it('agrees with Date over a long range', () => {
    for (let offset = -800; offset <= 25_000; offset += 37) {
      const date = new Date(Date.UTC(1970, 0, 1 + offset));
      const day = date.toISOString().slice(0, 10);
      expect(addDays('1970-01-01', offset)).toBe(day);
      expect(isoWeekday(day)).toBe(date.getUTCDay() === 0 ? 7 : date.getUTCDay());
    }
  });

  it('maps weekends to Friday for /v2/historical', () => {
    expect(historicalLookupDay('2024-01-05')).toBe('2024-01-05');
    expect(historicalLookupDay('2024-01-06')).toBe('2024-01-05');
    expect(historicalLookupDay('2024-01-07')).toBe('2024-01-05');
    expect(historicalLookupDay('2024-01-08')).toBe('2024-01-08');
    expect(historicalLookupDay('2026-11-01')).toBe('2026-10-30'); // Sunday the 1st: previous month
    expect(historicalLookupDay('2027-01-02')).toBe('2027-01-01'); // Saturday
    expect(historicalLookupDay('2028-01-01')).toBe('2027-12-31'); // Saturday the 1st: previous year
    expect(() => historicalLookupDay('2024-02-30')).toThrow(RangeError);
    // Go accepts year 0000; its weekend falls back into year −1, where no row can exist
    expect(isValidDay('0000-01-01')).toBe(true);
    expect(historicalLookupDay('0000-01-01')).toBeNull(); // Saturday
    expect(historicalLookupDay('0000-01-02')).toBeNull(); // Sunday
    expect(historicalLookupDay('0000-01-03')).toBe('0000-01-03');
    expect(historicalLookupDay('0000-01-08')).toBe('0000-01-07');
    expect(historicalLookupDay('9999-12-31')).toBe('9999-12-31');
  });

  it('finds the previous trading day, Monday-safe', () => {
    expect(previousTradingDay('2026-11-23')).toBe('2026-11-20'); // Monday -> Friday
    expect(previousTradingDay('2026-11-24')).toBe('2026-11-23');
    expect(previousTradingDay('2026-11-20')).toBe('2026-11-19');
    expect(previousTradingDay('2026-11-21')).toBe('2026-11-20'); // Saturday
    expect(previousTradingDay('2026-11-22')).toBe('2026-11-20'); // Sunday
    expect(previousTradingDay('2027-01-04')).toBe('2027-01-01'); // Monday after New Year's Friday
    expect(previousTradingDay('2026-06-01')).toBe('2026-05-29');
  });

  it('derives ISO week keys', () => {
    expect(isoWeekKey('2026-11-20')).toBe('2026-W47');
    expect(isoWeekKey('2026-11-16')).toBe('2026-W47');
    expect(isoWeekKey('2026-11-22')).toBe('2026-W47');
    expect(isoWeekKey('2026-11-23')).toBe('2026-W48');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01'); // Thursday
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53'); // Friday of the last 2026 week
    expect(isoWeekKey('2027-01-04')).toBe('2027-W01');
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01'); // Monday belonging to next year's week 1
    expect(isoWeekKey('2021-01-03')).toBe('2020-W53');
    expect(isoWeekKey('2011-01-03')).toBe('2011-W01');
  });

  it('lists the trading days of an ISO week', () => {
    const week = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
    expect(isoWeekTradingDays('2026-11-20')).toEqual(week);
    expect(isoWeekTradingDays('2026-11-16')).toEqual(week);
    expect(isoWeekTradingDays('2026-11-22')).toEqual(week);
    expect(isoWeekTradingDays('2027-01-01')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01']);
  });
});
