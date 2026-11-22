import { decimalToHundredths, numberToHundredths } from '@bluelytics/core';
import { ParseError } from './errors.ts';

/**
 * Declared per source, never guessed:
 * - `ar`: `.` thousands, `,` decimals (`$ 1.655,00`, `1548,41`, `$1.675`, `$<!-- -->1615,05`);
 * - `en`: `.` decimals, no thousands separator (`1655`, `1571.0000`).
 */
export type NumberFormat = 'ar' | 'en';

const AR_NUMBER = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
const EN_NUMBER = /^\d+(?:\.\d+)?$/;

/** Price text → integer centavos. Anything but one number in `format` (after `$`, spaces, `&nbsp;`, HTML comments) throws. */
export function parsePriceCents(raw: string, format: NumberFormat): number {
  const text = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/&nbsp;| /g, ' ')
    .trim()
    .replace(/^\$\s*/, '');
  if (format === 'ar') {
    if (!AR_NUMBER.test(text)) throw new ParseError('number', `not an Argentine-format number (like 1.655,00): ${JSON.stringify(raw)}`);
    return positive(decimalToHundredths(text.replace(/\./g, '').replace(',', '.')), raw);
  }
  if (!EN_NUMBER.test(text)) throw new ParseError('number', `not a plain number (like 1655.00): ${JSON.stringify(raw)}`);
  return positive(decimalToHundredths(text), raw);
}

/** A JSON number field → integer centavos; strings, booleans, null, non-finite and non-positive values throw. */
export function jsonPriceCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ParseError('number', `${field} is not a JSON number: ${JSON.stringify(value) ?? String(value)}`);
  }
  return positive(numberToHundredths(value), `${field}=${value}`);
}

function positive(cents: number, raw: string): number {
  if (cents <= 0) throw new ParseError('number', `not a positive price: ${JSON.stringify(raw)}`);
  return cents;
}
