import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTestKey } from '../helpers/rsa-keys.js';
import { createStubGithub, type StubGithub } from './helpers/stub-github.js';
import { runCli } from './helpers/run-cli.js';

// Design §"Install contract": doctor reports PASS/WARN/FAIL with a
// one-line reason and **never** prints a secret — no key material, no
// token, no JWT. This file plants markers in the two secrets doctor ever
// touches (the private key and the minted installation token) and
// asserts they never appear in stdout or stderr, across every output
// mode doctor has (the default human report and `--json`) and across
// both a failing run (bad key) and a fully successful one (a real key,
// a real mint against the stub).

const key = generateTestKey();

// A real RSA key, but with the marker spliced into the *middle* of its
// base64 body (not merely prepended — parsePrivateKey's PEM regex would
// still find a valid BEGIN/END block and happily ignore leading noise,
// which would make this "bad key" scenario accidentally pass). Splicing
// the marker into the body corrupts the base64 alphabet, so this is a
// genuine parse failure that still carries something reporter-shaped to
// check for.
const KEY_MARKER = 'MARKER-KEY-b4d8f0a1-do-not-print-me';
const hostileKey = (() => {
  const lines = key.pkcs1Pem.split('\n');
  const midpoint = Math.floor(lines.length / 2);
  return [...lines.slice(0, midpoint), KEY_MARKER, ...lines.slice(midpoint)].join('\n');
})();

let stub: StubGithub;

beforeEach(async () => {
  stub = await createStubGithub();
  stub.setLabels(['source:in-app', 'app:example-app', 'env:uat']);
});

afterEach(async () => {
  await stub.close();
});

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
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

/** The stub's fixed token string (see test/bin/helpers/stub-github.ts) —
 * used to assert the *real, successfully minted* token never appears in
 * output either, not just a marker planted in a failure path. */
const STUB_TOKEN = 'stub-installation-token';

/** A slice of the real key's base64 body, long enough that it could only
 * appear in output if the raw PEM leaked, not as an accidental
 * substring collision. */
const KEY_BODY_SLICE = key.pkcs1Pem
  .split('\n')
  .filter((line) => !line.includes('-----'))
  .join('')
  .slice(0, 40);

/** Matches a JWT's three-dot-separated base64url shape (doctor's
 * githubAppAuth() dependency signs one internally to mint the
 * installation token — see src/github/jwt.ts — but never hands it back
 * to doctor's own checks, so there's no literal JWT string on hand to
 * assert the absence of; this catches the *shape* instead). `eyJ` is the
 * base64 of `{"` — every JWT header starts with it. */
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

function assertNoSecrets(output: string): void {
  expect(output).not.toContain(KEY_MARKER);
  expect(output).not.toContain(STUB_TOKEN);
  expect(output).not.toContain(KEY_BODY_SLICE);
  expect(output).not.toContain('-----BEGIN');
  expect(output).not.toContain('-----END');
  expect(output).not.toMatch(JWT_SHAPE);
}

describe('doctor: no secret ever reaches stdout or stderr', () => {
  it('a malformed key carrying a marker: human output', async () => {
    const result = await runCli(['doctor'], baseEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: hostileKey }));

    expect(result.exitCode).toBe(1);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
  });

  it('a malformed key carrying a marker: --json output', async () => {
    const result = await runCli(['doctor', '--json'], baseEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: hostileKey }));

    expect(result.exitCode).toBe(1);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
    // Round-trips as JSON even though every check failed or was skipped.
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it('a full success — real key, real mint against the stub: human output never carries the key or the minted token', async () => {
    const result = await runCli(['doctor'], baseEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem }));

    expect(result.exitCode).toBe(0);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
  });

  it('a full success: --json output never carries the key or the minted token', async () => {
    const result = await runCli(['doctor', '--json'], baseEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem }));

    expect(result.exitCode).toBe(0);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
  });

  it('base64-of-PEM input: the raw base64 key text never leaks even when parsing fails', async () => {
    const hostileBase64 = Buffer.from(hostileKey, 'utf8').toString('base64');
    const result = await runCli(['doctor'], baseEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: hostileBase64 }));

    expect(result.exitCode).toBe(1);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
    expect(result.stdout).not.toContain(hostileBase64.slice(0, 40));
  });

  it('a raw private key pasted as a stray positional argument is never echoed in the usage error', async () => {
    // "-----BEGIN..." starts with '-', so it looks flag-shaped to the
    // parser before it's rejected as an unexpected positional argument —
    // exactly the path that used to interpolate the raw token.
    const result = await runCli(['doctor', key.pkcs1Pem], {});

    expect(result.exitCode).toBe(2);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
    expect(result.stderr).toMatch(/unexpected argument|unknown flag/);
  });

  it('a base64-of-PEM key pasted as a stray positional argument is never echoed in the usage error', async () => {
    const pkcs1Base64 = Buffer.from(key.pkcs1Pem, 'utf8').toString('base64');
    const result = await runCli(['doctor', pkcs1Base64], {});

    expect(result.exitCode).toBe(2);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
    expect(result.stderr).not.toContain(pkcs1Base64.slice(0, 40));
    expect(result.stderr).toContain('unexpected argument');
  });

  it("a base64-of-PEM key handed to --limiter (which takes 'memory'/'shared') is never echoed in the usage error", async () => {
    const pkcs1Base64 = Buffer.from(key.pkcs1Pem, 'utf8').toString('base64');
    const result = await runCli(['doctor', '--limiter', pkcs1Base64], {});

    expect(result.exitCode).toBe(2);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
    expect(result.stderr).not.toContain(pkcs1Base64.slice(0, 40));
    expect(result.stderr).toContain("'--limiter' must be 'memory' or 'shared'");
  });

  it("a hostile mint-failure response body never leaks through token-mint's FAIL reason", async () => {
    // FeedbackCredentialError's message is always a fixed, static string
    // (src/github/errors.ts) — never derived from the response body —
    // but this is the regression test that would catch it if that ever
    // changed. The stub's simulated-401 body itself never carries the
    // marker (that would only prove the stub is safe); the point is
    // that doctor's own FAIL reason for a real 401 contains no response
    // body content at all, hostile or not.
    stub.setMintStatus(401);
    const result = await runCli(['doctor'], baseEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem }));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] token-mint');
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
  });
});

// Gate R finding 1: doctor still printed two secret-shaped arguments
// verbatim — (a) src/bin/doctor.ts's unknown-command message, and (b)
// src/doctor/checks.ts's invalid-origins message. Both reproductions
// below are the literal ones from the finding; the rest of this block
// is "one per remaining echo site" the same finding asked for, so every
// call site describeArg() now guards (src/doctor/redact.ts) has a
// black-box regression test here, not just the two named ones.

describe('Gate R finding 1: every value that can reach a message is redacted', () => {
  it('(a) papergiant-feedback "<PEM>": an unknown top-level command never echoes a pasted PEM', async () => {
    // The PEM is the very first argv token — command dispatch in
    // src/bin/doctor.ts, before "doctor" subcommand parsing even starts.
    const result = await runCli([key.pkcs1Pem], {});

    expect(result.exitCode).toBe(2);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
    expect(result.stderr).toContain('unknown command');
  });

  it('(a) papergiant-feedback "<base64-of-PEM>": an unknown top-level command never echoes it either', async () => {
    const pkcs1Base64 = Buffer.from(key.pkcs1Pem, 'utf8').toString('base64');
    const result = await runCli([pkcs1Base64], {});

    expect(result.exitCode).toBe(2);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
    expect(result.stderr).not.toContain(pkcs1Base64.slice(0, 40));
    expect(result.stderr).toContain('unknown command');
  });

  it('(b) doctor --origins "<PEM>": an invalid origin never echoes a pasted PEM', async () => {
    const result = await runCli(['doctor', '--origins', key.pkcs1Pem], baseEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem }));

    // A check FAILing (origins-well-formed) is exit 1, not a usage
    // error — --origins accepts any string at parse time; the format is
    // only checked once the origins-well-formed check runs.
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] origins-well-formed');
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
  });

  it('(b) doctor --origins "<base64-of-PEM>": an invalid origin never echoes it either', async () => {
    const pkcs1Base64 = Buffer.from(key.pkcs1Pem, 'utf8').toString('base64');
    const result = await runCli(['doctor', '--origins', pkcs1Base64], baseEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem }));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] origins-well-formed');
    expect(result.stdout).not.toContain(pkcs1Base64.slice(0, 40));
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
  });

  it('a long intake repository name is never echoed in the token-mint, repo-has-issues or repo-private PASS reasons', async () => {
    // config.intake reaches these three PASS-path messages only once
    // githubAppAuth() has already accepted it as "owner/name"-shaped and
    // the stub has minted against it — it can't carry a raw newline or
    // "-----" through a URL path segment, but length alone is enough to
    // exercise the fix (describeArg redacts by length too), so this
    // uses a long, URL-path-safe marker rather than a literal PEM.
    const intakeMarker = `owner/MARKER-INTAKE-${'A'.repeat(40)}`;
    const result = await runCli(
      ['doctor'],
      baseEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem, FEEDBACK_INTAKE_REPOSITORY: intakeMarker }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[PASS] token-mint');
    expect(result.stdout).toContain('[PASS] repo-has-issues');
    expect(result.stdout).toContain('[PASS] repo-private');
    expect(result.stdout).not.toContain(intakeMarker);
    expect(result.stdout).not.toContain('MARKER-INTAKE');
    expect(result.stdout).toMatch(/\d+ characters, not echoed/);
  });

  it('a long intake repository name is never echoed in github-api.ts\'s "GET /repos/... returned NNN" FAIL reason', async () => {
    stub.setRepo({ status: 500 });
    const intakeMarker = `owner/MARKER-INTAKE-${'B'.repeat(40)}`;
    const result = await runCli(
      ['doctor'],
      baseEnv({ FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem, FEEDBACK_INTAKE_REPOSITORY: intakeMarker }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] repo-has-issues');
    expect(result.stdout).toContain('returned 500');
    expect(result.stdout).not.toContain(intakeMarker);
    expect(result.stdout).not.toContain('MARKER-INTAKE');
  });

  it('a long, base64-shaped label is never echoed in the missing-labels FAIL reason', async () => {
    const labelMarker = Buffer.from('MARKER-LABEL-do-not-print-me-0123456789', 'utf8').toString('base64');
    const result = await runCli(
      ['doctor'],
      baseEnv({
        FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem,
        FEEDBACK_LABELS: `source:in-app,app:example-app,env:uat,${labelMarker}`,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] labels-exist');
    expect(result.stdout).toContain('missing labels');
    expect(result.stdout).not.toContain(labelMarker);
    expect(result.stdout).not.toContain('MARKER-LABEL');
  });

  it('a long, base64-shaped label is never echoed in github-api.ts\'s "GET .../labels/... returned NNN" FAIL reason', async () => {
    stub.setLabelStatus(500);
    const labelMarker = Buffer.from('MARKER-LABEL-status-path-0123456789', 'utf8').toString('base64');
    const result = await runCli(
      ['doctor'],
      baseEnv({
        FEEDBACK_GITHUB_PRIVATE_KEY: key.pkcs1Pem,
        FEEDBACK_LABELS: labelMarker,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[FAIL] labels-exist');
    expect(result.stdout).toContain('returned 500');
    expect(result.stdout).not.toContain(labelMarker);
    expect(result.stdout).not.toContain('MARKER-LABEL');
  });

  // The top-level exception handler (src/bin/doctor.ts's `.catch()`) is
  // covered by test/bin/redact.test.ts's direct tests of describeArg()
  // rather than a test here: every path that could realistically hand
  // it attacker-controlled content is already caught, and converted to
  // a safe generic message, deeper in the stack (checkTokenMint's own
  // try/catch, the origin/URL parsers' own try/catches, etc — see the
  // comment on that handler), so there is no black-box way to reach it
  // with a marker in hand without deliberately weakening one of those
  // guards just to exercise this one. What the handler actually does —
  // run the caught message through describeArg() before printing it —
  // is exactly what redact.test.ts verifies directly.
});
