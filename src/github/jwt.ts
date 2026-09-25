/**
 * @papergiant/feedback/github — the RS256 JWT GitHub Apps use to
 * authenticate as the app itself (before an installation token exists).
 */
import { base64UrlFromBytes, base64UrlFromString } from './base64.js';

export interface SignAppJwtOptions {
  /** The GitHub App's client id — becomes the `iss` claim. */
  clientId: string;
  /** The imported, non-extractable RSASSA-PKCS1-v1_5/SHA-256 signing key. */
  key: CryptoKey;
  /** The current time in epoch milliseconds (as `Date.now()` returns). */
  nowMs: number;
}

/**
 * Signs `{ alg: 'RS256', typ: 'JWT' }` with claims `iat = now − 60s`,
 * `exp = now + 540s`, `iss = clientId`, base64url-encoded without padding
 * (RFC 7519 / RFC 7515).
 */
export async function signAppJwt(options: SignAppJwtOptions): Promise<string> {
  const nowSeconds = Math.floor(options.nowMs / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iat: nowSeconds - 60,
    exp: nowSeconds + 540,
    iss: options.clientId,
  };

  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(
    JSON.stringify(claims),
  )}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    options.key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}
