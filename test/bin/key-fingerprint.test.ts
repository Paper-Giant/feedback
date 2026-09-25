import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { computeKeyInfo } from '../../dist/doctor/key-info.js';
import { generateTestKey } from '../helpers/rsa-keys.js';

// Fix review, item 4: doctor's key-parses PASS reason must print the
// fingerprint the way GitHub documents its own key fingerprints —
// `SHA256:` followed by the (padded) base64 of the SHA-256 of the public
// key's SPKI DER — i.e. exactly what
//
//   openssl rsa -in key.pem -pubout -outform DER \
//     | openssl sha256 -binary | openssl base64
//
// prints, with that prefix added. Verified against the real openssl
// pipeline (chained via execFileSync's `input`, not a shell, so there's
// no shell-injection surface) when openssl is on PATH; against an
// independent node:crypto computation otherwise, so the test still means
// something in an environment without openssl.

function opensslAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const key = generateTestKey();

describe("computeKeyInfo(): the fingerprint matches GitHub's own SHA256: format", () => {
  it('matches the openssl pipeline GitHub documents, or an independent node:crypto computation', () => {
    let expected: string;

    if (opensslAvailable()) {
      const dir = mkdtempSync(join(tmpdir(), 'feedback-doctor-fingerprint-'));
      const keyPath = join(dir, 'key.pem');
      writeFileSync(keyPath, key.pkcs1Pem, 'utf8');

      const der = execFileSync('openssl', ['rsa', '-in', keyPath, '-pubout', '-outform', 'DER']);
      const digest = execFileSync('openssl', ['sha256', '-binary'], { input: der });
      const base64 = execFileSync('openssl', ['base64'], { input: digest }).toString('utf8').trim();
      expected = `SHA256:${base64}`;
    } else {
      // Written directly against node:crypto here, independently of
      // src/doctor/key-info.ts's own implementation, so this branch
      // still catches a regression in that module rather than only
      // confirming the module agrees with itself.
      const privateKey = createPrivateKey({ key: key.pkcs1Pem, format: 'pem' });
      const publicKey = createPublicKey(privateKey);
      const der = publicKey.export({ type: 'spki', format: 'der' });
      expected = `SHA256:${createHash('sha256').update(der).digest('base64')}`;
    }

    const info = computeKeyInfo(key.pkcs1Pem);

    expect(info.spkiSha256).toBe(expected);
    expect(info.spkiSha256).toMatch(/^SHA256:[A-Za-z0-9+/]+=*$/);
  });

  it('is the same fingerprint regardless of which of the four accepted key forms is given', () => {
    const fromPkcs1Pem = computeKeyInfo(key.pkcs1Pem).spkiSha256;
    const fromPkcs8Pem = computeKeyInfo(key.pkcs8Pem).spkiSha256;
    const fromPkcs1Base64 = computeKeyInfo(key.pkcs1Base64).spkiSha256;
    const fromPkcs8Base64 = computeKeyInfo(key.pkcs8Base64).spkiSha256;

    expect(fromPkcs1Pem).toBeDefined();
    expect(fromPkcs8Pem).toBe(fromPkcs1Pem);
    expect(fromPkcs1Base64).toBe(fromPkcs1Pem);
    expect(fromPkcs8Base64).toBe(fromPkcs1Pem);
  });
});
