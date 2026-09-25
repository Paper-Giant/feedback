/**
 * Test-only helper for `test/bin/*.test.ts` (task P11): spawns the
 * **built** CLI (`dist/bin/doctor.js`), never the TypeScript source, so
 * these tests exercise exactly what a person or CI running
 * `npx @papergiant/feedback doctor` would run.
 *
 * The child's environment is built from a minimal base (`PATH` only —
 * never inherited wholesale) plus whatever the test passes, so a
 * `FEEDBACK_*` variable that happens to be set in the *outer* test
 * process (CI, a developer's shell) can never leak into a "missing env"
 * scenario and make it flaky.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('../../../dist/bin/doctor.js', import.meta.url));

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ExecFileError extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

export function runCli(args: readonly string[], env: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { env: { PATH: process.env.PATH ?? '', ...env } },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        const execError = error as ExecFileError;
        if (typeof execError.code === 'number') {
          resolve({ stdout: execError.stdout ?? stdout, stderr: execError.stderr ?? stderr, exitCode: execError.code });
          return;
        }
        // A signal (string `.code`, or none at all) means the process
        // didn't exit normally — that's a real test-infrastructure
        // failure, not a doctor exit code to assert on.
        reject(error);
      },
    );
  });
}

export { CLI_PATH };
