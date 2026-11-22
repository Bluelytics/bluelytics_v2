/** Milliseconds to wait from an HTTP `Retry-After` value (delay-seconds or an HTTP date). */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}
