/**
 * @papergiant/feedback — `doctor`'s private-key fingerprint (task P11).
 *
 * `doctor` runs only as a Node CLI (never in an edge or browser runtime,
 * unlike `src/github/`, which is built on WebCrypto for that reason), so
 * it is free to use `node:crypto` directly. This module derives the
 * **public** key's SPKI fingerprint from the parsed private key, the same
 * kind of fingerprint GitHub itself shows next to an uploaded App key, so
 * a person running `doctor` can cross-check the two without either of
 * them ever displaying the private key.
 *
 * The PEM-extraction step below (base64-of-PEM tolerance, `\n` escapes)
 * intentionally mirrors `src/github/key.ts`'s `extractPemText` — that
 * function isn't exported for reuse, so this is kept in sync by hand, the
 * same way `src/limit/index.ts` keeps its subject-length bound in sync
 * with `sql/postgres-limiter.sql` by hand rather than sharing code across
 * a module boundary that shouldn't otherwise exist.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';

export interface KeyInfo {
  /** RSA modulus length in bits, when determinable (e.g. 2048). */
  modulusLength?: number;
  /** The public key's SPKI-DER SHA-256 fingerprint, formatted exactly the
   * way GitHub documents its own key fingerprints: `SHA256:` followed by
   * the (padded) base64 of the raw digest bytes — i.e. the same value
   * `openssl rsa -in key.pem -pubout -outform DER | openssl sha256
   * -binary | openssl base64` prints, with that prefix added. */
  spkiSha256?: string;
}

function extractPemText(input: string): string | null {
  const direct = input.trim().replace(/\\n/g, '\n');
  if (direct.includes('-----BEGIN')) return direct;

  try {
    const decoded = Buffer.from(direct.replace(/\s+/g, ''), 'base64').toString('utf8');
    const unescaped = decoded.trim().replace(/\\n/g, '\n');
    if (unescaped.includes('-----BEGIN')) return unescaped;
  } catch {
    // fall through
  }
  return null;
}

/**
 * Best-effort only: called after `parsePrivateKey` (the real parse this
 * check reports PASS/FAIL on) has already succeeded, purely to enrich the
 * PASS reason with a length and a fingerprint. Returns `{}` on any
 * failure here rather than throwing — a fingerprint that can't be
 * computed must never turn an otherwise-valid key into a FAIL.
 */
export function computeKeyInfo(input: string): KeyInfo {
  try {
    const pem = extractPemText(input);
    if (pem === null) return {};

    const privateKey = createPrivateKey({ key: pem, format: 'pem' });
    const publicKey = createPublicKey(privateKey);
    const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
    const spkiSha256 = `SHA256:${createHash('sha256').update(spkiDer).digest('base64')}`;

    const details = privateKey.asymmetricKeyDetails;
    const modulusLength = typeof details?.modulusLength === 'number' ? details.modulusLength : undefined;

    return { modulusLength, spkiSha256 };
  } catch {
    return {};
  }
}
