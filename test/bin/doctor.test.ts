import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTestKey } from '../helpers/rsa-keys.js';
import { createStubGithub, type StubGithub } from './helpers/stub-github.js';
import { runCli } from './helpers/run-cli.js';

// Design §"Install contract": doctor is read-only and checks — required
// environment names present; the private key parses; an installation
// token mints narrowed to the intake repository; the repository has
// issues enabled and is private (WARN if public); the configured labels
// exist; the configured origins are well-formed and include the app
// URL's origin; and a warning when an in-process limiter is configured
// for production without declaring the host single-instance.
//
// Every scenario here runs the **built** CLI (dist/bin/doctor.js)
// against a local stub GitHub (test/bin/helpers/stub-github.ts) and a
// key generated at test time — never real GitHub.

const key = generateTestKey();

let stub: StubGithub;

beforeEach(async () => {
  stub = await createStubGithub();
  stub.setLabels(['source:in-app', 'app:example-app', 'env:uat']);
});

afterEach(async () => {
  await stub.close();
});

/** A fully valid configuration pointed at the local stub, with `overrides`
 * layered on top for the individual-FAIL scenarios below. */
function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem,
    FEEDBACK_GITHUB_CLIENT_ID: 'Iv1.testclient',
    FEEDBACK_GITHUB_INSTALLATION_ID: '12345',
    FEEDBACK_INTAKE_REPOSITORY: 'acme/intake-repo',
    FEEDBACK_APP_URL: 'https://app.example',
    FEEDBACK_ORIGINS: 'https://app.example,https://staging.app.example',
    FEEDBACK_LABELS: 'source:in-app,app:example-app,env:uat',
    FEEDBACK_GITHUB_API_BASE_URL: stub.url,
    ...overrides,
  };
}

describe('doctor: all checks pass', () => {
  it('exits 0 and reports PASS for every check', async () => {
    const result = await runCli(['doctor'], validEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    for (const id of [
      'required-names',
      'key-parses',
      'token-mint',
      'repo-has-issues',
      'repo-private',
      'labels-exist',
      'origins-well-formed',
      'app-url-in-origins',
      'limiter-production',
    ]) {
      expect(result.stdout).toContain(`[PASS] ${id}`);
    }
    expect(result.stdout).not.toContain('FAIL');
    expect(result.stdout).not.toContain('WARN');
    expect(result.stdout).toMatch(/All checks passed\./);
  });
});

describe('doctor: individual FAIL scenarios', () => {
  it('missing env: required-names FAILs and exit code is 1', async () => {
    const result = await runCli(['doctor'], {});

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] required-names');
    expect(result.stdout).toContain('FEEDBACK_GITHUB_PRIVATE_KEY');
    expect(result.stdout).toContain('FEEDBACK_LABELS');
  });

  it('bad key: key-parses FAILs with a fixed, safe reason and exit code is 1', async () => {
    const result = await runCli(['doctor'], validEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: 'not a key at all' }));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] key-parses');
    expect(result.stdout).toContain('could not parse private key');
  });

  it('mint 401: token-mint FAILs and exit code is 1', async () => {
    stub.setMintStatus(401);
    const result = await runCli(['doctor'], validEnv());

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] token-mint');
    expect(result.stdout).toMatch(/401/);
    // key-parses is independent of the mint outcome and should still pass.
    expect(result.stdout).toContain('[PASS] key-parses');
  });

  it('repo without issues: repo-has-issues FAILs while repo-private still passes, exit code is 1', async () => {
    stub.setRepo({ hasIssues: false, isPrivate: true });
    const result = await runCli(['doctor'], validEnv());

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] repo-has-issues');
    expect(result.stdout).toContain('[PASS] repo-private');
    expect(result.stdout).toContain('[PASS] token-mint');
  });

  it('missing label: labels-exist FAILs listing the missing name, other checks unaffected, exit code is 1', async () => {
    stub.setLabels(['source:in-app', 'app:example-app']); // env:uat is missing
    const result = await runCli(['doctor'], validEnv());

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/\[FAIL\] labels-exist.*env:uat/);
    expect(result.stdout).not.toMatch(/labels-exist.*source:in-app/);
    expect(result.stdout).toContain('[PASS] token-mint');
    expect(result.stdout).toContain('[PASS] repo-has-issues');
  });

  it('bad origin: origins-well-formed FAILs, other checks unaffected, exit code is 1', async () => {
    const result = await runCli(['doctor'], validEnv({ FEEDBACK_ORIGINS: 'https://app.example/with/a/path' }));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] origins-well-formed');
    expect(result.stdout).toContain('[PASS] token-mint');
  });

  it("app URL not in origins: app-url-in-origins FAILs while origins-well-formed still passes, exit code is 1", async () => {
    const result = await runCli(['doctor'], validEnv({ FEEDBACK_APP_URL: 'https://not-listed.example' }));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] app-url-in-origins');
    expect(result.stdout).toContain('[PASS] origins-well-formed');
  });
});

describe('doctor: WARN scenarios', () => {
  it('a public intake repository WARNs on repo-private but does not fail the run', async () => {
    stub.setRepo({ hasIssues: true, isPrivate: false });
    const result = await runCli(['doctor'], validEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[WARN] repo-private');
    expect(result.stdout).toContain('[PASS] repo-has-issues');
    expect(result.stdout).toMatch(/warning/);
  });

  it('--limiter memory --production without --single-instance WARNs but does not fail the run', async () => {
    const result = await runCli(['doctor', '--limiter', 'memory', '--production'], validEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[WARN] limiter-production');
  });

  it('--limiter memory --production --single-instance PASSes (the genuinely-single-instance exception)', async () => {
    const result = await runCli(
      ['doctor', '--limiter', 'memory', '--production', '--single-instance'],
      validEnv(),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[PASS] limiter-production');
  });

  it('--limiter shared --production PASSes without needing --single-instance', async () => {
    const result = await runCli(['doctor', '--limiter', 'shared', '--production'], validEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[PASS] limiter-production');
  });

  it('--limiter memory without --production PASSes (development/tests)', async () => {
    const result = await runCli(['doctor', '--limiter', 'memory'], validEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[PASS] limiter-production');
  });

  it('no --limiter given without --production PASSes (nothing to check)', async () => {
    const result = await runCli(['doctor'], validEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[PASS] limiter-production');
  });

  it('--production without --limiter WARNs (a production host must declare one)', async () => {
    const result = await runCli(['doctor', '--production'], validEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[WARN] limiter-production');
    expect(result.stdout).toContain('limiter not declared; pass --limiter shared|memory');
  });
});

describe('doctor --json', () => {
  it('prints a parseable report with the documented shape when every check passes', async () => {
    const result = await runCli(['doctor', '--json'], validEnv());

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      exitCode: number;
      checks: Array<{ id: string; description: string; status: string; reason: string }>;
    };
    expect(report.ok).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.checks).toHaveLength(9);
    for (const check of report.checks) {
      expect(typeof check.id).toBe('string');
      expect(check.id.length).toBeGreaterThan(0);
      expect(typeof check.description).toBe('string');
      expect(['pass', 'warn', 'fail']).toContain(check.status);
      expect(typeof check.reason).toBe('string');
    }
  });

  it('reflects a FAIL in the JSON shape too, with exit code 1', async () => {
    const result = await runCli(['doctor', '--json'], {});

    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as { ok: boolean; exitCode: number; checks: unknown[] };
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.checks).toHaveLength(9);
  });
});

describe('doctor: exit codes and dispatch', () => {
  it('exits 2 with no command at all', async () => {
    const result = await runCli([], {});
    expect(result.exitCode).toBe(2);
  });

  it('exits 2 for an unrecognised command', async () => {
    const result = await runCli(['not-a-real-command'], {});
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown command');
  });

  it('--help at the top level exits 0 and mentions doctor', async () => {
    const result = await runCli(['--help'], {});
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('doctor');
  });

  it('doctor --help exits 0 without requiring any configuration', async () => {
    const result = await runCli(['doctor', '--help'], {});
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: papergiant-feedback doctor');
    expect(result.stdout).toContain('FEEDBACK_GITHUB_PRIVATE_KEY');
  });

  it('exits 2 on an unknown flag, without running any check', async () => {
    const result = await runCli(['doctor', '--not-a-flag'], validEnv());
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown flag');
    expect(result.stdout).toBe('');
  });

  it('exits 2 when a value-taking flag is given no value', async () => {
    const result = await runCli(['doctor', '--intake'], {});
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('requires a value');
  });

  it("exits 2 when --limiter is given something other than 'memory'/'shared'", async () => {
    const result = await runCli(['doctor', '--limiter', 'bogus'], validEnv());
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("'memory' or 'shared'");
  });

  it('exits 2 for a bare positional argument', async () => {
    const result = await runCli(['doctor', 'positional'], validEnv());
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unexpected argument');
  });

  it('exits 2 for an unreadable --dotenv-file, before any check runs', async () => {
    const result = await runCli(['doctor', '--dotenv-file', '/nonexistent/path/does-not-exist.env'], {});
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--dotenv-file');
    expect(result.stdout).toBe('');
  });
});

describe('doctor: --intake owner/name validation', () => {
  it('a malformed --intake FAILs token-mint with a fixed, safe reason', async () => {
    const result = await runCli(['doctor'], validEnv({ FEEDBACK_INTAKE_REPOSITORY: 'not-owner-slash-name' }));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] token-mint');
    expect(result.stdout).toContain('owner/name');
  });
});

describe('doctor: a 3xx on the GETs is reported as an unexpected redirect', () => {
  it('a redirect on GET /repos/{owner}/{name} FAILs repo-has-issues and repo-private with "unexpected redirect"', async () => {
    stub.setRepo({ status: 302 });
    const result = await runCli(['doctor'], validEnv());

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/\[FAIL\] repo-has-issues\s+unexpected redirect/);
    expect(result.stdout).toMatch(/\[FAIL\] repo-private\s+unexpected redirect/);
    expect(result.stdout).not.toContain('could not reach GitHub');
  });

  it('a redirect on GET .../labels/{name} FAILs labels-exist with "unexpected redirect"', async () => {
    stub.setLabelStatus(301);
    const result = await runCli(['doctor'], validEnv());

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/\[FAIL\] labels-exist\s+unexpected redirect/);
    expect(result.stdout).not.toContain('could not reach GitHub');
  });
});

describe('doctor: FEEDBACK_GITHUB_API_BASE_URL safety (fix review)', () => {
  it('the token-mint PASS reason names a non-default API base URL ("via <url>")', async () => {
    const result = await runCli(['doctor'], validEnv());

    expect(result.exitCode).toBe(0);
    // The URL itself goes through describeArg() (Gate R finding 1) like
    // every other doctor-supplied value that reaches a message, so a
    // short, safe one like the stub's is echoed quoted.
    expect(result.stdout).toMatch(
      new RegExp(`\\[PASS\\] token-mint\\s+.*via '${stub.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
    );
  });

  it('refuses a plain http:// --api-base-url that is not loopback, before any check runs', async () => {
    const result = await runCli(['doctor', '--api-base-url', 'http://evil.example'], validEnv());

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('must be https://');
  });

  it('allows a plain http:// --api-base-url when the host is loopback (127.0.0.1, as the stub uses)', async () => {
    // validEnv() already points FEEDBACK_GITHUB_API_BASE_URL at
    // http://127.0.0.1:<port> (the stub) — this is the exception, not a
    // separate case, and every other test in this file already relies on
    // it implicitly. This test asserts it explicitly.
    expect(stub.url.startsWith('http://127.0.0.1:')).toBe(true);
    const result = await runCli(['doctor'], validEnv());
    expect(result.exitCode).toBe(0);
  });

  it('refuses an --api-base-url that is not a valid URL at all', async () => {
    const result = await runCli(['doctor', '--api-base-url', 'not a url'], validEnv());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('is not a valid URL');
  });
});
