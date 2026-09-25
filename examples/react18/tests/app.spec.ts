import { expect, test, type Page } from '@playwright/test';

/**
 * Task P10: real-browser proof, on all three engines, that
 * `@papergiant/feedback` works under an independently installed React 18
 * (this project's own `react@18.3.x` + `react-dom@18.3.x`, resolved
 * together — see `package.json` — separately from the package's own React
 * 19 devDependencies). Mirrors the patterns `examples/fixture/tests/*`
 * already established (`delivery.spec.ts`'s send-and-check-status,
 * `host-modals.spec.ts`'s nested/Escape assertions), trimmed to what this
 * consumer needs to prove once, not re-prove the whole delivery matrix.
 */

async function resetHarness(page: Page): Promise<void> {
  await page.request.post('/__reset');
}

test.beforeEach(async ({ page }) => {
  await resetHarness(page);
});

test('React.version resolves to a React 18, not the package root\'s own React 19 devDependency', async ({ page }) => {
  await page.goto('/');
  const version = await page.evaluate(() => window.__REACT_VERSION__);
  expect(version).toMatch(/^18\./);
});

test('StrictMode mount leaves exactly one launcher, and opening leaves exactly one feedback host', async ({
  page,
}) => {
  await page.goto('/');

  // React 18's development Strict Mode double-invokes mount effects
  // (mount -> cleanup -> mount again) — a naive controller/launcher
  // lifecycle would leave two of either behind. `vite build --mode
  // development` (package.json) keeps this build on React's development
  // branch specifically so this is actually exercised here, not silently
  // skipped by a production build.
  await expect(page.getByTestId('launcher')).toHaveCount(1);

  // Opens via the launcher *inside* the always-open wizard, not the
  // top-level one: the wizard's Radix overlay covers the whole page by
  // design (design §3 — a launcher outside an open host modal refuses to
  // open at all, see examples/fixture/tests/host-modals.spec.ts's
  // "refusal" case), so `data-testid="launcher"` is never the reachable
  // one while this page's wizard is open. That's exactly the same one
  // StrictMode's double-invoke could also have doubled, so it still
  // proves the point.
  await page.getByTestId('launcher-in-dialog').click();
  await expect(page.getByTestId('feedback-dialog')).toBeVisible();

  const hostCount = await page.evaluate(() => document.querySelectorAll('[data-feedback-host]').length);
  expect(hostCount).toBe(1);
});

test('the button inside the always-open Radix dialog opens feedback nested, and Escape closes only feedback', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.evaluate(() => window.__hostSpies)).resolves.toEqual({ escapeCalls: 0, openChangeCalls: 0 });

  const launcher = page.getByTestId('launcher-in-dialog');
  await launcher.click();

  const dialog = page.getByTestId('feedback-dialog');
  await expect(dialog).toBeVisible();

  // Nested inside the Radix dialog's own content element, not appended to
  // <body> — design §3 "Host modals".
  const nested = await page.evaluate(() => {
    const radixContent = document.querySelector('[role="dialog"][data-state="open"]');
    const host = document.querySelector('[data-feedback-host]');
    return Boolean(radixContent && host && radixContent.contains(host));
  });
  expect(nested).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Zero calls to the host wizard's own Escape/openChange handlers — the
  // window-capture guard (task P7) stopped Escape reaching Radix at all.
  const spies = await page.evaluate(() => window.__hostSpies);
  expect(spies).toEqual({ escapeCalls: 0, openChangeCalls: 0 });

  // The wizard itself is still open (it never actually closes; this also
  // confirms Escape didn't navigate away or tear the page down).
  await expect(page.getByText('Example wizard (always open)')).toBeVisible();

  // Focus returns to the launcher that opened it.
  await expect(launcher).toBeFocused();
});

test('sending a report through the tiny local handler shows "Received · #n"', async ({ page }) => {
  await page.goto('/');

  // Same reachability note as the StrictMode test above: the top-level
  // launcher sits behind the always-open wizard's overlay, so the
  // in-dialog one is what a real click can reach.
  await page.getByTestId('launcher-in-dialog').click();
  const dialog = page.getByTestId('feedback-dialog');
  await expect(dialog).toBeVisible();

  await page.getByTestId('feedback-kind-bug').check();
  await page.getByTestId('feedback-what').fill('react18 example — end-to-end delivery smoke');
  await page.getByTestId('feedback-send').click();

  const status = page.getByTestId('feedback-status');
  await expect(status).toHaveText(/^Received · #\d+$/);
});
