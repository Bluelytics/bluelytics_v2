const INDENT = '  ';

/**
 * `?pretty` variant of a JSON body: Go `json.Indent(dst, src, "", "  ")` as echo applies it, then
 * one trailing `\n`. Works on tokens, so number text such as `1574.50` passes through untouched.
 * Empty containers stay `{}` / `[]`; scalars (`null`) are returned as they are.
 */
export function prettyJson(compactBody: string): string {
  let out = '';
  let depth = 0;
  let needIndent = false;
  let inString = false;
  let runStart = 0;
  const newline = (): string => `\n${INDENT.repeat(depth)}`;

  for (let i = 0; i < compactBody.length; i++) {
    const code = compactBody.charCodeAt(i);
    if (inString) {
      if (code === 0x5c) i += 1;
      else if (code === 0x22) inString = false;
      continue;
    }
    const isSpace = code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09;
    const isOpen = code === 0x7b || code === 0x5b;
    const isClose = code === 0x7d || code === 0x5d;
    const isPunctuation = isOpen || isClose || code === 0x2c || code === 0x3a;
    if (!isSpace && !isPunctuation && !needIndent) {
      if (code === 0x22) inString = true;
      continue;
    }

    out += compactBody.slice(runStart, i);
    runStart = i + 1;
    if (isSpace) continue;
    if (needIndent && !isClose) {
      needIndent = false;
      depth += 1;
      out += newline();
    }
    if (isOpen) {
      needIndent = true;
      out += compactBody[i];
    } else if (code === 0x2c) {
      out += `,${newline()}`;
    } else if (code === 0x3a) {
      out += ': ';
    } else if (isClose) {
      if (needIndent) {
        needIndent = false;
      } else {
        depth -= 1;
        out += newline();
      }
      out += compactBody[i];
    } else {
      // First byte of a scalar right after an opening bracket: it starts a new run.
      runStart = i;
      if (code === 0x22) inString = true;
    }
  }
  return `${out}${compactBody.slice(runStart)}\n`;
}
