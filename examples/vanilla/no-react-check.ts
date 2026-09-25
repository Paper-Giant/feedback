/**
 * Task P10: "A Node check that importing `@papergiant/feedback`,
 * `/browser`, `/server`, `/github`, `/limit`, `/build` from the tarball
 * works with no React present (the `/react` entry is expected to fail to
 * resolve `react` — assert it fails cleanly and only that one)."
 *
 * Plain Node: no bundler, no import map, so every specifier below
 * resolves exactly the way a real Node host would see it.
 *
 * Run via `npm run test:no-react`, which is `run-no-react-check.sh`, not
 * a direct `tsx no-react-check.ts` — see that script's header for why:
 * in short, this file's own resolution checks only mean what they say
 * when run from *outside* this repository (`FEEDBACK_VANILLA_PROJECT_DIR`
 * below is how it still finds the real `examples/vanilla` to check for a
 * stray `react`). Requires `@papergiant/feedback` to be installed as a
 * real, unpacked copy (the packed tarball, same as CI) — not the bare
 * `"file:../.."` link `package.json` declares for local development;
 * through that symlink, `@papergiant/feedback/react`'s own `import ...
 * from 'react'` would resolve to the package root's own `react`
 * devDependency (needed to build/test the package itself) instead of
 * failing to resolve at all, which is exactly what this file's final
 * assertion checks for.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `run-no-react-check.sh` runs this file from a scratch copy outside the
// repository (its header explains why), so `import.meta.url` no longer
// points at the real `examples/vanilla` — it sets this instead.
const projectDir = process.env.FEEDBACK_VANILLA_PROJECT_DIR ?? path.dirname(fileURLToPath(import.meta.url));

// The whole point of this consumer (task P10 bullet 4): no React,
// anywhere in its own dependency tree.
assert.equal(
  existsSync(path.join(projectDir, 'node_modules', 'react')),
  false,
  'examples/vanilla must never have its own react in node_modules',
);

const CLEAN_ENTRIES = [
  '@papergiant/feedback',
  '@papergiant/feedback/browser',
  '@papergiant/feedback/server',
  '@papergiant/feedback/github',
  '@papergiant/feedback/limit',
  '@papergiant/feedback/build',
] as const;

for (const specifier of CLEAN_ENTRIES) {
  await import(specifier);
  console.log(`ok: imported ${specifier} with no React present`);
}

// The one entry point that *does* need react (the optional peer, design
// §3) — importing it here, with no react resolvable anywhere, must fail,
// and fail *cleanly*: a module-resolution error naming `react`, not some
// other crash (a TypeError deep inside a partially-evaluated module, a
// syntax error, a hang, ...).
let reactEntryError: unknown;
try {
  await import('@papergiant/feedback/react');
} catch (error) {
  reactEntryError = error;
}

assert.ok(reactEntryError, '@papergiant/feedback/react must fail to import when react is not installed');
const err = reactEntryError as NodeJS.ErrnoException;
const message = err instanceof Error ? err.message : String(err);

assert.equal(err.code, 'ERR_MODULE_NOT_FOUND', `expected Node's own module-not-found error code, got: ${err.code}`);
assert.match(message, /'react'/, `expected the error to name 'react', got: ${message}`);
console.log(`ok: @papergiant/feedback/react failed cleanly (${err.code}), naming react — and only that entry failed`);

console.log('no-react check passed: every non-React entry point works with no React installed.');
