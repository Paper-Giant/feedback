/**
 * @papergiant/feedback/github — errors.
 *
 * `FeedbackCredentialError` is thrown for every credential failure in this
 * module: an unparseable private key, a JWT that cannot be signed, or an
 * installation-token mint that GitHub refused or returned unparseably. Its
 * message is always a fixed, static string (plus an optional HTTP status
 * code) — it must never interpolate the input key material, the mint
 * response body, or anything else that could carry a secret or reporter
 * content into a log line.
 */
export class FeedbackCredentialError extends Error {
  /** The HTTP status GitHub returned, when the failure came from a response. */
  readonly status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = 'FeedbackCredentialError';
    this.status = options?.status;
    // Preserve V8 stack trace shape (Error.captureStackTrace is optional —
    // not every runtime implements it).
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, FeedbackCredentialError);
    }
  }
}
