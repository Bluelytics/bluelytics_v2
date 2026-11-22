/**
 * Instants are ISO-8601 strings and are never routed through `Date`: the legacy data carries
 * microseconds, which `Date` would truncate. All calendar maths is integer arithmetic on the
 * proleptic Gregorian calendar, valid for years 0000–9999 (Go's `time` range for RFC 3339).
 */

/** Go's zero `time.Time`, emitted by the legacy API when a row is missing. */
export const GO_ZERO_TIME = '0001-01-01T00:00:00Z';

/** America/Argentina/Buenos_Aires: UTC−3, no DST since 2009. */
export const ART_OFFSET_SECONDS = -3 * 3600;

/** Trading window in Argentine time: Monday–Friday, 07:00–19:59. */
export const TRADING_WINDOW = { fromHour: 7, toHour: 20 } as const;

const SECONDS_PER_DAY = 86_400;
const MAX_FRACTION_DIGITS = 9;

export interface Instant {
  /** Whole seconds since 1970-01-01T00:00:00Z (negative before). */
  epochSeconds: number;
  /** Fractional-second digits, trailing zeros trimmed, at most nine; `''` when zero. */
  fraction: string;
}

export interface ArtParts {
  /** Argentine calendar date, `YYYY-MM-DD`. */
  day: string;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  isoWeekday: number;
  hour: number;
  minute: number;
  second: number;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Days since 1970-01-01 for a proleptic Gregorian date. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const monthFromMarch = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthFromMarch = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthFromMarch + 2) / 5) + 1;
  const month = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function formatDay(days: number): string {
  const { year, month, day } = civilFromDays(days);
  if (year < 0 || year > 9999) throw new RangeError(`date out of range: year ${year}`);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function isoWeekdayOfDays(days: number): number {
  return ((((days + 3) % 7) + 7) % 7) + 1; // 1970-01-01 was a Thursday
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function tryParseDay(day: string): number | null {
  const match = day.match(DAY);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > daysInMonth(year, month)) return null;
  return daysFromCivil(year, month, dayOfMonth);
}

function parseDay(day: string): number {
  const days = tryParseDay(day);
  if (days === null) throw new RangeError(`not a calendar date (YYYY-MM-DD): ${JSON.stringify(day)}`);
  return days;
}

/**
 * Strict `YYYY-MM-DD` check with the behaviour of Go `time.Parse("2006-01-02", s)`: four-digit
 * year, two-digit month and day, a real calendar date, and nothing before or after.
 */
export function isValidDay(text: string): boolean {
  return tryParseDay(text) !== null;
}

/** ISO weekday of a `YYYY-MM-DD` date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  return isoWeekdayOfDays(parseDay(day));
}

/** `day` shifted by a whole number of calendar days (negative = back). */
export function addDays(day: string, count: number): string {
  if (!Number.isInteger(count)) throw new RangeError(`addDays: not an integer: ${count}`);
  return formatDay(parseDay(day) + count);
}

/** The weekday (Mon–Fri) strictly before `day`: Monday, Sunday and Saturday all map to Friday. */
export function previousTradingDay(day: string): string {
  let days = parseDay(day) - 1;
  while (isoWeekdayOfDays(days) > 5) days -= 1;
  return formatDay(days);
}

/**
 * `/v2/historical` remap: Saturday and Sunday are answered with the preceding Friday. `null` when
 * that Friday is before year 0000 (`0000-01-01`/`02`): no row can exist, answer "day not found" as
 * legacy did. Throws `RangeError` for a string that fails {@link isValidDay}.
 */
export function historicalLookupDay(day: string): string | null {
  const days = parseDay(day);
  const weekday = isoWeekdayOfDays(days);
  if (weekday <= 5) return day;
  const friday = days - (weekday - 5);
  return civilFromDays(friday).year < 0 ? null : formatDay(friday);
}

/** ISO-8601 week of a date, e.g. `2026-W47` (weeks start on Monday; the year is the ISO week-year). */
export function isoWeekKey(day: string): string {
  const days = parseDay(day);
  const thursday = days - (isoWeekdayOfDays(days) - 1) + 3;
  const { year } = civilFromDays(thursday);
  const week = Math.floor((thursday - daysFromCivil(year, 1, 1)) / 7) + 1;
  return `${pad(year, 4)}-W${pad(week, 2)}`;
}

/** Monday to Friday of the ISO week that contains `day`. */
export function isoWeekTradingDays(day: string): string[] {
  const days = parseDay(day);
  const monday = days - (isoWeekdayOfDays(days) - 1);
  return [0, 1, 2, 3, 4].map((offset) => formatDay(monday + offset));
}

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/** Parses `YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)`, keeping every fractional digit (up to nine). */
export function parseInstant(iso: string): Instant {
  const match = iso.match(INSTANT);
  if (!match) throw new RangeError(`not an ISO-8601 instant: ${JSON.stringify(iso)}`);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError(`not an ISO-8601 instant: ${JSON.stringify(iso)}`);
  const zone = match[8] as string;
  let offsetSeconds = 0;
  if (zone !== 'Z') {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) throw new RangeError(`not an ISO-8601 instant: ${JSON.stringify(iso)}`);
    offsetSeconds = (zone.startsWith('-') ? -1 : 1) * (offsetHours * 3600 + offsetMinutes * 60);
  }
  const days = parseDay(`${match[1]}-${match[2]}-${match[3]}`);
  return {
    epochSeconds: days * SECONDS_PER_DAY + hour * 3600 + minute * 60 + second - offsetSeconds,
    fraction: (match[7] ?? '').slice(0, MAX_FRACTION_DIGITS).replace(/0+$/, ''),
  };
}

function formatInstant(instant: Instant, offsetSeconds: number, minFractionDigits: number): string {
  const local = instant.epochSeconds + offsetSeconds;
  const days = Math.floor(local / SECONDS_PER_DAY);
  const secondOfDay = local - days * SECONDS_PER_DAY;
  const time = `${pad(Math.floor(secondOfDay / 3600), 2)}:${pad(Math.floor((secondOfDay % 3600) / 60), 2)}:${pad(secondOfDay % 60, 2)}`;
  const digits = instant.fraction.padEnd(minFractionDigits, '0');
  let zone = 'Z';
  if (offsetSeconds !== 0) {
    const abs = Math.abs(offsetSeconds);
    zone = `${offsetSeconds < 0 ? '-' : '+'}${pad(Math.floor(abs / 3600), 2)}:${pad(Math.floor((abs % 3600) / 60), 2)}`;
  }
  return `${formatDay(days)}T${time}${digits === '' ? '' : `.${digits}`}${zone}`;
}

/**
 * Any instant → UTC with a `Z` suffix, Go `RFC3339Nano` style: trailing fractional zeros trimmed,
 * fraction omitted when zero. This is the `alert_at` wire format.
 */
export function toUtcZ(iso: string): string {
  return formatInstant(parseInstant(iso), 0, 0);
}

/**
 * Any instant → Argentine time with a `-03:00` suffix, Go `RFC3339Nano` style. This is the
 * `last_update` / `date` wire format: `2026-11-20T22:45:51.758024Z` → `2026-11-20T19:45:51.758024-03:00`.
 */
export function toArtOffset(iso: string): string {
  return formatInstant(parseInstant(iso), ART_OFFSET_SECONDS, 0);
}

/**
 * Any instant → the storage form: UTC, `Z` suffix, at least millisecond digits (more are kept).
 * The fixed-width prefix makes plain string comparison chronological in SQL.
 */
export function toStoredUtc(iso: string): string {
  return formatInstant(parseInstant(iso), 0, 3);
}

/** Milliseconds since the Unix epoch; digits beyond milliseconds are truncated. */
export function epochMs(iso: string): number {
  const instant = parseInstant(iso);
  return instant.epochSeconds * 1000 + Number(instant.fraction.padEnd(3, '0').slice(0, 3));
}

/** `iso` shifted by a whole number of seconds (negative = back), in storage form; the fraction is kept. */
export function addSeconds(iso: string, seconds: number): string {
  if (!Number.isInteger(seconds)) throw new RangeError(`addSeconds: not an integer: ${seconds}`);
  const instant = parseInstant(iso);
  return formatInstant({ epochSeconds: instant.epochSeconds + seconds, fraction: instant.fraction }, 0, 3);
}

/** Negative, zero or positive as `a` is before, equal to or after `b`, at full precision. */
export function compareInstants(a: string, b: string): number {
  const left = parseInstant(a);
  const right = parseInstant(b);
  if (left.epochSeconds !== right.epochSeconds) return left.epochSeconds - right.epochSeconds;
  const leftFraction = left.fraction.padEnd(MAX_FRACTION_DIGITS, '0');
  const rightFraction = right.fraction.padEnd(MAX_FRACTION_DIGITS, '0');
  return leftFraction < rightFraction ? -1 : leftFraction > rightFraction ? 1 : 0;
}

/** Calendar date and wall-clock fields of an instant in Argentine time. */
export function artParts(iso: string): ArtParts {
  const local = parseInstant(iso).epochSeconds + ART_OFFSET_SECONDS;
  const days = Math.floor(local / SECONDS_PER_DAY);
  const secondOfDay = local - days * SECONDS_PER_DAY;
  return {
    day: formatDay(days),
    isoWeekday: isoWeekdayOfDays(days),
    hour: Math.floor(secondOfDay / 3600),
    minute: Math.floor((secondOfDay % 3600) / 60),
    second: secondOfDay % 60,
  };
}

/** Argentine calendar date (`YYYY-MM-DD`) of an instant: the trading day. */
export function artDate(iso: string): string {
  return artParts(iso).day;
}

/** Whether the instant falls inside the trading window (Mon–Fri, 07:00–19:59 Argentine time). */
export function isTradingWindow(iso: string): boolean {
  const { isoWeekday: weekday, hour } = artParts(iso);
  return weekday <= 5 && hour >= TRADING_WINDOW.fromHour && hour < TRADING_WINDOW.toHour;
}
