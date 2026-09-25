/**
 * @papergiant/feedback — `doctor` (task P11; design §3 "Install
 * contract", build plan P11).
 *
 * This module is not part of the package's public API (there is no
 * `./doctor` entry in `package.json`'s `exports`) — it exists so
 * `src/bin/doctor.ts` has something to call, and so the pieces below it
 * can be unit-tested directly (`test/bin/*.test.ts` imports from
 * `dist/doctor/*.js`) without spawning a process for every case. The
 * process-level, spawn-the-built-CLI tests still exist (design/build
 * plan requires exercising the real `dist/bin/doctor.js`); this is what
 * they exercise underneath.
 */
import type { FetchLike } from '../github/index.js';
import { runChecks } from './checks.js';
import { DoctorUsageError, parseDoctorArgs, resolveConfig } from './config.js';
import { formatHuman, formatJson } from './format.js';
import { doctorUsage } from './help.js';
import { buildReport } from './types.js';

export { ENV_VAR_NAMES } from './config.js';
export { parseEnvFile } from './env-file.js';
export type { CheckResult, CheckStatus, DoctorReport } from './types.js';
export { buildReport } from './types.js';

export interface DoctorCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Runs the `doctor` subcommand end to end: parse `argv` (everything
 * after the `doctor` token), resolve configuration from flags + `env` +
 * `--env-file`, run every check, and format the result. `fetchImpl` is
 * injectable so tests point every network call at a local stub.
 *
 * Never throws: a usage problem (bad flag, unreadable `--env-file`,
 * `--limiter` given something other than `memory`/`shared`) is reported
 * through `exitCode: 2` and a message on `stderr`, not an exception.
 */
export async function runDoctorCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike = fetch,
): Promise<DoctorCommandResult> {
  let args;
  try {
    args = parseDoctorArgs(argv);
  } catch (error) {
    if (error instanceof DoctorUsageError) {
      return { stdout: '', stderr: `papergiant-feedback doctor: ${error.message}\n\n${doctorUsage()}`, exitCode: 2 };
    }
    throw error;
  }

  if (args.help) {
    return { stdout: doctorUsage(), stderr: '', exitCode: 0 };
  }

  let config;
  try {
    config = resolveConfig(args, env);
  } catch (error) {
    if (error instanceof DoctorUsageError) {
      return { stdout: '', stderr: `papergiant-feedback doctor: ${error.message}\n\n${doctorUsage()}`, exitCode: 2 };
    }
    throw error;
  }

  const checks = await runChecks(config, fetchImpl);
  const report = buildReport(checks);
  const stdout = args.json ? formatJson(report) : formatHuman(report);

  return { stdout, stderr: '', exitCode: report.exitCode };
}
