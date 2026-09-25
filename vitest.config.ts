import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // test/react/**/*.test.tsx opts into jsdom itself, per file, with a
    // leading `// @vitest-environment jsdom` comment — everything else
    // (including every other test file in this suite) stays on the
    // `environment` above ('node'), per the build plan.
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
