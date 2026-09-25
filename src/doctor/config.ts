/**
 * @papergiant/feedback — `doctor` argument parsing and configuration
 * resolution (task P11; design §3 "Install contract").
 *
 * `doctor` never accepts the private key on the command line — there is
 * no `--private-key` flag — because a CLI argument sits in the shell's
 * history and in the process list (`ps`) for the whole run; the key can
 * only arrive through `FEEDBACK_GITHUB_PRIVATE_KEY` (directly in the
 * environment, or via `--dotenv-file`, which is read once and never
 * echoed). Every other setting has both a flag and an environment-variable
 * default, documented in `doctorUsage()` (`./help.ts`).
 *
 * **Why `--dotenv-file`, not `--env-file`.** Node.js (confirmed on 20.19
 * and 22.17, i.e. both of this package's CI matrix entries) recognises
 * its own `--env-file`/`--env-file=...` flag anywhere in `process.argv`
 * — even after the script path, where every other Node flag stops being
 * special — and if the named file doesn't exist, *Node itself* prints
 * `node: <path>: not found` and exits with code 9 before this script's
 * `main()` ever runs. That happens no matter what this module calls the
 * flag internally, because the interception happens in the `node`
 * binary, not in this file: naming doctor's own flag `--env-file` would
 * make a missing file crash with the wrong message and the wrong exit
 * code (9, not this file's own usage-error code 2) every time, and would
 * also mean Node — not `./env-file.ts`'s "parsed as data, never
 * executed" parser — is the thing actually reading the file. No other
 * flag name doctor uses collides the same way (checked individually).
 */
import { readFileSync } from 'node:fs';
import { parseEnvFile } from './env-file.js';
import { describeArg } from './redact.js';

/** The seven environment variables `doctor` reads defaults from (design
 * §3 "Install contract"). Exported so tests and `INSTALL.md` can cite the
 * same list `doctor --help` prints. */
export const ENV_VAR_NAMES = {
  privateKey: 'FEEDBACK_GITHUB_PRIVATE_KEY',
  clientId: 'FEEDBACK_GITHUB_CLIENT_ID',
  installationId: 'FEEDBACK_GITHUB_INSTALLATION_ID',
  intake: 'FEEDBACK_INTAKE_REPOSITORY',
  appUrl: 'FEEDBACK_APP_URL',
  origins: 'FEEDBACK_ORIGINS',
  labels: 'FEEDBACK_LABELS',
} as const;

/** Testing-only: not part of the install contract. Points `doctor` at a
 * stand-in for `https://api.github.com`, the same way `githubSink()` and
 * `githubAppAuth()`'s own `apiBaseUrl` option does.
 *
 * **Never read from `--dotenv-file`.** Every other setting may come from
 * a dotenv file; this one may not — a stray or poisoned line in a
 * shared `.env` could otherwise redirect the installation-token mint
 * (which signs and sends the app's private key's JWT) to an attacker's
 * server. It can only come from `--api-base-url` or a value already
 * present in the real environment. See `resolveConfig` below. */
export const API_BASE_URL_ENV_VAR = 'FEEDBACK_GITHUB_API_BASE_URL';
export const DEFAULT_API_BASE_URL = 'https://api.github.com';

export class DoctorUsageError extends Error {}

export type LimiterKind = 'memory' | 'shared';

export interface DoctorArgs {
  help: boolean;
  dotenvFile?: string;
  appUrl?: string;
  origins?: string;
  intake?: string;
  clientId?: string;
  installationId?: string;
  labels?: string;
  production: boolean;
  limiter?: LimiterKind;
  singleInstance: boolean;
  json: boolean;
  apiBaseUrl?: string;
}

interface FlagSpec {
  key: keyof DoctorArgs;
  takesValue: boolean;
}

const FLAGS: Record<string, FlagSpec> = {
  '--help': { key: 'help', takesValue: false },
  '-h': { key: 'help', takesValue: false },
  '--dotenv-file': { key: 'dotenvFile', takesValue: true },
  '--app-url': { key: 'appUrl', takesValue: true },
  '--origins': { key: 'origins', takesValue: true },
  '--intake': { key: 'intake', takesValue: true },
  '--client-id': { key: 'clientId', takesValue: true },
  '--installation-id': { key: 'installationId', takesValue: true },
  '--labels': { key: 'labels', takesValue: true },
  '--production': { key: 'production', takesValue: false },
  '--limiter': { key: 'limiter', takesValue: true },
  '--single-instance': { key: 'singleInstance', takesValue: false },
  '--json': { key: 'json', takesValue: false },
  '--api-base-url': { key: 'apiBaseUrl', takesValue: true },
};

/** Parses `doctor`'s own argv (i.e. everything after the `doctor`
 * subcommand token, which `src/bin/doctor.ts` strips before calling
 * this). Throws `DoctorUsageError` on anything it can't make sense of —
 * an unknown flag, a value-flag with no value, a boolean flag given
 * `--flag=value`, `--limiter` given something other than
 * `memory`/`shared`, or a bare positional argument (`doctor` takes
 * none). Every thrown message runs its offending value through
 * `describeArg` first — see that function's comment. */
export function parseDoctorArgs(argv: readonly string[]): DoctorArgs {
  const args: DoctorArgs = {
    help: false,
    production: false,
    singleInstance: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (!token.startsWith('-')) {
      throw new DoctorUsageError(
        `unexpected argument ${describeArg(token, i + 1)} (doctor takes no positional arguments)`,
      );
    }

    const eq = token.indexOf('=');
    const flagName = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);

    const spec = FLAGS[flagName];
    if (!spec) {
      throw new DoctorUsageError(`unknown flag ${describeArg(flagName, i + 1)}`);
    }

    if (!spec.takesValue) {
      if (inlineValue !== undefined) {
        throw new DoctorUsageError(`'${flagName}' does not take a value`);
      }
      (args as unknown as Record<string, unknown>)[spec.key] = true;
      continue;
    }

    let value = inlineValue;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new DoctorUsageError(`'${flagName}' requires a value`);
      }
      value = next;
      i++;
    }

    if (flagName === '--limiter' && value !== 'memory' && value !== 'shared') {
      throw new DoctorUsageError(`'--limiter' must be 'memory' or 'shared' (${describeArg(value, i + 1)})`);
    }

    (args as unknown as Record<string, unknown>)[spec.key] = value;
  }

  return args;
}

export interface ResolvedConfig {
  privateKey?: string;
  clientId?: string;
  installationId?: string;
  intake?: string;
  appUrl?: string;
  originsRaw?: string;
  labelsRaw?: string;
  production: boolean;
  limiter?: LimiterKind;
  singleInstance: boolean;
  apiBaseUrl: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim().length > 0 ? value : undefined;
}

/** Resolves one setting: an explicit CLI flag wins; otherwise a
 * currently-exported environment variable; otherwise a value from
 * `--dotenv-file`, which only fills in what the real environment doesn't
 * already have — the same "don't clobber what's already exported"
 * convention the `dotenv` package uses. This precedence isn't specified
 * by the design or build plan; it is the least surprising one available,
 * and is documented here rather than only in the PR description. */
function resolve(
  flagValue: string | undefined,
  envVarName: string,
  processEnv: NodeJS.ProcessEnv,
  envFileValues: Record<string, string>,
): string | undefined {
  return nonEmpty(flagValue) ?? nonEmpty(processEnv[envVarName]) ?? nonEmpty(envFileValues[envVarName]);
}

/** Reads and parses `--dotenv-file`, if given. Thrown errors are usage
 * errors (exit 2) — a missing or unreadable file is a mistake in how
 * `doctor` was invoked, not a check the report should FAIL. The path
 * itself is run through `describeArg` before being echoed, for the same
 * reason argv tokens are: a value that fails to open as a path (because
 * it's actually a pasted PEM, say) must not be printed back out. */
function readEnvFile(path: string | undefined): Record<string, string> {
  if (path === undefined) return {};
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new DoctorUsageError(`could not read --dotenv-file ${describeArg(path)}: ${code}`);
  }
  return parseEnvFile(content);
}

/** `FEEDBACK_GITHUB_API_BASE_URL` must be `https://` unless the host is
 * loopback (`localhost`, `127.0.0.1`, `::1`) — the target of the
 * installation-token mint, which sends the signed app JWT, so a plain
 * `http://` endpoint anywhere else would put that JWT on the wire in
 * the clear. Loopback stays allowed because that's exactly what this
 * package's own tests point doctor at (a local stub GitHub). */
function assertSafeApiBaseUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DoctorUsageError(`--api-base-url / ${API_BASE_URL_ENV_VAR} is not a valid URL (${describeArg(value)})`);
  }
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !isLoopback) {
    throw new DoctorUsageError(
      `--api-base-url / ${API_BASE_URL_ENV_VAR} must be https:// unless the host is loopback ` +
        `(localhost/127.0.0.1/::1); got ${describeArg(value)}`,
    );
  }
}

/** Combines parsed flags, `process.env` and an optional `--dotenv-file`
 * into the configuration `checks.ts` runs against. Pure with respect to
 * the network and the filesystem beyond the one `--dotenv-file` read.
 *
 * Two settings are deliberately **not** resolved through `resolve()`'s
 * usual flag-then-env-then-dotenv-file precedence:
 * - `privateKey` never reads `--dotenv-file` at all (no flag either) —
 *   it comes from the real environment only.
 * - `apiBaseUrl` never reads `--dotenv-file` either, and is refused
 *   outright unless it's `https://` or loopback — see
 *   `assertSafeApiBaseUrl` above and the comment on
 *   `API_BASE_URL_ENV_VAR`.
 */
export function resolveConfig(args: DoctorArgs, processEnv: NodeJS.ProcessEnv): ResolvedConfig {
  const envFileValues = readEnvFile(args.dotenvFile);

  if (envFileValues[ENV_VAR_NAMES.privateKey] !== undefined) {
    throw new DoctorUsageError(
      '--dotenv-file must not contain FEEDBACK_GITHUB_PRIVATE_KEY — the key comes from the real environment only',
    );
  }

  const apiBaseUrl = nonEmpty(args.apiBaseUrl) ?? nonEmpty(processEnv[API_BASE_URL_ENV_VAR]) ?? DEFAULT_API_BASE_URL;
  assertSafeApiBaseUrl(apiBaseUrl);

  return {
    privateKey: nonEmpty(processEnv[ENV_VAR_NAMES.privateKey]),
    clientId: resolve(args.clientId, ENV_VAR_NAMES.clientId, processEnv, envFileValues),
    installationId: resolve(args.installationId, ENV_VAR_NAMES.installationId, processEnv, envFileValues),
    intake: resolve(args.intake, ENV_VAR_NAMES.intake, processEnv, envFileValues),
    appUrl: resolve(args.appUrl, ENV_VAR_NAMES.appUrl, processEnv, envFileValues),
    originsRaw: resolve(args.origins, ENV_VAR_NAMES.origins, processEnv, envFileValues),
    labelsRaw: resolve(args.labels, ENV_VAR_NAMES.labels, processEnv, envFileValues),
    production: args.production,
    limiter: args.limiter,
    singleInstance: args.singleInstance,
    apiBaseUrl,
  };
}

/** Splits a comma-separated flag/env value into trimmed, non-empty
 * entries (`--origins`, `--labels`). `undefined` and `''` both yield an
 * empty list. */
export function parseList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
