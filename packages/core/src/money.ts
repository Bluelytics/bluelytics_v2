/**
 * Round half to EVEN, like C `rint()` and Postgres `round(double precision)`.
 * `Math.round` rounds half up and must not be used for published values.
 */
export function rint(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`rint: not a finite number: ${x}`);
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Postgres `PERCENTILE_CONT(0.5)`: sort ascending, interpolate linearly at position 0.5 * (n - 1).
 * The expression shape is the float8 lerp Postgres uses; do not "simplify" it to (a + b) / 2.
 */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new RangeError('median: empty input');
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = 0.5 * (sorted.length - 1);
  const lo = sorted[Math.floor(pos)] as number;
  const hi = sorted[Math.ceil(pos)] as number;
  return lo + (pos - Math.floor(pos)) * (hi - lo);
}

function assertSafeInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${what}: expected a safe integer, got ${value}`);
}

/** `"%.2f"` text of an integer number of hundredths: `157450` → `"1574.50"`. Never formats from a float. */
export function formatFixed2(hundredths: number): string {
  assertSafeInteger(hundredths, 'formatFixed2');
  const abs = Math.abs(hundredths);
  const whole = Math.trunc(abs / 100);
  const fraction = abs % 100;
  return `${hundredths < 0 ? '-' : ''}${whole}.${fraction < 10 ? '0' : ''}${fraction}`;
}

const FIXED2 = /^(-?)(\d+)\.(\d{2})$/;

/** Inverse of {@link formatFixed2}: `"1574.50"` → `157450`. Accepts exactly two decimals, nothing else. */
export function parseFixed2(text: string): number {
  const match = text.match(FIXED2);
  if (!match) throw new RangeError(`parseFixed2: not a "%.2f" number: ${JSON.stringify(text)}`);
  const hundredths = Number(match[2]) * 100 + Number(match[3]);
  assertSafeInteger(hundredths, 'parseFixed2');
  return match[1] === '-' && hundredths !== 0 ? -hundredths : hundredths;
}

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d*))?$/;

/**
 * Exact decimal text → integer hundredths, rounding half away from zero beyond two decimals
 * (Postgres `numeric(30,2)` semantics): `"1548.41"` → `154841`, `"0.925"` → `93`, `"1675"` → `167500`.
 */
export function decimalToHundredths(text: string): number {
  const match = text.match(DECIMAL);
  if (!match) throw new RangeError(`decimalToHundredths: not a plain decimal: ${JSON.stringify(text)}`);
  const fraction = (match[3] ?? '').padEnd(3, '0');
  const roundUp = fraction.charCodeAt(2) >= 0x35; // third decimal >= '5'
  const hundredths = Number(match[2]) * 100 + Number(fraction.slice(0, 2)) + (roundUp ? 1 : 0);
  assertSafeInteger(hundredths, 'decimalToHundredths');
  return match[1] === '-' && hundredths !== 0 ? -hundredths : hundredths;
}

/**
 * A JSON number → integer hundredths through its shortest decimal text, the way the legacy loader
 * stored floats (`repr(float)` → `numeric(30,2)`). Use for values that arrive as numbers, not text.
 */
export function numberToHundredths(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`numberToHundredths: not a finite number: ${value}`);
  if (Math.abs(value) < 1e-6) return 0; // String() switches to exponent form below 1e-6
  return decimalToHundredths(String(value));
}

/** Integer centavos → pesos as a float, the unit medians are taken in (`161505` → `1615.05`). */
export function centsToPesos(cents: number): number {
  assertSafeInteger(cents, 'centsToPesos');
  return cents / 100;
}

/** Integer pesos → integer hundredths (= centavos): `1670` → `167000`. */
export function pesosToHundredths(pesos: number): number {
  assertSafeInteger(pesos, 'pesosToHundredths');
  return pesos * 100;
}

/** Hundredths of `(buy + sell) / 2` for integer pesos; the only published number that can end in `.50`. */
export function averageHundredths(buyPesos: number, sellPesos: number): number {
  assertSafeInteger(buyPesos, 'averageHundredths');
  assertSafeInteger(sellPesos, 'averageHundredths');
  return (buyPesos + sellPesos) * 50;
}
