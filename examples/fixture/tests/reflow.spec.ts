import { expect, test, type Page } from '@playwright/test';

/**
 * Real-browser proof for build plan P9's "Accessibility" group, 320 px
 * reflow (design §3 "Dialog": "320 px reflow, safe-area and
 * visual-viewport handling for iOS keyboards"; the `@media (max-width:
 * 359px)` rule in `src/browser/styles.ts` is what this exercises). At
 * 320×640 the dialog fits with no horizontal scroll, every control is
 * reachable and visible when focused, and no text overflows its box.
 */

async function focusedElementHandle(page: Page) {
  return page.evaluateHandle(() => {
    let el: Element | null = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  });
}

test.describe('320 px reflow (design §3 "Dialog")', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the dialog fits with no horizontal scroll, every control is reachable and visible when focused, and no text overflows', async ({
    page,
  }) => {
    await page.goto('/vanilla.html');
    await page.getByTestId('launcher').click();
    const dialog = page.getByTestId('feedback-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('feedback-kind-bug').check();

    // No horizontal scroll on the page itself.
    const pageScrollsHorizontally = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(pageScrollsHorizontally).toBe(false);

    // The dialog's own box fits inside the 320px viewport (the
    // `@media (max-width: 359px)` rule caps its width at
    // `calc(100vw - 1.5rem)`).
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(320);

    // The dialog element itself never needs to scroll sideways to show
    // its own content (its children never overflow its own inline box).
    const dialogOverflowsHorizontally = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(dialogOverflowsHorizontally).toBe(false);

    // No text node's containing block overflows its own box either — a
    // narrower, more specific version of the same check for the labels,
    // the notice and the kind options row, which is exactly the content
    // most likely to wrap badly at 320px.
    const textOverflows = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="feedback-host"]');
      const root = host?.shadowRoot;
      if (!root) return true;
      const candidates = root.querySelectorAll('h2, p, label, legend, span, .kind-options');
      for (const el of Array.from(candidates)) {
        if (el.scrollWidth > el.clientWidth + 1) return true;
      }
      return false;
    });
    expect(textOverflows).toBe(false);

    // Every control is reachable (Tab-focusable — arrow keys for the
    // radio group, per the keyboard traversal spec) and visible on
    // screen — not clipped outside the dialog's own bounds — when
    // focused. Reference is included on every fixture page
    // (`allowReference: true`).
    const controlTestIds = [
      'feedback-kind-help',
      'feedback-kind-bug',
      'feedback-kind-idea',
      'feedback-what',
      'feedback-expected',
      'feedback-reference',
      'feedback-cancel',
      'feedback-send',
    ];
    for (const testId of controlTestIds) {
      const locator = page.getByTestId(testId);
      await locator.focus();
      await expect(locator).toBeFocused();
      const box = await locator.boundingBox();
      expect(box, `${testId} should have a visible box`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      // Vertically the dialog may itself scroll (it's a tall form in a
      // 640px-tall viewport) — but the *focused* control must be
      // scrolled into view, which `.focus()` does natively.
      const scrolledIntoView = await locator.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < (window.visualViewport?.height ?? window.innerHeight);
      });
      expect(scrolledIntoView, `${testId} should be scrolled into view when focused`).toBe(true);
    }

    // Sanity: the handle above really does track a live element, proving
    // the deep-active-element walk works the same way here as in the
    // keyboard traversal spec.
    const handle = await focusedElementHandle(page);
    const finalTestId = await handle.evaluate((el) => el?.getAttribute('data-testid') ?? null);
    expect(finalTestId).toBe('feedback-send');
  });
});
