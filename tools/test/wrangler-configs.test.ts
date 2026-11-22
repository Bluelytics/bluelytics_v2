import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const APPS = ['api', 'jobs', 'web'];
const config = (app: string): string => readFileSync(new URL(`../../apps/${app}/wrangler.jsonc`, import.meta.url), 'utf8');

describe('wrangler.jsonc route guard (MIGRATION.md 1.1)', () => {
  it.each(APPS)('apps/%s: every line the `"pattern"` grep matches is a live route, never a comment', (app) => {
    const matches = config(app)
      .split('\n')
      .filter((line) => line.includes('"pattern"'));
    for (const line of matches) expect(line.trimStart().startsWith('//')).toBe(false);
  });
});
