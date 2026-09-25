import { expect, test } from '@playwright/test';

/**
 * Task P10: real-browser proof, on all three engines, that the
 * framework-free surface (`mountFeedback()` + `mountLauncher()`, task P7)
 * works with no React installed anywhere in this project — open, send,
 * receive. Same interaction pattern as `examples/fixture/tests/delivery.spec.ts`.
 */

test.beforeEach(async ({ page }) => {
  await page.request.post('/__reset');
});

test('opens, sends, and receives — vanilla (no React)', async ({ page }) => {
  await page.goto('/');

  // Both entry points this consumer wires up (pages/app.ts) are present:
  // the in-page button (mountFeedback()'s controller.open()) and the
  // side-tab launcher (mountLauncher()).
  await expect(page.locator('[data-feedback-launcher]')).toBeVisible();

  await page.getByTestId('launcher').click();
  const dialog = page.getByTestId('feedback-dialog');
  await expect(dialog).toBeVisible();

  await page.getByTestId('feedback-kind-bug').check();
  await page.getByTestId('feedback-what').fill('vanilla example — end-to-end delivery smoke');
  await page.getByTestId('feedback-send').click();

  const status = page.getByTestId('feedback-status');
  await expect(status).toHaveText(/^Received · #\d+$/);
});
