import type { TestProject } from 'vitest/node';
import { defineConfig } from 'vitest/config';

/**
 * Projects that have tests. `passWithNoTests` (needed while the other projects are placeholders)
 * would otherwise let one of these go green with zero files after a renamed directory or a broken
 * `include` glob. Add a project here once it has tests.
 */
const PROJECTS_WITH_TESTS = ['core', 'db', 'contract'];

const requireTests = {
  projects: [] as TestProject[],
  onInit(vitest: { projects: TestProject[] }) {
    this.projects = vitest.projects;
  },
  async onTestRunStart() {
    for (const project of this.projects) {
      if (!PROJECTS_WITH_TESTS.includes(project.name)) continue;
      const { testFiles } = await project.globTestFiles();
      if (testFiles.length === 0) throw new Error(`vitest project "${project.name}" matches no test files: check its include glob`);
    }
  },
};

// A workspace package joins the root run by having its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'apps/{api,jobs,web}/vitest.config.ts',
      'tools/vitest.config.ts',
      'infra/vitest.config.ts',
    ],
    passWithNoTests: true,
    reporters: ['default', requireTests],
  },
});
