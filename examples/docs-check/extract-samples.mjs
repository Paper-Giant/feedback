#!/usr/bin/env node
// Extracts every fenced ts/tsx/js/mjs code block from ../../INSTALL.md and
// ../../README.md verbatim into this directory, so `tsc --strict --noEmit`
// (see package.json's `check` script) can compile every documented sample
// against real host dependencies (task P12 review item 21) — the same
// floor as test/docs.test.ts's export-name check, but a real compile
// rather than a name lookup, and against README.md too.
//
// A block's first line, when it's a `// path/to/file.ext` comment, names
// where it's written — matching how a reader would actually create the
// file (`app/api/feedback/route.ts` really is app/api/feedback/route.ts
// in a Next project), and letting two files that import from each other
// by relative path (`./app-feedback`, from an authed layout) resolve for
// real. A first line like `// astro.config.mjs / vite.config.ts` (several
// alternative filenames for one shared sample) picks whichever
// alternative's extension matches the block's own fenced language. A
// block with no such first line falls back to `samples/<doc>-<line>.<ext>`.
//
// This intentionally does NOT special-case which blocks are "real" versus
// "illustrative" — every ts/tsx/js/mjs block gets extracted and checked,
// which is the whole point: a sample that only *looks* like it compiles
// is exactly the kind of drift this exists to catch.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const langs = new Set(['ts', 'tsx', 'js', 'mjs']);

let extractedCount = 0;

for (const doc of ['INSTALL.md', 'README.md']) {
  const lines = readFileSync(path.join(repoRoot, doc), 'utf8').split('\n');
  let open = null;

  lines.forEach((line, i) => {
    if (!open) {
      const m = /^```(\S*)\s*$/.exec(line);
      if (m) open = { lang: m[1], start: i + 1, buf: [] };
      return;
    }
    if (/^```\s*$/.test(line)) {
      if (langs.has(open.lang)) {
        const code = open.buf.join('\n') + '\n';
        let target = `samples/${doc.replace('.md', '')}-${open.start}.${open.lang}`;

        const first = /^\/\/\s*(.+)$/.exec(open.buf[0] ?? '');
        if (first) {
          const alts = first[1].split('/').map((s) => s.trim()).filter(Boolean);
          // "app/api/feedback/route.ts" contains slashes too — only treat
          // as alternative whole filenames when every piece looks like one.
          const wholeNames = alts.length > 0 && alts.every((a) => /^[\w.()[\]-]+\.[a-z]+$/.test(a));
          if (wholeNames && alts.length > 1) {
            target = alts.find((a) => a.endsWith('.' + open.lang)) ?? alts[0];
          } else if (/\.[a-z]+$/.test(first[1].trim())) {
            target = first[1].trim();
          }
        }

        const out = path.join(here, target);
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, code);
        extractedCount++;
        console.log(`${doc}:${open.start} -> ${target}`);
      }
      open = null;
      return;
    }
    open.buf.push(line);
  });
}

if (extractedCount === 0) {
  console.error('extract-samples: found no ts/tsx/js/mjs blocks in INSTALL.md or README.md');
  process.exit(1);
}
console.log(`extract-samples: wrote ${extractedCount} file(s)`);
