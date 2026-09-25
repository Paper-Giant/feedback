/**
 * @papergiant/feedback/github — githubSink(), githubAppAuth(), tokenAuth()
 * (task P5). Files a rendered `feedback/v1` ticket as a GitHub issue in
 * the client's private intake repository; see design §5 "Delivery
 * states" and "Credential".
 *
 * Zero runtime dependencies: built on global `fetch`, `crypto.subtle`
 * (WebCrypto), `AbortSignal.timeout`, `TextEncoder` and `atob`/`btoa`
 * only, so it runs unmodified in edge-style runtimes. `node:crypto` is
 * never imported here.
 */
export { parsePrivateKey } from './key.js';
export { FeedbackCredentialError } from './errors.js';
export { signAppJwt, type SignAppJwtOptions } from './jwt.js';
export { githubAppAuth, tokenAuth, type GithubAppAuthOptions, type TokenSource } from './app-auth.js';
export {
  githubSink,
  type FeedbackTicket,
  type SinkOutcome,
  type GithubSink,
  type GithubSinkOptions,
  type GithubSinkLogEvent,
} from './sink.js';
export type { FetchLike } from './constants.js';
