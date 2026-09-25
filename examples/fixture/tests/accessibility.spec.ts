import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Real-browser proof for build plan P9's "Accessibility" group, axe half:
 * design §3 "Dialog" ("Tests run in a real browser with axe; jsdom cannot
 * open a modal dialog"). Scans the feedback dialog itself — shadow root
 * included, axe pierces open shadow roots without any extra configuration
 * — in each of the states design §5 names, against the WCAG 2.1 A/AA
 * rule tags. Every state is driven from the vanilla page; the dialog's
 * own markup, shadow root and stylesheet (task P7) are identical
 * regardless of which host framework mounted it, so this does not repeat
 * per page the way the delivery matrix (task P9, `delivery-matrix.spec.ts`)
 * does.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scanDialog(page: Page) {
  return new AxeBuilder({ page })
    // A two-element array is axe-core's own syntax for a selector that
    // pierces a shadow boundary: the host in light DOM, then a selector
    // resolved inside its shadow root (axe-core's "context object"
    // spec) — a plain string selector for `feedback-dialog` alone finds
    // nothing, since that element only exists inside the shadow root
    // `mountFeedback()` (task P7) opens on the host below.
    .include([['[data-testid="feedback-host"]', '[data-testid="feedback-dialog"]']])
    .withTags(WCAG_TAGS)
    .analyze();
}

async function openDialog(page: Page): Promise<void> {
  await page.getByTestId('launcher').click();
  await expect(page.getByTestId('feedback-dialog')).toBeVisible();
}

test.describe('Accessibility — axe on the feedback dialog, per delivery state (design §5)', () => {
  test('open empty: zero violations', async ({ page }) => {
    await page.goto('/vanilla.html');
    await openDialog(page);

    const results = await scanDialog(page);
    expect(results.violations).toEqual([]);
  });

  test('validation errors (empty required field, Send clicked): zero violations', async ({ page }) => {
    await page.goto('/vanilla.html');
    await openDialog(page);
    await page.getByTestId('feedback-send').click();
    await expect(page.getByTestId('feedback-error-summary')).toBeVisible();

    const results = await scanDialog(page);
    expect(results.violations).toEqual([]);
  });

  test('sending (a held response): zero violations', async ({ page }) => {
    await page.goto('/vanilla.html');
    let resolveRoute: (() => void) | undefined;
    const routeGate = new Promise<void>((resolve) => {
      resolveRoute = resolve;
    });
    await page.route('**/api/feedback', async (route) => {
      await routeGate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'received', receipt: '#1' }) });
    });

    await openDialog(page);
    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill('a11y sending state');
    await page.getByTestId('feedback-send').click();
    await expect(page.getByTestId('feedback-send')).toHaveText('Sending…');

    const results = await scanDialog(page);
    expect(results.violations).toEqual([]);

    resolveRoute!();
  });

  test('received: zero violations', async ({ page }) => {
    await page.goto('/vanilla.html');
    await page.route('**/api/feedback', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'received', receipt: '#42' }) });
    });

    await openDialog(page);
    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill('a11y received state');
    await page.getByTestId('feedback-send').click();
    await expect(page.getByTestId('feedback-status')).toHaveText(/^Received/);

    const results = await scanDialog(page);
    expect(results.violations).toEqual([]);
  });

  test('not sent: zero violations', async ({ page }) => {
    await page.goto('/vanilla.html');
    await page.route('**/api/feedback', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'not_sent', code: 'rate_limited' }) });
    });

    await openDialog(page);
    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill('a11y not sent state');
    await page.getByTestId('feedback-send').click();
    await expect(page.getByTestId('feedback-status')).toContainText('Not sent');

    const results = await scanDialog(page);
    expect(results.violations).toEqual([]);
  });

  test('unconfirmed (duplicate warning visible): zero violations', async ({ page }) => {
    await page.goto('/vanilla.html');
    await page.route('**/api/feedback', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'unconfirmed', report_id: 'a11y-unconfirmed' }) });
    });

    await openDialog(page);
    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill('a11y unconfirmed state');
    await page.getByTestId('feedback-send').click();
    await expect(page.getByTestId('feedback-status')).toContainText('Delivery unconfirmed');
    await expect(page.getByTestId('feedback-duplicate-warning')).toBeVisible();

    const results = await scanDialog(page);
    expect(results.violations).toEqual([]);
  });
});
