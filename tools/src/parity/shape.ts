/** A value of a JSON (or JSONP) body: a non-key string or a number, with the key it belongs to. */
export interface ValueToken {
  key: string | null;
  text: string;
}

const TOKEN = /"(?:[^"\\]|\\.)*"|(?<![\w.$])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
const INSTANT = /^"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})"$/;
const DAY = /^"\d{4}-\d{2}-\d{2}"$/;

/** The format class of a value: what must stay identical even when the value changes. */
function valueClass(text: string): string {
  if (text.startsWith('"')) {
    const instant = text.match(INSTANT);
    if (instant) return `<instant${instant[1]}>`;
    if (DAY.test(text)) return '<day>';
    return text;
  }
  if (/^-?\d+\.\d{2}$/.test(text)) return '<%.2f>';
  if (/^-?\d+$/.test(text)) return '<int>';
  return '<number>';
}

const isKey = (text: string, end: number): boolean => text[end - 1] === '"' && /^\s*:/.test(text.slice(end, end + 8));

/**
 * The body with every value replaced by its format class. Keys, key order, punctuation, the JSONP
 * wrapper, whitespace and the trailing newline are kept, as are string values other than
 * timestamps and days (currency codes and names, `source`), so two bodies with the same shape
 * differ only in their numbers and times.
 */
export function bodyShape(text: string): string {
  return text.replace(TOKEN, (match: string, offset: number) => (isKey(text, offset + match.length) ? match : valueClass(match)));
}

/** The values of a body in order, each with the nearest key before it. */
export function valueTokens(text: string): ValueToken[] {
  const tokens: ValueToken[] = [];
  let key: string | null = null;
  for (const match of text.matchAll(TOKEN)) {
    const end = (match.index ?? 0) + match[0].length;
    if (isKey(text, end)) key = match[0].slice(1, -1);
    else tokens.push({ key, text: match[0] });
  }
  return tokens;
}

/** Up to `limit` value changes between two bodies of the same shape, as `key old → new`. */
export function valueChanges(before: string, after: string, limit = 3): string[] {
  const b = valueTokens(after);
  const changes: string[] = [];
  let total = 0;
  valueTokens(before).forEach((token, index) => {
    const other = b[index];
    if (other === undefined || other.text === token.text) return;
    total += 1;
    if (changes.length < limit) changes.push(`${token.key ?? 'value'} ${token.text} → ${other.text}`);
  });
  if (total > changes.length) changes.push(`… ${total - changes.length} more`);
  return changes;
}
