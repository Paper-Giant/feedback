import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Keeps INSTALL.md honest as the package's public API moves (task P12).
 *
 * Every fenced ```ts / ```tsx / ```js / ```mjs code block in INSTALL.md is
 * a promise about this package's real exported surface (js/mjs included
 * because next.config.mjs and astro.config.mjs samples import from this
 * package too, and a plain-JS sample drifting from the real exports is
 * exactly as wrong as a TS one). This test extracts each such block,
 * finds every `import { ... } from '@papergiant/feedback...'` statement
 * in it, and checks that:
 *
 *  - the entry point (`@papergiant/feedback`, `@papergiant/feedback/react`,
 *    …) is one package.json's own `exports` map actually declares, and
 *  - every named import is really exported from that entry's *built*
 *    declaration file (`dist/*'/index.d.ts`, read from disk — not from
 *    source, so a build that silently fails to emit an export this doc
 *    relies on is caught the same way a consumer's install would hit it).
 *
 * This does not typecheck the samples in full (no bundler config, host
 * types like `Request`/Next's `env`, etc. are in scope) — it is a floor,
 * not a ceiling: it cannot pass while a code sample imports a name this
 * package doesn't export, which is the specific way these docs have
 * drifted from the code before.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const installMdPath = path.join(repoRoot, 'INSTALL.md');
const packageJsonPath = path.join(repoRoot, 'package.json');

interface FencedBlock {
  lang: string;
  code: string;
  /** 1-based line number of the block's opening fence, for error messages. */
  line: number;
}

/**
 * Extracts every top-level fenced code block from a Markdown document.
 * Deliberately simple (no nested-fence handling beyond "the closing fence
 * is a line that is exactly ``` "), which is exactly what INSTALL.md's own
 * fences (plain ```lang / ``` pairs) need.
 */
function extractFencedBlocks(markdown: string): FencedBlock[] {
  const lines = markdown.split('\n');
  const blocks: FencedBlock[] = [];
  let open: { lang: string; startLine: number; buffer: string[] } | null = null;

  lines.forEach((line, index) => {
    if (!open) {
      const start = /^```(\S*)\s*$/.exec(line);
      if (start) {
        open = { lang: start[1] ?? '', startLine: index + 1, buffer: [] };
      }
      return;
    }
    if (/^```\s*$/.test(line)) {
      blocks.push({ lang: open.lang, code: open.buffer.join('\n'), line: open.startLine });
      open = null;
      return;
    }
    open.buffer.push(line);
  });

  return blocks;
}

interface PackageImport {
  specifier: string;
  /** The externally-visible names this statement imports (alias, when one is given — never the source-side name before `as`). */
  names: string[];
}

/**
 * Finds every `import { ... } from '@papergiant/feedback...'` (optionally
 * `import type { ... }`) in a code block. Only named imports are looked
 * for — INSTALL.md never uses a default or namespace import from this
 * package, and this package's `exports` map has no default export to
 * check one against anyway.
 */
function extractPackageImports(code: string): PackageImport[] {
  // Matches any `import { ... } from '...'`, with the specifier
  // unconstrained — deliberately not filtered to '@papergiant/feedback'
  // inside the regex itself. An earlier version anchored the specifier
  // here, and when a block's *first* import was some other package (e.g.
  // `import { Hono } from 'hono';` immediately before the package
  // import), a failed match on that first statement's specifier made the
  // regex engine backtrack `[^}]*` rightward past that import's own
  // closing brace and merge it with the *next* import statement's names
  // — silently checking the wrong name list against the right specifier.
  // `[^}]*` can't cross a `}` at all, so each match is exactly one
  // statement's brace list; filtering by specifier happens below instead.
  const importRegex = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  const results: PackageImport[] = [];
  for (const match of code.matchAll(importRegex)) {
    const [, namesList, specifier] = match;
    if (!specifier.startsWith('@papergiant/feedback')) continue;
    const names = namesList
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.replace(/^type\s+/, ''))
      .map((entry) => {
        const parts = entry.split(/\s+as\s+/).map((part) => part.trim());
        return parts[parts.length - 1];
      });
    results.push({ specifier, names });
  }
  return results;
}

/** package.json's own `exports` map, keyed the way INSTALL.md's import specifiers are written. */
function loadEntryPointFiles(): Map<string, string> {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    exports?: Record<string, { types?: string }>;
  };
  const map = new Map<string, string>();
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    if (!target.types) continue;
    const specifier =
      subpath === '.' ? '@papergiant/feedback' : `@papergiant/feedback/${subpath.replace(/^\.\//, '')}`;
    map.set(specifier, path.resolve(repoRoot, target.types));
  }
  return map;
}

const DECLARE_NAME = /export\s+declare\s+(?:function|class|const)\s+([A-Za-z_$][\w$]*)/g;
const INTERFACE_NAME = /export\s+interface\s+([A-Za-z_$][\w$]*)/g;
const ENUM_NAME = /export\s+enum\s+([A-Za-z_$][\w$]*)/g;
// `export type Foo = …` / `export type Foo<T> = …` — but not `export type { … }`,
// which the alternation's lack of a following `=` naturally excludes.
const TYPE_ALIAS_NAME = /export\s+type\s+([A-Za-z_$][\w$]*)\s*(?:<[^={]*>)?\s*=/g;
// The `from '...'` clause is deliberately OPTIONAL here: `export { A, B };`
// and `export type { A, B };`, with no `from` at all, are how tsc emits a
// LOCAL re-export of names a file already imported under a type-only
// import elsewhere in itself (e.g. dist/react/index.d.ts's `export type {
// FeedbackBuild, FeedbackController, ... };`, re-exporting names it
// imported from '../browser/index.js' higher up in the same file) — an
// earlier version of this regex required `from` and silently missed every
// name exported this way. The specifier, when present, is only used by
// STAR_REEXPORT below; a plain re-export list never needs to recurse.
const REEXPORT_LIST = /export\s+(?:type\s+)?\{([\s\S]*?)\}(?:\s*from\s*['"][^'"]*['"])?/g;
const STAR_REEXPORT = /export\s+\*\s+from\s*['"]([^'"]+)['"]/g;

/**
 * Every name a built declaration file exports, following a local
 * `export { … };` / `export type { … };`, a cross-file `export { … }
 * from` / `export type { … } from`, and `export * from` (recursively —
 * `dist/index.d.ts` is nothing but `export * from './core/index.js'`, for
 * instance). Reads only `dist/`, never `src/`, so this reflects what a
 * consumer installing the package actually gets.
 */
function exportedNamesOf(filePath: string, visited: Set<string> = new Set()): Set<string> {
  const resolved = path.resolve(filePath);
  if (visited.has(resolved) || !existsSync(resolved)) return new Set();
  visited.add(resolved);

  const text = readFileSync(resolved, 'utf8');
  const names = new Set<string>();

  for (const m of text.matchAll(DECLARE_NAME)) names.add(m[1]);
  for (const m of text.matchAll(INTERFACE_NAME)) names.add(m[1]);
  for (const m of text.matchAll(ENUM_NAME)) names.add(m[1]);
  for (const m of text.matchAll(TYPE_ALIAS_NAME)) names.add(m[1]);

  for (const m of text.matchAll(REEXPORT_LIST)) {
    const [, list] = m;
    for (const rawEntry of list.split(',')) {
      const entry = rawEntry.trim().replace(/^type\s+/, '');
      if (!entry) continue;
      const parts = entry.split(/\s+as\s+/).map((part) => part.trim());
      const exportedName = parts[parts.length - 1];
      if (exportedName) names.add(exportedName);
    }
  }

  for (const m of text.matchAll(STAR_REEXPORT)) {
    const [, specifier] = m;
    const targetFile = path.resolve(path.dirname(resolved), specifier.replace(/\.js$/, '.d.ts'));
    for (const name of exportedNamesOf(targetFile, visited)) names.add(name);
  }

  return names;
}

describe('INSTALL.md code samples import only real exports', () => {
  it('has been built — dist/index.d.ts exists (see the pretest script)', () => {
    expect(existsSync(path.join(repoRoot, 'dist', 'index.d.ts'))).toBe(true);
  });

  const CHECKED_LANGS = new Set(['ts', 'tsx', 'js', 'mjs']);
  const markdown = readFileSync(installMdPath, 'utf8');
  const tsBlocks = extractFencedBlocks(markdown).filter((block) => CHECKED_LANGS.has(block.lang));

  it('found at least one ```ts/```tsx/```js/```mjs code block in INSTALL.md to check', () => {
    expect(tsBlocks.length).toBeGreaterThan(0);
  });

  const entryPointFiles = loadEntryPointFiles();

  it("package.json declares at least one entry point ('exports')", () => {
    expect(entryPointFiles.size).toBeGreaterThan(0);
  });

  // Every (specifier, name) pair actually referenced across every ts/tsx
  // block, de-duplicated — one assertion per pair, with the block's own
  // line number in the failure message so a broken sample is easy to find.
  const referenced = new Map<string, { specifier: string; name: string; line: number }>();
  for (const block of tsBlocks) {
    for (const { specifier, names } of extractPackageImports(block.code)) {
      for (const name of names) {
        const key = `${specifier}::${name}`;
        if (!referenced.has(key)) {
          referenced.set(key, { specifier, name, line: block.line });
        }
      }
    }
  }

  it('found at least one @papergiant/feedback import to check', () => {
    expect(referenced.size).toBeGreaterThan(0);
  });

  const exportsByEntry = new Map<string, Set<string>>();

  for (const { specifier, name, line } of referenced.values()) {
    it(`INSTALL.md:${line} — '${specifier}' really exports '${name}'`, () => {
      expect(
        entryPointFiles.has(specifier),
        `INSTALL.md:${line} imports from '${specifier}', which is not an entry point ` +
          `package.json's "exports" map declares. Known entry points: ` +
          `${[...entryPointFiles.keys()].sort().join(', ')}`,
      ).toBe(true);

      const entryFile = entryPointFiles.get(specifier)!;
      if (!exportsByEntry.has(specifier)) {
        exportsByEntry.set(specifier, exportedNamesOf(entryFile));
      }
      const available = exportsByEntry.get(specifier)!;

      expect(
        available.has(name),
        `INSTALL.md:${line} imports '${name}' from '${specifier}', but the built ` +
          `declaration file (${path.relative(repoRoot, entryFile)}) does not export it. ` +
          `Known exports of '${specifier}': ${[...available].sort().join(', ')}`,
      ).toBe(true);
    });
  }
});
