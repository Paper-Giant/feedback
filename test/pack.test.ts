import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Proves the published tarball carries only what package.json's `files`
// field promises: dist/, sql/, and the root docs. Nothing from src/ or
// test/ should ever leave this repository in the published package.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const allowedRootFiles = new Set([
  'package.json',
  'README.md',
  'INSTALL.md',
  'SECURITY.md',
  'CHANGELOG.md',
  'LICENSE',
]);

interface PackEntry {
  path: string;
}

interface PackResult {
  files: PackEntry[];
}

describe('npm pack --dry-run file list', () => {
  it('contains only dist/, sql/, and the root docs', () => {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    const [result] = JSON.parse(output) as PackResult[];
    const paths = result.files.map((f) => f.path);

    expect(paths.length).toBeGreaterThan(0);

    for (const p of paths) {
      const topLevel = p.split('/')[0];
      const isAllowedRoot = allowedRootFiles.has(p);
      const isDist = topLevel === 'dist';
      const isSql = topLevel === 'sql';
      expect(isAllowedRoot || isDist || isSql, `unexpected packed file: ${p}`).toBe(true);
    }

    expect(paths.some((p) => p.startsWith('src/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('test/'))).toBe(false);
    expect(paths.some((p) => p === 'package-lock.json')).toBe(false);
    expect(paths).toContain('package.json');
    expect(paths).toContain('README.md');
    expect(paths).toContain('SECURITY.md');
    expect(paths).toContain('LICENSE');
    expect(paths.some((p) => p.startsWith('dist/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('sql/'))).toBe(true);
  });
});
