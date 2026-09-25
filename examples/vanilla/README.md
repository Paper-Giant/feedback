# `examples/vanilla`

Task P10: proves the framework-free surface — `@papergiant/feedback/browser` and `/server`, and every non-React entry point — works with **no React installed anywhere** in this project.

A separate npm project, like `examples/fixture` — its own `package.json`, its own lockfile, not part of the package's own dependency tree. See `examples/fixture/README.md`'s "Task P10" note for how the `@papergiant/feedback` dependency itself works (`"file:../.."` locally, the packed tarball in CI).

## What's here

- **`pages/app.ts`** — a plain page, no framework: `mountFeedback()` wired to an in-page button, plus `mountLauncher()`'s own side-tab launcher.
- **`server.ts`** — a tiny Hono host, same shape as `examples/react18/server.ts` (an in-memory stub sink, not `githubSink()` — see that project's README for why).
- **`no-react-check.ts`** / **`run-no-react-check.sh`** (`npm run test:no-react`) — a plain Node check: every entry point except `/react` (`@papergiant/feedback`, `/browser`, `/server`, `/github`, `/limit`, `/build`) imports cleanly with no React present; `/react` fails cleanly (`ERR_MODULE_NOT_FOUND`, naming `react`) — and only that one. Run via the wrapper script, not directly — see its header for why (short version: this project lives nested inside the package's own repository, which has its own `react` devDependency reachable by Node's ordinary upward `node_modules` search unless the check runs from outside the repository entirely).
- **`tests/smoke.spec.ts`** — Playwright, three engines: opens, sends, and receives ("Received · #n").

## Running it

```sh
npm run build          # from the package root, first
cd examples/vanilla
npm ci
npm run typecheck
npm run test:no-react   # only meaningful against the packed tarball — see no-react-check.ts
npx playwright install chromium webkit firefox   # once; may already be cached
npx playwright test
```

Against the packed tarball (what CI does, and the only install `test:no-react` is meaningful against — see its header): `npm run build && npm pack` at the root, then here, `npm install --no-save ../../papergiant-feedback-*.tgz` before the commands above.
