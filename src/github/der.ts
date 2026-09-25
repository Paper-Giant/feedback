/**
 * @papergiant/feedback/github — minimal DER encoding.
 *
 * Just enough ASN.1 DER to wrap a PKCS#1 `RSAPrivateKey` (the format
 * GitHub issues its App private keys in) into a PKCS#8 `PrivateKeyInfo`,
 * which is the only format WebCrypto's `importKey('pkcs8', …)` accepts.
 * No parsing: the PKCS#1 bytes are carried opaquely inside the wrapper's
 * OCTET STRING, and WebCrypto itself is what validates their shape —
 * garbage input simply fails `importKey`, which the caller turns into a
 * `FeedbackCredentialError`.
 */

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** DER length octets (definite form, short or long) for a content of `length` bytes. */
function derLength(length: number): number[] {
  if (length < 0x80) {
    return [length];
  }
  const bytes: number[] = [];
  let n = length;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

function derTagged(tag: number, content: Uint8Array): Uint8Array {
  return concatBytes([Uint8Array.from([tag, ...derLength(content.length)]), content]);
}

function derSequence(contentParts: Uint8Array[]): Uint8Array {
  return derTagged(0x30, concatBytes(contentParts));
}

function derOctetString(content: Uint8Array): Uint8Array {
  return derTagged(0x04, content);
}

/** INTEGER 0 — the PKCS#8 `version` field for an unencrypted key. */
const PKCS8_VERSION_ZERO = Uint8Array.from([0x02, 0x01, 0x00]);

/**
 * `AlgorithmIdentifier { algorithm rsaEncryption (1.2.840.113549.1.1.1),
 * parameters NULL }`, DER-encoded. This is the well-known, fixed encoding
 * for plain RSA (no PSS/OAEP parameters), so it is a constant rather than
 * something built from an OID encoder.
 */
const RSA_ENCRYPTION_ALGORITHM_IDENTIFIER = Uint8Array.from([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

/**
 * Wraps a PKCS#1 `RSAPrivateKey` DER encoding in a PKCS#8 `PrivateKeyInfo`:
 *
 * ```
 * PrivateKeyInfo ::= SEQUENCE {
 *   version                   INTEGER (0),
 *   privateKeyAlgorithm       AlgorithmIdentifier (rsaEncryption, NULL),
 *   privateKey                OCTET STRING (the PKCS#1 DER, opaque here)
 * }
 * ```
 */
export function wrapPkcs1InPkcs8(pkcs1Der: Uint8Array): Uint8Array {
  return derSequence([
    PKCS8_VERSION_ZERO,
    RSA_ENCRYPTION_ALGORITHM_IDENTIFIER,
    derOctetString(pkcs1Der),
  ]);
}
