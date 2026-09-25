# Install

This is the install contract for `@papergiant/feedback` — for a person wiring it into a host app, and for an agent doing the same unaided. It ships inside the published tarball, so it travels with the package. If anything here disagrees with the code, the code wins; file an issue.

## What it is

A small dialog inside your app posts a structured report to a route handler in **your own server** (`createFeedbackHandler`, `@papergiant/feedback/server`). That handler authenticates the reporter using **your** session logic, rate-limits the request, renders a versioned ticket (`feedback/v1`), and files it as a GitHub issue in a **private intake repository** that only your triage accounts read. GitHub is the only record. There is no queue, portal, webhook, screenshot store or database of this package's own — the one piece of state it needs (a rate-limit counter) lives in your own database or process.

Nothing in this package reads a request body, a cookie or a database on your behalf beyond what you explicitly wire up. It never imports a host's authentication, ORM or UI library. Every entry point is a plain function or a framework-optional export.

### What it never captures

The dialog and the server never collect, and the rendered ticket never contains:

- answer values, evidence or DOM text from your app
- pathnames, query strings or resource ids (0.1 does no route inference — see "Areas" in each recipe below)
- cookies, storage contents or request bodies from elsewhere in your app
- console output or screenshots
- names, email addresses or organisation names
- full user-agent strings (only a short derived `browser` string, e.g. `"Safari 19 · macOS"`)

What a ticket *does* carry — write your host's privacy notice from this exact list, not from a summary of it:

- the reporter's own prose, fenced as untrusted text, and, for a bug, what they expected instead
- `report_id` (a UUID, for spotting a resubmitted duplicate — nothing looks it up), the app key, the **product** repository, the environment, and `received_at`
- `receiving_commit` and, only when the browser also reported a commit, `reported_build_skew` — both omitted entirely when the host doesn't know its own commit
- `source_hint` and `hints_at`, only for a configured, non-`unknown` area (never a pathname, query string or resource id)
- an opaque `reporter` reference, role and surface from your `identify()` function, plus an optional `organisation_ref` and a `reporter_lookup` URL — if you build that URL with the person's own id in it, the way recipe (a) does, that id is what leaves, even though it means nothing to GitHub
- `kind`, `release`, `commit`, `area`, and whichever of `browser`/`viewport`/`locale`/`timezone` the browser sent — all unverified claims the server never confirms
- `reference_unverified`, only from a reporter your `identify()` marked `allowReference: true`, and only ever recorded as unverified
- `diagnostic`, only if you configure and send one

Before sending, the reporter sees a "Details included" disclosure listing every one of these values that will leave; after a successful send, they see a receipt like `Received · #123`.

## Prerequisites

- **Node ≥ 20** (the package uses global `fetch`, Web Streams and WebCrypto; nothing here imports `node:crypto`, `Buffer` or `process` outside your own host code).
- **ESM only.** `@papergiant/feedback` ships no CommonJS build. A bundler-based host (Vite, Next, Astro) handles this transparently; a plain Node host must run as ESM (`"type": "module"` in `package.json`, or a `.mjs` file). Next 14's `next.config.js` is loaded as CommonJS by default — if you import this package from your config (to compute build facts), name the file `next.config.mjs` instead (see recipe (b)).
- **React is an optional peer**, `^18.2.0 || ^19.0.0`, needed only for `@papergiant/feedback/react`. Every other entry point (`/browser`, `/server`, `/github`, `/limit`, `/build`, the root) has no React dependency at all.
- **TypeScript floor for strict hosts.** If your host typechecks its dependencies (`skipLibCheck: false`), you need **TypeScript ≥ 5.7** to use `/browser` (or `/react`, which imports from it): `dist/browser/uuid.d.ts` declares `RandomSource.getRandomValues(array: Uint8Array<ArrayBuffer>)`, using the generic typed-array parameter TypeScript's lib types gained in 5.7 — an older TypeScript can't parse that declaration file at all once it's asked to fully check it, regardless of whether your code actually imports `RandomSource`. There is no extra `@types/react` floor beyond whatever your React major version already needs — the `/react` entry deliberately annotates every component's return type with the directly-importable `ReactElement` rather than relying on inference through the `React.JSX` namespace, specifically so its declarations stay portable across `@types/react` versions. Most hosts run with `skipLibCheck: true` (Next's own default) and never hit this.

## One-time set-up per client

This section is condensed from the design document, §6. Do all of it — recorded, not just done — before the first real report is accepted for a client. **The rule that matters most: the accounts that can read a client's intake repository are never the accounts any agent uses.** Nothing else in this section works if that one is skipped.

1. **Triage accounts.** Each triager gets a dedicated, paid GitHub account, with two-factor authentication, used only in a browser profile with no agent extension and signed in to no GitHub CLI, Git Credential Manager, GitHub Desktop, IDE or agent environment anywhere. No personal access tokens, SSH keys or OAuth app authorisations on it. Its notification email is either turned off, or points at a mailbox no agent connector reads. Everyday accounts — the ones agents use — never join the intake organisation.
2. **An intake organisation**, separate from wherever your product repositories live, owned only by triage accounts, base permission *No permission*, classic and fine-grained personal access tokens blocked, OAuth app access restrictions **on** (defence in depth — not relied on by itself), Actions disabled, no organisation webhooks, Copilot **not** enabled, no GitHub App installed except the feedback app below.
3. **An intake repository per client**, in that organisation: private, Issues on, Wiki/Discussions/Projects off, no webhooks, deploy keys or issue templates, a README saying what it is and who reads it. Labels created up front (see "Labels" below) — the sink never creates a label itself. Give a client's own approved reader (if any) read-only outside-collaborator access on their repository only; that account is part of the intended audience, not a quarantine violation. Record the *actual* readership — owners, members, outside collaborators, teams, base permission — and confirm it matches the audience you meant to approve.
4. **The GitHub App**, owned by the intake organisation, installed **only** on that one intake repository: permissions **Issues: Read and write** and **Metadata: Read** — nothing else, no webhook. One private key per host **environment** (dev, UAT, production each get their own; an app can hold several keys, each revocable alone). Record the app's client id and the installation id.
5. **The key lives only in the deployment's secret store** — Vercel/your platform's environment variables, or an equivalent managed secret — for that environment. It never goes in a local `.env` file, `.env.deploy`, a repository, CI logs, or an agent's environment. A key is itself a path to reporter text (Issues: write also means read), so treat it exactly as you would a database credential. Local development uses a stub sink (see "Local development" under recipe (a)) instead of a real key.
6. **Every agent-accessible path excluded.** Before enabling intake, record exclusion from every agent-accessible path, including GitHub Apps, personal PAT/OAuth/MCP credentials, organisation and repository webhooks, notifications and their destination mailboxes, exports, connectors, browser sessions and feedback-app credentials; disable any path whose exclusion cannot be established.
7. **Verify the quarantine before enabling intake**: with every real agent credential your team actually uses (each triager's and developer's everyday `gh` login, any MCP GitHub server, your coding-agent's own GitHub App installs on your product repositories), confirm that reading the intake repository, and searching its issues, both fail or return nothing — and, separately, fetch the **timeline** of an engineering issue that **actually refers to an intake issue** (the kind the acceptance step below produces; a synthetic one with a real reference is fine for this check) and confirm that reference isn't followable either. An engineering issue with no such reference proves nothing about whether the reference itself would leak anything. Confirm each triage account's token/SSH-key/authorised-application pages are empty. Send one synthetic report and check where its notification lands.
8. **Notifications**: each triage account explicitly watches the intake repository (all activity) — organisation membership by itself does not deliver notifications; watching is a separate, deliberate step.
9. **Acceptance transfers checked facts, never reporter prose.** When a triager accepts a report, they open the engineering issue in the product repository (the "From feedback" form — see the `AGENTS.md` block below) and write the problem, expected versus actual, confirmed reproduction and environment, likely location, a checkable done-when, out of scope, and the base branch, in their **own words**. The form separately carries the machine-checked facts (release, reported client commit, receiving commit, area and source hint, any validated diagnostic) so that context still reaches whoever — or whatever — works the issue. Reporter prose is never pasted from intake into the engineering issue.
10. **Links run one way.** The engineering issue in a product repository is expected to refer to the intake issue it came from, by its reference, for the person reading it — that's the normal case step 9 produces, and step 7's timeline check above proves it can't be followed by an agent. The reverse must never happen: nothing written in the **intake** repository may refer to a product issue or PR in any form GitHub would link — that would create a cross-reference right on the **product** issue's own timeline, exactly where an agent working that issue can already see it, without ever reading intake. This is also in the block for the host's `AGENTS.md`, below.

**Labels.** Create these on the intake repository before the first report: `source:in-app`, one `app:<app>` per host sharing that repository, one `env:<environment>` per environment, and `kind:help` / `kind:bug` / `kind:idea`. GitHub silently drops any label in a create request that doesn't already exist — the sink detects this (`FEEDBACK_LABELS_DROPPED`, a count only) and the report still counts as received, but the issue arrives under-labelled. See "Troubleshooting" below.

## Recipes

Each of these is a documentation pattern, not package code — the package never imports any of the frameworks or libraries named here.

### (a) Next.js App Router + Supabase SSR

The common case (a Next App Router host on Vercel with Supabase authentication). Four pieces: build facts inlined at build time, a route handler, a Postgres-backed limiter, and the React provider mounted from a layout.

**1. Build facts**, computed once in `next.config.mjs` (see the ESM note in Prerequisites — Next 14 needs the `.mjs` extension; Next 15+ also accepts `next.config.ts`) and inlined through Next's `env` key, which is a compile-time replacement available in both server and client code, not a runtime lookup. This is also where `<FeedbackProvider enabled>` gets its signal — from **the key's presence at build time, or the explicit local-stub opt-in described under "Local development" below** — not from whether a commit happens to be set, so it comes out `false` in an environment (production, until you're ready) that has neither, the same test the route handler itself makes:

```js
// next.config.mjs
import { buildFacts } from '@papergiant/feedback/build';

const production =
  process.env.VERCEL_TARGET_ENV === 'production' || process.env.VERCEL_ENV === 'production';
// Never derive `production` from NODE_ENV — a Vercel preview build also
// runs with NODE_ENV=production, and buildFacts() would then require a
// commit it may not have. Outside Vercel, set your own equivalent flag
// from whatever your platform gives you — there is no VERCEL_TARGET_ENV
// off Vercel, and `environment` below needs a host-specific source too
// (on Vercel, a preview deployment's own `VERCEL_TARGET_ENV` already
// reads 'preview', so the `env:preview` label falls out for free; another
// platform has to supply that value itself).

const facts = buildFacts({ env: process.env, production });

/** @type {import('next').NextConfig} */
export default {
  env: {
    // Next's `env` rejects `null` — buildFacts()'s `commit` is `string |
    // null`, so this must be coerced to a string.
    FEEDBACK_RELEASE: facts.release,
    FEEDBACK_COMMIT: facts.commit ?? '',
    // The signal <FeedbackProvider enabled> reads — set from whether the
    // GitHub key is configured for THIS environment, OR from the explicit
    // local-stub opt-in ("Local development", below) — never from
    // `commit` or `production` alone, so it matches the route handler's
    // own key/stub test exactly.
    FEEDBACK_ENABLED:
      process.env.FEEDBACK_GITHUB_PRIVATE_KEY || process.env.FEEDBACK_LOCAL_STUB === '1' ? '1' : '',
  },
};
```

**2. The route handler**, outside any typed API contract your app already enforces (it isn't a JSON:API/OpenAPI route). **This handler must be the first reader of the request** — it locks and streams the body itself, with a hard 32 KiB cap. If your framework runs anything in front of this route that also reads the body (a logger, a wrapping proxy), that code must call `request.clone()` and read the *clone*, never the original, or the handler's own read will hang or see an already-drained stream — `identify()` below must not read the body either, for the same reason:

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler, type FeedbackHandlerSink } from '@papergiant/feedback/server';
import { rpcLimiter } from '@papergiant/feedback/limit';
import { githubSink, githubAppAuth } from '@papergiant/feedback/github';
import { createServiceRoleClient } from '@/lib/supabase/server'; // your own server-only client
import { getCookieSession } from '@/lib/auth'; // your own cookie-session resolver

// owner/name of the private intake repository (design §6) — a code
// constant, not a secret; only the key below is.
const INTAKE_REPOSITORY = 'your-intake-org/acme-feedback';
const GITHUB_CLIENT_ID = 'Iv1.xxxxxxxxxxxxxxxx';
const GITHUB_INSTALLATION_ID = '12345678';

// PEM PKCS#1, PEM PKCS#8, or base64 of either (parsePrivateKey(), in
// @papergiant/feedback/github, accepts all four combinations) — never
// hand this to `githubAppAuth()` from anywhere but the real environment;
// see "One-time set-up per client" above.
const privateKey = process.env.FEEDBACK_GITHUB_PRIVATE_KEY;
const production =
  process.env.VERCEL_TARGET_ENV === 'production' || process.env.VERCEL_ENV === 'production';
// A separate, EXPLICIT local-development opt-in — see "Local
// development" below. Never inferred from "no key and not production"
// alone: a real host also has dev and UAT deployments that have a real
// key and must behave exactly like production when they do.
const localStub = process.env.FEEDBACK_LOCAL_STUB === '1';
if (localStub && production) {
  // Defence in depth: the real rule is "never set this in a production
  // environment's configuration" — this throw only catches it if that
  // rule was broken anyway, so a misconfigured deploy fails loudly
  // instead of quietly faking every receipt in production.
  throw new Error('FEEDBACK_LOCAL_STUB must never be set in a production environment.');
}

// identify() must not read the request body — createFeedbackHandler reads
// it itself, once, after this returns, and reading it twice would hang.
// This is the cookie session ONLY: a browser dialog never sends an
// Authorization or X-Api-Key header, and the handler already refuses any
// request that does, before identify() ever runs — but if your app also
// has an API-key auth path elsewhere (several hosts' general resolvers
// accept one), do not reuse that resolver here. Every gate a real
// session needs to pass generally belongs here too, not just aal2 and
// accepted agreements — an inactive user, for instance, must be refused
// here exactly as it would be anywhere else in your app.
async function identify(request: Request) {
  const session = await getCookieSession(request);
  if (!session || !session.aal2 || !session.agreementsAccepted || !session.active) return null;
  return {
    ref: session.userId,
    role: session.role,
    surface: session.surface,
    organisationRef: session.organisationId,
    lookupUrl: `${process.env.NEXT_PUBLIC_APP_URL}/staff/people/${session.userId}`,
    allowReference: session.role === 'staff',
  };
}

// A dev stub: logs the rendered ticket instead of filing it, and returns
// an incrementing, genuinely positive synthetic issue number — never a
// literal 0. The browser's receipt parser requires a receipt matching
// `#[1-9][0-9]*` (`parseFeedbackResponse`, @papergiant/feedback/core); a
// stub that answered `number: 0` would render `#0`, which the browser
// can't parse as "received" at all, so every local report would sit on
// "Delivery unconfirmed" forever instead of a real receipt. Selected only
// by the explicit `localStub` flag above — never merely "no key, not
// production" (see "Local development" below for why).
let devIssueNumber = 0;
const devSink: FeedbackHandlerSink = {
  async create(ticket) {
    devIssueNumber += 1;
    console.warn(`[feedback] dev stub #${devIssueNumber} — nothing was sent to GitHub:`, ticket.title, ticket.labels);
    return { ok: true, number: devIssueNumber, droppedLabels: [] };
  },
};

// githubAppAuth()/githubSink() must be constructed once, at module scope
// — a fresh instance per request defeats the token cache.
const sink = privateKey
  ? githubSink({
      auth: githubAppAuth({
        clientId: GITHUB_CLIENT_ID,
        installationId: GITHUB_INSTALLATION_ID,
        privateKey,
        repository: INTAKE_REPOSITORY,
      }),
      intake: INTAKE_REPOSITORY,
      // This is what makes FEEDBACK_LABELS_DROPPED show up anywhere at
      // all — without a `log`, a dropped label degrades silently. Ids,
      // codes, statuses and issue numbers only, never reporter text or
      // the rendered ticket (githubSink()'s own contract).
      log: (event) => console.warn(JSON.stringify(event)),
    })
  : localStub
    ? devSink
    : null; // no key, and FEEDBACK_LOCAL_STUB not set: the route 404s below.

// Every origin the dialog may POST from — the canonical app URL, plus
// this deployment's own preview origin when there is one (design §5
// "CSRF": preview origins are configured separately from the production
// one, deliberately; VERCEL_URL is this specific deployment's own unique
// origin, never a wildcard). A non-Vercel host supplies its own list the
// same way, e.g. from a platform-provided preview-origin env var.
const origins = [new URL(process.env.NEXT_PUBLIC_APP_URL!).origin];
if (process.env.VERCEL_URL) origins.push(`https://${process.env.VERCEL_URL}`);

const handler = sink
  ? createFeedbackHandler({
      app: 'acme',
      displayName: 'Acme',
      productRepository: 'Paper-Giant/acme', // the PRODUCT repository, never the intake one
      environment: process.env.VERCEL_TARGET_ENV ?? 'dev',
      // Exact bare origins only — new URL(x).origin strips any trailing
      // slash or path a misconfigured env var might carry.
      origins,
      identify,
      // Called only after identify() has accepted the person, keyed by
      // identity.ref. Supabase's rpc() resolves { data, error } rather
      // than rejecting on failure — unwrap it yourself, as below.
      limiter: rpcLimiter(async (subject) => {
        const client = createServiceRoleClient(); // service_role only — never anon/authenticated
        const { data, error } = await client.rpc('feedback_rate_take', { p_subject: subject });
        if (error) throw error;
        return data;
      }),
      sink,
      areas: {
        'checkout-wizard': 'app/(app)/wizard/page.tsx',
        home: 'app/(app)/home/page.tsx',
      },
      receivingCommit: process.env.FEEDBACK_COMMIT || null,
    })
  : // No key, and FEEDBACK_LOCAL_STUB not set (production, or a dev host
    // that hasn't opted in) — the route 404s, decided once, before the
    // handler is constructed, rather than inside every request.
    () => new Response('Not found', { status: 404 });

// createFeedbackHandler()'s return value already has the right shape
// (Request) => Promise<Response> — no wrapping needed.
export const POST = handler;
```

**Local development, with no GitHub key at all.** Set `FEEDBACK_LOCAL_STUB=1` in your own untracked local environment file (e.g. `.env.local`) — **never** in a shared, deployed, CI, or otherwise checked-in environment's configuration; the `production` check above throws immediately if it's ever set there anyway. This one flag does both jobs a local developer needs: `next.config.mjs`'s `FEEDBACK_ENABLED` (above) reads it alongside the key, so `<FeedbackProvider>` actually mounts locally with no key configured at all — without it, the provider stays disabled and the stub above is never reachable, however it's wired up. And the route handler reads it to select `devSink` instead of a `null` sink. The result is a fully working local loop with **no secret anywhere on the machine**: open the dialog, send a report, and see a real `Received · #1`-style receipt (from the stub's own incrementing counter) rather than getting stuck on "Delivery unconfirmed" — which is exactly what a stub returning `number: 0` would produce, since the browser's own receipt parser requires a positive number.

**3. The limiter migration** — see "Installing the limiter SQL" below; call it through `rpcLimiter` exactly as shown above.

**4. Mounting the provider**, from a client component rendered once per authenticated layout (never per page, and never more than once per subtree — recreating the controller drops any in-progress draft):

```tsx
// app/(app)/app-feedback.tsx
'use client';
import { FeedbackProvider } from '@papergiant/feedback/react';

export function AppFeedback({ children }: { children: React.ReactNode }) {
  return (
    <FeedbackProvider
      // Driven by the KEY's presence at build time, or the explicit
      // FEEDBACK_LOCAL_STUB opt-in for local development (next.config.mjs's
      // FEEDBACK_ENABLED, above) — the same test the route handler makes
      // — never by whether a commit happens to be set, which would read
      // true in production even with no key configured. false means
      // every <FeedbackButton> renders null instead of throwing, and no
      // launcher mounts.
      enabled={process.env.FEEDBACK_ENABLED === '1'}
      notice="Reports go to Acme's engineering team on GitHub, stored in the United States."
      allowReference={false}
      areas={['checkout-wizard', 'home']}
      build={{ release: process.env.FEEDBACK_RELEASE ?? '', commit: process.env.FEEDBACK_COMMIT || null }}
      launcher
    >
      {children}
    </FeedbackProvider>
  );
}
```

```tsx
// app/(app)/layout.tsx
import { AppFeedback } from './app-feedback';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return <AppFeedback>{children}</AppFeedback>;
}
```

Then, **one `<FeedbackArea name="…" />` per page** — never in a layout. The most recently *mounted* area wins, and mount order follows React's commit **sibling order**, not JSX nesting: a layout that renders its own `<FeedbackArea>` as a plain sibling of `{children}` overrides whatever the page declared only if it's placed *after* `{children}`, and loses to it if placed *before* — which one wins is not obvious from reading the layout alone. Keeping every area declaration on pages, and none in layouts, avoids depending on that ordering at all:

```tsx
// app/(app)/wizard/page.tsx
import { FeedbackArea } from '@papergiant/feedback/react';

export default function WizardPage() {
  return (
    <>
      <FeedbackArea name="checkout-wizard" />
      {/* … */}
    </>
  );
}
```

**Nesting inside a Radix dialog.** `<FeedbackButton>` passes its own DOM element as the "opened from" element automatically, and `mountFeedback()`'s default host-modal detection already recognises an open Radix `Dialog`/`AlertDialog` (`[role="dialog"][data-state="open"]` / `[role="alertdialog"][data-state="open"]`) or a native `<dialog>` opened with `showModal()`. So `<FeedbackButton>Give feedback</FeedbackButton>` placed inside a Radix `Dialog.Content` **nests automatically, with no host code** — feedback's own dialog mounts inside that content element, and its Escape/scroll guards stop the host dialog's handlers from ever seeing the interaction. One level of nesting only: a launcher inside a modal that is itself inside another open modal refuses, the same as a launcher outside any modal at all. Do **not** add a keyboard handler (e.g. an `onKeyDown` that also watches Escape) to the Radix `DialogContent` element itself for any other reason — React dispatches feedback's own synthetic events to handlers on that content element and its ancestors, so such a handler would also fire for feedback's own keystrokes.

### (b) Next 14 / React 18

The same recipe as (a), with three differences:

- `next.config.mjs` is **required**, not optional — Next 14's config loader treats a `.js` extension as CommonJS, and this package has no CommonJS build, so `require('@papergiant/feedback/build')` fails. Next 15+ tolerates `.js` here more often but `.mjs` is still the safe choice.
- Install `react`/`react-dom` `^18.2.0` (not `^19.x`) — the peer range accepts either. `@papergiant/feedback/react` runs its own test suite under React 19; an independently installed React 18 consumer (`examples/react18` in the package repository) proves the same build works there too.
- If your host typechecks dependencies, make sure `@types/react` is at least `18.2.7` (see Prerequisites) — an older `@types/react` on Next 14 is a common miss.

Everything else — the route handler, the limiter, `<FeedbackProvider>`/`<FeedbackButton>`/`<FeedbackArea>` — is identical.

### (c) Hono (or any other framework-free Web-standard server)

`createFeedbackHandler()` returns a plain `(Request) => Promise<Response>`, so any router that hands you a real `Request` and accepts a real `Response` needs no adapter at all:

```ts
import { Hono } from 'hono';
import { createFeedbackHandler } from '@papergiant/feedback/server';
import { memoryLimiter } from '@papergiant/feedback/limit';
import { githubSink, githubAppAuth } from '@papergiant/feedback/github';

const auth = githubAppAuth({
  clientId: process.env.FEEDBACK_GITHUB_CLIENT_ID!,
  installationId: process.env.FEEDBACK_GITHUB_INSTALLATION_ID!,
  privateKey: process.env.FEEDBACK_GITHUB_PRIVATE_KEY!,
  repository: process.env.FEEDBACK_INTAKE_REPOSITORY!,
});

const feedbackHandler = createFeedbackHandler({
  app: 'quick',
  displayName: 'Quick',
  productRepository: 'Paper-Giant/quick',
  environment: process.env.APP_ENV ?? 'dev',
  origins: [new URL(process.env.APP_URL!).origin],
  identify: async (request) => {
    // your own session or forwarded-header check — see design §5.
    // identify() must return an actual FeedbackIdentity or null — never
    // fall off the end of the function, which TypeScript would otherwise
    // happily infer as Promise<void> and createFeedbackHandler rejects.
    return null;
  },
  // memoryLimiter() is for a genuinely single-instance process (design
  // §5) — one long-running Node process with no horizontal scaling, e.g.
  // Quick. It is NOT shared across instances or processes; run `doctor
  // --production --limiter memory` without `--single-instance` to see
  // this flagged for a host that hasn't declared itself single-instance
  // — doctor never infers this on its own. Anything that can run more
  // than one instance needs rpcLimiter() over a shared database instead
  // (recipe (a)).
  limiter: memoryLimiter({ singleInstance: true }),
  // `log` is what makes FEEDBACK_LABELS_DROPPED (and every other event)
  // show up anywhere — without one, a dropped label degrades silently.
  sink: githubSink({
    auth,
    intake: process.env.FEEDBACK_INTAKE_REPOSITORY!,
    log: (event) => console.warn(JSON.stringify(event)),
  }),
  areas: {},
  receivingCommit: process.env.GIT_COMMIT_SHA || null,
});

const app = new Hono();
app.post('/api/feedback', (c) => feedbackHandler(c.req.raw));
```

The package's own `examples/fixture/server.ts` is a complete, tested Hono host built exactly this way — read it for the full picture, including how it wires a stub GitHub sink for local development.

### (d) Framework-free (Astro islands, plain HTML pages, anything without React)

Use `@papergiant/feedback/browser` directly — this is what `@papergiant/feedback/react` itself is built on:

```ts
import { mountFeedback, mountLauncher } from '@papergiant/feedback/browser';

const controller = mountFeedback({
  endpoint: '/api/feedback',
  notice: 'Reports go to the Acme team on GitHub.',
  areas: ['home'],
  build: { release: import.meta.env.PUBLIC_FEEDBACK_RELEASE, commit: import.meta.env.PUBLIC_FEEDBACK_COMMIT || null },
});

// Optional: a fixed side-tab button that calls controller.open(button) —
// or wire your own trigger and call controller.open(fromElement) directly.
mountLauncher(controller);
```

`mountFeedback()` and `mountLauncher()` never touch the DOM at import time — only when called — so this is safe to import in any bundler, including one with no React in the dependency tree at all.

**Build facts with Vite** (Astro's default bundler): use `define`, with every value passed through `JSON.stringify` — Vite's `define` does a literal text substitution, so an un-stringified value is inlined as bare (invalid) JavaScript. In an Astro project this is `vite.define` nested inside Astro's own `defineConfig` (from `astro/config`, not `vite`) — Astro's config schema isn't a plain Vite config, but it accepts and forwards one under `vite`:

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { buildFacts } from '@papergiant/feedback/build';

const facts = buildFacts({ env: process.env, production: process.env.VERCEL_ENV === 'production' });

export default defineConfig({
  vite: {
    define: {
      'import.meta.env.PUBLIC_FEEDBACK_RELEASE': JSON.stringify(facts.release),
      'import.meta.env.PUBLIC_FEEDBACK_COMMIT': JSON.stringify(facts.commit ?? ''),
    },
  },
});
```

A plain Vite project (no Astro) uses the same `define` block, but top-level, from `defineConfig` in `'vite'` itself rather than nested under `vite:`.

### (e) Hosts out of scope in 0.1

Two host shapes from the design's survey (§3.1) are **not supported yet**, on purpose:

- **A host with no per-user identity** (e.g. a site behind one shared password, rather than individual sign-in). `identify()` must return an opaque reference to *the person*, not the app; without individual sign-in there is nothing safe to put there, and the rate limiter has no subject to key on. This is deferred to a later increment that decides how such reports are identified and limited.
- **A single-page app with no server of its own** (a static site with no backend to host a route handler in). `createFeedbackHandler` needs a server to run in; 0.1 has none for a host that has no server at all. A hosted relay — the same handler running as a small shared function, reached with a host-issued signed token instead of a cookie session — is planned for a later increment, not this one.

Both are refusals of scope, not technical limits of the handler itself: `createFeedbackHandler` is Web-standard and framework-free, so either gap is a deployment story, not a rewrite, once it's designed.

## Installing the limiter SQL

`sql/postgres-limiter.sql` ships inside the tarball (`node_modules/@papergiant/feedback/sql/postgres-limiter.sql`) and is also available from the repository directly. **Read its header before copying it** — it explains the advisory lock, the `search_path` pinning and why `pg_temp` is listed explicitly; this section only covers installing it.

1. Copy the `create schema`, `create table`, both `create index` statements and the `create or replace function` block **unchanged** into your own migration.
2. Replace the `__FEEDBACK_SERVER_ROLE__` placeholder in the final `grant execute` line with your server-only role (`service_role` on Supabase). This is a literal find-and-replace, not a `psql` `:"variable"` — variable substitution does not happen when a migration runner pastes this file's contents into a migration and applies it.
3. **Required on Supabase**: uncomment (or otherwise add) the revoke in the file's "PRIVILEGE HARDENING" block —
   ```sql
   revoke execute on function public.feedback_rate_take(text) from anon, authenticated;
   ```
   Supabase's own default privileges grant `EXECUTE` on every new `public` function directly to `anon`, `authenticated` and `service_role`, independent of the `revoke … from public` above it in the file. Skipping this step leaves the rate limiter callable by any signed-in *or anonymous* PostgREST request, defeating the "eligibility decided once, in `identify()`" guarantee the design relies on.
4. On **plain Postgres** (no Supabase), replace `__FEEDBACK_SERVER_ROLE__` with whatever role your server code connects as, and add any revokes your own database's default privileges need in the same hardening block (for example, a `web_anon` role your PostgREST-alike exposes).
5. Apply the migration. **Re-running the file with `create or replace function` keeps whatever revokes and grants you already have** — it only replaces the function body. If you ever `drop function` and `create` it again (rather than `create or replace`), Postgres resets it to your database's default privileges, silently discarding the revokes above; keep the `revoke`/`grant` statements in the *same* migration as the function, every time, so the two can never drift apart.
6. Call it only through `rpcLimiter()`, only after `identify()` has accepted the person (see recipe (a)) — never expose an endpoint that calls `feedback_rate_take` on an unauthenticated caller's behalf; the function itself trusts whatever subject string it's handed.

One database is one quota domain: every subject and every call across every app sharing that database shares the same hundred-per-hour app-wide window. Give each application its own database, or its own copy of the table and function under a different name, if that's not what you want.

## `doctor`

`npx @papergiant/feedback doctor` (the package's bin is `papergiant-feedback`; `doctor` is its one subcommand) is a **read-only** installation checker, running nine checks: the seven environment names below are present; the private key parses; an installation token mints, narrowed to the intake repository with `issues: write`; the repository has issues enabled (and warns if it isn't private); every configured label exists; every configured origin is a bare origin; the app URL's own origin is among the configured origins; and, only given `--production` together with `--limiter memory|shared`, whether the configured limiter is safe for a production host. **`doctor` never inspects your route handler or infers which limiter you're running — you tell it, with flags:**

```sh
npx @papergiant/feedback doctor --production --limiter memory
# warns: an in-process limiter can't coordinate across instances or survive a restart

npx @papergiant/feedback doctor --production --limiter memory --single-instance
# passes: this host declared itself genuinely single-instance (e.g. Quick, recipe (c))

npx @papergiant/feedback doctor --production --limiter shared
# passes: a shared, atomic limiter (rpcLimiter() over the SQL) is safe for production
```

Every setting has both a flag and an environment-variable default (the flag wins). The seven environment variables:

| Variable | Flag | What it's for |
| --- | --- | --- |
| `FEEDBACK_GITHUB_PRIVATE_KEY` | *(none — see below)* | The GitHub App's private key (PEM, or base64 of PEM) |
| `FEEDBACK_GITHUB_CLIENT_ID` | `--client-id` | The GitHub App's client id |
| `FEEDBACK_GITHUB_INSTALLATION_ID` | `--installation-id` | The installation id on the intake organisation |
| `FEEDBACK_INTAKE_REPOSITORY` | `--intake` | The intake repository, as `owner/name` |
| `FEEDBACK_APP_URL` | `--app-url` | Your app's canonical URL — checked for membership in `FEEDBACK_ORIGINS`, below |
| `FEEDBACK_ORIGINS` | `--origins` | Comma-separated — **every** allowed origin, including the app URL's own, not just the extra ones |
| `FEEDBACK_LABELS` | `--labels` | Comma-separated labels `doctor` expects to already exist on the intake repository |

`--dotenv-file <path>` reads any of the above from a dotenv-style file when the real environment doesn't already have them — parsed as plain data (never executed, never shelled out), and it never overrides a value already exported. **The private key has no CLI flag and should not go in a `--dotenv-file` either**, even though the parser doesn't distinguish it from the other six: writing it to a file on disk, even a scratch one, is the quarantine violation the set-up section above exists to prevent, and a repository Actions secret in the *product* repository is no better — that repository is exactly where your agents already run. Run `doctor` for the private key check somewhere the real value is already an environment variable because the deployment platform put it there, or export it transiently in an authenticated human's own shell, fed from the secret store, and never written down. `--dotenv-file` is genuinely useful for the other six, non-secret settings, so you don't have to retype `--intake owner/name --client-id ... --installation-id ...` by hand every run. `doctor --help` lists every flag and exit code.

If your host hardcodes the client id, installation id or repository as code constants (as recipe (a) does) rather than reading them from these variables at runtime, pass the same values as flags (or put them in a `--dotenv-file`) when you run `doctor` — it has no way to read your route handler's source, only what you tell it.

## Troubleshooting

**`403 forbidden_origin`.** The handler refuses any request whose `Origin` header is missing, `null`, or not an exact member of the `origins` array you configured — and separately refuses a present `Sec-Fetch-Site` that isn't `same-origin`. Common causes: your configured origin carries a trailing slash or a path (`origins` must be bare origins — scheme, host, optional port, nothing else: `new URL(value).origin === value`, checked at construction, throws early if not); a preview deployment's origin isn't in the list (preview origins are configured separately from the production one, deliberately, per the design); an internationalised domain wasn't converted to punycode; or the app genuinely was embedded or proxied cross-origin, which this refusal is specifically for.

**Labels arrive missing from a filed issue (`FEEDBACK_LABELS_DROPPED` in your logs).** GitHub silently drops any label on issue creation that doesn't already exist on the repository — the sink never creates one for you. Compare the count in the log event against your configured labels, then create whatever's missing on the intake repository (see "Labels" in set-up above). The report still counted as received; only the labelling is degraded.

**`unconfirmed`.** The request reached the network and something happened, but the outcome is unknown — a `5xx`, a network error, the ten-second delivery deadline, or a `201` whose body couldn't be parsed. This is deliberately distinct from `not_sent`: the issue may or may not exist in the intake repository. The draft is kept client-side and resubmitting **reuses the same `report_id`** so a triager can spot a duplicate by the id, but there is no automatic retry and no idempotent create on GitHub's side — **a genuine duplicate issue is possible** if the original request did in fact succeed. Treat two intake issues with the same `report_id` in their body as one report, not two.

## For the host's `AGENTS.md`

Paste this block into the product repository's `AGENTS.md` (not the intake repository's — there isn't one an agent should ever reach):

```markdown
## In-app feedback (@papergiant/feedback)

This app files reports as GitHub issues in a **private intake repository**
your credentials cannot read — see `node_modules/@papergiant/feedback/INSTALL.md`
for how it's wired up. Rules for any agent working in this repository:

- Never attempt to read, search or list issues in the intake repository,
  by any name you find for it. If you were pointed at one, stop and ask.
- Links run one way: the engineering issue you're working from may
  refer to the intake issue it came from, and that reference is
  expected — leave it as it is. Nothing written in the intake
  repository may ever refer to a product issue or PR in a form GitHub
  would link; you have no access there to do that anyway, but never try,
  and never fabricate a new intake reference of your own.
- Never write the feedback private key (`FEEDBACK_GITHUB_PRIVATE_KEY` or
  similar) to a local file, a commit, a log, or a shell history you keep.
- An engineering issue in *this* repository, opened from the "From
  feedback" issue form, is the only thing you should act on — open a
  **draft PR only**, never merge; put the issue number in the branch
  name and the PR.
- Don't touch secrets, CI, authentication, RLS policies or database
  migrations beyond what that issue's stated scope covers, even if the
  fix looks small.
```
