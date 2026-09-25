import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';

/**
 * Real-browser proof for the r1 review's blocker and should-fixes (task
 * P7). Each test names the review item(s) it covers.
 */

declare global {
  interface Window {
    __escapeReachedDocument?: boolean;
  }
}

test.describe('Item 1 (blocker) — zombie controller recovery', () => {
  test('removing the host modal from the DOM while feedback is open nested lets Escape reach the host again, and a fresh open() shows feedback again', async ({
    page,
  }) => {
    await page.goto('/radix.html');
    await page.getByTestId('launcher-inside').click();
    const dialog = page.getByTestId('feedback-dialog');
    await expect(dialog).toBeVisible();

    const isOpenBefore = await page.evaluate(() => window.__feedbackController!.isOpen());
    expect(isOpenBefore).toBe(true);

    // Simulate a route change / redirect that unmounts the host modal
    // while feedback is nested inside it — no `close` event fires for a
    // node that's merely detached, so the native <dialog> element still
    // thinks it's open.
    await page.evaluate(() => {
      document.querySelector('[role="dialog"][data-state="open"]')?.remove();
    });

    // isOpen() must not keep reporting true for a detached host element.
    const isOpenAfterRemoval = await page.evaluate(() => window.__feedbackController!.isOpen());
    expect(isOpenAfterRemoval).toBe(false);

    // The window-capture Escape guard is still installed (removing the
    // DOM node doesn't remove it) — but it must self-heal on the very
    // next Escape rather than keep eating every Escape on the page.
    await page.evaluate(() => {
      window.__escapeReachedDocument = false;
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Escape') window.__escapeReachedDocument = true;
        },
        { once: true },
      );
    });
    await page.keyboard.press('Escape');
    const reached = await page.evaluate(() => window.__escapeReachedDocument);
    expect(reached).toBe(true);

    // A fresh open() must recover synchronously and actually show
    // feedback again, not silently no-op because it still believed
    // itself open.
    const opened = await page.evaluate(() => {
      const button = document.querySelector('[data-testid="launcher-outside"]') as HTMLButtonElement;
      return window.__feedbackController!.open(button);
    });
    expect(opened).toBe(true);
    await expect(dialog).toBeVisible();
  });
});

test.describe('Item 4 (review r2) — a throwing onEvent must not break the dialog', () => {
  test('onEvent throwing on every call (opened, sent, received) is ignored: the dialog still opens and sends, and Send is never left wedged in its busy state', async ({
    page,
  }) => {
    await page.goto('/vanilla.html');

    // Make the fixture's own onEvent (which just does
    // window.__feedbackEvents.push(event) — see mount-feedback.ts) throw
    // on every call, without touching any fixture page source: monkeypatch
    // the array's own push before the launcher is ever clicked, so even
    // the very first {type:'opened'} event throws.
    await page.evaluate(() => {
      window.__feedbackEvents!.push = () => {
        throw new Error('host onEvent boom');
      };
    });

    await page.getByTestId('launcher').click();
    // opened's onEvent threw and was ignored — the dialog still opened.
    await expect(page.getByTestId('feedback-dialog')).toBeVisible();

    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill('onEvent throws on every event');
    await page.getByTestId('feedback-send').click();

    // sent's onEvent threw too — this is the review-reported failure
    // mode: Send must not be left wedged in its busy state.
    await expect(page.getByTestId('feedback-status')).toHaveText(/^Received · #\d+$/);
    await expect(page.getByTestId('feedback-send')).toHaveAttribute('aria-disabled', 'false');
    await expect(page.getByTestId('feedback-send')).toHaveText('Send');
  });
});

test.describe('Item 4 — noValidate: empty Send reaches our own error summary', () => {
  test('an empty required field on Send shows the focused error summary instead of the browser’s native validation bubble', async ({
    page,
  }) => {
    await page.goto('/vanilla.html');
    await page.getByTestId('launcher').click();
    await expect(page.getByTestId('feedback-dialog')).toBeVisible();

    await page.getByTestId('feedback-send').click();

    const summary = page.getByTestId('feedback-error-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(page.getByTestId('feedback-what')).toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('Items 2 & 3 — duplicate-warning behaviour', () => {
  test('the duplicate warning shows immediately on unconfirmed (no extra "arm" click) and is announced; a following not_sent does not clear it; the same report_id is reused throughout; received finally clears it', async ({
    page,
  }) => {
    await page.goto('/vanilla.html');

    let callCount = 0;
    const capturedReportIds: string[] = [];
    await page.route('**/api/feedback', async (route) => {
      const body = route.request().postDataJSON() as { report_id: string };
      capturedReportIds.push(body.report_id);
      callCount += 1;
      const reply =
        callCount === 1
          ? { status: 'unconfirmed', report_id: body.report_id }
          : callCount === 2
            ? { status: 'not_sent', code: 'rate_limited' }
            : { status: 'received', receipt: '#99' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
    });

    await page.getByTestId('launcher').click();
    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill('duplicate-risk scenario');

    // Attempt 1: unconfirmed.
    await page.getByTestId('feedback-send').click();
    const status = page.getByTestId('feedback-status');
    await expect(status).toContainText('Delivery unconfirmed');
    // Folded into the same live-region text, not a silent, separate banner.
    await expect(status).toContainText(/duplicate/i);
    // Visible immediately — no extra "arm" click needed first.
    await expect(page.getByTestId('feedback-duplicate-warning')).toBeVisible();
    await expect(page.getByTestId('feedback-send')).toHaveText('Send anyway');

    // Attempt 2 (a single click — "Send anyway"): not_sent.
    await page.getByTestId('feedback-send').click();
    await expect(status).toContainText('Not sent');
    // The not_sent must NOT clear the risk carried over from attempt 1.
    await expect(page.getByTestId('feedback-duplicate-warning')).toBeVisible();
    await expect(page.getByTestId('feedback-send')).toHaveText('Send anyway');

    // Attempt 3: received, finally clears it.
    await page.getByTestId('feedback-send').click();
    await expect(status).toContainText('Received');
    await expect(page.getByTestId('feedback-duplicate-warning')).toBeHidden();
    await expect(page.getByTestId('feedback-send')).toHaveText('Send');

    expect(callCount).toBe(3);
    // The exact same report_id travelled on every attempt — never
    // re-minted until Received.
    expect(new Set(capturedReportIds).size).toBe(1);
  });
});

test.describe('Item 5 — an outcome that lands after the dialog closes is shown on the next open', () => {
  test('closing the dialog while a send is in flight (Cancel), then reopening after the response lands, shows the outcome instead of a blank form', async ({
    page,
  }) => {
    await page.goto('/vanilla.html');

    let resolveRoute: (() => void) | undefined;
    const routeGate = new Promise<void>((resolve) => {
      resolveRoute = resolve;
    });
    await page.route('**/api/feedback', async (route) => {
      await routeGate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'received', receipt: '#7' }) });
    });

    await page.getByTestId('launcher').click();
    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill('closes mid-flight');
    await page.getByTestId('feedback-send').click();

    // The request is now in flight (held by routeGate). Close via
    // Cancel — explicit, user-initiated, unlike the Escape-while-sending
    // case the `cancel` listener guards against.
    await page.getByTestId('feedback-cancel').click();
    await expect(page.getByTestId('feedback-dialog')).toBeHidden();

    // Let the held response land while the dialog is closed. There's
    // nothing visible to poll for yet (the dialog is hidden and the
    // fixture has no signal for "the promise chain settled"), so give
    // the fetch → json() → applyDeliveryOutcome chain a short, fixed
    // moment to run before reopening.
    resolveRoute!();
    await page.waitForTimeout(200);

    // Reopen: the outcome from the request that resolved while closed is
    // shown now, not a blank form.
    await page.getByTestId('launcher').click();
    await expect(page.getByTestId('feedback-status')).toHaveText(/^Received · #7$/);
    await expect(page.getByTestId('feedback-what')).toHaveValue('');
  });
});

test.describe('Items 2 & 3 (review r2) — a pending not_sent-with-fields outcome keeps its field errors and gets focus on reopen', () => {
  test('closing while sending, then a not_sent with fields lands while closed: reopening shows the field errors (not silently cleared) and focuses the error summary, not the first radio', async ({
    page,
  }) => {
    await page.goto('/vanilla.html');

    let resolveRoute: (() => void) | undefined;
    const routeGate = new Promise<void>((resolve) => {
      resolveRoute = resolve;
    });
    await page.route('**/api/feedback', async (route) => {
      await routeGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'not_sent', code: 'invalid', fields: ['what_happened'] }),
      });
    });

    await page.getByTestId('launcher').click();
    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill('closes mid-flight, arrives as not_sent with fields');
    await page.getByTestId('feedback-send').click();

    await page.getByTestId('feedback-cancel').click();
    await expect(page.getByTestId('feedback-dialog')).toBeHidden();

    resolveRoute!();
    await page.waitForTimeout(200);

    await page.getByTestId('launcher').click();
    await expect(page.getByTestId('feedback-dialog')).toBeVisible();
    await expect(page.getByTestId('feedback-status')).toContainText('Not sent');

    // The field error is intact — not silently cleared by the reopen's
    // usual fresh-start clearValidationErrors() (the review-reported bug).
    await expect(page.getByTestId('feedback-what')).toHaveAttribute('aria-invalid', 'true');
    const summary = page.getByTestId('feedback-error-summary');
    await expect(summary).toBeVisible();

    // Focus follows the outcome — the error summary takes priority over
    // the status region, and neither is the first field.
    await expect(summary).toBeFocused();
  });
});

test.describe('Item 8 (review r2) — destroy() aborts an in-flight request', () => {
  test('calling destroy() while a send is in flight aborts the underlying fetch instead of leaving it to complete against a torn-down controller', async ({
    page,
  }) => {
    await page.goto('/vanilla.html');

    // Never resolves on its own — this test's whole point is that the
    // *client* aborts it via destroy(), not that the server ever answers.
    await page.route('**/api/feedback', () => new Promise(() => {}));

    // The exact error text for a client-aborted request differs by engine
    // (Chromium: "net::ERR_ABORTED"; WebKit and Firefox use their own
    // wording) — a `requestfailed` for this URL at all is the signal:
    // the route handler above never resolves on its own, so nothing
    // else could make this request fail.
    let sawFailure = false;
    page.on('requestfailed', (request) => {
      if (request.url().includes('/api/feedback')) sawFailure = true;
    });

    await page.getByTestId('launcher').click();
    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill('destroy mid-flight');
    await page.getByTestId('feedback-send').click();

    // Give the fetch a moment to actually leave the page before tearing
    // the controller down.
    await page.waitForTimeout(100);

    await page.evaluate(() => window.__feedbackController?.destroy());

    await expect.poll(() => sawFailure, { timeout: 5000 }).toBe(true);

    // No crash, and the host element this controller ever created is
    // gone — destroy()'s own contract, unaffected by the in-flight abort.
    const hostGone = await page.evaluate(() => document.querySelector('[data-testid="feedback-host"]') === null);
    expect(hostGone).toBe(true);
  });
});

test.describe('Gate R finding 4 — the report fetch never follows a redirect', () => {
  test('a real 307 from POST /api/feedback results in Delivery unconfirmed, exactly one request to /api/feedback, and no request ever reaches the redirect target', async ({
    page,
  }) => {
    // Playwright's `route.fulfill({ status: 307, ... })` is refused on
    // WebKit ("Cannot fulfill with redirect status") — confirmed directly
    // against this checkout, not assumed — so a synthetic redirect can't
    // be built with `fulfill()` alone across all three engines. Instead,
    // a tiny real HTTP server answers with a *genuine* 307, and
    // `route.continue({ url })` retargets the actual network request to
    // it, so the browser's own networking (not Playwright's simulation)
    // is what `fetch`'s `redirect: 'error'` reacts to — the same
    // real-world mechanics a redirecting host would trigger. Port
    // derived from PORT (default 4321) to avoid colliding with another
    // worktree's own fixture run.
    const redirectServerPort = Number(process.env.PORT ?? 4321) + 1000;
    let redirectTargetHit = false;
    const server = createServer((request, response) => {
      if (request.url === '/redirect-me') {
        response.writeHead(307, { location: `http://localhost:${redirectServerPort}/redirected-elsewhere` });
        response.end();
      } else {
        redirectTargetHit = true;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(redirectServerPort, resolve));

    try {
      let feedbackRequestCount = 0;
      await page.route('**/api/feedback', async (route) => {
        feedbackRequestCount += 1;
        await route.continue({ url: `http://localhost:${redirectServerPort}/redirect-me` });
      });
      // Belt-and-braces: if a follow somehow reached back into the page's
      // own origin instead, this would also catch it.
      await page.route('**/redirected-elsewhere', async (route) => {
        redirectTargetHit = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      await page.goto('/vanilla.html');
      await page.getByTestId('launcher').click();
      await page.getByTestId('feedback-kind-bug').check();
      await page.getByTestId('feedback-what').fill('a redirect must not be followed');
      await page.getByTestId('feedback-send').click();

      await expect(page.getByTestId('feedback-status')).toContainText('Delivery unconfirmed');
      expect(redirectTargetHit).toBe(false);
      expect(feedbackRequestCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

test.describe('Gate R finding 5 — unsent draft text survives close and reopen', () => {
  test('type, Cancel, reopen: the text is still there', async ({ page }) => {
    await page.goto('/vanilla.html');
    await page.getByTestId('launcher').click();
    await page.getByTestId('feedback-what').fill('unsent draft text, cancel path');
    await page.getByTestId('feedback-cancel').click();
    await expect(page.getByTestId('feedback-dialog')).toBeHidden();

    await page.getByTestId('launcher').click();
    await expect(page.getByTestId('feedback-what')).toHaveValue('unsent draft text, cancel path');
  });

  test('type, Escape, reopen: the text is still there', async ({ page }) => {
    await page.goto('/vanilla.html');
    await page.getByTestId('launcher').click();
    await page.getByTestId('feedback-what').fill('unsent draft text, escape path');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('feedback-dialog')).toBeHidden();

    await page.getByTestId('launcher').click();
    await expect(page.getByTestId('feedback-what')).toHaveValue('unsent draft text, escape path');
  });

  test('not_sent, edit, close, reopen: the edited text survives — not the text as it stood at the time of the failed Send', async ({
    page,
  }) => {
    await page.goto('/vanilla.html');

    await page.route('**/api/feedback', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'not_sent', code: 'rate_limited' }),
      });
    });

    await page.getByTestId('launcher').click();
    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill('original text that gets refused');
    await page.getByTestId('feedback-send').click();
    await expect(page.getByTestId('feedback-status')).toContainText('Not sent');

    // Edited AFTER the refusal, without resending.
    await page.getByTestId('feedback-what').fill('edited text after the refusal');
    await page.getByTestId('feedback-cancel').click();
    await expect(page.getByTestId('feedback-dialog')).toBeHidden();

    await page.getByTestId('launcher').click();
    await expect(page.getByTestId('feedback-what')).toHaveValue('edited text after the refusal');
  });

  test('the zombie-recovery path (host modal removed while nested) also preserves unsent text', async ({ page }) => {
    await page.goto('/radix.html');
    await page.getByTestId('launcher-inside').click();
    await expect(page.getByTestId('feedback-dialog')).toBeVisible();

    await page.getByTestId('feedback-what').fill('typed just before the host modal disappears');

    await page.evaluate(() => {
      document.querySelector('[role="dialog"][data-state="open"]')?.remove();
    });

    const opened = await page.evaluate(() => {
      const button = document.querySelector('[data-testid="launcher-outside"]') as HTMLButtonElement;
      return window.__feedbackController!.open(button);
    });
    expect(opened).toBe(true);
    await expect(page.getByTestId('feedback-what')).toHaveValue('typed just before the host modal disappears');
  });
});

test.describe('Gate R round 2 finding 2 — pending scroll-restoration frames don’t outlive teardown', () => {
  // The precise, deterministic verification of this fix is the unit test
  // (test/browser/scroll-restore.test.ts, "scheduleDeferredScrollRestore()"):
  // a fake, manually-driven requestAnimationFrame scheduler proves
  // cancel() stops a pass that hasn't fired yet, that a pass already
  // mid-flight still checks the staleness guard, and that neither ever
  // runs after cancellation, without depending on any particular engine's
  // timing. That's deliberate, not merely a preference: reproducing the
  // *exact* race in a real browser — the two frames `showModal()`'s own
  // disturbance schedules must still be pending at the instant destroy()
  // runs — turned out to require timing this task's fixture pages can't
  // reliably pin down any more (see below), and a real-browser test that
  // only sometimes exercises the race it names is worse than an honest
  // one that exercises a related, real invariant instead.
  //
  // This test still exercises the real, nested, destroy()-through-the-
  // host code path end to end, on radix.html — confirmed directly that
  // the underlying disturbance itself never reproduces unnested or
  // against a synthetic `[aria-modal="true"]` container (feedback's
  // `<dialog>` is `position: fixed`, so once promoted to the top layer
  // by `showModal()`, bringing it or a descendant into view generally
  // never needs to scroll a `<body>`-mounted or non-Radix ancestor), so
  // it needs the real fixture page. But task P8's React wrapper landed on
  // radix.html since this task's own r1 pass: `pages/radix.tsx` no
  // longer exposes an imperative `controller.destroy()` at all
  // (`window.__feedbackController.destroy` there is now a deliberate
  // no-op stub — see host-modals.spec.ts's "the guard is also gone once
  // feedback is disabled" test and its own comment); `open` is still
  // bridged through to the real controller (confirmed directly), so
  // destroying goes through the one path that's left — clicking
  // `unmount-feedback`, which flips `<FeedbackProvider>`'s `enabled`
  // prop to `false` and reaches the real destroy() underneath only after
  // React's own state-update and effect-cleanup scheduling. Confirmed
  // directly (temporarily reverting the fix and re-running) that by the
  // time that flip actually completes, both of showModal()'s deferred
  // restore passes have typically already run and settled naturally —
  // there's nothing left pending for destroy() to cancel, so this
  // version of the test passes with or without the fix. It's kept
  // anyway, as a real-world sanity check of the same destroy()-cancels-
  // pending-work code path (the unit test above being the one that
  // actually pins the race down), and its own comments say so rather
  // than overclaiming precision this particular page can't deliver any
  // more.
  test('destroying the controller (disabling feedback) shortly after a nested open leaves the host scroll position exactly where a person set it afterwards', async ({
    page,
  }) => {
    await page.goto('/radix.html');
    await page.getByTestId('grow-host').click();
    const radixContent = page.locator('[role="dialog"][data-state="open"]').first();
    await expect.poll(() => radixContent.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await radixContent.evaluate((el) => {
      el.scrollTop = 400;
    });

    // Opened via a direct open() call, not launcher-inside.click() — see
    // host-modals.spec.ts's "does not reset the host's scroll position"
    // test for why a real Playwright click on this particular button, in
    // this particular fixture layout, is its own confound unrelated to
    // the product code this test means to exercise.
    const opened = await page.evaluate(() => {
      const button = document.querySelector('[data-testid="launcher-inside"]') as HTMLButtonElement;
      return window.__feedbackController!.open(button);
    });
    expect(opened).toBe(true);
    await expect(page.getByTestId('feedback-dialog')).toBeVisible();

    // Disable feedback (destroys the controller underneath) as soon as
    // possible after opening. The native, still-open `<dialog>` blocks
    // real pointer hit-testing on the rest of the page, `unmount-feedback`
    // included, so a direct DOM click is used instead, matching
    // host-modals.spec.ts's own pattern for this exact situation.
    await page.evaluate(() => {
      (document.querySelector('[data-testid="unmount-feedback"]') as HTMLButtonElement).click();
    });
    // The reliable "destroy() actually ran" signal (see above), not a
    // fixed wait: the whole shadow host is gone, not merely hidden.
    await expect(page.getByTestId('feedback-host')).toHaveCount(0);

    // The review's probe: set a new scroll position after destroy has
    // completed, then wait two frames for a (should-be-cancelled) queued
    // restore to have fired if it were going to.
    await radixContent.evaluate((el) => {
      el.scrollTop = 123;
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    const scrollTopAfter = await radixContent.evaluate((el) => el.scrollTop);
    expect(scrollTopAfter).toBe(123);
  });
});
