// Test-only helper: generates RSA key material with `node:crypto` (never
// imported from `src/`) so `test/github-*.test.ts` can exercise
// `parsePrivateKey`'s PKCS#1/PKCS#8, PEM/base64 forms against a real key,
// and verify signatures independently of the module under test.
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';

export interface TestKeyMaterial {
  /** PEM PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`) — the format GitHub issues. */
  pkcs1Pem: string;
  /** PEM PKCS#8 (`-----BEGIN PRIVATE KEY-----`) of the same key. */
  pkcs8Pem: string;
  /** Base64 of `pkcs1Pem`, as a single-line environment variable would carry it. */
  pkcs1Base64: string;
  /** Base64 of `pkcs8Pem`. */
  pkcs8Base64: string;
  /** SPKI PEM public key, for verifying signatures made with the private key. */
  publicKeyPem: string;
}

export function generateTestKey(modulusLength = 2048): TestKeyMaterial {
  const { privateKey: pkcs1Pem, publicKey: publicKeyPem } = generateKeyPairSync('rsa', {
    modulusLength,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const pkcs8Pem = createPrivateKey({ key: pkcs1Pem, format: 'pem', type: 'pkcs1' })
    .export({ format: 'pem', type: 'pkcs8' })
    .toString();

  return {
    pkcs1Pem,
    pkcs8Pem,
    pkcs1Base64: Buffer.from(pkcs1Pem, 'utf8').toString('base64'),
    pkcs8Base64: Buffer.from(pkcs8Pem, 'utf8').toString('base64'),
    publicKeyPem,
  };
}
