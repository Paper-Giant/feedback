/**
 * @papergiant/feedback/github — shared constants and the injectable-fetch
 * type used by both the auth sources and the sink.
 */

/** The type of the global `fetch`, used so a host or test can inject a stand-in. */
export type FetchLike = typeof fetch;

export const DEFAULT_API_BASE_URL = 'https://api.github.com';

/** Default deadline, in milliseconds, for a GitHub REST request (mint or issue-create). */
export const DEFAULT_TIMEOUT_MS = 10_000;

export const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json';
export const GITHUB_API_VERSION = '2022-11-28';
export const USER_AGENT = 'papergiant-feedback';

/** Common headers for every GitHub REST call this module makes. */
export function githubHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: GITHUB_ACCEPT_HEADER,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': USER_AGENT,
    ...extra,
  };
}
