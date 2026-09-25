/**
 * @papergiant/feedback — `doctor`'s checks (task P11; design §3 "Install
 * contract").
 *
 * Every check below always runs and always produces exactly one
 * `CheckResult`, even when an earlier check failed and this one has
 * nothing to verify as a result — in that case its status is `'fail'`
 * with a reason that says what's missing (e.g. "skipped: ..."). This
 * keeps the report's shape (nine checks, always) independent of how much
 * configuration was supplied, which is what makes `--json`'s shape
 * stable and lets a person or a script see the whole picture at once,
 * the way `flutter doctor` or `git fsck` do, rather than stopping at the
 * first problem.
 *
 * Nothing in this file ever puts key material, a token or a JWT into a
 * `CheckResult.reason` — see the individual comments below for where
 * that matters most (the key-parse and token-mint checks, which handle
 * the two secrets doctor ever touches).
 */
import { FeedbackCredentialError, githubAppAuth, parsePrivateKey, type FetchLike } from '../github/index.js';
import { memoryLimiter } from '../limit/index.js';
import { DEFAULT_API_BASE_URL, ENV_VAR_NAMES, parseList, type ResolvedConfig } from './config.js';
import { fetchLabelExists, fetchRepoState } from './github-api.js';
import { computeKeyInfo } from './key-info.js';
import { describeArg } from './redact.js';
import type { CheckResult } from './types.js';

const TIMEOUT_MS = 10_000;

function isBareOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.origin === value;
}

function pass(id: string, description: string, reason: string): CheckResult {
  return { id, description, status: 'pass', reason };
}
function warn(id: string, description: string, reason: string): CheckResult {
  return { id, description, status: 'warn', reason };
}
function fail(id: string, description: string, reason: string): CheckResult {
  return { id, description, status: 'fail', reason };
}

function checkRequiredNames(config: ResolvedConfig): CheckResult {
  const id = 'required-names';
  const description = 'required environment names are present';

  const required: Array<[string, string | undefined]> = [
    [ENV_VAR_NAMES.privateKey, config.privateKey],
    [ENV_VAR_NAMES.clientId, config.clientId],
    [ENV_VAR_NAMES.installationId, config.installationId],
    [ENV_VAR_NAMES.intake, config.intake],
    [ENV_VAR_NAMES.appUrl, config.appUrl],
    [ENV_VAR_NAMES.origins, config.originsRaw],
    [ENV_VAR_NAMES.labels, config.labelsRaw],
  ];
  const missing = required.filter(([, value]) => value === undefined).map(([name]) => name);

  if (missing.length > 0) {
    return fail(id, description, `missing: ${missing.join(', ')}`);
  }
  return pass(id, description, 'all seven required names are present');
}

async function checkKeyParses(config: ResolvedConfig): Promise<CheckResult> {
  const id = 'key-parses';
  const description = 'the private key parses (PKCS#1/PKCS#8, PEM or base64)';

  if (config.privateKey === undefined) {
    return fail(id, description, `skipped: ${ENV_VAR_NAMES.privateKey} is not set`);
  }

  try {
    await parsePrivateKey(config.privateKey);
  } catch (error) {
    const message = error instanceof FeedbackCredentialError ? error.message : 'the private key could not be parsed';
    return fail(id, description, message);
  }

  const info = computeKeyInfo(config.privateKey);
  const parts: string[] = ['parses'];
  if (info.modulusLength !== undefined) parts.push(`${info.modulusLength}-bit`);
  if (info.spkiSha256 !== undefined) parts.push(`public key fingerprint ${info.spkiSha256}`);
  return pass(id, description, parts.join('; '));
}

interface TokenMintResult {
  check: CheckResult;
  token?: string;
}

async function checkTokenMint(config: ResolvedConfig, fetchImpl: FetchLike): Promise<TokenMintResult> {
  const id = 'token-mint';
  const description = "an installation token mints, narrowed to the intake repository with issues: write";

  if (
    config.privateKey === undefined ||
    config.clientId === undefined ||
    config.installationId === undefined ||
    config.intake === undefined
  ) {
    return {
      check: fail(
        id,
        description,
        `skipped: needs ${ENV_VAR_NAMES.privateKey}, ${ENV_VAR_NAMES.clientId}, ${ENV_VAR_NAMES.installationId} and ${ENV_VAR_NAMES.intake}`,
      ),
    };
  }

  try {
    const auth = githubAppAuth({
      clientId: config.clientId,
      installationId: config.installationId,
      privateKey: config.privateKey,
      repository: config.intake,
      apiBaseUrl: config.apiBaseUrl,
      fetch: fetchImpl,
      timeoutMs: TIMEOUT_MS,
    });
    const token = await auth.token();
    const via = config.apiBaseUrl !== DEFAULT_API_BASE_URL ? ` via ${describeArg(config.apiBaseUrl)}` : '';
    return {
      check: pass(
        id,
        description,
        `token minted, narrowed to ${describeArg(config.intake)} with issues: write${via}`,
      ),
      token,
    };
  } catch (error) {
    // Only a FeedbackCredentialError's message is trusted to be a fixed,
    // safe string (see src/github/errors.ts) — anything else is reported
    // generically rather than interpolated, on the same reasoning as the
    // privacy note above the file.
    if (error instanceof FeedbackCredentialError) {
      const status = error.status !== undefined ? ` (status ${error.status})` : '';
      return { check: fail(id, description, `${error.message}${status}`) };
    }
    return { check: fail(id, description, 'an unexpected error occurred minting the installation token') };
  }
}

function checkRepoState(
  config: ResolvedConfig,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<[CheckResult, CheckResult]> {
  const hasIssuesId = 'repo-has-issues';
  const hasIssuesDescription = 'the intake repository has issues enabled';
  const privateId = 'repo-private';
  const privateDescription = 'the intake repository is private';

  const intake = config.intake;
  if (token === undefined || intake === undefined) {
    const reason = 'skipped: no installation token available';
    return Promise.resolve([
      fail(hasIssuesId, hasIssuesDescription, reason),
      fail(privateId, privateDescription, reason),
    ]);
  }

  return fetchRepoState(intake, {
    apiBaseUrl: config.apiBaseUrl,
    token,
    fetch: fetchImpl,
    timeoutMs: TIMEOUT_MS,
  }).then((result): [CheckResult, CheckResult] => {
    if (!result.ok) {
      return [
        fail(hasIssuesId, hasIssuesDescription, result.reason),
        fail(privateId, privateDescription, result.reason),
      ];
    }

    // `intake` (not `config.intake`) — narrowing to `string` above
    // doesn't survive into this `.then()` closure otherwise.
    const intakeDescribed = describeArg(intake);
    const hasIssuesCheck = result.hasIssues
      ? pass(hasIssuesId, hasIssuesDescription, `issues are enabled on ${intakeDescribed}`)
      : fail(hasIssuesId, hasIssuesDescription, `issues are disabled on ${intakeDescribed}`);

    const privateCheck = result.isPrivate
      ? pass(privateId, privateDescription, `${intakeDescribed} is private`)
      : warn(privateId, privateDescription, `${intakeDescribed} is public`);

    return [hasIssuesCheck, privateCheck];
  });
}

async function checkLabelsExist(
  config: ResolvedConfig,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<CheckResult> {
  const id = 'labels-exist';
  const description = 'every configured label exists on the intake repository';

  const labels = parseList(config.labelsRaw);

  if (token === undefined || config.intake === undefined || labels.length === 0) {
    return fail(id, description, 'skipped: no installation token, intake repository, or labels configured');
  }

  const missing: string[] = [];
  for (const label of labels) {
    const result = await fetchLabelExists(config.intake, label, {
      apiBaseUrl: config.apiBaseUrl,
      token,
      fetch: fetchImpl,
      timeoutMs: TIMEOUT_MS,
    });
    if (!result.ok) {
      return fail(id, description, result.reason);
    }
    if (!result.exists) {
      missing.push(label);
    }
  }

  if (missing.length > 0) {
    return fail(id, description, `missing labels: ${missing.map((label) => describeArg(label)).join(', ')}`);
  }
  return pass(id, description, `all ${labels.length} configured labels exist`);
}

function checkOriginsWellFormed(config: ResolvedConfig): CheckResult {
  const id = 'origins-well-formed';
  const description = 'each configured origin is exactly new URL(v).origin';

  const origins = parseList(config.originsRaw);
  if (origins.length === 0) {
    return fail(id, description, `skipped: ${ENV_VAR_NAMES.origins} is not set`);
  }

  const invalid = origins.filter((origin) => !isBareOrigin(origin));
  if (invalid.length > 0) {
    return fail(id, description, `not a bare origin: ${invalid.map((origin) => describeArg(origin)).join(', ')}`);
  }
  return pass(id, description, `${origins.length} configured origin(s) are well-formed`);
}

function checkAppUrlInOrigins(config: ResolvedConfig): CheckResult {
  const id = 'app-url-in-origins';
  const description = "the app URL's origin is among the configured origins";

  if (config.appUrl === undefined) {
    return fail(id, description, `skipped: ${ENV_VAR_NAMES.appUrl} is not set`);
  }

  let appOrigin: string;
  try {
    appOrigin = new URL(config.appUrl).origin;
  } catch {
    return fail(id, description, `${ENV_VAR_NAMES.appUrl} is not a valid URL`);
  }

  const origins = parseList(config.originsRaw);
  if (origins.length === 0) {
    return fail(id, description, `skipped: ${ENV_VAR_NAMES.origins} is not set`);
  }

  if (!origins.includes(appOrigin)) {
    return fail(id, description, `the app URL's origin (${appOrigin}) is not among the configured origins`);
  }
  return pass(id, description, `${appOrigin} is among the configured origins`);
}

function checkLimiterProduction(config: ResolvedConfig): CheckResult {
  const id = 'limiter-production';
  const description = 'production does not rely on an unshared, non-atomic limiter';

  if (config.limiter === undefined) {
    return config.production
      ? warn(id, description, 'limiter not declared; pass --limiter shared|memory')
      : pass(id, description, 'no --limiter given; nothing to check');
  }
  if (config.limiter === 'shared') {
    return pass(id, description, 'a shared limiter is configured; safe for a multi-instance production host');
  }

  // 'memory': read the real memoryLimiter()'s reported kind/singleInstance
  // (src/limit/index.ts exposes them for exactly this check) rather than
  // re-deriving the same decision from the raw flags a second time.
  const limiter = memoryLimiter({ singleInstance: config.singleInstance });

  if (config.production && !limiter.singleInstance) {
    return warn(
      id,
      description,
      'an in-process memory limiter cannot coordinate across instances or survive a restart; ' +
        'production needs a shared, atomic limiter (design §5), or pass --single-instance if this host is genuinely single-instance',
    );
  }
  return pass(
    id,
    description,
    config.production
      ? 'memoryLimiter is configured, but this host declared itself --single-instance'
      : 'memoryLimiter is fine for development and tests (no --production given)',
  );
}

/** Runs every check, in the design's order, and returns all nine results.
 * `fetchImpl` is injectable so tests point `doctor` at a local stub
 * instead of the real `https://api.github.com`. */
export async function runChecks(config: ResolvedConfig, fetchImpl: FetchLike = fetch): Promise<CheckResult[]> {
  const requiredNames = checkRequiredNames(config);
  const keyParses = await checkKeyParses(config);
  const { check: tokenMint, token } = await checkTokenMint(config, fetchImpl);
  const [hasIssues, isPrivate] = await checkRepoState(config, token, fetchImpl);
  const labelsExist = await checkLabelsExist(config, token, fetchImpl);
  const originsWellFormed = checkOriginsWellFormed(config);
  const appUrlInOrigins = checkAppUrlInOrigins(config);
  const limiterProduction = checkLimiterProduction(config);

  return [
    requiredNames,
    keyParses,
    tokenMint,
    hasIssues,
    isPrivate,
    labelsExist,
    originsWellFormed,
    appUrlInOrigins,
    limiterProduction,
  ];
}
