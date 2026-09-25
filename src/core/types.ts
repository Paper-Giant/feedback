/**
 * @papergiant/feedback/core — types for the `feedback/v1` wire payload, the
 * validated/normalised payload, and the two host-supplied shapes the
 * renderer needs (design §4, §5; the host's `identify()` result and its
 * static config).
 */

/** The three report kinds a reporter can pick in the dialog (design §3). */
export type FeedbackKind = 'help' | 'bug' | 'idea';

/**
 * Build facts the browser attaches to a report. Every field is optional
 * and capped at 100 characters, except `commit`, which — when present —
 * must be exactly 40 lowercase hex characters (design §4).
 */
export interface FeedbackClient {
  release?: string;
  commit?: string;
  browser?: string;
  viewport?: string;
  locale?: string;
  timezone?: string;
}

/**
 * The browser → server wire payload, exactly as a host's dialog POSTs it.
 * `validatePayload` accepts only these top-level keys (and only these
 * `client` keys) — anything else, including the server-derived fields a
 * browser must never be able to set (`title`, `source_hint`,
 * `reported_build_skew`, `hints_at`, `receiving_commit`), is rejected as
 * an unknown field.
 */
export interface FeedbackPayload {
  schema: 'feedback/v1';
  /** A UUID the browser generates (e.g. via `crypto.randomUUID()`). */
  report_id: string;
  kind: FeedbackKind;
  /** Required prose, 1–5000 characters after NFC normalisation. */
  what_happened: string;
  /** Bugs only (rejected on help/idea); ≤ 2000 characters. */
  expected?: string;
  /** Staff-only; ≤ 64 characters. Rejected unless `identity.allowReference`. */
  reference?: string;
  /** ≤ 256 characters, matching `^[a-z0-9-]+:[A-Za-z0-9._-]{1,200}$`. */
  diagnostic?: string;
  /** A key of the host's configured `areas`; anything else normalises to `'unknown'`. */
  area?: string;
  client?: FeedbackClient;
}

/**
 * The validated, normalised form `validatePayload` returns on success.
 * Differences from the wire shape: `area` is always present (defaulted to
 * `'unknown'`), `client` is always present (as `{}` when the browser sent
 * none), and every string has been NFC-normalised. Absent optional fields
 * stay absent — never `null` — so the renderer's "absent stays absent"
 * rule (design §4) has a single source of truth.
 */
export interface ValidatedFeedbackPayload {
  schema: 'feedback/v1';
  report_id: string;
  kind: FeedbackKind;
  what_happened: string;
  expected?: string;
  reference?: string;
  diagnostic?: string;
  area: string;
  client: FeedbackClient;
}

/**
 * What a host's `identify(req)` returns (design §5). This is the whole of
 * what can leave about the reporter: opaque references, role and surface,
 * and optionally an organisation reference and a link to the person in the
 * host's own staff console.
 */
export interface FeedbackIdentity {
  ref: string;
  role: string;
  surface: string;
  organisationRef?: string;
  lookupUrl?: string;
  /** Whether this reporter is allowed to supply the staff-only `reference` field. */
  allowReference: boolean;
}

/**
 * The static, per-host configuration the renderer needs to build a title
 * and the server-recorded section of the ticket (design §4).
 */
export interface FeedbackHostConfig {
  /** The label value used in `labels` (`app:<app>`) — short, stable, lowercase. */
  app: string;
  /** The human-readable name used in the ticket title. */
  displayName: string;
  /** The **product** repository the code lives in (never the intake repository). */
  productRepository: string;
  environment: string;
  /**
   * Area key → source hint (or `null` for a registered area with no hint).
   *
   * `'unknown'` is reserved: it is the fallback `validatePayload` returns
   * for a missing or unrecognised area, and `renderTicket` never emits a
   * `source_hint` for it, even if a host configures one. Call
   * `assertHostAreas(areas)` at host construction time to catch a host
   * that accidentally configures it.
   */
  areas: Record<string, string | null>;
  /**
   * The commit the running server was built from, or `null` when none is
   * known (e.g. local development with no commit env var set).
   * `renderTicket` omits `receiving_commit` — and, since a build-skew
   * comparison against an unknown commit is meaningless, `reported_build_skew`
   * too — from the rendered ticket entirely when this is `null`, rather
   * than rendering an empty string or a misleading skew flag.
   */
  receivingCommit: string | null;
}

/**
 * Throws if `areas` configures the reserved `'unknown'` key (see
 * `FeedbackHostConfig.areas` above). Intended for a host's handler
 * construction code (build plan task P6) to call once, at start-up, so a
 * misconfigured host fails fast and loudly rather than silently losing
 * the `unknown` fallback's protection against a spoofed source hint.
 */
export function assertHostAreas(areas: Record<string, string | null>): void {
  if (Object.prototype.hasOwnProperty.call(areas, 'unknown')) {
    throw new Error(
      "FeedbackHostConfig.areas must not configure the reserved key 'unknown': " +
        "it is validatePayload's fallback for a missing or unrecognised area, " +
        'and renderTicket never emits a source_hint for it.',
    );
  }
}
