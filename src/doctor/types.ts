/**
 * @papergiant/feedback — `doctor` (task P11; design §3 "Install contract").
 *
 * Shared types for the doctor CLI's checks and report. `doctor` is
 * read-only: it never creates, edits or deletes anything in GitHub — the
 * only POST it ever makes is the installation-token mint (a read of
 * GitHub's state, not a write to the intake repository).
 */

/** A check's outcome. There is no fourth "skip" status — a check whose
 * prerequisite is missing is reported as `'fail'` with a reason that says
 * so, so the report always lists the same fixed set of checks and the
 * `--json` shape never varies with how much configuration was supplied. */
export type CheckStatus = 'pass' | 'warn' | 'fail';

/** One line of the report: a stable `id`, a human description of what it
 * verifies, its outcome, and a one-line reason. `reason` is the only free
 * text here and must never contain a secret — no key material, no token,
 * no JWT (see the individual checks in `checks.ts`). */
export interface CheckResult {
  id: string;
  description: string;
  status: CheckStatus;
  reason: string;
}

/** The full doctor report: every check, plus the roll-up `doctor` itself
 * needs to decide its exit code (design: 0 with no FAIL, 1 with any FAIL). */
export interface DoctorReport {
  checks: CheckResult[];
  ok: boolean;
  exitCode: 0 | 1;
}

export function buildReport(checks: CheckResult[]): DoctorReport {
  const ok = checks.every((check) => check.status !== 'fail');
  return { checks, ok, exitCode: ok ? 0 : 1 };
}
