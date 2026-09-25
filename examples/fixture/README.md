# `examples/fixture`

The test host for `@papergiant/feedback` — task P10a. It exists so real-browser tests (P9) can start the moment the handler (P6) and dialog (P7) land, without waiting to also build a host from scratch.

It is a **separate npm project** — its own `package.json`, its own lockfile, installed independently of the package root. The package root gains nothing from this except one script (`fixture:test`); it has zero runtime dependencies either way.

**Task P10: this project depends on the real, built package**, `@papergiant/feedback` — no more Vite aliases or `dist/` imports. Locally, `package.json` declares `"@papergiant/feedback": "file:../.."`: `npm install`/`npm ci` here creates a symlink at `node_modules/@papergiant/feedback` back to the package root, so `npm run build` at the package root (still required first — see below) is picked up live, no reinstall needed between builds. CI instead installs a real, unpacked copy of the packed tarball on top, `--no-save`, after the ordinary install: `npm run build && npm pack` at the root, then `npm install --no-save ../../papergiant-feedback-*.tgz` here — so no per-pack integrity hash ever lands in the committed lockfile, and what CI actually tests is what would ship. `vite.config.ts`'s `resolve.dedupe: ['react', 'react-dom']` guards the local (symlinked) case specifically: without it, a bare `import 'react'` inside the linked package's compiled `dist/react/index.js` can resolve to the package root's own `react` devDependency instead of this project's, at Vite build time — two React module instances in one page.

## What's here

- **`stub-github.ts`** — a plain `node:http` server standing in for the two GitHub calls the package's sink (P5) makes: minting an installation token and creating an issue. Its behaviour on issue creation is controllable per-request (see below), so tests can force every delivery outcome the design (§5 "Delivery states") cares about.
- **`server.ts`** — a Hono host server serving the built Vite pages and `POST /api/feedback`, the real `createFeedbackHandler(...)` (task P6) — see "How each page wires up the package" below.
- **`pages/`** — three Vite-built pages (`vanilla.html`, `react19.html`, `radix.html`). `vanilla.html` calls `mountFeedback()` (task P7) directly; `react19.html` and `radix.html` use the React wrapper (task P8, `<FeedbackProvider>`/`<FeedbackButton>`/`<FeedbackArea>`) — see "How each page wires up the package" below.
- **`tests/`** — Playwright specs: one smoke spec per page plus the stub/placeholder-route wiring (`api.spec.ts`), proving the harness itself works, and the real-browser suite: `delivery.spec.ts` and `delivery-matrix.spec.ts` (every delivery state through the UI), `host-modals.spec.ts` and `review-fixes.spec.ts` (nesting, refusal, scrolling, recovery), `accessibility.spec.ts` (axe in six states), `keyboard.spec.ts`, `reflow.spec.ts` and `forced-colors.spec.ts`.

## Running it

```sh
npm run build          # from the package root, first — this project's node_modules/@papergiant/feedback is a symlink back to the root, so it needs a real dist/ to point at
cd examples/fixture
npm ci
npx playwright install chromium webkit firefox   # once; may already be cached
npx playwright test
```

From the package root: `npm run fixture:test` does the `examples/fixture` half (`npm ci` + `playwright test`) in one step — it still expects `dist/` to already exist.

To run it the way CI does — against the packed tarball rather than the live symlink — pack first: `npm run build && npm pack` at the root, then `npm install --no-save ../../papergiant-feedback-*.tgz` here before `npx playwright test`.

Useful during development:

- `npm run build:pages` — builds the three pages to `dist-pages/` (Playwright's `webServer` does this itself before starting the host, so you don't normally need to run it by hand).
- `npm run start:stub` / `npm run start:host` — run either server standalone (stub on `:4322`, host on `:4321` by default; override with `STUB_PORT` / `PORT`).

## The stub's control endpoint

`POST /__control` with `{ "behaviour": "<name>" }` sets the behaviour for the **next** `POST /repos/:owner/:repo/issues` call only — it reverts to `"succeed"` the moment that one request is served, so tests don't need to reset it back themselves.

| Behaviour | What happens | Recorded in `/__issues`? |
| --- | --- | --- |
| `succeed` (default) | Responds `201` with an incrementing `number`, `html_url`, and the requested labels. | Yes |
| `status:<code>` (e.g. `status:422`, `status:503`) | Responds with that status and a generic error body. Nothing was created. | No |
| `hang` | Never responds at all. The caller must time out or abort. | No |
| `record-then-drop` | Records the issue (it gets a number and appears in `/__issues`) and then **destroys the socket with no response** — GitHub did the work, but the client never found out. This is the design's "delivery unconfirmed" case. | Yes |
| `drop-labels` | Records the issue and responds `201`, but the response omits one of the requested labels — simulating GitHub silently dropping a label the caller wasn't allowed to set. | Yes |

Why `status:<code>` and `hang` aren't recorded: on real GitHub, a request that never created an issue doesn't show up anywhere. `record-then-drop` is the one case that's recorded *and* fails to respond, on purpose — it's the one that matters for the "delivery unconfirmed" test.

Other stub endpoints:

- `GET /__issues` → `{ issues: [{ number, owner, repo, headers, body }, ...] }`, everything recorded so far, bodies included.
- `POST /__reset` → clears recorded issues, resets numbering to 1, and resets the behaviour to `succeed`.
- `POST /app/installations/:id/access_tokens` → `201 { token, expires_at }` (a fixed-shape stub token; nothing about the caller's JWT is checked).

## The host's endpoints

- `GET /vanilla.html`, `/react19.html`, `/radix.html` — the built pages. Each also accepts an arbitrary trailing path segment (`/vanilla.html/anything`) so P9's URL-sentinel test can navigate with a path segment without the fixture needing real routing.
- `POST /api/feedback` — see "How each page wires up the package" below.
- `GET /__outbound` → `{ headers, body }`, the **last** raw request this server received on `POST /api/feedback` — `headers` as a plain object, `body` as the **raw request text**, not parsed JSON (so a malformed body is still captured faithfully, and this can't be fooled by anything downstream that only reads a clone). This is what P9's collection-boundary test reads: sentinel strings placed in the URL, the page DOM and the host form must never show up here, in either field — `Referer` included, see "Sentinel strings" below. Captured in middleware from `c.req.raw.clone().text()`, before the route handler ever reads the body, so it can't interfere with a real (P6) handler's own streamed 32 KiB cap running after it.
- `POST /__host-control` with `{ "behaviour": "pass" | "drop-response" | "corrupt-response" | "html-response" }` — see "Host-side response ambiguity" below.
- `POST /__reset` — clears the outbound record and resets the host-control behaviour to `"pass"`. (This is the *host's* reset; the stub has its own, at `${STUB_URL}/__reset`, documented above.)

### Host-side response ambiguity

The stub's `/__control` simulates GitHub-side ambiguity — did the issue actually get created? This host needs a second, independent kind: ambiguity on the browser↔host leg itself, after the stub has already done its job. `POST /__host-control` sets a single-shot behaviour (same rule as the stub's: it reverts to `"pass"` the moment the next `POST /api/feedback` consumes it), applied to that request's *response only*, after the real feedback handler has already run and the stub has already recorded (or not) the issue:

| Behaviour | What happens | Issue recorded on the stub? |
| --- | --- | --- |
| `pass` (default) | Normal response. | Yes |
| `drop-response` | The socket is destroyed with no response at all. | Yes |
| `corrupt-response` | `200`, `content-type: application/json`, but a truncated body (`{"status":"rec`). | Yes |
| `html-response` | `200` with an HTML body instead of JSON. | Yes |

In every case the issue is still recorded — the stub already got the request inside `await next()`, before the host tampers with what the *client* sees. This is deliberately **not** implemented with Playwright's `page.route`: intercepting and re-issuing the request client-side changes `Origin` and `Sec-Fetch-Site`, which would defeat the CSRF checks P6 adds. This is a real response from the real server, made ambiguous after the fact.

## How each page wires up the package (P6, P7, P8 have all landed — nothing here is a placeholder any more)

- **`POST /api/feedback` in `server.ts`** is the real `createFeedbackHandler({ ... })` (task P6), wired to `memoryLimiter({ singleInstance: true })`, a static `identify` (the fixed staff identity in `server.ts`, unless the request carries a `fixture-anon=1` cookie), `githubSink()` pointed at the stub, and the real `areas` map (`vanilla`/`react19`/`radix`, each the source page's own path — see "The Radix page" below).
- **`vanilla.html`** is the only page that talks to `mountFeedback()` (task P7) imperatively: `pages/shared/mount-feedback.ts` calls it directly and every launcher button calls `window.__openFeedback?.(fromElement)`, which that file defines. `window.__feedbackController` and `window.__feedbackEvents` are the real controller and its real event log.
- **`react19.html`** and **`radix.html`** instead use the React wrapper (task P8): `<FeedbackProvider>` + `<FeedbackButton>` (+ `<FeedbackArea>` on `radix.html`), imported from `@papergiant/feedback/react` (a real dependency as of task P10 — see above) — neither page calls `window.__openFeedback` or sets `window.__feedbackController` itself. `radix.tsx`'s `FeedbackWindowBridge` component is the one exception: it republishes `useFeedback()`'s `open`/`isOpen` onto `window.__feedbackController` (with `close`/`setArea`/`destroy` as unused stubs, only present to satisfy that global's `FeedbackController` type), purely so `tests/review-fixes.spec.ts`'s "Item 1" test — the one spec still exercising the controller imperatively rather than through a button click — keeps working.

## The Radix page (`radix.html`)

Mirrors a host's always-open wizard dialog: a `Dialog.Root` whose `open` prop is the literal `true` (never state), so it can never actually close — `onOpenChange(false)`, fired by Escape, an outside click or a close control, calls a fake `navigate()` instead. The content element itself is the scroller (`maxHeight: 90vh; overflow: auto; overscrollBehavior: contain`), matching a host's wizard dialog's own `.modal` stylesheet, and it also gets a host's `onOpenAutoFocus` treatment — default focus is prevented and the (sr-only) title is focused instead, without opening a keyboard or selecting anything in the form.

Three separate spies live on `window.__hostSpies`, starting at `{ escapeCalls: 0, openChangeCalls: 0, navigateCalls: [] }`:

- `escapeCalls` — Radix's own document-capture Escape handler reached this content (`onEscapeKeyDown`). Once feedback (P7) nests here and stops Escape's propagation at the window in the capture phase first, this must stay at `0` while feedback is open.
- `openChangeCalls` — Radix asked to close (`onOpenChange(false)`), which this fixture treats as "leave the wizard" — fired by Escape (if not stopped upstream), an outside click, or a close control.
- `navigateCalls` — the fake `navigate()` the host calls whenever `openChangeCalls` fires; an array of the hrefs it was "sent" to.

P9 asserts feedback nesting inside this dialog produces **zero** calls to any of the three, not merely that the dialog stays visible — `escapeCalls` and `openChangeCalls` are separate because a real Escape press can trigger either or both, and a test that only checked one could pass by accident.

Test ids:

- `data-testid="host-draft"` — the host's own draft textarea inside the dialog content, pre-filled with `SENTINEL_FORM`.
- `data-testid="launcher-inside"` — a launcher inside the dialog content. Feedback opened from here should nest inside this dialog's content element (design §3), not refuse.
- `data-testid="launcher-outside"` — a second launcher outside the dialog, present in the DOM behind the overlay. Feedback opened from here should refuse (the launcher isn't inside an open host modal, so opening it would sit behind the overlay).
- `data-testid="grow-host"` — toggles the content inside `data-testid="host-scroll-content"` (which has no height cap of its own) between short and tall, so the **dialog content element** — the actual scroller — can be tested both non-overflowing (short) and at its own scroll boundary (tall, per the fix in this revision: an earlier version capped the inner div's own height, which meant the outer dialog could never be made to overflow).
- `data-testid="open-nested"` / `data-testid="launcher-nested-2"` — opens a second Radix dialog nested inside the first, containing its own launcher. Feedback opened from there is beyond the one level of nesting the design allows, and should refuse like the outside case.

This page also carries a `<FeedbackArea name="radix">` (task P8), which matches the `radix` key in `server.ts`'s `createFeedbackHandler({ areas: {...} })` map (`vanilla`/`react19`/`radix`, each the source page's own path as its source hint) — a report sent from here round-trips through the real *server-side* area check too, not just the browser-side one. `tests/radix.spec.ts`'s `<FeedbackArea>` test checks both: the outbound payload (`/__outbound`) and the rendered ticket title the stub recorded (`[Fixture] Bug · radix`, not `· unknown`).

## Sentinel strings (for P9's collection-boundary test)

Every page carries the same three sentinels, none of which the real handler (P6) may ever see:

- **`SENTINEL_DOM`** — static page text, `data-testid="sentinel-dom"`.
- **`SENTINEL_FORM`** — the pre-filled value of the page's own host form field (`data-testid="host-form-field"` on `vanilla.html`/`react19.html`, `data-testid="host-draft"` on `radix.html`).
- **`SENTINEL_QUERY`** and a path segment — not embedded in the pages themselves; P9's test navigates with `?secret=SENTINEL_QUERY` and an extra path segment (e.g. `/vanilla.html/some-segment`), which every page route accepts and ignores.

**`Referer` is in scope too, and easy to miss.** A default same-origin `fetch`/`POST` from one of these pages carries the page's own URL — path segment and query string, sentinels included — in the `Referer` header, independently of anything the request body does. `/__outbound`'s captured `headers` includes it. The real dialog (P7) is expected to send `referrerPolicy: 'no-referrer'` specifically so this can't leak; P9's collection-boundary test checks `Referer` (and every other header) for sentinels, not just the body. See the collection-boundary test in `tests/delivery.spec.ts`.

## Known limitation of these smoke tests

`tests/api.spec.ts` posts to `/api/feedback` with Playwright's `request` fixture — a plain HTTP client, not a page — so those requests carry no `Origin`, `Sec-Fetch-Site` or `Referer`. That's fine for proving the placeholder route and the stub are wired correctly (P10a's job), but it is not what P6's real handler will accept once it adds the origin/CSRF checks in design §5. P6 rewrites these tests to post from an actual page (e.g. `page.evaluate(() => fetch(...))`) so the request looks like a real same-origin browser POST.

## Real-browser coverage

Every item in the build plan's P9 list has a real spec (see `tests/` above); nothing is left as `test.fixme`. Skips carry reasons in the spec: touch-drag uses Chrome DevTools Protocol and runs on Chromium only; `forcedColors` emulation exists only in Chromium; `keyboard.spec.ts` records how each engine's native modal `<dialog>` handles Tab at its edges inside a shadow root (Chromium hops through `<body>`, Firefox parks on the last control, WebKit follows macOS's default of text fields only) and asserts in every engine that focus never reaches the host page.

Running two worktrees' fixtures at once on one machine collides on the default ports (4321/4322) and Playwright's `reuseExistingServer` will reuse the other worktree's server; set `PORT` and `STUB_PORT` per worktree.
