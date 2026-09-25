/**
 * @papergiant/feedback/browser — a `report_id` generator that works even
 * outside a secure context (review fix, task P7).
 *
 * `crypto.randomUUID()` throws in a non-secure context (plain HTTP, other
 * than `localhost`) per its spec, but several of this package's own hosts
 * run plain-HTTP local dev servers (design §3.1's Hono/framework-free
 * rows, and any host during early local development before HTTPS is set
 * up) — the dialog must still be able to mint a `report_id` there. Falls
 * back to building an RFC 4122 version-4 UUID from
 * `crypto.getRandomValues`, which carries no such restriction.
 */

/** The minimal slice of `Crypto` this module needs — accepted as a
 * parameter (default: the real global `crypto`) so the fallback path is
 * unit-testable without depending on the host environment's actual
 * secure-context state. */
export interface RandomSource {
  randomUUID?: () => string;
  getRandomValues: (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
}

export function generateUUID(source: RandomSource = crypto): string {
  if (typeof source.randomUUID === 'function') {
    return source.randomUUID();
  }

  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  // Version 4: the 4 high bits of byte 6 are 0100.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // Variant (RFC 4122): the 2 high bits of byte 8 are 10.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
