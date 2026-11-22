import { defineProject } from 'vitest/config';

export default defineProject({
  // Local Chrome renders take a few seconds on a cold start.
  test: { name: 'social', include: ['test/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
});
