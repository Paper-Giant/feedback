import { expect, test } from '@playwright/test';

/**
 * Real-browser proof for build plan P9's "Accessibility" group, forced
 * colours (design §3 "Dialog": "system-colour borders in forced-colours
 * mode"; the `@media (forced-colors: active)` rule in
 * `src/browser/styles.ts`). Chromium is the only engine Playwright's
 * `page.emulateMedia({ forcedColors })` supports — WebKit and Firefox
 * both silently ignore the option (there is no Playwright API to force
 * either engine's own forced-colours mode), so this is Chromium-only,
 * skipped elsewhere with a reason rather than silently passing on
 * untested engines.
 *
 * The stylesheet's `@media (forced-colors: active)` block sets the
 * dialog's, the inputs' and the buttons' borders to `CanvasText`, and
 * `button[data-send]` to `Highlight`/`HighlightText` — this checks the
 * *computed* styles once that media query is active differ from the
 * ordinary light-mode fallbacks, rather than trusting the source CSS,
 * and that a focused control still shows a visible (non-transparent,
 * non-zero-width) outline.
 */

test.describe('Forced colours (design §3 "Dialog")', () => {
  test('the dialog, inputs, buttons and focus ring all show visible, non-transparent borders/outlines once forced-colors is active', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Playwright can only emulate forced-colors on Chromium; WebKit and Firefox have no equivalent emulation API.',
    );

    await page.goto('/vanilla.html');
    await page.getByTestId('launcher').click();
    const dialog = page.getByTestId('feedback-dialog');
    await expect(dialog).toBeVisible();

    // Baseline (ordinary light mode) border colour, for comparison below.
    const baselineDialogBorder = await dialog.evaluate((el) => getComputedStyle(el).borderColor);

    await page.emulateMedia({ forcedColors: 'active' });

    const forcedDialogBorder = await dialog.evaluate((el) => getComputedStyle(el).borderColor);
    expect(forcedDialogBorder).not.toBe('transparent');
    expect(forcedDialogBorder).not.toBe('rgba(0, 0, 0, 0)');
    // Proves the `@media (forced-colors: active)` rule actually took
    // effect, rather than just happening to already be non-transparent.
    expect(forcedDialogBorder).not.toBe(baselineDialogBorder);

    const whatBorder = await page.getByTestId('feedback-what').evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.borderColor, width: style.borderWidth };
    });
    expect(whatBorder.color).not.toBe('transparent');
    expect(whatBorder.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(parseFloat(whatBorder.width)).toBeGreaterThan(0);

    const referenceBorder = await page.getByTestId('feedback-reference').evaluate((el) => getComputedStyle(el).borderColor);
    expect(referenceBorder).not.toBe('transparent');
    expect(referenceBorder).not.toBe('rgba(0, 0, 0, 0)');

    const cancelBorder = await page.getByTestId('feedback-cancel').evaluate((el) => getComputedStyle(el).borderColor);
    expect(cancelBorder).not.toBe('transparent');
    expect(cancelBorder).not.toBe('rgba(0, 0, 0, 0)');

    // Send is styled distinctly in forced-colors mode (`Highlight` /
    // `HighlightText`, `forced-color-adjust: none`) — its background
    // must differ from an ordinary transparent/unset value too.
    const sendStyle = await page.getByTestId('feedback-send').evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(sendStyle.background).not.toBe('transparent');
    expect(sendStyle.background).not.toBe('rgba(0, 0, 0, 0)');

    // The focus ring: focus a control and check its outline is visible
    // (non-`none` style, non-zero width, non-transparent colour) — this
    // is what a forced-colors user actually relies on to see where
    // keyboard focus is, since background/border differences alone can
    // be much harder to spot.
    const whatLocator = page.getByTestId('feedback-what');
    await whatLocator.focus();
    const outline = await whatLocator.evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
    });
    expect(outline.style).not.toBe('none');
    expect(parseFloat(outline.width)).toBeGreaterThan(0);
    expect(outline.color).not.toBe('transparent');
    expect(outline.color).not.toBe('rgba(0, 0, 0, 0)');
  });
});
