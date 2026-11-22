/** URL parameters of the history pages and whether a period is closed (cacheable for a day). */
import { addDays, isValidDay } from '@bluelytics/core';

/** First year of data in the legacy history (2011-01-03). */
export const FIRST_YEAR = 2011;

/** `"2024"` → 2024 when it is a 4-digit year in `[FIRST_YEAR, currentYear]`, else `null`. */
export function parseYear(text: string | undefined, currentYear: number): number | null {
  if (text === undefined || !/^\d{4}$/.test(text)) return null;
  const year = Number(text);
  return year >= FIRST_YEAR && year <= currentYear ? year : null;
}

/** `"03"` → 3; only the two-digit form is canonical. */
export function parseMonth(text: string | undefined): number | null {
  if (text === undefined || !/^(0[1-9]|1[0-2])$/.test(text)) return null;
  return Number(text);
}

/** `YYYY-MM-DD` of a real calendar day from the three URL segments, else `null`. */
export function parseDayParams(year: number, month: number, text: string | undefined): string | null {
  if (text === undefined || !/^\d{2}$/.test(text)) return null;
  const day = `${year}-${String(month).padStart(2, '0')}-${text}`;
  return isValidDay(day) ? day : null;
}

/** Last calendar day of a year or month. */
export function periodEnd(year: number, month?: number): string {
  if (month === undefined) return `${year}-12-31`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

/** A period is closed once its last day is before today (Argentine date). */
export function isClosed(lastDay: string, today: string): boolean {
  return lastDay < today;
}
