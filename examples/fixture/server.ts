/**
 * Host server — task P10a skeleton, task P6 wires up the real handler.
 *
 * Hono on Node, serving the built Vite pages (`pages/*.html`, built to
 * `dist-pages/` by `npm run build:pages`) plus:
 *
 *   POST /api/feedback  — `createFeedbackHandler(...)` (task P6), imported
 *     from `@papergiant/feedback/server` — a real dependency (task P10):
 *     `"file:../.."` locally (a symlink to the package root, so its built
 *     `dist/` is picked up live), or an installed copy of the packed
 *     tarball in CI. Wired to `memoryLimiter({ singleInstance: true })`, a static
 *     `identify` (the fixed staff identity below, unless the request
 *     carries `fixture-anon=1`, in which case `null`) and `githubSink()`
 *     pointed at the stub via `STUB_URL`.
 *
 *   GET /__outbound — the last raw request (headers + raw text body) this
 *     server received on POST /api/feedback, for the P9 collection-boundary
 *     test (sentinel strings placed in the URL, DOM and host form must
 *     never appear here). Captured from a *clone* of the request stream in
 *     middleware, before the route handler reads it, so this can't starve
 *     the real handler's own streamed 32 KiB cap — and it's kept as raw
 *     text rather than parsed JSON so a malformed body is still captured
 *     faithfully.
 *
 *   POST /__host-control  { "behaviour": "..." } — see "Host-side response
 *     ambiguity" below. POST /__reset clears it (and the outbound record).
 *
 * Page routes also accept an arbitrary trailing path segment
 * (`/vanilla.html/*`) so tests can navigate with a sentinel path segment
 * without the fixture needing real routing.
 *
 * Host-side response ambiguity.
 *
 * The stub's own `/__control` simulates GitHub-side ambiguity (did the
 * issue get created?). This host also needs to simulate ambiguity on the
 * *browser <-> host* leg — a dropped connection, a truncated body, an
 * unexpected content type — independently of what the stub did, because
 * the real `createFeedbackHandler` (P6) response can go missing or get
 * mangled after the stub has already done its job. `POST /__host-control`
 * sets a single-shot behaviour (reverting to `"pass"` the moment the next
 * `POST /api/feedback` consumes it, same as the stub's `/__control`),
 * applied to that request's *response* only, after the real feedback
 * handler has already run and the stub has already recorded the issue:
 *
 *   - "pass" (default): normal response.
 *   - "drop-response": the issue is recorded on the stub, then the
 *     underlying socket is destroyed after a `Content-Length` header
 *     promising a body that never arrives — see the note below on why a
 *     bare `socket.destroy()` isn't enough.
 *   - "corrupt-response": a `200` with a truncated JSON body.
 *   - "html-response": a `200` with an HTML body instead of JSON.
 *
 * Not implemented with Playwright's `page.route` — that intercepts and
 * re-issues the request client-side, which changes `Origin` and
 * `Sec-Fetch-Site` and would defeat P6's CSRF checks. This is real
 * ambiguity produced by the real server.
 *
 * Every response also carries `Connection: close` (see the middleware
 * below): this is belt-and-braces *after* the `Content-Length` fix to
 * `drop-response` (which alone is what makes a dropped connection
 * unambiguous to the client — see that middleware's comment), added so no
 * connection this host ever hands back to a browser is a candidate for
 * reuse in the first place. Even so, `tests/api.spec.ts`'s "exactly one
 * issue recorded" assertions for `record-then-drop`/`drop-response` hold
 * only because this fixture forbids connection reuse outright. A real
 * production host over ordinary HTTP keep-alive has no such guarantee: a
 * browser can transparently retry a POST on a fresh connection when the
 * one it used is destroyed before any response byte arrives (verified
 * during this task in both Chromium and Firefox), and that retry carries
 * the same `report_id` and can file a second, duplicate issue — outside
 * this package's control, since it happens entirely within the browser's
 * network stack before `mountFeedback()` (task P7) ever sees a failure.
 */
import { serve, type HttpBindings } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_PORT, INTAKE_OWNER, INTAKE_REPO, SINK_TIMEOUT_MS, STUB_URL } from './constants.ts';
import { createFeedbackHandler } from '@papergiant/feedback/server';
import type { FeedbackIdentity } from '@papergiant/feedback';
import { memoryLimiter } from '@papergiant/feedback/limit';
import type { Limiter, LimiterOutcome } from '@papergiant/feedback/limit';
import { githubSink, tokenAuth } from '@papergiant/feedback/github';

type Env = { Bindings: HttpBindings };

/** The one fixed identity every "signed-in" fixture request gets, unless
 * the request carries the `fixture-anon=1` cookie (see `identify` below). */
const FIXTURE_IDENTITY: FeedbackIdentity = {
  ref: 'fixture-person',
  role: 'staff',
  surface: 'staff',
  allowReference: true,
  lookupUrl: `http://localhost:${HOST_PORT}/people/fixture-person`,
};

function hasFixtureAnonCookie(request: Request): boolean {
  const header = request.headers.get('cookie');
  if (!header) return false;
  return header
    .split(';')
    .map((part) => part.trim())
    .includes('fixture-anon=1');
}

async function identify(request: Request): Promise<FeedbackIdentity | null> {
  return hasFixtureAnonCookie(request) ? null : FIXTURE_IDENTITY;
}

// `POST /__reset` recreates the counting state (see below) so tests stay
// independent of each other's rate-limit usage, without having to tear
// down and rebuild `feedbackHandler` itself (built once, per the design's
// "construct once" contract for createFeedbackHandler). This thin wrapper
// always delegates to whichever memoryLimiter() instance `innerLimiter`
// currently points at, so swapping that reference is enough.
let innerLimiter = memoryLimiter({ singleInstance: true });
const limiter: Limiter = {
  take(subject: string): Promise<LimiterOutcome> {
    return innerLimiter.take(subject);
  },
};

const sink = githubSink({
  auth: tokenAuth('fixture-token'),
  intake: `${INTAKE_OWNER}/${INTAKE_REPO}`,
  apiBaseUrl: STUB_URL,
  timeoutMs: SINK_TIMEOUT_MS,
});

const feedbackHandler = createFeedbackHandler({
  app: 'fixture',
  displayName: 'Fixture',
  productRepository: 'papergiant/fixture-product',
  environment: 'test',
  origins: [`http://localhost:${HOST_PORT}`],
  identify,
  limiter,
  sink,
  areas: {
    vanilla: 'examples/fixture/pages/vanilla.html',
    react19: 'examples/fixture/pages/react19.html',
    radix: 'examples/fixture/pages/radix.html',
  },
  receivingCommit: 'f00dfacef00dfacef00dfacef00dfacef00dface',
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, 'dist-pages');
// `serveStatic`'s `root` is resolved relative to `process.cwd()` (it does
// not accept an absolute path) — derive it from the same __dirname base as
// `PAGES_DIR` instead of a hardcoded `'./dist-pages'`, so both agree
// regardless of the directory the process happens to be started from.
const PAGES_DIR_RELATIVE_TO_CWD = path.relative(process.cwd(), PAGES_DIR) || '.';
const PAGE_NAMES = ['vanilla.html', 'react19.html', 'radix.html'] as const;

type HostBehaviour = 'pass' | 'drop-response' | 'corrupt-response' | 'html-response';
const HOST_BEHAVIOURS: HostBehaviour[] = ['pass', 'drop-response', 'corrupt-response', 'html-response'];

const app = new Hono<Env>();

let lastReceived: { headers: Record<string, string>; body: string } | null = null;
let nextHostBehaviour: HostBehaviour = 'pass';

// Every response closes its connection rather than offering it back to
// Node's keep-alive pool — belt-and-braces alongside the `Content-Length`
// fix in `drop-response` below (see the file header comment for the full
// story: a bare zero-byte `socket.destroy()` was silently retried by both
// Chromium and Firefox on a fresh connection, masking the very failure
// `drop-response` is meant to produce). This alone was tried first and
// was not sufficient — Firefox still accepted the destroyed connection's
// absence of any `Content-Length`/`Transfer-Encoding` as an ordinary
// empty `200` — but it removes connection reuse as a variable everywhere
// else in this fixture too, which is what the file header's note on
// production behaviour depends on.
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('connection', 'close');
});

app.get('/', (c) =>
  c.html(
    `<!doctype html><html><body><h1>@papergiant/feedback fixture</h1><ul>${PAGE_NAMES.map(
      (name) => `<li><a href="/${name}">${name}</a></li>`
    ).join('')}</ul></body></html>`
  )
);

async function servePage(c: Context<Env>, page: string) {
  try {
    const html = await readFile(path.join(PAGES_DIR, page), 'utf8');
    return c.html(html);
  } catch {
    return c.text(`${page} is not built — run \`npm run build:pages\` first.`, 500);
  }
}

for (const page of PAGE_NAMES) {
  app.get(`/${page}`, (c) => servePage(c, page));
  // Trailing path segment for the P9 URL-sentinel test — this is a static
  // fixture, so anything after the page name is ignored and the same page
  // is served regardless.
  app.get(`/${page}/*`, (c) => servePage(c, page));
}

// Captures the raw request (for /__outbound) and applies the single-shot
// host-side response behaviour (see file header) — in that order, wrapping
// the actual POST /api/feedback handler below.
app.use('/api/feedback', async (c, next) => {
  lastReceived = {
    headers: Object.fromEntries(c.req.raw.headers),
    body: await c.req.raw.clone().text(),
  };

  await next();

  const behaviour = nextHostBehaviour;
  nextHostBehaviour = 'pass';

  if (behaviour === 'drop-response') {
    // The feedback handler already ran and the stub already recorded the
    // issue (or didn't, per its own behaviour) inside `next()` above —
    // this only makes sure nothing usable of that outcome reaches the
    // client. Two things were tried and rejected before this one:
    //   - A bare `socket.destroy()` with *zero* bytes written turned out
    //     to be indistinguishable, to a real browser, from an ordinary
    //     stale-pooled-connection race: both Chromium and Firefox will
    //     silently retry a request on a fresh connection when the one
    //     they used is destroyed before any response byte arrives, which
    //     let the retry quietly succeed instead of the page's fetch()
    //     ever seeing a failure.
    //   - Writing only the status line (no headers, no body) before
    //     destroying stopped the silent retry, but Firefox then treated
    //     the connection close as legitimate HTTP/1.0-style framing — no
    //     Content-Length or Transfer-Encoding means "body ends when the
    //     connection does" — and resolved it as an ordinary empty `200`.
    // Declaring a Content-Length the body never reaches is unambiguous
    // under HTTP semantics in every engine: every client must treat a
    // closed connection short of a promised Content-Length as a hard
    // network error (Chromium: ERR_CONTENT_LENGTH_MISMATCH; Firefox and
    // WebKit similarly), which is exactly "browser sees this response as
    // broken" — what this behaviour is meant to simulate.
    c.env.incoming.socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 30\r\n\r\n');
    c.env.incoming.socket.destroy();
    return;
  }
  if (behaviour === 'corrupt-response') {
    c.res = new Response('{"status":"rec', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    return;
  }
  if (behaviour === 'html-response') {
    c.res = new Response('<!doctype html><html><body>not json</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }
});

app.post('/api/feedback', (c) => feedbackHandler(c.req.raw));

app.get('/__outbound', (c) => c.json(lastReceived ?? {}));

app.post('/__host-control', async (c) => {
  let requested: string | undefined;
  try {
    requested = (await c.req.json())?.behaviour;
  } catch {
    requested = undefined;
  }
  if (!requested || !HOST_BEHAVIOURS.includes(requested as HostBehaviour)) {
    return c.json({ error: 'unknown behaviour', got: requested ?? null }, 400);
  }
  nextHostBehaviour = requested as HostBehaviour;
  return c.json({ ok: true, behaviour: requested });
});

app.post('/__reset', (c) => {
  nextHostBehaviour = 'pass';
  lastReceived = null;
  // A fresh limiter each reset, so one test's rate-limit usage (including
  // hitting the per-subject cap on purpose) never bleeds into the next.
  // See the `innerLimiter`/`limiter` wrapper above for why this is enough
  // without rebuilding `feedbackHandler` itself.
  innerLimiter = memoryLimiter({ singleInstance: true });
  return c.json({ ok: true });
});

// Fallback: built assets (Vite's `assets/*.js`, `.css`, …).
app.use('*', serveStatic({ root: PAGES_DIR_RELATIVE_TO_CWD }));

serve({ fetch: app.fetch, port: HOST_PORT }, (info) => {
  console.log(`[fixture host] listening on http://localhost:${info.port}`);
});
