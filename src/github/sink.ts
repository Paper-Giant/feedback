/**
 * @papergiant/feedback/github — the sink: files a rendered ticket as a
 * GitHub issue in the intake repository (design §5 "Delivery states").
 *
 * `FeedbackTicket` is a minimal local stand-in for the ticket shape
 * `renderTicket()` (task P2, core) will produce — `{ title, body, labels }`
 * — kept deliberately narrow so this task does not block on P2, which is
 * being built in parallel. `renderTicket()`'s return type is a structural
 * superset of this, so passing its output here needs no adapter.
 */
import { DEFAULT_API_BASE_URL, DEFAULT_TIMEOUT_MS, githubHeaders, type FetchLike } from './constants.js';
import { FeedbackCredentialError } from './errors.js';
import type { TokenSource } from './app-auth.js';

/** The minimal ticket input this sink needs: a title, a body and labels. */
export interface FeedbackTicket {
  title: string;
  body: string;
  labels: readonly string[];
}

export type SinkOutcome =
  | { ok: true; number: number; url?: string; droppedLabels: string[] }
  | { ok: false; definitive: true; code: string; status?: number }
  | { ok: false; definitive: false; code: string; status?: number };

export interface GithubSinkLogEvent {
  event: 'FEEDBACK_LABELS_DROPPED';
  /** How many requested labels GitHub silently dropped — never their names. */
  count: number;
}

export interface GithubSinkOptions {
  auth: TokenSource;
  /** The intake repository, as `owner/name`. Must match `auth.repository`, when set. */
  intake: string;
  apiBaseUrl?: string;
  fetch?: FetchLike;
  /** Milliseconds before the issue-create request is aborted. Default 10000. */
  timeoutMs?: number;
  log?: (event: GithubSinkLogEvent) => void;
}

export interface GithubSink {
  create(ticket: FeedbackTicket): Promise<SinkOutcome>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Definitive-refusal codes for the statuses design §5 lists as definitive. */
function definitiveCodeForStatus(status: number, headers: Headers): string | null {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorised';
    case 403:
      return isRateLimited(headers) ? 'rate_limited' : 'forbidden';
    case 404:
      return 'not_found';
    case 410:
      return 'gone';
    case 422:
      return 'validation';
    case 429:
      return 'rate_limited';
    default:
      return null;
  }
}

function isRateLimited(headers: Headers): boolean {
  return headers.get('x-ratelimit-remaining') === '0' || headers.get('retry-after') !== null;
}

/** Reads `labels[].name` (GitHub's shape) or bare strings, tolerantly. */
function extractLabelNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      names.push(item);
    } else if (isRecord(item) && typeof item.name === 'string') {
      names.push(item.name);
    }
  }
  return names;
}

/**
 * Builds the GitHub sink: `create(ticket)` files an issue in `intake` and
 * maps every outcome to `SinkOutcome` per design §5.
 *
 * `intake` must name the same repository as `auth.repository`, when
 * `auth` reports one (as `githubAppAuth` does) — a mismatch throws
 * `FeedbackCredentialError` synchronously, at construction, since a
 * token narrowed to one repository can never file into another.
 *
 * `auth.token()` throwing is a definitive `credential` failure and
 * sends no issue request. `201` with a parseable, valid `number` is
 * success (`url` is set when GitHub also returned a string `html_url`,
 * but is not required for receipt). `400/401/403/404/410/422/429` are
 * definitive refusals — a `401` also calls `auth.invalidate?.()`, so a
 * dead cached token is not reused, with no in-request retry. Every
 * other outcome — a `5xx` or other unlisted status, a network error,
 * the timeout (including one that lands while the response body is
 * still being read), or an unparseable `201` — is a non-definitive
 * (inconclusive) outcome. The response body is released
 * (`response.body?.cancel()`) whenever it is not read. Never logs or
 * includes the ticket title or body.
 */
export function githubSink(options: GithubSinkOptions): GithubSink {
  if (options.auth.repository !== undefined && options.auth.repository !== options.intake) {
    throw new FeedbackCredentialError(
      '"auth" is scoped to a different repository than "intake"',
    );
  }

  const apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async create(ticket: FeedbackTicket): Promise<SinkOutcome> {
      let token: string;
      try {
        token = await options.auth.token();
      } catch {
        return { ok: false, definitive: true, code: 'credential' };
      }

      const signal = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(`${apiBaseUrl}/repos/${options.intake}/issues`, {
          method: 'POST',
          // Never follow a redirect: a 301/303 would resend the bearer
          // token as a GET to wherever it points, and a 307 would
          // replay this exact POST (title/body/labels included) there.
          redirect: 'error',
          headers: githubHeaders({
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            title: ticket.title,
            body: ticket.body,
            labels: ticket.labels,
          }),
          signal,
        });
      } catch {
        return signal.aborted
          ? { ok: false, definitive: false, code: 'timeout' }
          : { ok: false, definitive: false, code: 'network' };
      }

      if (response.status === 201) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          // The deadline can fire after headers arrive but while the
          // body is still being read; that is a timeout, not a body
          // that will never be parseable.
          return signal.aborted
            ? { ok: false, definitive: false, code: 'timeout' }
            : { ok: false, definitive: false, code: 'unparseable_success', status: response.status };
        }

        // Receipt requires only a valid issue number (design §5); the
        // URL is a convenience, not a condition of "received".
        const number = isRecord(body) ? body.number : undefined;
        if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
          return { ok: false, definitive: false, code: 'unparseable_success', status: response.status };
        }
        const htmlUrl = isRecord(body) ? body.html_url : undefined;
        const url = typeof htmlUrl === 'string' ? htmlUrl : undefined;

        const returnedLabels = extractLabelNames(isRecord(body) ? body.labels : undefined);
        const droppedLabels = ticket.labels.filter((label) => !returnedLabels.includes(label));
        if (droppedLabels.length > 0) {
          options.log?.({ event: 'FEEDBACK_LABELS_DROPPED', count: droppedLabels.length });
        }

        return { ok: true, number, url, droppedLabels };
      }

      // Every remaining path ignores the body — release it rather than
      // leaving the connection held open by an unread stream.
      void response.body?.cancel().catch(() => {});

      const definitiveCode = definitiveCodeForStatus(response.status, response.headers);
      if (definitiveCode) {
        if (response.status === 401) {
          options.auth.invalidate?.();
        }
        return { ok: false, definitive: true, code: definitiveCode, status: response.status };
      }

      const code = response.status >= 500 ? 'server_error' : 'unexpected_status';
      return { ok: false, definitive: false, code, status: response.status };
    },
  };
}
