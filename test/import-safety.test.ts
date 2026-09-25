import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This test runs against the *built* package (see the `pretest` script,
// which runs `npm run build` before `vitest run`). It proves that every
// published entry point can be imported in an environment with no DOM —
// no `document`, no `window` — without throwing.

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

const entries = [
  'index.js',
  'browser/index.js',
  'react/index.js',
  'server/index.js',
  'github/index.js',
  'limit/index.js',
  'build/index.js',
];

describe('import safety', () => {
  it('has built dist/ before running (see the pretest script)', () => {
    expect(existsSync(distDir)).toBe(true);
  });

  it('runs with no document or window global', () => {
    expect(globalThis.document).toBeUndefined();
    expect(globalThis.window).toBeUndefined();
  });

  for (const entry of entries) {
    it(`imports dist/${entry} without throwing or touching the DOM`, async () => {
      expect(globalThis.document).toBeUndefined();
      expect(globalThis.window).toBeUndefined();

      const entryPath = path.join(distDir, entry);
      expect(existsSync(entryPath)).toBe(true);

      const moduleUrl = pathToFileURL(entryPath).href;
      const mod: unknown = await import(moduleUrl);

      expect(mod).toBeTruthy();
      expect(globalThis.document).toBeUndefined();
      expect(globalThis.window).toBeUndefined();
    });
  }
});
