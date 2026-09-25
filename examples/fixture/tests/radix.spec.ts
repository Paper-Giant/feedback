import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { STUB_URL } from '../constants.ts';

test.describe('radix page — harness smoke', () => {
  test('loads, the host dialog is open, and the DOM sentinel is present', async ({ page }) => {
    await page.goto('/radix.html');
    await expect(page.getByTestId('sentinel-dom')).toHaveText('SENTINEL_DOM');
    await expect(page.getByTestId('host-draft')).toHaveValue('SENTINEL_FORM');
  });

  test('the three launcher variants and the nested dialog trigger are present', async ({ page }) => {
    await page.goto('/radix.html');
    await expect(page.getByTestId('launcher-inside')).toBeVisible();
    // Behind the overlay, but present in the DOM per the design's refusal case.
    await expect(page.getByTestId('launcher-outside')).toBeAttached();
    await expect(page.getByTestId('open-nested')).toBeVisible();

    await page.getByTestId('open-nested').click();
    await expect(page.getByTestId('launcher-nested-2')).toBeVisible();
  });

  test('window.__hostSpies exists and starts at zero', async ({ page }) => {
    await page.goto('/radix.html');
    const spies = await page.evaluate(() => window.__hostSpies);
    expect(spies).toEqual({ escapeCalls: 0, openChangeCalls: 0, navigateCalls: [] });
  });

  test('the real feedback dialog (mountFeedback, P7) opens from the inside launcher, nested', async ({ page }) => {
    await page.goto('/radix.html');
    await page.getByTestId('launcher-inside').click();

    const opened = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="feedback-host"]');
      const dialog = host?.shadowRoot?.querySelector('[data-testid="feedback-dialog"]') as HTMLDialogElement | null;
      return Boolean(dialog?.open);
    });
    expect(opened).toBe(true);

    // The feedback host element should be mounted *inside* the Radix dialog
    // content, not appended to <body> — design §3 "Host modals".
    const nestedInsideRadixContent = await page.evaluate(() => {
      const radixContent = document.querySelector('[role="dialog"][data-state="open"]');
      const host = document.querySelector('[data-testid="feedback-host"]');
      return Boolean(radixContent && host && radixContent.contains(host));
    });
    expect(nestedInsideRadixContent).toBe(true);
  });

  test('the page\'s <FeedbackArea name="radix"> is sent as the report area, and reaches the rendered ticket via server.ts\'s real `areas` map (task P6/P8)', async ({
    page,
    request,
  }) => {
    await request.post(`${STUB_URL}/__reset`);
    await request.post('/__reset');
    await page.goto('/radix.html');
    await page.getByTestId('launcher-inside').click();
    const dialog = page.getByTestId('feedback-dialog');
    await expect(dialog).toBeVisible();

    const marker = `area-check-${randomUUID()}`;
    await page.getByTestId('feedback-kind-bug').check();
    await page.getByTestId('feedback-what').fill(marker);
    await page.getByTestId('feedback-send').click();
    await expect(page.getByTestId('feedback-status')).toHaveText(/^Received/);

    // What the browser actually sent...
    const outbound = await (await request.get('/__outbound')).json();
    expect(JSON.parse(outbound.body).area).toBe('radix');

    // ...and what the server rendered into the ticket it filed with the
    // stub, proving 'radix' also reached server.ts's own `areas` map
    // (`radix: 'examples/fixture/pages/radix.html'`) — a title of
    // `[Fixture] Bug · radix`, not `· unknown` — not merely the raw
    // outbound payload (the same pattern delivery.spec.ts uses).
    const { issues } = await (await request.get(`${STUB_URL}/__issues`)).json();
    const recorded = issues.find(
      (issue: { body?: { body?: string } }) => typeof issue.body?.body === 'string' && issue.body.body.includes(marker),
    );
    expect(recorded).toBeTruthy();
    expect(recorded.body.title).toBe('[Fixture] Bug · radix');
  });

  test('the grow-host toggle overflows the dialog content element, which scrolls to its own boundary', async ({
    page,
  }) => {
    await page.goto('/radix.html');
    // The content element is the scroller (per a host's wizard dialog's own
    // `.modal` stylesheet), not some inner box — so measure the open dialog itself.
    const dialog = page.locator('[role="dialog"][data-state="open"]').first();

    const before = await dialog.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(before).toBe(false);

    await page.getByTestId('grow-host').click();

    const after = await dialog.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(after).toBe(true);

    const reachedBottomBoundary = await dialog.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop >= el.scrollHeight - el.clientHeight - 1;
    });
    expect(reachedBottomBoundary).toBe(true);
  });
});
