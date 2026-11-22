import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'scrapers', include: ['test/**/*.test.ts'] },
});
