import { expect, test } from '@playwright/test';

test.describe('vanilla page — harness smoke', () => {
  test('loads, shows the launcher, carries the DOM sentinel', async ({ page }) => {
    await page.goto('/vanilla.html');
    await expect(page.getByTestId('launcher')).toBeVisible();
    await expect(page.getByTestId('sentinel-dom')).toHaveText('SENTINEL_DOM');
    await expect(page.getByTestId('host-form-field')).toHaveValue('SENTINEL_FORM');
  });

  test('the real feedback dialog (mountFeedback, P7) opens from the launcher', async ({ page }) => {
    await page.goto('/vanilla.html');
    await page.getByTestId('launcher').click();

    const opened = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="feedback-host"]');
      const dialog = host?.shadowRoot?.querySelector('[data-testid="feedback-dialog"]') as HTMLDialogElement | null;
      return Boolean(dialog?.open);
    });
    expect(opened).toBe(true);
  });
});
