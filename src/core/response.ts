/**
 * The handler's reply to the browser: the one contract between `server` (P6) and `browser` (P7).
 *
 * The browser decides the delivery state from the parsed body alone, never from the HTTP status,
 * because a proxy or platform error page can arrive with any status. Anything it cannot parse into
 * one of these three shapes after the request left is *Delivery unconfirmed* (design §5).
 */

/** Why a report was definitively not sent. Nothing was created in the tracker for any of these. */
export const NOT_SENT_CODES = [
  'method_not_allowed',
  'credentials_not_allowed',
  'unsupported_media_type',
  'forbidden_origin',
  'too_large',
  'bad_json',
  'unauthenticated',
  'rate_limited',
  'limiter_unavailable',
  'invalid',
  'too_long',
  'credential',
  'tracker_refused',
] as const;

export type NotSentCode = (typeof NOT_SENT_CODES)[number];

export type FeedbackResponse =
  /** The tracker confirmed the issue. `receipt` is what the reporter sees, e.g. `#123`. */
  | { status: 'received'; receipt: string }
  /** A definitive refusal; the draft is kept. `fields` lists invalid payload fields for `invalid`. */
  | { status: 'not_sent'; code: NotSentCode; fields?: string[] }
  /** The tracker request left but its outcome is unknown; the draft and `report_id` are kept. */
  | { status: 'unconfirmed'; report_id: string };

const RECEIPT = /^#[1-9][0-9]{0,9}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIELD = /^[a-z_.]{1,40}$/;

/**
 * Parses a response body into a `FeedbackResponse`, or returns `null` for anything else.
 * `null` after the request left means *Delivery unconfirmed*.
 */
export function parseFeedbackResponse(body: unknown): FeedbackResponse | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  switch (value.status) {
    case 'received':
      return typeof value.receipt === 'string' && RECEIPT.test(value.receipt)
        ? { status: 'received', receipt: value.receipt }
        : null;
    case 'not_sent': {
      if (!(NOT_SENT_CODES as readonly unknown[]).includes(value.code)) return null;
      const code = value.code as NotSentCode;
      if (value.fields === undefined) return { status: 'not_sent', code };
      if (
        !Array.isArray(value.fields) ||
        value.fields.length > 20 ||
        !value.fields.every((field) => typeof field === 'string' && FIELD.test(field))
      ) {
        return null;
      }
      return { status: 'not_sent', code, fields: value.fields as string[] };
    }
    case 'unconfirmed':
      return typeof value.report_id === 'string' && UUID.test(value.report_id)
        ? { status: 'unconfirmed', report_id: value.report_id }
        : null;
    default:
      return null;
  }
}
