import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'mcp', include: ['test/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 120_000 },
});
