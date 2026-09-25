/**
 * @papergiant/feedback/browser — outbound payload assembly (task P7;
 * design §4 "What is sent"; build plan P7: "an invalid area key is
 * replaced by `unknown` before the request is built"). Pure: given a
 * draft and resolved options, returns exactly the wire object `mountFeedback`
 * sends — nothing more, nothing derived server-side.
 */
import type { FeedbackKind, FeedbackPayload } from '../core/types.js';
import type { ClientFacts } from './client-facts.js';

export interface FeedbackDraft {
  reportId: string;
  kind: FeedbackKind;
  whatHappened: string;
  expected: string;
  reference: string;
  /** The most recent `setArea()` key, or `null` if never set. */
  area: string | null;
}

export function createEmptyDraft(reportId: string): FeedbackDraft {
  return { reportId, kind: 'help', whatHappened: '', expected: '', reference: '', area: null };
}

export interface AssemblePayloadOptions {
  areas: readonly string[];
  allowReference: boolean;
  client: ClientFacts;
}

/**
 * Builds the exact `feedback/v1` wire payload for `draft` — the design's
 * "Never captured" list (location, referrer, DOM text, cookies, storage,
 * host form values) never has a code path into this function because
 * nothing here ever reads them: every input is either part of `draft`
 * (the dialog's own form state) or `options.client` (already-gathered,
 * package-computed facts).
 *
 * `area` is resolved here, before the caller ever builds a `Request` —
 * a key not in `options.areas` (including a stale key left over from a
 * host that reconfigured its area list) becomes `'unknown'`, exactly as
 * `validatePayload` would resolve it server-side, so the "Details
 * included" preview and the request body never disagree.
 */
export function assembleOutboundPayload(draft: FeedbackDraft, options: AssemblePayloadOptions): FeedbackPayload {
  const area = draft.area !== null && options.areas.includes(draft.area) ? draft.area : 'unknown';

  const payload: FeedbackPayload = {
    schema: 'feedback/v1',
    report_id: draft.reportId,
    kind: draft.kind,
    what_happened: draft.whatHappened,
    area,
  };

  if (draft.kind === 'bug' && draft.expected.trim() !== '') {
    payload.expected = draft.expected;
  }

  if (options.allowReference && draft.reference.trim() !== '') {
    payload.reference = draft.reference;
  }

  const client: FeedbackPayload['client'] = {};
  const { release, commit, browser, viewport, locale, timezone } = options.client;
  if (release) client.release = release;
  if (commit) client.commit = commit;
  if (browser) client.browser = browser;
  if (viewport) client.viewport = viewport;
  if (locale) client.locale = locale;
  if (timezone) client.timezone = timezone;
  if (Object.keys(client).length > 0) {
    payload.client = client;
  }

  return payload;
}
