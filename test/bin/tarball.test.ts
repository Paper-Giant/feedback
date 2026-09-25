import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTestKey } from '../helpers/rsa-keys.js';
import { createStubGithub, type StubGithub } from './helpers/stub-github.js';

const execFileAsync = promisify(execFile);

// Build plan P11: "a test that runs doctor from a freshly packed
// tarball installed into a temp directory". This proves doctor works
// the way a real consumer gets it — `npm install @papergiant/feedback`
// then the package's one bin script — not just via
// `node dist/bin/doctor.js` inside this repo's own tree, which is what
// every other test/bin/*.test.ts file runs.
//
// The install itself must make no real network call: `--offline` makes
// npm fail loudly rather than silently reaching the registry if it ever
// needed to, which is the verification the fix review asked for, not
// just a comment claiming it; `--ignore-scripts` skips any lifecycle
// script (this package has none, but a future dependency might);
// `--no-audit --no-fund` skip npm's own registry-touching extras. The
// tarball is installed from a local file path, so ordinary dependency
// resolution needs no registry lookup regardless — `--offline` is what
// turns "shouldn't need the network" into "will fail here if it did".
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('doctor: from a freshly packed tarball, installed with no network access', () => {
  let installDir: string;
  let binPath: string;

  beforeAll(() => {
    const packDir = mkdtempSync(join(tmpdir(), 'feedback-doctor-pack-'));
    const packOutput = execFileSync('npm', ['pack', '--json', `--pack-destination=${packDir}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const [{ filename }] = JSON.parse(packOutput) as Array<{ filename: string }>;
    const tarballPath = join(packDir, filename);

    installDir = mkdtempSync(join(tmpdir(), 'feedback-doctor-install-'));
    execFileSync('npm', ['init', '--yes'], { cwd: installDir, stdio: 'ignore' });
    execFileSync(
      'npm',
      ['install', tarballPath, '--no-audit', '--no-fund', '--ignore-scripts', '--legacy-peer-deps', '--offline'],
      { cwd: installDir, stdio: 'ignore' },
    );

    // The package's one bin script, exactly as `npm install` links it —
    // run directly rather than through `npx`, which has its own
    // resolution logic (and, unlike this, a registry-fallback path) on
    // top of what's already installed.
    binPath = join(installDir, 'node_modules', '.bin', 'papergiant-feedback');
  }, 120_000);

  it('the installed bin script exists at node_modules/.bin/papergiant-feedback and runs', () => {
    // execFileSync throws if the file is missing or not executable —
    // this is the explicit, named assertion for that, so a failure here
    // reads as "the bin didn't link" rather than a confusing ENOENT in
    // one of the tests below.
    expect(() => execFileSync(binPath, ['doctor', '--help'], { encoding: 'utf8' })).not.toThrow();
  });

  it('doctor --help works, run directly (no configuration needed)', () => {
    const output = execFileSync(binPath, ['doctor', '--help'], { encoding: 'utf8' });

    expect(output).toContain('Usage: papergiant-feedback doctor');
    expect(output).toContain('FEEDBACK_GITHUB_PRIVATE_KEY');
  });

  describe('a full run against a local stub GitHub', () => {
    const key = generateTestKey();
    let stub: StubGithub;

    beforeAll(async () => {
      stub = await createStubGithub();
      stub.setLabels(['source:in-app', 'app:example-app', 'env:uat']);
    });

    afterAll(async () => {
      await stub.close();
    });

    it('exits 0 with every check passing, using FEEDBACK_GITHUB_API_BASE_URL from the real environment', async () => {
      // Deliberately the *async* execFile (promisified), not
      // execFileSync: the stub GitHub above is a node:http server
      // running in this very test process's event loop.
      // execFileSync blocks that event loop until the child exits, so
      // the child's request could never even reach it — a synchronous
      // spawn cannot talk to a server its own parent is hosting.
      // (runCli() in test/bin/helpers/run-cli.ts, used by every other
      // file in this directory, already gets this right; this file's
      // first version didn't, and hung until its 10-second internal
      // timeout every time before this fix.)
      const { stdout } = await execFileAsync(binPath, ['doctor'], {
        env: {
          ...process.env,
          FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem,
          FEEDBACK_GITHUB_CLIENT_ID: 'Iv1.testclient',
          FEEDBACK_GITHUB_INSTALLATION_ID: '12345',
          FEEDBACK_INTAKE_REPOSITORY: 'acme/intake-repo',
          FEEDBACK_APP_URL: 'https://app.example',
          FEEDBACK_ORIGINS: 'https://app.example,https://staging.app.example',
          FEEDBACK_LABELS: 'source:in-app,app:example-app,env:uat',
          FEEDBACK_GITHUB_API_BASE_URL: stub.url,
        },
      });

      expect(stdout).toContain('All checks passed.');
      expect(stdout).not.toContain('FAIL');
    });
  });
});
