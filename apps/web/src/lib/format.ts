/**
 * Display formatting for both locales, built on integers and `@bluelytics/core` time helpers
 * (no `Intl`, so output is identical in workerd, Node and every browser).
 * Spanish follows es-AR: `.` thousands, `,` decimals, `$ 1.675`, `4,9 %`, 24-hour clock.
 */
import { artParts, epochMs, isoWeekday } from '@bluelytics/core';
import type { Locale } from '../i18n/routes.ts';

const NBSP = '\u00a0';
/** Typographic minus (U+2212); present in the self-hosted font. */
export const MINUS = '\u2212';

const SEPARATORS: Record<Locale, { thousands: string; decimal: string }> = {
  es: { thousands: '.', decimal: ',' },
  en: { thousands: ',', decimal: '.' },
};

const MONTHS: Record<Locale, readonly string[]> = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const MONTHS_SHORT: Record<Locale, readonly string[]> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const WEEKDAYS: Record<Locale, readonly string[]> = {
  es: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

function groupThousands(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** `1675` → `1.675` (es) / `1,675` (en). Negative values use the typographic minus. */
export function formatInteger(value: number, locale: Locale): string {
  if (!Number.isInteger(value)) throw new RangeError(`formatInteger: not an integer: ${value}`);
  const text = groupThousands(String(Math.abs(value)), SEPARATORS[locale].thousands);
  return value < 0 ? `${MINUS}${text}` : text;
}

/** Hundredths → `1.652,50` / `1,652.50`. */
export function formatHundredths(hundredths: number, locale: Locale): string {
  if (!Number.isInteger(hundredths)) throw new RangeError(`formatHundredths: not an integer: ${hundredths}`);
  const abs = Math.abs(hundredths);
  const whole = groupThousands(String(Math.floor(abs / 100)), SEPARATORS[locale].thousands);
  const text = `${whole}${SEPARATORS[locale].decimal}${String(abs % 100).padStart(2, '0')}`;
  return hundredths < 0 ? `${MINUS}${text}` : text;
}

function withCurrency(amount: string, locale: Locale): string {
  return locale === 'es' ? `$${NBSP}${amount}` : `$${amount}`;
}

/** Whole pesos with the currency sign: `$ 1.675` / `$1,675`. */
export function formatPesos(pesos: number, locale: Locale): string {
  return withCurrency(formatInteger(pesos, locale), locale);
}

/** Hundredths of a peso with the currency sign: `$ 1.652,50` / `$1,652.50`. */
export function formatPesosHundredths(hundredths: number, locale: Locale): string {
  return withCurrency(formatHundredths(hundredths, locale), locale);
}

/** `+20` / `−20` / `0`. */
export function formatSignedInteger(value: number, locale: Locale): string {
  const text = formatInteger(Math.abs(value), locale);
  if (value > 0) return `+${text}`;
  return value < 0 ? `${MINUS}${text}` : text;
}

/** A ratio as a percentage: `0.049` → `4,9 %` / `4.9%`. Display only: the ratio may be a float. */
export function formatPercent(ratio: number, locale: Locale, digits = 1): string {
  const scaled = Math.round(Math.abs(ratio) * 100 * 10 ** digits);
  const negative = ratio < 0 && scaled !== 0;
  const whole = groupThousands(String(Math.floor(scaled / 10 ** digits)), SEPARATORS[locale].thousands);
  const fraction = digits > 0 ? `${SEPARATORS[locale].decimal}${String(scaled % 10 ** digits).padStart(digits, '0')}` : '';
  const text = `${negative ? MINUS : ''}${whole}${fraction}`;
  return locale === 'es' ? `${text}${NBSP}%` : `${text}%`;
}

/** `+0,9 %` / `−0,9 %` / `0,0 %`. */
export function formatSignedPercent(ratio: number, locale: Locale, digits = 1): string {
  const text = formatPercent(ratio, locale, digits);
  return text.startsWith(MINUS) || Math.round(Math.abs(ratio) * 100 * 10 ** digits) === 0 ? text : `+${text}`;
}

export function monthName(month: number, locale: Locale): string {
  const name = MONTHS[locale][month - 1];
  if (name === undefined) throw new RangeError(`monthName: invalid month ${month}`);
  return name;
}

/** `20 de noviembre de 2026` / `November 20, 2026` (long) or `20 nov 2026` / `Nov 20, 2026` (short). */
export function formatDay(day: string, locale: Locale, style: 'long' | 'short' = 'long'): string {
  const year = day.slice(0, 4);
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const name = style === 'long' ? monthName(month, locale) : (MONTHS_SHORT[locale][month - 1] as string);
  if (locale === 'es') return style === 'long' ? `${date} de ${name} de ${year}` : `${date} ${name} ${year}`;
  return `${name} ${date}, ${year}`;
}

/** `20/11` (es) / `11/20` (en): compact axis and table labels. */
export function formatDayNumeric(day: string, locale: Locale, withYear = false): string {
  const dd = day.slice(8, 10);
  const mm = day.slice(5, 7);
  const year = withYear ? `/${day.slice(0, 4)}` : '';
  return locale === 'es' ? `${dd}/${mm}${year}` : `${mm}/${dd}${year}`;
}

/** `marzo de 2024` / `March 2024`. */
export function formatMonth(year: number, month: number, locale: Locale): string {
  return locale === 'es' ? `${monthName(month, locale)} de ${year}` : `${monthName(month, locale)} ${year}`;
}

/** `mar 2024` / `Mar 2024`: axis labels. */
export function formatMonthShort(year: number, month: number, locale: Locale): string {
  return `${MONTHS_SHORT[locale][month - 1] as string} ${year}`;
}

export function weekdayName(day: string, locale: Locale): string {
  return WEEKDAYS[locale][isoWeekday(day) - 1] as string;
}

/** Argentine wall-clock time of an instant: `19:45`. */
export function formatTime(iso: string): string {
  const { hour, minute } = artParts(iso);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Argentine date and time of an instant: `20 nov 2026, 19:45` / `Nov 20, 2026, 19:45`. */
export function formatDateTime(iso: string, locale: Locale): string {
  return `${formatDay(artParts(iso).day, locale, 'short')}, ${formatTime(iso)}`;
}

/** Coarse elapsed time: `hace 5 min` / `5 min ago`, then hours, then days. */
export function formatAgo(fromIso: string, nowIso: string, locale: Locale): string {
  const minutes = Math.max(0, Math.floor((epochMs(nowIso) - epochMs(fromIso)) / 60_000));
  let amount: string;
  if (minutes < 60) amount = `${minutes} min`;
  else if (minutes < 48 * 60) amount = `${Math.floor(minutes / 60)} h`;
  else amount = locale === 'es' ? `${Math.floor(minutes / 1440)} días` : `${Math.floor(minutes / 1440)} days`;
  return locale === 'es' ? `hace ${amount}` : `${amount} ago`;
}
