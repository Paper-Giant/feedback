/**
 * @papergiant/feedback/build — buildFacts(), releaseLabel() (task P3).
 */

/**
 * Error thrown when build facts cannot be determined.
 */
export class BuildFactsError extends Error {
  override name = 'BuildFactsError';
}

export interface BuildFacts {
  release: string;
  commit: string | null;
}

/**
 * buildFacts() determines the build's release and commit.
 *
 * The default release format is YYYY.MM.DD-<first 7 hex of commit> when `FEEDBACK_RELEASE`
 * is not set; the suffix is `-local` when there is no commit. A custom `FEEDBACK_RELEASE`
 * replaces the whole release string.
 *
 * @param opts.env - environment variables
 * @param opts.now - timestamp for date calculation, default current time (UTC)
 * @param opts.commitVars - variable names to check for commit (default: ['VERCEL_GIT_COMMIT_SHA', 'GIT_COMMIT_SHA', 'SOURCE_COMMIT'])
 * @param opts.production - whether this is a production build (default: false); when true, requires a commit
 * @returns build facts with `release` and `commit` (or `null`); inline only these fields in bundler config
 * @throws BuildFactsError if the commit variable is malformed, `FEEDBACK_RELEASE` is invalid, or production mode requires a commit
 *
 * For Next App Router, inline in `env`: `release: buildFacts({ env: process.env }).release` and `commit: buildFacts({ env: process.env }).commit ?? ''`
 * (Next's `env` rejects null). Determine `production` from the deployment target (`VERCEL_TARGET_ENV` or `VERCEL_ENV`), never from `NODE_ENV`.
 */
export function buildFacts(opts: {
  env: Record<string, string | undefined>;
  now?: Date;
  commitVars?: string[];
  production?: boolean;
}): BuildFacts {
  const env = opts.env;
  const now = opts.now ?? new Date();
  const commitVars = opts.commitVars ?? [
    'VERCEL_GIT_COMMIT_SHA',
    'GIT_COMMIT_SHA',
    'SOURCE_COMMIT',
  ];
  const production = opts.production ?? false;

  // Find the first non-empty commit variable
  let commit: string | null = null;
  let commitVarUsed: string | undefined;
  for (const varName of commitVars) {
    const value = env[varName];
    if (value && value.trim() !== '') {
      commit = value.trim().toLowerCase();
      commitVarUsed = varName;
      break;
    }
  }

  // Validate commit if present
  if (commit !== null) {
    if (!/^[0-9a-f]{40}$/.test(commit)) {
      const value = env[commitVarUsed!];
      const len = value?.length ?? 0;
      throw new BuildFactsError(
        `Invalid commit SHA from ${commitVarUsed}: expected 40 hex characters, got ${len}`
      );
    }
  }

  // Production build requires a commit
  if (production && commit === null) {
    const varList = commitVars.length > 0 ? commitVars.join(', ') : '(none configured)';
    throw new BuildFactsError(
      `Production build requires a commit from one of: ${varList}`
    );
  }

  // Determine release
  let release: string;
  const feedbackRelease = env.FEEDBACK_RELEASE?.trim();
  if (feedbackRelease && feedbackRelease.length > 0) {
    // Validate FEEDBACK_RELEASE format and length
    if (
      feedbackRelease.length > 64 ||
      !/^[A-Za-z0-9._-]+$/.test(feedbackRelease)
    ) {
      throw new BuildFactsError(
        `Invalid FEEDBACK_RELEASE: must be 1-64 chars of [A-Za-z0-9._-], got ${JSON.stringify(feedbackRelease)}`
      );
    }
    release = feedbackRelease;
  } else {
    // Format: YYYY.MM.DD-<commit7 or 'local'>
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const dateStr = `${year}.${month}.${day}`;

    if (commit !== null) {
      release = `${dateStr}-${commit.slice(0, 7)}`;
    } else {
      release = `${dateStr}-local`;
    }
  }

  return { release, commit };
}

/**
 * releaseLabel() formats a release label for display.
 *
 * For the default release format (YYYY.MM.DD-<7-hex or local>), renders `Release <YYYY.MM.DD> · <7-hex>`
 * (or `Release <YYYY.MM.DD>` if no commit).
 * For a custom `FEEDBACK_RELEASE`, renders `Release <release> · <7-hex>` if commit exists, or `Release <release>` otherwise.
 *
 * @param facts - build facts
 * @returns formatted release label (e.g., "Release 2026.09.29 · 9f4c2a1")
 */
export function releaseLabel(facts: BuildFacts): string {
  const { release, commit } = facts;
  // Only the exact default shape counts: the date plus this commit's short hash, or `-local` when there
  // is no commit. A custom FEEDBACK_RELEASE that merely starts with a date is rendered whole.
  const suffix = commit !== null ? commit.slice(0, 7) : 'local';
  const defaultFormatMatch = release.match(/^(\d{4}\.\d{2}\.\d{2})-([0-9a-f]{7}|local)$/);
  const isDefault = defaultFormatMatch !== null && defaultFormatMatch[2] === suffix;

  if (isDefault) {
    // Default format: extract date, render with commit separately
    const date = defaultFormatMatch![1];
    if (commit !== null) {
      const shortCommit = commit.slice(0, 7);
      return `Release ${date} · ${shortCommit}`;
    } else {
      return `Release ${date}`;
    }
  } else {
    // Custom release format
    if (commit !== null) {
      const shortCommit = commit.slice(0, 7);
      return `Release ${release} · ${shortCommit}`;
    } else {
      return `Release ${release}`;
    }
  }
}
