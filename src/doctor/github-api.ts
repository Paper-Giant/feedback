/**
 * @papergiant/feedback — `doctor`'s read-only GitHub calls (task P11).
 *
 * `src/github/` (task P5) covers minting an installation token and
 * creating an issue; it has no reason to expose "read a repository" or
 * "read a label", so this file makes those two GETs directly with the
 * minted token. The header shape (`Accept`, `X-GitHub-Api-Version`,
 * `User-Agent`) intentionally mirrors `src/github/constants.ts`'s
 * `githubHeaders` — that module's constants aren't exported for reuse
 * outside `src/github/`, so this is kept in sync by hand.
 *
 * Every function here is a plain read (`GET`); `doctor` never writes to
 * GitHub beyond the installation-token mint in `src/github/`.
 */
import type { FetchLike } from '../github/index.js';
import { describeArg } from './redact.js';

const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'papergiant-feedback';

export interface GithubApiOptions {
  apiBaseUrl: string;
  token: string;
  fetch: FetchLike;
  timeoutMs: number;
}

export type RepoStateResult =
  | { ok: true; hasIssues: boolean; isPrivate: boolean }
  | { ok: false; reason: string };

export type LabelCheckResult = { ok: true; exists: boolean } | { ok: false; reason: string };

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: GITHUB_ACCEPT_HEADER,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': USER_AGENT,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** True for any 3xx status. Both GETs below use `redirect: 'manual'`
 * (never `'error'`) specifically so a redirect response is inspectable
 * rather than only ever surfacing as a generic fetch rejection — a
 * redirect target is never followed either way, but the reason a
 * FAIL gives should say "unexpected redirect", not the same "could not
 * reach GitHub" a real DNS/connection failure gets. */
function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/** `GET /repos/{owner}/{name}` — read-only. Used for the "issues enabled"
 * FAIL check and the "repository is private" WARN check (design §3). */
export async function fetchRepoState(
  intake: string,
  options: GithubApiOptions,
): Promise<RepoStateResult> {
  let response: Response;
  try {
    response = await options.fetch(`${options.apiBaseUrl}/repos/${intake}`, {
      method: 'GET',
      redirect: 'manual',
      headers: headers(options.token),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch {
    return { ok: false, reason: 'could not reach GitHub to read the repository' };
  }

  if (isRedirectStatus(response.status)) {
    void response.body?.cancel().catch(() => {});
    return { ok: false, reason: 'unexpected redirect' };
  }

  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {});
    return { ok: false, reason: `GET /repos/${describeArg(intake)} returned ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'unparseable response reading the repository' };
  }

  if (!isRecord(body)) {
    return { ok: false, reason: 'unparseable response reading the repository' };
  }

  return {
    ok: true,
    hasIssues: body.has_issues === true,
    isPrivate: body.private === true,
  };
}

/** `GET /repos/{owner}/{name}/labels/{name}` — read-only, one call per
 * required label (design §3: "FAIL listing the missing names"). A 404
 * means the label doesn't exist; any other non-200 or transport failure
 * is reported as `ok: false` so the caller can tell "doesn't exist" apart
 * from "couldn't check". */
export async function fetchLabelExists(
  intake: string,
  label: string,
  options: GithubApiOptions,
): Promise<LabelCheckResult> {
  let response: Response;
  try {
    response = await options.fetch(
      `${options.apiBaseUrl}/repos/${intake}/labels/${encodeURIComponent(label)}`,
      {
        method: 'GET',
        redirect: 'manual',
        headers: headers(options.token),
        signal: AbortSignal.timeout(options.timeoutMs),
      },
    );
  } catch {
    return { ok: false, reason: 'could not reach GitHub to check labels' };
  }

  void response.body?.cancel().catch(() => {});

  if (isRedirectStatus(response.status)) return { ok: false, reason: 'unexpected redirect' };
  if (response.status === 200) return { ok: true, exists: true };
  if (response.status === 404) return { ok: true, exists: false };
  return { ok: false, reason: `GET .../labels/${describeArg(label)} returned ${response.status}` };
}
