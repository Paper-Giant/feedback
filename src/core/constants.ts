import type { FeedbackKind } from './types.js';

/**
 * The three report kinds a reporter can pick (design §3). Also the
 * definitive list `validatePayload` checks `kind` against — imported
 * rather than duplicated, so a host's dialog (P7) can build its kind
 * selector from the same source of truth.
 */
export const KINDS: readonly FeedbackKind[] = ['help', 'bug', 'idea'];

/**
 * The character caps `validatePayload` enforces (design §4), exported so
 * a host's dialog (P7) can wire the same numbers into `maxlength`
 * attributes and live character counters rather than duplicating them.
 * `client` is the cap shared by every `client.*` string field; `commit`
 * is additionally constrained to exactly 40 lowercase hex characters,
 * which is stricter and checked separately.
 */
export const LIMITS = {
  what_happened: 5000,
  expected: 2000,
  reference: 64,
  diagnostic: 256,
  client: 100,
} as const;
