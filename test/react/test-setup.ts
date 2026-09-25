// Shared by every test/react/**/*.test.tsx file. Root's vitest.config.ts
// does not set `test.globals: true` (every other test file in this repo
// explicitly imports `describe`/`it`/`expect` from 'vitest'), so
// @testing-library/react's own auto-cleanup — which only registers itself
// when it finds a global `afterEach` — never fires on its own here. This
// file registers it explicitly instead of turning on globals for the
// whole suite.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
