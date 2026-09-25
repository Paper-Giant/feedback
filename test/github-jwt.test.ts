import { describe, expect, it, beforeAll } from 'vitest';
import { createVerify } from 'node:crypto';
import { parsePrivateKey, signAppJwt } from '../dist/github/index.js';
import { generateTestKey, type TestKeyMaterial } from './helpers/rsa-keys.js';

// Design §"Credential": header `{ alg: 'RS256', typ: 'JWT' }`, claims
// `iat = now − 60`, `exp = now + 540`, `iss = clientId`, base64url without
// padding. Verified here against the public key with `node:crypto`,
// independent of this module's own base64url/DER code.

let key: TestKeyMaterial;

beforeAll(() => {
  key = generateTestKey();
});

function base64UrlToBuffer(segment: string): Buffer {
  return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

describe('signAppJwt', () => {
  it('signs RS256 with the exact header, the three claims at a fixed now, and a verifiable signature', async () => {
    const cryptoKey = await parsePrivateKey(key.pkcs8Pem);
    const nowMs = Date.parse('2026-09-25T04:12:00.000Z');
    const clientId = 'Iv1.abcdef1234567890';

    const jwt = await signAppJwt({ clientId, key: cryptoKey, nowMs });
    const segments = jwt.split('.');
    expect(segments).toHaveLength(3);
    const [headerSeg, claimsSeg, signatureSeg] = segments as [string, string, string];

    // base64url, no padding: neither `+`, `/` nor `=` ever appear.
    expect(jwt).not.toMatch(/[+/=]/);

    const header = JSON.parse(base64UrlToBuffer(headerSeg).toString('utf8'));
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });

    const claims = JSON.parse(base64UrlToBuffer(claimsSeg).toString('utf8'));
    const nowSeconds = Math.floor(nowMs / 1000);
    expect(claims).toEqual({
      iat: nowSeconds - 60,
      exp: nowSeconds + 540,
      iss: clientId,
    });

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerSeg}.${claimsSeg}`);
    verifier.end();
    expect(verifier.verify(key.publicKeyPem, base64UrlToBuffer(signatureSeg))).toBe(true);
  });

  it('produces a different, independently valid signature for a different now', async () => {
    const cryptoKey = await parsePrivateKey(key.pkcs1Pem);
    const clientId = 'Iv1.another-client';

    const first = await signAppJwt({ clientId, key: cryptoKey, nowMs: Date.parse('2026-09-25T00:00:00Z') });
    const second = await signAppJwt({ clientId, key: cryptoKey, nowMs: Date.parse('2026-09-26T00:00:00Z') });

    expect(first).not.toBe(second);

    for (const jwt of [first, second]) {
      const [headerSeg, claimsSeg, signatureSeg] = jwt.split('.') as [string, string, string];
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${headerSeg}.${claimsSeg}`);
      verifier.end();
      expect(verifier.verify(key.publicKeyPem, base64UrlToBuffer(signatureSeg))).toBe(true);
    }
  });
});
