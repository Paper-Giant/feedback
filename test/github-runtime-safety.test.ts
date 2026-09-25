import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The github/ entry must run unmodified in edge-style runtimes: built on
// global fetch, WebCrypto, AbortSignal.timeout, TextEncoder and
// atob/btoa only. This greps the *built* output (not the source, since
// a comment referencing "node:crypto" in prose is fine) for the things
// that would break that: a "node:" import, the Node-only `Buffer`
// global, and `process.*` env/argv access.

const githubDistDir = fileURLToPath(new URL('../dist/github/', import.meta.url));

describe('dist/github/*.js stays free of Node-only and edge-unsafe references', () => {
  const files = readdirSync(githubDistDir).filter((name) => name.endsWith('.js'));

  it('found the built github entry files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} has no "node:" import/require, Buffer or process. reference`, () => {
      const source = readFileSync(path.join(githubDistDir, file), 'utf8');

      expect(source).not.toMatch(/(?:from\s+|require\()\s*['"]node:/);
      expect(source).not.toMatch(/\bBuffer\b/);
      expect(source).not.toMatch(/\bprocess\./);
    });
  }
});
