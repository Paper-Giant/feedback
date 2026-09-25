# @papergiant/feedback

A small, framework-free in-app feedback pipe: a dialog inside a host app posts a structured report to the host's own server route, which authenticates the reporter, rate-limits the request, renders a versioned ticket (`feedback/v1`), and files it as a GitHub issue in a private intake repository. GitHub is the only record — there is no queue, portal, webhook or screenshot store, and no storage of this package's own beyond the host's rate-limit counter.

What makes a report useful to a coding agent isn't automation inside this package — it's that every ticket arrives with the same machine-readable shape, records the build the browser reported and the commit that received it, carries an optional source hint, and fences the reporter's own words off as untrusted data the agent never reads directly; a human always triages the intake issue and writes the engineering issue an agent is actually pointed at.

ESM only, zero runtime dependencies, Node >= 20. React (`^18.2.0 || ^19.0.0`) is an optional peer for the `@papergiant/feedback/react` entry only; every other entry (`/browser`, `/server`, `/github`, `/limit`, `/build`) is framework-free.

**Status:** 0.1, pre-release; not yet published to npm.

## Quick start

See **[INSTALL.md](./INSTALL.md)** for the full install contract — prerequisites, one-time GitHub set-up per client, a recipe per host type, and troubleshooting. This is a **sketch**, not a copy-pasteable route — it compiles, but every value below is a placeholder for your own (see INSTALL.md's recipe (a) for a Next + Supabase route wired up for real, including the dev-stub sink and preview origins a production route needs):

```ts
import { createFeedbackHandler } from '@papergiant/feedback/server';
import { rpcLimiter } from '@papergiant/feedback/limit';
import { githubSink, githubAppAuth } from '@papergiant/feedback/github';

const handler = createFeedbackHandler({
  app: 'acme', displayName: 'Acme', productRepository: 'Paper-Giant/acme',
  environment: 'production', origins: ['https://acme.example'],
  identify: async (request) => /* your session, or null */ null,
  limiter: rpcLimiter(/* the limiter SQL, called after identify() */ async () => true),
  sink: githubSink({
    auth: githubAppAuth({
      clientId: 'Iv1.xxxxxxxxxxxxxxxx', // your GitHub App's client id
      installationId: '12345678', // its installation id on the intake org
      privateKey: process.env.FEEDBACK_GITHUB_PRIVATE_KEY!, // never a literal, never a local file
      repository: 'org/acme-feedback', // the intake repository, owner/name
    }),
    intake: 'org/acme-feedback',
  }),
  areas: {}, receivingCommit: process.env.GIT_COMMIT_SHA ?? null,
});

export const POST = handler; // a route handler, as-is
```

Then mount `<FeedbackProvider>`/`<FeedbackButton>`/`<FeedbackArea>` (React) or call `mountFeedback()`/`mountLauncher()` (framework-free) in the browser. **INSTALL.md has the working version of this for Next + Supabase, Next 14/React 18, Hono, and plain pages** — don't hand-adapt the sketch above without it; several steps (the limiter SQL's required privilege revokes, the exact origin format, the 404-with-no-key behaviour) are easy to get subtly wrong.

## The ticket

Every report renders as one GitHub issue with three sections: the reporter's own prose, clearly fenced as **untrusted, non-instruction data**; facts the server recorded or derived (a UUID, the receiving commit, the reporter's opaque reference and role, a source hint); and facts the browser claimed but the server never verified (release, commit, viewport, locale, an optional staff-only reference). Every `@mention`, issue reference and URL in reporter text is neutralised before it's fenced, so an issue never notifies, links or auto-closes anything by virtue of what a reporter typed. See `INSTALL.md` and the design document for the full schema (`feedback/v1`).

## Licence

MIT — see [LICENSE](./LICENSE).
