/**
 * @papergiant/feedback/github — base64 / base64url helpers.
 *
 * Deliberately built on the Web-standard `atob`/`btoa` rather than a
 * Node-only binary-string API, so this module runs unmodified in
 * edge-style runtimes that implement `fetch` and WebCrypto but not
 * Node's own globals.
 */

/** Decodes standard (possibly padded) base64 into raw bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encodes raw bytes as base64url with no padding, per RFC 7515 §2. */
export function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Encodes a UTF-8 string as base64url with no padding. */
export function base64UrlFromString(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}
