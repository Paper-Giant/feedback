import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The react/ entry must ship as a client-only module: bundlers that honour
// React Server Component boundaries key off a literal "use client"; at the
// very top of the file. tsc is not guaranteed to preserve an arbitrary
// string-literal expression statement as the first line of its output, so
// this test asserts it against the built file rather than the source.

const reactEntry = fileURLToPath(new URL('../dist/react/index.js', import.meta.url));

describe('react entry "use client" directive', () => {
  it('starts the built file with "use client";', async () => {
    const source = await readFile(reactEntry, 'utf8');
    expect(source.startsWith('"use client";')).toBe(true);
  });
});
