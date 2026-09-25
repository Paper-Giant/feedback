import { describe, expect, it, beforeAll } from 'vitest';
import { createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import { FeedbackCredentialError, parsePrivateKey } from '../dist/github/index.js';
import { generateTestKey, type TestKeyMaterial } from './helpers/rsa-keys.js';

// Design §"Credential": `parsePrivateKey` accepts PEM PKCS#1 (what GitHub
// issues), PEM PKCS#8, or base64 of either PEM (single-line env vars),
// tolerating surrounding whitespace and literal `\n` escapes. A garbage
// key throws `FeedbackCredentialError` without echoing the input.

let key: TestKeyMaterial;

beforeAll(() => {
  key = generateTestKey();
});

async function signsAndVerifies(cryptoKey: CryptoKey, publicKeyPem: string): Promise<boolean> {
  const data = new TextEncoder().encode('parsePrivateKey round-trip check');
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, data);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(Buffer.from(data));
  verifier.end();
  return verifier.verify(publicKeyPem, Buffer.from(signature));
}

describe('parsePrivateKey', () => {
  it('parses PEM PKCS#1 (the format GitHub issues its App keys in)', async () => {
    const parsed = await parsePrivateKey(key.pkcs1Pem);
    expect(await signsAndVerifies(parsed, key.publicKeyPem)).toBe(true);
  });

  it('parses PEM PKCS#8', async () => {
    const parsed = await parsePrivateKey(key.pkcs8Pem);
    expect(await signsAndVerifies(parsed, key.publicKeyPem)).toBe(true);
  });

  it('parses base64 of PEM PKCS#1 (a single-line environment variable)', async () => {
    const parsed = await parsePrivateKey(key.pkcs1Base64);
    expect(await signsAndVerifies(parsed, key.publicKeyPem)).toBe(true);
  });

  it('parses base64 of PEM PKCS#8', async () => {
    const parsed = await parsePrivateKey(key.pkcs8Base64);
    expect(await signsAndVerifies(parsed, key.publicKeyPem)).toBe(true);
  });

  it('tolerates surrounding whitespace around a PEM value', async () => {
    const parsed = await parsePrivateKey(`\n\n   ${key.pkcs1Pem}\n  \n`);
    expect(await signsAndVerifies(parsed, key.publicKeyPem)).toBe(true);
  });

  it('tolerates surrounding whitespace around a base64 value', async () => {
    const parsed = await parsePrivateKey(`  ${key.pkcs8Base64}  \n`);
    expect(await signsAndVerifies(parsed, key.publicKeyPem)).toBe(true);
  });

  it('tolerates literal \\n escapes in place of real newlines (single-line env vars)', async () => {
    const escaped = key.pkcs1Pem.trim().split('\n').join('\\n');
    expect(escaped.includes('\n')).toBe(false);
    const parsed = await parsePrivateKey(escaped);
    expect(await signsAndVerifies(parsed, key.publicKeyPem)).toBe(true);
  });

  it('imports a non-extractable key', async () => {
    const parsed = await parsePrivateKey(key.pkcs8Pem);
    expect(parsed.extractable).toBe(false);
    expect(parsed.usages).toEqual(['sign']);
  });

  it('throws FeedbackCredentialError for a garbage string, and never echoes it', async () => {
    const garbage = `not-a-key-${randomBytes(8).toString('hex')}`;
    await expect(parsePrivateKey(garbage)).rejects.toBeInstanceOf(FeedbackCredentialError);

    try {
      await parsePrivateKey(garbage);
      expect.unreachable('parsePrivateKey should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(FeedbackCredentialError);
      expect((error as Error).message).not.toContain(garbage);
    }
  });

  it('throws FeedbackCredentialError for a well-formed PEM wrapper with an invalid body, without echoing it', async () => {
    const bogusBody = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
    const bogus = `-----BEGIN RSA PRIVATE KEY-----\n${bogusBody}\n-----END RSA PRIVATE KEY-----`;

    await expect(parsePrivateKey(bogus)).rejects.toBeInstanceOf(FeedbackCredentialError);
    try {
      await parsePrivateKey(bogus);
      expect.unreachable('parsePrivateKey should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(bogusBody);
    }
  });

  it('throws FeedbackCredentialError for an unsupported PEM type (e.g. an EC key)', async () => {
    const { privateKey: ecPem } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'sec1', format: 'pem' },
    });

    await expect(parsePrivateKey(ecPem)).rejects.toBeInstanceOf(FeedbackCredentialError);
    try {
      await parsePrivateKey(ecPem);
      expect.unreachable('parsePrivateKey should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(ecPem);
    }
  });

  it('throws FeedbackCredentialError for an empty string', async () => {
    await expect(parsePrivateKey('')).rejects.toBeInstanceOf(FeedbackCredentialError);
  });
});

describe('parsePrivateKey with a 4096-bit key (long-form DER lengths)', () => {
  // A 2048-bit PKCS#1 DER body is short enough that the DER length octets
  // for its outer SEQUENCE and inner INTEGERs mostly fit the one-byte
  // short form. A 4096-bit key's PKCS#1 body is large enough (well over
  // 256 bytes) to force the two-byte long form (`0x82 hi lo`) in
  // `wrapPkcs1InPkcs8`'s DER length encoder, which the 2048-bit tests
  // above never exercise.
  let bigKey: TestKeyMaterial;

  beforeAll(() => {
    bigKey = generateTestKey(4096);
  });

  it('parses PEM PKCS#1', async () => {
    const parsed = await parsePrivateKey(bigKey.pkcs1Pem);
    expect(await signsAndVerifies(parsed, bigKey.publicKeyPem)).toBe(true);
  });

  it('parses PEM PKCS#8', async () => {
    const parsed = await parsePrivateKey(bigKey.pkcs8Pem);
    expect(await signsAndVerifies(parsed, bigKey.publicKeyPem)).toBe(true);
  });

  it('parses base64 of PEM PKCS#1', async () => {
    const parsed = await parsePrivateKey(bigKey.pkcs1Base64);
    expect(await signsAndVerifies(parsed, bigKey.publicKeyPem)).toBe(true);
  });
});
