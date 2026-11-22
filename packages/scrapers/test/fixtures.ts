import { readFileSync } from 'node:fs';

/** A trimmed fixture from `test/fixtures/` (cut from the full pages saved on 2026-11-22). */
export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/** `text` with exactly one occurrence of `from` replaced; fails the test if `from` is not there once. */
export function mutate(text: string, from: string, to: string): string {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`mutation anchor ${JSON.stringify(from)} occurs ${count} times`);
  return text.replace(from, to);
}

/** Like `mutate` for every occurrence (at least one). */
export function mutateAll(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`mutation anchor ${JSON.stringify(from)} not found`);
  return text.split(from).join(to);
}
