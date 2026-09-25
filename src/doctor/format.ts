/**
 * @papergiant/feedback — `doctor` report formatting (task P11).
 */
import type { CheckResult, CheckStatus, DoctorReport } from './types.js';

const LABELS: Record<CheckStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };

function formatLine(check: CheckResult): string {
  const label = LABELS[check.status].padEnd(4);
  const id = check.id.padEnd(22);
  return `[${label}] ${id} ${check.reason}`;
}

/** The default, human-readable report. */
export function formatHuman(report: DoctorReport): string {
  const lines = report.checks.map(formatLine);

  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const check of report.checks) counts[check.status]++;

  const summary =
    counts.fail > 0
      ? `${counts.fail} failure${counts.fail === 1 ? '' : 's'}, ${counts.warn} warning${counts.warn === 1 ? '' : 's'}.`
      : counts.warn > 0
        ? `All checks passed, with ${counts.warn} warning${counts.warn === 1 ? '' : 's'}.`
        : 'All checks passed.';

  return `${lines.join('\n')}\n\n${summary}\n`;
}

/** `--json`: the same report, machine-readable. */
export function formatJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
