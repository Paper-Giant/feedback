# `examples/react18`

Task P10: proves `@papergiant/feedback` works under an **independently installed React 18** — `react@18.3.x` + `react-dom@18.3.x` + `@types/react@18.3.x` + `@types/react-dom@18.3.x`, resolved together in this project's own `node_modules`, separate from the package's own React 19 devDependencies (used to build and test the package itself).

A separate npm project, like `examples/fixture` — its own `package.json`, its own lockfile, not part of the package's own dependency tree. See `examples/fixture/README.md`'s "Task P10" note for how the `@papergiant/feedback` dependency itself works (`"file:../.."` locally, the packed tarball in CI) and why `vite.config.ts` sets `resolve.dedupe: ['react', 'react-dom']`.

## What's here

- **`pages/app.tsx`** — one page: a top-level `<FeedbackButton>`, a `<FeedbackArea name="r18">`, and a second `<FeedbackButton>` inside an always-open Radix `Dialog` (mirrors a host's always-open wizard dialog — the launcher outside it sits behind the dialog's overlay by design, same as `examples/fixture/pages/radix.tsx`'s `launcher-outside`; only the in-dialog one is reachable while the wizard is open). Mounted under `<StrictMode>`, with `React.version` exposed on `window.__REACT_VERSION__`.
- **`server.ts`** — a tiny Hono host: the built page, plus `POST /api/feedback` via the real `createFeedbackHandler()` (task P6), wired to `memoryLimiter` and a static `identify` — but an **in-memory stub sink**, not `githubSink()`. This consumer exists to prove React 18 support end to end, not to re-prove the delivery matrix P9 already covers in the fixture.
- **`ssr-check.tsx`** — a plain Node script (`npm run test:ssr`), no Playwright, no jsdom: `renderToString()` on `<FeedbackProvider>`, asserting no DOM global is touched and a `type="button"` renders. See its header for why it only means what it says against the packed tarball, not the local `file:../..` link.
- **`tests/app.spec.ts`** — Playwright, three engines: `React.version` starts with `18`; StrictMode's mount/cleanup/remount leaves exactly one launcher and one feedback host; the in-dialog button opens feedback nested with zero calls to the host wizard's own Escape/close handlers; sending a report shows "Received · #n".

## Running it

```sh
npm run build          # from the package root, first
cd examples/react18
npm ci
npm run typecheck      # only trustworthy against the packed tarball — see tsconfig.json
npm run test:ssr        # ditto — see ssr-check.tsx
npx playwright install chromium webkit firefox   # once; may already be cached
npx playwright test
```

Against the packed tarball (what CI does, and the only install this project's `typecheck`/`test:ssr` scripts are meaningful against): `npm run build && npm pack` at the root, then here, `npm install --no-save ../../papergiant-feedback-*.tgz` before the commands above.
