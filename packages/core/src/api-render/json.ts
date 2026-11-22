const NEEDS_ESCAPE = /["\\<>&\u0000-\u001f\u2028\u2029\ud800-\udfff]/;
const HEX = '0123456789abcdef';

function unicodeEscape(code: number): string {
  return `\\u${HEX[(code >> 12) & 15]}${HEX[(code >> 8) & 15]}${HEX[(code >> 4) & 15]}${HEX[code & 15]}`;
}

/**
 * A JSON string literal with the escaping of Go 1.14 `encoding/json` (HTML escaping on, as echo
 * uses it): non-ASCII is emitted raw; `"` and `\` are backslash-escaped; `\n`, `\r`, `\t` use the
 * short forms; other control characters, `<`, `>`, `&`, U+2028 and U+2029 become `\u00XX`-style
 * escapes in lower-case hex; unpaired surrogates (Go: invalid UTF-8) become `\ufffd`.
 */
export function goJsonString(value: string): string {
  if (!NEEDS_ESCAPE.test(value)) return `"${value}"`;
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x22 || code === 0x5c) {
      out += `\\${value[i]}`;
    } else if (code === 0x0a) {
      out += '\\n';
    } else if (code === 0x0d) {
      out += '\\r';
    } else if (code === 0x09) {
      out += '\\t';
    } else if (code < 0x20 || code === 0x3c || code === 0x3e || code === 0x26 || code === 0x2028 || code === 0x2029) {
      out += unicodeEscape(code);
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value.slice(i, i + 2);
        i += 1;
      } else {
        out += '\\ufffd';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\\ufffd';
    } else {
      out += value[i];
    }
  }
  return `${out}"`;
}
