/**
 * @papergiant/feedback/github — installation-token auth sources.
 *
 * `githubAppAuth` implements the GitHub App installation-token flow
 * (design §5 "Credential"): sign an RS256 JWT as the app, mint a token
 * narrowed to the one intake repository with `issues: write`, and cache
 * it until five minutes before it expires. `tokenAuth` wraps a
 * fine-grained personal access token in the same `{ token() }` shape,
 * for the fallback credential.
 *
 * `githubAppAuth(options)` must be constructed once — at module scope,
 * not per request — and its returned `TokenSource` reused. A fresh
 * instance per request defeats the token cache, the single-flight mint
 * and the parsed-key cache below, and re-parses the private key on
 * every call.
 */
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  githubHeaders,
  type FetchLike,
} from './constants.js';
import { FeedbackCredentialError } from './errors.js';
import { signAppJwt } from './jwt.js';
import { parsePrivateKey } from './key.js';

/** The shape both credential kinds present to `githubSink`. */
export interface TokenSource {
  /** Resolves to a bearer token, or rejects with `FeedbackCredentialError`. */
  token(): Promise<string>;
  /** Clears any cached token, so the next `token()` call mints again. */
  invalidate?(): void;
  /** The repository this token is scoped to, as `owner/name`, when known. */
  repository?: string;
}

export interface GithubAppAuthOptions {
  /** The GitHub App's client id (the JWT `iss` claim). */
  clientId: string;
  /** The installation id of the app on the client's intake organisation. */
  installationId: string;
  /** PEM PKCS#1, PEM PKCS#8, or base64 of either — see `parsePrivateKey`. */
  privateKey: string;
  /** The intake repository the minted token is narrowed to, as `owner/name`. */
  repository: string;
  apiBaseUrl?: string;
  fetch?: FetchLike;
  /** Returns the current time in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Milliseconds before the token-mint request is aborted. Default 10000. */
  timeoutMs?: number;
}

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

interface MintResult {
  token: string;
  /** `null` when `expires_at` could not be parsed: use this token once, do not cache it. */
  expiresAtMs: number | null;
}

interface MintParams {
  installationId: string;
  repoName: string;
  jwt: string;
  apiBaseUrl: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function repositoryName(repository: string): string {
  const parts = repository.split('/');
  const name = parts[1];
  if (parts.length !== 2 || !parts[0] || !name) {
    throw new FeedbackCredentialError('"repository" must be "owner/name"');
  }
  return name;
}

async function mintInstallationToken(params: MintParams): Promise<MintResult> {
  let response: Response;
  try {
    response = await params.fetchImpl(
      `${params.apiBaseUrl}/app/installations/${params.installationId}/access_tokens`,
      {
        method: 'POST',
        // Never follow a redirect: a 301/303 would resend the bearer JWT
        // as a GET to wherever it points, and a 307 would replay this
        // exact POST there. Treat any redirect as a failed mint instead.
        redirect: 'error',
        headers: githubHeaders({
          Authorization: `Bearer ${params.jwt}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          repositories: [params.repoName],
          permissions: { issues: 'write' },
        }),
        signal: AbortSignal.timeout(params.timeoutMs),
      },
    );
  } catch {
    throw new FeedbackCredentialError('could not mint installation token: request failed');
  }

  if (response.status !== 201) {
    void response.body?.cancel().catch(() => {});
    throw new FeedbackCredentialError('could not mint installation token', {
      status: response.status,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FeedbackCredentialError('could not mint installation token: unparseable response', {
      status: response.status,
    });
  }

  const token = isRecord(body) ? body.token : undefined;
  if (typeof token !== 'string' || token.length === 0) {
    throw new FeedbackCredentialError('could not mint installation token: unparseable response', {
      status: response.status,
    });
  }

  // `expires_at` is required by GitHub's API, but a missing or
  // unparseable value is not itself a reason to refuse a token GitHub
  // did hand us — treat it as already expired: usable once, but never
  // cached, so the next call mints fresh rather than trusting a
  // lifetime we could not determine.
  const expiresAt = isRecord(body) ? body.expires_at : undefined;
  const expiresAtMs = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN;

  return { token, expiresAtMs: Number.isNaN(expiresAtMs) ? null : expiresAtMs };
}

/**
 * A GitHub App installation-token source (design §5 "Credential").
 *
 * `repository` (`owner/name`) is validated synchronously — a malformed
 * value throws immediately, not later from `token()`. `privateKey` is
 * parsed once, on first use, and the resulting `CryptoKey` is cached; a
 * failed parse is not cached, so the next call retries it. The minted
 * token is narrowed to `repository` with `issues: write`, and is cached
 * until five minutes before `expires_at` (or not cached at all, when
 * `expires_at` could not be parsed — see `mintInstallationToken`).
 * Concurrent `token()` callers share one in-flight mint; a failed mint
 * is not cached, so the next call retries it. `invalidate()` clears the
 * cached token (`githubSink` calls it after a `401` on the issue
 * request, so a dead token is never reused).
 */
export function githubAppAuth(options: GithubAppAuthOptions): TokenSource {
  const repoName = repositoryName(options.repository);
  const apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let cached: CachedToken | null = null;
  let inFlight: Promise<string> | null = null;
  let keyPromise: Promise<CryptoKey> | null = null;

  function getKey(): Promise<CryptoKey> {
    if (!keyPromise) {
      keyPromise = parsePrivateKey(options.privateKey).catch((error: unknown) => {
        keyPromise = null;
        throw error;
      });
    }
    return keyPromise;
  }

  async function refresh(): Promise<string> {
    const key = await getKey();
    const jwt = await signAppJwt({ clientId: options.clientId, key, nowMs: now() });
    const minted = await mintInstallationToken({
      installationId: options.installationId,
      repoName,
      jwt,
      apiBaseUrl,
      fetchImpl,
      timeoutMs,
    });
    cached =
      minted.expiresAtMs === null ? null : { token: minted.token, expiresAtMs: minted.expiresAtMs };
    return minted.token;
  }

  return {
    async token(): Promise<string> {
      if (cached && cached.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > now()) {
        return cached.token;
      }
      if (!inFlight) {
        inFlight = refresh().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    invalidate(): void {
      cached = null;
    },
    repository: options.repository,
  };
}

/**
 * A fixed-token source for the fine-grained personal-access-token
 * fallback credential (design §5). Same `{ token() }` shape as
 * `githubAppAuth`, with no minting, caching or repository scope of its
 * own to report.
 */
export function tokenAuth(token: string): TokenSource {
  return {
    async token(): Promise<string> {
      return token;
    },
  };
}
