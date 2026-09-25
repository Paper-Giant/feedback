# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities in `@papergiant/feedback` privately, not as a public GitHub issue — this repository is public, and its issue tracker is not the right place for an unfixed vulnerability to be discussed in the open.

Email **chris@papergiant.net** with a description of the issue, the affected version, and, if you have one, a minimal reproduction. We aim to acknowledge a report within a few business days.

Please do not include real reporter text, a real intake repository name, or any live credential in a report — a synthetic reproduction is enough to demonstrate almost anything this package could get wrong.

## Threat model, in brief

This package's own threat model is narrower than "a feedback widget's" — most of the hard problems (who can read a report, what starts an agent) are pushed onto the host and the GitHub set-up around it, by design. In scope for this package specifically:

- **Reporter text is always untrusted input**, never instructions. Every string a reporter supplies is neutralised (`@mentions`, issue references, URL separators) and fenced with a fence sequence longer than any run already present, so it cannot notify, link, auto-close or otherwise act on the tracker it lands in, and cannot be mistaken for a prompt by anything that later reads the issue.
- **No agent reads a reporter's words directly.** The design this package implements assumes a human triages every intake issue and writes a separate, human-authored engineering issue before any agent is pointed at anything; this package has no code path that hands reporter text to an agent, and ships no automation that would create one.
- **Credential scope narrows by repository, not by permission level.** The GitHub App itself is granted **Issues: Read and write** and **Metadata: Read** — nothing else — at set-up (`INSTALL.md`'s "One-time set-up per client"). Each installation token `githubAppAuth()` mints is requested with `permissions: { issues: 'write' }`, which GitHub grants as the same read-and-write level the app itself holds (there is no separate write-only level for Issues — "write" already includes "read"), but narrowed to **one repository** (`repositories: [name]`) rather than every repository the app is installed on; the sink throws if the auth source's own recorded `repository` doesn't match the `intake` it's about to file into. So a feedback key **can read and modify** the intake repository's issues, exactly as the app's own permission set allows — it is exactly as sensitive as a database credential and must live only in a deployment's own secret store — see `INSTALL.md`'s set-up section for the full handling rule.
- **What never leaves a host**, regardless of configuration: answer values, evidence or DOM text from the host app; pathnames, query strings or resource ids; cookies, storage or request bodies from elsewhere in the app; console output; screenshots; names, email addresses or organisation names; full user-agent strings. `identify()` is the only source of who a reporter is, and it is host-supplied — this package never inspects a session, cookie or database itself.
- **CSRF and request-shape hardening** in `createFeedbackHandler()`: exact origin matching (no wildcard, no reflection), a `Sec-Fetch-Site` check, a hard 32 KiB streamed body cap, and an explicit refusal of any request carrying `Authorization` or `X-Api-Key` — a browser dialog never sends either, and several hosts' general auth resolvers accept API keys, so this closes a path a misconfigured host might otherwise open.
- **Rate limiting fails closed.** Both `memoryLimiter()` and the shipped `sql/postgres-limiter.sql` refuse (throw, or return `false`) rather than silently allowing a request through on an error, and the SQL function must be granted only to a server-only role, never a role a browser-authenticated caller can assume — see `INSTALL.md`'s required Supabase revokes.

Out of scope for this package, by design, and the responsibility of whoever operates a given installation: who is a member of the intake organisation, whether triage accounts are kept separate from everyday/agent-connected accounts, whether a GitHub App is installed anywhere beyond the one intake repository it should be, and any process for what happens after a person accepts a report. `INSTALL.md`'s "One-time set-up per client" section exists precisely because those decisions live outside this package's code and cannot be enforced by it.

## Supported versions

Pre-1.0: only the latest published `0.x` version is supported. There is no long-term-support branch yet; a security fix lands as a new patch release, and hosts are expected to track `latest`.
