/**
 * @papergiant/feedback — `doctor` usage and help text (task P11).
 */

/** Printed by the bin entry itself (`src/bin/doctor.ts`) for `--help`
 * with no subcommand, or for an unrecognised/missing subcommand. */
export function topLevelUsage(): string {
  return `Usage: papergiant-feedback <command> [options]

Commands:
  doctor    Read-only install checks (see 'papergiant-feedback doctor --help')

Run 'papergiant-feedback <command> --help' for a command's own options.
`;
}

/** Printed by `doctor --help` (exit 0), and reused as the tail of a usage
 * error (exit 2) so a mistyped flag still shows the whole contract. */
export function doctorUsage(): string {
  return `Usage: papergiant-feedback doctor [options]

Read-only install checks (design "Install contract"): environment names
present; the private key parses; an installation token mints narrowed to
the intake repository; the repository has issues enabled (and is
private); the configured labels exist; the configured origins are
well-formed and include the app URL's origin; and a warning when an
in-process limiter is configured for production without declaring the
host single-instance. Never creates, edits or deletes anything in
GitHub — the only network write is the installation-token mint itself.

Options:
  --dotenv-file <path>
        Read defaults from a dotenv-style file (parsed as data;
        NAME=value, quotes and comments — never executed). Does not
        override a value already present in the real environment. Named
        --dotenv-file rather than --env-file because Node.js intercepts
        --env-file itself, anywhere in argv, before this program runs.
        --dotenv-file supplies every setting except the key and the API
        base URL; the key comes from the environment, e.g.
        FEEDBACK_GITHUB_PRIVATE_KEY="$(base64 -i key.pem | tr -d '\\n')"
        — a file containing FEEDBACK_GITHUB_PRIVATE_KEY is refused
        outright, and FEEDBACK_GITHUB_API_BASE_URL in one is ignored.
  --app-url <url>              The app's canonical URL (FEEDBACK_APP_URL).
  --origins <a,b>               Comma-separated allowed origins (FEEDBACK_ORIGINS).
  --intake <owner/name>         The intake repository (FEEDBACK_INTAKE_REPOSITORY).
  --client-id <id>               The GitHub App's client id (FEEDBACK_GITHUB_CLIENT_ID).
  --installation-id <id>
        The app's installation id on the intake repository
        (FEEDBACK_GITHUB_INSTALLATION_ID).
  --labels <a,b,c>
        Comma-separated labels that must exist on the intake repository
        (FEEDBACK_LABELS).
  --production          Check the limiter as a production host would be run.
                         Without --limiter this WARNs: a production host
                         must declare one.
  --limiter <memory|shared>
        Which kind of limiter this host is configured with, for the
        production limiter warning.
  --single-instance
        This host is a genuinely single-instance deployment (see design
        §5 "Limits") — silences the memory-limiter-in-production warning.
  --json                Print the report as machine-readable JSON.
  --api-base-url <url>
        Point doctor at a stand-in for https://api.github.com. For
        testing only — not part of the install contract. Must be
        https://, or plain http:// only when the host is loopback
        (localhost/127.0.0.1/::1) — never read from --dotenv-file, only
        from this flag or the real environment (FEEDBACK_GITHUB_API_BASE_URL),
        since it's where the signed app JWT is sent.
  -h, --help             Show this help and exit.

The private key (FEEDBACK_GITHUB_PRIVATE_KEY) has no command-line flag and
is never read from --dotenv-file: it can only be supplied through the real
environment, so it never sits in shell history, a process listing, or a
shared dotenv file. Example: set it with
  export FEEDBACK_GITHUB_PRIVATE_KEY="$(base64 -i key.pem | tr -d '\\n')"

Environment variables (each has the CLI flag noted above, where one exists):
  FEEDBACK_GITHUB_PRIVATE_KEY       PEM PKCS#1/PKCS#8, or base64 of either.
                                     Real environment only — never --dotenv-file.
  FEEDBACK_GITHUB_CLIENT_ID         The GitHub App's client id.
  FEEDBACK_GITHUB_INSTALLATION_ID   The app's installation id.
  FEEDBACK_INTAKE_REPOSITORY        owner/name of the intake repository.
  FEEDBACK_APP_URL                  The app's canonical URL.
  FEEDBACK_ORIGINS                  Comma-separated allowed origins.
  FEEDBACK_LABELS                   Comma-separated required labels.

Exit codes:
  0   every check passed (warnings are still allowed)
  1   at least one check failed
  2   usage error (a bad flag, a missing --dotenv-file, a --dotenv-file
      containing the key, an unsafe --api-base-url, etc.) — no checks ran
`;
}
