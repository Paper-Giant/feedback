/**
 * Task P10: "SSR check with `react-dom/server` `renderToString` in a small
 * Node test (no DOM side effects, renders a `type="button"`)".
 *
 * Plain Node, no jsdom, no Playwright, no bundler: `document`/`window`
 * simply don't exist in this process, so "no DOM side effects" is proven
 * by construction rather than asserted after the fact — if
 * `@papergiant/feedback/react` (or React itself) ever touched either
 * during import or render, this script would throw `ReferenceError`
 * before `renderToString` even returned.
 *
 * Run with `npm run test:ssr` (`tsx ssr-check.tsx`) — tsx only transpiles
 * the JSX/TS syntax; nothing here needs a browser or a DOM shim.
 *
 * Requires `@papergiant/feedback` to be installed as a real, unpacked copy
 * (the packed tarball, same as CI) — **not** the bare `"file:../.."` link
 * `package.json` otherwise declares for local development. Through that
 * symlink, plain Node resolution follows it to the package root before
 * resolving `@papergiant/feedback/react`'s own `import ... from 'react'`,
 * which then finds the package root's *own* `react` devDependency
 * (19.x, needed to build/test the package itself) instead of this
 * project's `react@18.3.x` — two different React module instances, one
 * rendering (`react-dom/server`, this project's 18.x) and one inside the
 * rendered component tree (the package's, 19.x via the symlink), which
 * fails with "Invalid hook call" rather than silently rendering the wrong
 * version. Vite-bundled code (`pages/app.tsx`, this project's Playwright
 * suite) doesn't have this problem: `vite.config.ts`'s `resolve.dedupe`
 * fixes it at bundle time, and Vite's own resolver is what's affected —
 * this script bypasses Vite entirely, so `dedupe` can't help it. The
 * tarball install has no symlink: it's a real, self-contained copy inside
 * this project's own `node_modules`, so plain Node resolution finds only
 * this project's own React 18, no config needed.
 */
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import { FeedbackArea, FeedbackButton, FeedbackProvider } from '@papergiant/feedback/react';

assert.equal(typeof document, 'undefined', 'this script must run in plain Node — no jsdom');
assert.equal(typeof window, 'undefined', 'this script must run in plain Node — no jsdom');

const html = renderToString(
  <FeedbackProvider notice="ssr" endpoint="/api/feedback" areas={['r18']}>
    <FeedbackButton data-testid="ssr-button">Give feedback</FeedbackButton>
    <FeedbackArea name="r18" />
  </FeedbackProvider>,
);

// Still true after rendering: `<FeedbackProvider>` only calls
// `mountFeedback()`/`mountLauncher()` inside a `useEffect`, and React's
// `renderToString` never runs effects (server or client) — see
// src/react/index.tsx's file header.
assert.equal(typeof document, 'undefined', 'renderToString must not have touched document');
assert.equal(typeof window, 'undefined', 'renderToString must not have touched window');

assert.match(html, /<button[^>]*\btype="button"/, 'expected a <button type="button"> in the SSR output');
assert.match(html, />Give feedback</, 'expected the button label in the SSR output');

console.log(`SSR check passed (${html.length} bytes rendered, no DOM touched).`);
