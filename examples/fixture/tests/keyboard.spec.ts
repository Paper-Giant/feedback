import { expect, test, type Page } from '@playwright/test';

/**
 * Real-browser proof for build plan P9's "Accessibility" group, keyboard
 * half (design §3 "Dialog": "Labels inside the root, error summary, live
 * status, focus returned to the launcher"). Two things this task must
 * prove that no existing spec does:
 *
 *   - Tab forward and Shift+Tab backward through every control, in the
 *     dialog's real order (kind radios as one native radio group, cycled
 *     by arrow keys rather than Tab; `what happened`; `expected` once
 *     kind is Bug; the reference field, allowed on every fixture page;
 *     the Details summary; Cancel; Send) — and that focus never lands on
 *     real host-page content while the dialog is open.
 *   - Escape closes and focus returns to the launcher, on the vanilla and
 *     React 19 pages. The Radix "launcher inside" case is already proven
 *     by `tests/host-modals.spec.ts`'s nesting test (its own final
 *     assertion is `await expect(launcher).toBeFocused()` after Escape),
 *     so it is not repeated here.
 *
 * The dialog relies entirely on the browser's own native `<dialog
 * showModal>` focus trap (design §3: no manual trap is built) — and that
 * native trap turns out to behave differently once the dialog lives
 * inside an open shadow root, in ways this task had to characterise by
 * hand rather than assume (recorded per engine below, not treated as a
 * package defect: nothing in `src/browser/dialog.ts` picks a tab order
 * or intercepts Tab itself; every difference below is the engine's own
 * native `<dialog>`/focus-navigation implementation):
 *   - **Chromium** wraps correctly but via one extra hop onto `<body>`
 *     between Send and the first control — a documented Blink quirk of
 *     recomputing sequential focus navigation on wrap, not specific to
 *     shadow DOM.
 *   - **Firefox** does not wrap forward at all: Tab past Send simply
 *     leaves focus parked on Send (repeatedly), rather than cycling back
 *     to the first control. Shift+Tab back out of the sequence still
 *     works normally.
 *   - **WebKit** (real macOS Safari's own long-standing default: "Tab
 *     moves focus to text fields and lists only", full keyboard access
 *     off) excludes the kind radios and the Cancel/Send buttons from the
 *     Tab sequence entirely — true of every button and radio group on
 *     every website in default Safari, not something this dialog's
 *     markup can opt out of. Those controls stay fully operable by
 *     click/tap and by Space/Enter once focused another way (the rest of
 *     this suite exercises them that way throughout); a person using
 *     Safari with "Full Keyboard Access" turned on gets the same
 *     sequence Chromium and Firefox show below.
 * In every engine, the one property that actually matters for a modal —
 * focus never lands on real host-page content while the dialog is open —
 * holds; the last test below checks that directly, engine differences
 * and all.
 */

/** Walks through any open shadow roots to find the element that's really
 * focused — `document.activeElement` alone only ever returns the shadow
 * host for an open shadow root, never a descendant inside it. */
async function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    let el: Element | null = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el ? el.getAttribute('data-testid') : null;
  });
}

async function focusedTagName(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    let el: Element | null = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el?.tagName.toLowerCase();
  });
}

async function openDialog(page: Page): Promise<void> {
  await page.getByTestId('launcher').click();
  await expect(page.getByTestId('feedback-dialog')).toBeVisible();
}

test.describe('Keyboard traversal — the core fields (identical on every engine)', () => {
  test('kind radios (arrow-key group) → what → expected (once Bug is selected) → reference, and the exact reverse with Shift+Tab', async ({
    page,
  }) => {
    await page.goto('/vanilla.html');
    await openDialog(page);

    // Opening focuses the first kind radio (help — the first of KINDS,
    // regardless of which one is checked).
    await expect.poll(() => focusedTestId(page)).toBe('feedback-kind-help');

    // Arrow keys move *within* the radio group and select as they go —
    // native `<input type="radio">` behaviour, not anything this
    // package implements — landing on Bug, which also reveals the
    // `expected` field (design: "one optional... for bugs").
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-kind-bug');
    await expect(page.getByTestId('feedback-kind-bug')).toBeChecked();
    await expect(page.getByTestId('feedback-expected')).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-kind-idea');
    await expect(page.getByTestId('feedback-expected')).toBeHidden();

    // Back to Bug for the rest of this test, so `expected` stays in play.
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-kind-bug');
    await expect(page.getByTestId('feedback-expected')).toBeVisible();

    await page.keyboard.press('Tab');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-what');
    await page.keyboard.press('Tab');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-expected');
    await page.keyboard.press('Tab');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-reference');

    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-expected');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-what');
    // One more Shift+Tab, back onto the radio group, is Chromium/Firefox
    // vs. WebKit territory (like Cancel/Send below) — asserted in the
    // next describe block instead of here.
  });
});

test.describe('Keyboard traversal — the kind radio group, Details summary, Cancel, Send (Chromium and Firefox include these in the default Tab order; WebKit does not — see file header)', () => {
  test('Shift+Tab from what reaches the kind radio group; the Details summary follows reference, then Cancel then Send, and Shift+Tab reverses the same way', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      "Safari's own default Tab order (\"text fields and lists only\", full keyboard access off) excludes buttons and radio groups — see this file's header comment.",
    );

    await page.goto('/vanilla.html');
    await openDialog(page);
    await page.keyboard.press('ArrowRight'); // -> bug, so `expected` is in play too

    await page.getByTestId('feedback-what').focus();
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-kind-bug');

    await page.getByTestId('feedback-reference').focus();
    await page.keyboard.press('Tab');
    expect(await focusedTagName(page)).toBe('summary');
    await page.keyboard.press('Tab');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-cancel');
    await page.keyboard.press('Tab');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-send');

    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-cancel');
    await page.keyboard.press('Shift+Tab');
    expect(await focusedTagName(page)).toBe('summary');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => focusedTestId(page)).toBe('feedback-reference');
  });

  test('WebKit: the radio group is skipped by Shift+Tab from what, and Tab from reference reaches the Details summary then leaves the Tab-reachable sequence (skipping Cancel and Send, per Safari’s default) — every one of them stays fully operable by click', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'webkit', 'documents the WebKit-specific default; see the Chromium/Firefox test above for the rest');

    await page.goto('/vanilla.html');
    await openDialog(page);
    await page.keyboard.press('ArrowRight'); // -> bug

    await page.getByTestId('feedback-what').focus();
    await page.keyboard.press('Shift+Tab');
    // Not 'feedback-kind-bug': Safari's default Tab order excludes the
    // radio group too, same reason as the buttons below.
    expect(await focusedTestId(page)).not.toBe('feedback-kind-bug');

    await page.getByTestId('feedback-reference').focus();
    await page.keyboard.press('Tab');
    expect(await focusedTagName(page)).toBe('summary');
    await page.keyboard.press('Tab');
    // Not 'feedback-cancel': Safari's default Tab order has already moved
    // on past both buttons.
    expect(await focusedTestId(page)).not.toBe('feedback-cancel');
    expect(await focusedTestId(page)).not.toBe('feedback-send');

    // Still fully usable — every other spec in this suite drives Send and
    // Cancel by click, which is exactly how a default-configuration
    // Safari user reaches them too.
    await page.getByTestId('feedback-cancel').click();
    await expect(page.getByTestId('feedback-dialog')).toBeHidden();
  });
});

/**
 * True unless focus is on real host-page content: inside the feedback
 * shadow root, on the shadow host `<div>` itself, or on `<body>` (the
 * transient landing spot Chromium and Firefox use — see the file header)
 * are all "safe"; a host-page control such as the launcher or the host
 * form field is not.
 */
async function focusIsSafe(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="feedback-host"]');
    let el: Element | null = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    const insideShadow = Boolean(host?.shadowRoot && el && host.shadowRoot.contains(el));
    return insideShadow || el === document.body || el === host;
  });
}

test.describe('Keyboard traversal — focus never lands on real host-page content', () => {
  test('repeatedly pressing Tab past the dialog’s own last reachable control never focuses the launcher or the host form field', async ({
    page,
  }) => {
    await page.goto('/vanilla.html');
    await openDialog(page);
    await page.keyboard.press('ArrowRight'); // -> bug

    // Walk to the end of what Tab can reach (works for every engine: on
    // WebKit this stops mattering past `reference`/the summary, since
    // Tab already can't reach Cancel/Send there — see the describe block
    // above — but pressing it a few more times is exactly the "keep
    // going past the end" case this test is for).
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
    }
    // A few more for good measure — this is where Chromium's body-hop
    // and Firefox's "parked on Send" behaviour would, if they were ever
    // going to, leak focus out to the page underneath.
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      const testid = await focusedTestId(page);
      expect(testid).not.toBe('launcher');
      expect(testid).not.toBe('host-form-field');
      expect(await focusIsSafe(page)).toBe(true);
    }

    // And the same going backward.
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Shift+Tab');
      const testid = await focusedTestId(page);
      expect(testid).not.toBe('launcher');
      expect(testid).not.toBe('host-form-field');
      expect(await focusIsSafe(page)).toBe(true);
    }
  });
});

test.describe('Escape closes and focus returns to the launcher', () => {
  for (const pageName of ['vanilla', 'react19'] as const) {
    test(`${pageName} page: Escape closes the dialog and focus returns to the launcher that opened it`, async ({ page }) => {
      await page.goto(`/${pageName}.html`);
      const launcher = page.getByTestId('launcher');
      await launcher.click();
      const dialog = page.getByTestId('feedback-dialog');
      await expect(dialog).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(launcher).toBeFocused();
    });
  }
});
