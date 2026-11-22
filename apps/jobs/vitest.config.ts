import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'jobs', include: ['test/**/*.test.ts'] },
});
