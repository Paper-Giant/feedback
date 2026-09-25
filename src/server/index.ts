/**
 * @papergiant/feedback/server — createFeedbackHandler() (task P6; design §5).
 *
 * Framework-free: a `(Request) => Promise<Response>` that a host wires into
 * its own router (a Next route handler, a Hono app, an Astro endpoint, an
 * edge function, …). Importing this module must never touch the DOM, and
 * nothing here uses a `node:` import, `Buffer` or `process` — only the
 * Web-standard globals (`Request`, `Response`, `Headers`, `ReadableStream`,
 * `TextDecoder`) that every one of those runtimes provides, so the same
 * built file runs unchanged everywhere.
 *
 * Every refusal below happens in the exact order the design and build plan
 * specify, and nothing after a refusal's step is ever called for that
 * request — `identify`, `limiter.take()` and `sink.create()` each run only
 * once every earlier gate has passed.
 */
import {
  assertHostAreas,
  FeedbackTicketTooLargeError,
  renderTicket,
  validatePayload,
  type FeedbackHostConfig,
  type FeedbackIdentity,
  type FeedbackResponse,
  type NotSentCode,
  type Ticket,
  type ValidationError,
} from '../core/index.js';
import type { Limiter } from '../limit/index.js';
import type { SinkOutcome } from '../github/index.js';

/** The minimal delivery sink the handler needs: `githubSink()` satisfies
 * this structurally, and a test double needs nothing more. */
export interface FeedbackHandlerSink {
  create(ticket: Ticket): Promise<SinkOutcome>;
}

/** A structured, machine-readable log event (design §5 "Delivery states").
 * Values are restricted to primitives that can never carry reporter text,
 * a title, a body, an identity reference or a header value — see the
 * privacy note on `createFeedbackHandler` below. */
export interface FeedbackLogEvent {
  event: string;
  [key: string]: string | number | boolean | null;
}

/**
 * Configures `createFeedbackHandler`. The returned handler must be the
 * **first** reader of the `Request` it's given — it locks and streams the
 * body itself (step 5, the 32 KiB cap) — so a host that also needs to read
 * the body (logging, a wrapping middleware, …) must call `request.clone()`
 * and read the clone, never the original, before handing the original to
 * this handler.
 */
export interface FeedbackHandlerConfig {
  /** The label value used in `labels` (`app:<app>`) — short, stable, lowercase. */
  app: string;
  /** The human-readable name used in the ticket title. */
  displayName: string;
  /** The **product** repository the code lives in (never the intake repository). */
  productRepository: string;
  environment: string;
  /** Exact origins this host serves the dialog from (design §5 "CSRF").
   * Each must be exactly a browser origin — `new URL(value).origin`, scheme
   * + host + optional port, no path, query or fragment, punycode for an
   * internationalised domain — and the array must be non-empty. */
  origins: readonly string[];
  /** Resolves the reporter from the request, or `null` when unauthenticated.
   * A throw is treated the same as `null` (fail closed) — see design §5.
   * Either way, no detail is kept: a thrown error's message and stack are
   * never logged or inspected here, only the fact that it threw (see
   * `FEEDBACK_IDENTIFY_FAILED` below). Log the cause inside your own
   * `identify` if you need it. */
  identify: (request: Request) => Promise<FeedbackIdentity | null>;
  /** Called only after `identify` has accepted the person, keyed by
   * `identity.ref`. A throw refuses the request (design §5 "Limits"). */
  limiter: Limiter;
  /** Files the rendered ticket. `create()` is expected to never throw
   * (`githubSink()`'s never does) — see the note on step 11 below for what
   * happens if it does anyway. */
  sink: FeedbackHandlerSink;
  /** Area key → source hint (or `null`). Must not configure the reserved
   * `'unknown'` key — see `assertHostAreas`. */
  areas: Record<string, string | null>;
  /** The commit the running server was built from, or `null` when none is
   * known (e.g. local development with no commit env var set). Passed
   * straight through to `renderTicket` (core, task P2), which then omits
   * `receiving_commit` (and `reported_build_skew`) from the ticket
   * entirely — see `FeedbackHostConfig.receivingCommit`. */
  receivingCommit: string | null;
  /** Structured log sink. Defaults to `console.warn(JSON.stringify(event))`. */
  log?: (event: FeedbackLogEvent) => void;
  /** Injectable clock, for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

/** 32 KiB — the hard cap on a feedback request body (design §5 "CSRF"). */
const MAX_BODY_BYTES = 32768;

function defaultLog(event: FeedbackLogEvent): void {
  console.warn(JSON.stringify(event));
}

/**
 * A bare origin: scheme + host + optional port, nothing else. `new
 * URL(value).origin === value` is false for anything carrying a path
 * (even a bare `/`), a query, a fragment, credentials, or an opaque
 * origin (e.g. `data:`, `file:` — `.origin` for those is the literal
 * string `"null"`, which can never equal a well-formed `value`).
 */
function isBareOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.origin === value;
}

/**
 * Exactly `application/json`, with an optional `charset=utf-8` parameter
 * (case-insensitive on both the media type and the parameter). Anything
 * else — a different type, a different or additional parameter, no header
 * at all — is refused (design §5 "CSRF": "JSON POST only with exact
 * application/json").
 */
function isAllowedContentType(value: string | null): boolean {
  if (value === null) return false;
  const parts = value.split(';').map((part) => part.trim());
  if (parts[0]?.toLowerCase() !== 'application/json') return false;
  if (parts.length === 1) return true;
  if (parts.length !== 2) return false;
  return parts[1].toLowerCase().replace(/\s+/g, '') === 'charset=utf-8';
}

/**
 * Reads `request.body` with a hard byte cap, never buffering past it.
 * Returns the accumulated bytes on success. On overflow, cancels the
 * stream immediately (dropping the chunk that pushed the total over the
 * cap rather than retaining it) and returns `null` — the caller must not
 * keep reading.
 */
async function readCappedBody(request: Request, cap: number): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Releases a not-yet-read request body without reading it — used on every
 * refusal that happens before (or without) reading the body, so the
 * underlying stream isn't left dangling. `cancel()` is not a read: it
 * tells the source to stop, it never invokes `pull()`. */
function discardBody(request: Request): void {
  void request.body?.cancel().catch(() => {});
}

function jsonResponse(body: FeedbackResponse, status: number, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers({
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  }
  // No CORS headers, ever — a cross-origin caller already failed the
  // Origin check above, and adding Access-Control-* here would undo it.
  return new Response(JSON.stringify(body), { status, headers });
}

function notSentResponse(code: NotSentCode, status: number, fields?: string[]): Response {
  const body: FeedbackResponse =
    fields !== undefined ? { status: 'not_sent', code, fields } : { status: 'not_sent', code };
  return jsonResponse(body, status);
}

function methodNotAllowedResponse(request: Request): Response {
  discardBody(request);
  return jsonResponse({ status: 'not_sent', code: 'method_not_allowed' }, 405, { Allow: 'POST' });
}

/**
 * Returns the distinct, canonical field names from `errors`, in
 * first-seen order, capped at 20 (design §5 / build plan P6 "the
 * distinct invalid field names ... max 20").
 *
 * Every field name `validatePayload` itself names (`schema`,
 * `what_happened`, `client.commit`, …) is drawn from a fixed, known
 * vocabulary that already satisfies `parseFeedbackResponse`'s field
 * pattern (`/^[a-z_.]{1,40}$/`, core/response.ts). An `unknown_field`
 * error is different: its `field` is the attacker's own arbitrary JSON
 * key — any length, any character, digits and markup included — so it is
 * never echoed back. Every `unknown_field` error, top-level or nested
 * under `client`, collapses to the single literal `'unknown_field'`
 * instead (itself a valid field name under that same pattern). Without
 * this, a hostile key name could make `parseFeedbackResponse` reject the
 * whole response body, and a definitive `invalid` refusal would look to
 * the browser exactly like "delivery unconfirmed" (task review of P6).
 */
function distinctFields(errors: readonly ValidationError[]): string[] {
  const seen = new Set<string>();
  const fields: string[] = [];
  for (const error of errors) {
    const field = error.code === 'unknown_field' ? 'unknown_field' : error.field;
    if (seen.has(field)) continue;
    seen.add(field);
    fields.push(field);
    if (fields.length === 20) break;
  }
  return fields;
}

function mapDefinitiveSinkCode(code: string): NotSentCode {
  if (code === 'credential') return 'credential';
  if (code === 'rate_limited') return 'rate_limited';
  return 'tracker_refused';
}

/**
 * Builds the handler `createFeedbackHandler(config)` returns.
 *
 * Construction is synchronous and throws on bad config: `assertHostAreas`
 * rejects an `areas` map that configures the reserved `'unknown'` key, and
 * `origins` must be a non-empty array of bare origins (scheme + host +
 * optional port, no path) — both are checked once, here, rather than on
 * every request, so a misconfigured host fails at start-up.
 *
 * Every log event this handler emits carries only an event name plus
 * ids, codes, statuses and issue numbers — reporter text, the rendered
 * title/body, an identity reference, and raw header values are never
 * passed to `log()`, even on a failure path where they would be sitting
 * right there in scope. If you extend this file, keep it that way.
 */
function isWellFormedIdentity(value: unknown): value is FeedbackIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const identity = value as Record<string, unknown>;
  return (
    typeof identity.ref === 'string' &&
    identity.ref.length > 0 &&
    typeof identity.role === 'string' &&
    typeof identity.surface === 'string' &&
    typeof identity.allowReference === 'boolean'
  );
}

export function createFeedbackHandler(
  config: FeedbackHandlerConfig,
): (request: Request) => Promise<Response> {
  assertHostAreas(config.areas);

  if (config.origins.length === 0) {
    throw new Error('createFeedbackHandler: config.origins must be a non-empty array of exact origins');
  }
  for (const [index, origin] of config.origins.entries()) {
    if (!isBareOrigin(origin)) {
      throw new Error(
        `createFeedbackHandler: config.origins[${index}] is not a bare origin ` +
          `(scheme + host + optional port, no path/query/fragment): ${JSON.stringify(origin)}`,
      );
    }
  }

  const log = config.log ?? defaultLog;
  const now = config.now ?? (() => new Date());

  // Built once, not per request: the parts of FeedbackHostConfig this
  // handler's config owns outright. `receivingCommit` passes through
  // unchanged — including `null` — so `renderTicket` (core) can apply its
  // own "omit receiving_commit and reported_build_skew when the host
  // doesn't know its own commit" rule; this handler does not paper over
  // `null` with a placeholder string.
  const hostConfig: FeedbackHostConfig = {
    app: config.app,
    displayName: config.displayName,
    productRepository: config.productRepository,
    environment: config.environment,
    areas: config.areas,
    receivingCommit: config.receivingCommit,
  };

  return async function feedbackHandler(request: Request): Promise<Response> {
    // 1. Method.
    if (request.method.toUpperCase() !== 'POST') {
      return methodNotAllowedResponse(request);
    }

    // 2. Credentials a browser dialog never sends, and that several
    // hosts' general auth resolvers accept (design §5 "Identity").
    if (request.headers.has('authorization') || request.headers.has('x-api-key')) {
      discardBody(request);
      return notSentResponse('credentials_not_allowed', 400);
    }

    // 3. Media type: exactly application/json, optional charset=utf-8.
    if (!isAllowedContentType(request.headers.get('content-type'))) {
      discardBody(request);
      return notSentResponse('unsupported_media_type', 415);
    }

    // 4. Origin + Sec-Fetch-Site (design §5 "CSRF").
    const origin = request.headers.get('origin');
    if (origin === null || origin === 'null' || !config.origins.includes(origin)) {
      discardBody(request);
      return notSentResponse('forbidden_origin', 403);
    }
    // The signed design requires Sec-Fetch-Site and requires it to be
    // exactly `same-origin` — an earlier revision of this handler accepted
    // a *missing* header on the theory that the exact Origin check above
    // was gate enough, but that's not what was signed off, so a missing
    // header is refused here too (task review of P6). This does mean a
    // browser with no Fetch Metadata support (Safari before 16.4; any
    // browser with the feature disabled) can never satisfy this check and
    // is refused regardless of Origin — an accepted, deliberate narrowing
    // to browsers new enough to send it.
    const secFetchSite = request.headers.get('sec-fetch-site');
    if (secFetchSite !== 'same-origin') {
      discardBody(request);
      return notSentResponse('forbidden_origin', 403);
    }

    // 5. Body: a declared Content-Length over the cap is refused without
    // reading; otherwise the stream is read with the same hard cap,
    // cancelled the instant it's exceeded. Reading can itself throw or
    // reject — an upload aborted mid-stream, or a host that already
    // consumed this exact Request's body before handing it here (see the
    // config-level note above) — and an uncaught rejection out of this
    // async function would otherwise surface as an unhandled route error
    // (a Hono 500, a Next uncaught-exception page) instead of an ordinary
    // refusal, so it's treated the same as any other unparseable body.
    const contentLengthHeader = request.headers.get('content-length');
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        discardBody(request);
        return notSentResponse('too_large', 413);
      }
    }

    let bytes: Uint8Array | null;
    try {
      bytes = await readCappedBody(request, MAX_BODY_BYTES);
    } catch {
      log({ event: 'FEEDBACK_BODY_UNREADABLE' });
      return notSentResponse('bad_json', 400);
    }
    if (bytes === null) {
      return notSentResponse('too_large', 413);
    }

    // 6. Decode (fatal on invalid UTF-8) and parse.
    let json: unknown;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      json = JSON.parse(text);
    } catch {
      return notSentResponse('bad_json', 400);
    }

    // 7. Identity. A throw is fail-closed, same outcome as `null`, but
    // logged separately so an ops dashboard can tell "nobody signed in"
    // apart from "identify() is broken".
    let identity: FeedbackIdentity | null;
    try {
      identity = await config.identify(request);
    } catch {
      log({ event: 'FEEDBACK_IDENTIFY_FAILED' });
      return notSentResponse('unauthenticated', 401);
    }
    // `undefined` (a JavaScript host forgetting to return) counts as nobody signed in. Anything else that
    // is not a well-formed identity is a broken `identify()`: refused the same way, logged separately.
    if (identity === null || identity === undefined) {
      return notSentResponse('unauthenticated', 401);
    }
    if (!isWellFormedIdentity(identity)) {
      log({ event: 'FEEDBACK_IDENTIFY_FAILED' });
      return notSentResponse('unauthenticated', 401);
    }

    // 8. Rate limit — called only now that identify has accepted the person.
    // The `Limiter` interface's return type promises exactly `'ok'` or
    // `'limited'`, but that's a compile-time contract only — a malformed
    // third-party or mocked implementation can still resolve to anything
    // at runtime (undefined, null, a boolean, an unexpected string), so
    // this is checked at runtime too rather than trusted: only an exact
    // `'ok'` proceeds, `'limited'` refuses as rate_limited, and anything
    // else at all refuses the same way a throw does (task review of P6 —
    // the "a throw means refuse" rule in design §5 is undermined if a
    // resolved-but-malformed value doesn't refuse just as hard).
    let limiterResult: unknown;
    try {
      limiterResult = await config.limiter.take(identity.ref);
    } catch {
      log({ event: 'FEEDBACK_LIMITER_FAILED' });
      return notSentResponse('limiter_unavailable', 503);
    }
    if (limiterResult === 'limited') {
      return notSentResponse('rate_limited', 429);
    }
    if (limiterResult !== 'ok') {
      log({ event: 'FEEDBACK_LIMITER_FAILED' });
      return notSentResponse('limiter_unavailable', 503);
    }

    // 9. Validate.
    const validation = validatePayload(json, { areas: config.areas, allowReference: identity.allowReference });
    if (!validation.ok) {
      return notSentResponse('invalid', 422, distinctFields(validation.errors));
    }
    const payload = validation.value;

    // 10. Render.
    let ticket: Ticket;
    try {
      ticket = renderTicket({ payload, identity, host: hostConfig, receivedAt: now() });
    } catch (error) {
      if (error instanceof FeedbackTicketTooLargeError) {
        return notSentResponse('too_long', 422);
      }
      throw error;
    }

    // 11. Deliver.
    let outcome: SinkOutcome;
    try {
      outcome = await config.sink.create(ticket);
    } catch {
      // The design's sink contract says create() never throws
      // (githubSink()'s doesn't), but a request that reached the network
      // before failing may still have dispatched — the same reasoning
      // that makes every non-definitive outcome "unconfirmed", not
      // "not sent". `code: 'sink_threw'` is this handler's own marker
      // (never one githubSink() itself produces) so this path is
      // distinguishable in logs from an ordinary inconclusive response.
      log({ event: 'FEEDBACK_DELIVERY_UNCONFIRMED', report_id: payload.report_id, code: 'sink_threw', status: null });
      return jsonResponse({ status: 'unconfirmed', report_id: payload.report_id }, 202);
    }

    if (outcome.ok) {
      log({ event: 'FEEDBACK_DELIVERED', report_id: payload.report_id, number: outcome.number });
      return jsonResponse({ status: 'received', receipt: `#${outcome.number}` }, 201);
    }

    if (outcome.definitive) {
      log({
        event: 'FEEDBACK_DELIVERY_FAILED',
        report_id: payload.report_id,
        code: outcome.code,
        status: outcome.status ?? null,
      });
      return notSentResponse(mapDefinitiveSinkCode(outcome.code), 502);
    }

    log({
      event: 'FEEDBACK_DELIVERY_UNCONFIRMED',
      report_id: payload.report_id,
      code: outcome.code,
      status: outcome.status ?? null,
    });
    return jsonResponse({ status: 'unconfirmed', report_id: payload.report_id }, 202);
  };
}
