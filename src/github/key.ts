/**
 * @papergiant/feedback/github — private key parsing.
 *
 * Built entirely on Web-standard `atob`/WebCrypto so it runs unmodified
 * in edge-style runtimes; `node:crypto` is never imported here (only
 * tests, which run under Node, use it — to generate keys and to verify
 * JWT signatures independently of this module).
 */
import { base64ToBytes } from './base64.js';
import { wrapPkcs1InPkcs8 } from './der.js';
import { FeedbackCredentialError } from './errors.js';

const PEM_BLOCK = /-----BEGIN ([A-Za-z0-9 ]+)-----([\s\S]*?)-----END \1-----/;

// Fixed, static messages only — never interpolate the input, the PEM
// body, or anything derived from key material into these strings.
const NOT_PEM_MESSAGE =
  'could not parse private key: not a recognisable PEM or base64-encoded PEM';
const MALFORMED_BODY_MESSAGE = 'could not parse private key: malformed PEM body';
const UNSUPPORTED_FORMAT_MESSAGE = 'could not parse private key: unsupported key format';
const IMPORT_FAILED_MESSAGE = 'could not parse private key: the key data was rejected';

/** Env vars often carry PEM newlines as the two-character escape `\n`. */
function unescapeNewlines(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function decodeBase64ToText(value: string): string | null {
  try {
    const bytes = base64ToBytes(value.replace(/\s+/g, ''));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Finds the PEM text within `input`: the raw string if it already looks
 * like PEM, otherwise its base64 decoding (for single-line environment
 * variables holding base64-of-PEM). Tolerates surrounding whitespace and
 * literal `\n` escapes in either form.
 */
function extractPemText(input: string): string {
  const direct = unescapeNewlines(input.trim());
  if (direct.includes('-----BEGIN')) {
    return direct;
  }

  const decoded = decodeBase64ToText(direct);
  if (decoded !== null) {
    const decodedText = unescapeNewlines(decoded.trim());
    if (decodedText.includes('-----BEGIN')) {
      return decodedText;
    }
  }

  throw new FeedbackCredentialError(NOT_PEM_MESSAGE);
}

// WebCrypto's `importKey` wants a `BufferSource` backed by a concrete
// `ArrayBuffer`. A `Uint8Array` built from another view (as `der.ts`'s
// helpers do, via `Uint8Array.from`/`set`) is typed over `ArrayBufferLike`,
// which also admits `SharedArrayBuffer` — so it is copied into a fresh,
// unambiguous `ArrayBuffer` here rather than passed through directly.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function importPkcs8(pkcs8Der: Uint8Array): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      toArrayBuffer(pkcs8Der),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    throw new FeedbackCredentialError(IMPORT_FAILED_MESSAGE);
  }
}

/**
 * Parses a GitHub App private key supplied as PEM PKCS#1
 * (`-----BEGIN RSA PRIVATE KEY-----`, the format GitHub issues), PEM
 * PKCS#8 (`-----BEGIN PRIVATE KEY-----`), or base64 of either PEM (for
 * single-line environment variables). Surrounding whitespace and literal
 * `\n` escapes are tolerated. PKCS#1 is wrapped into a PKCS#8
 * `PrivateKeyInfo` DER before import, because WebCrypto only imports
 * PKCS#8. Returns a non-extractable `RSASSA-PKCS1-v1_5` / SHA-256
 * signing key.
 *
 * Every failure path throws `FeedbackCredentialError` with a fixed,
 * static message. The input is never echoed, logged or otherwise
 * included in the error.
 */
export async function parsePrivateKey(input: string): Promise<CryptoKey> {
  const pem = extractPemText(input);
  const match = PEM_BLOCK.exec(pem);
  if (!match) {
    throw new FeedbackCredentialError(NOT_PEM_MESSAGE);
  }

  const type = match[1].trim();
  const body = match[2].replace(/\s+/g, '');

  let der: Uint8Array;
  try {
    der = base64ToBytes(body);
  } catch {
    throw new FeedbackCredentialError(MALFORMED_BODY_MESSAGE);
  }

  if (type === 'PRIVATE KEY') {
    return importPkcs8(der);
  }
  if (type === 'RSA PRIVATE KEY') {
    return importPkcs8(wrapPkcs1InPkcs8(der));
  }

  throw new FeedbackCredentialError(UNSUPPORTED_FORMAT_MESSAGE);
}
