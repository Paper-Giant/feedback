import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { STUB_URL } from '../constants.ts';

/**
 * Real-browser proof for task P7's basic delivery flow and the design §4
 * "Never captured" collection boundary, on the vanilla and React 19 pages
 * (build plan P9's "Delivery" and "Collection boundary" groups — the
 * "open, submit, received" and sentinel-boundary items specifically; the
 * fuller delivery matrix — not_sent, GitHub-side and host-side
 * ambiguity — stays `test.fixme` in `p9.fixme.spec.ts` as a P9 task).
 */

async function resetHarness(page: Page): Promise<void> {
  await page.request.post(`${STUB_URL}/__reset`);
  await page.request.post('/__reset');
}

async function sendReport(page: Page, marker: string): Promise<void> {
  await page.getByTestId('launcher').click();
  const dialog = page.getByTestId('feedback-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('feedback-kind-bug').check();
  await page.getByTestId('feedback-what').fill(marker);
  await page.getByTestId('feedback-send').click();
}

for (const pageName of ['vanilla', 'react19'] as const) {
  test.describe(`${pageName} page — delivery`, () => {
    test.beforeEach(async ({ page }) => {
      await resetHarness(page);
    });

    test('open, type, Send → "Received · #n", and the stub recorded the issue', async ({ page, request }) => {
      const marker = `delivery-${pageName}-${randomUUID()}`;
      await page.goto(`/${pageName}.html`);

      await sendReport(page, marker);

      const status = page.getByTestId('feedback-status');
      await expect(status).toHaveText(/^Received · #\d+$/);

      const { issues } = await (await request.get(`${STUB_URL}/__issues`)).json();
      // The stub records what the handler sent GitHub: the rendered ticket (title, markdown body, labels),
      // with the reporter's text fenced inside section 1.
      const recorded = issues.find(
        (issue: { body?: { body?: string } }) => typeof issue.body?.body === 'string' && issue.body.body.includes(marker),
      );
      expect(recorded).toBeTruthy();
      expect(recorded.body.title).toBe('[Fixture] Bug · unknown');
      expect(recorded.body.labels).toEqual(expect.arrayContaining(['source:in-app', 'kind:bug']));
    });

    test('the draft is cleared after Received: reopening shows a blank form', async ({ page }) => {
      const marker = `clear-${pageName}-${randomUUID()}`;
      await page.goto(`/${pageName}.html`);
      await sendReport(page, marker);
      await expect(page.getByTestId('feedback-status')).toHaveText(/^Received/);

      await page.getByTestId('feedback-cancel').click();
      await page.getByTestId('launcher').click();
      await expect(page.getByTestId('feedback-what')).toHaveValue('');
    });
  });

  test.describe(`${pageName} page — collection boundary (design §4 "Never captured")`, () => {
    test.beforeEach(async ({ page }) => {
      await resetHarness(page);
    });

    test('no sentinel placed in the URL path, query string, page DOM or the host form reaches the captured outbound request — headers or body — and there is no Referer header', async ({
      page,
      request,
    }) => {
      // Sentinels: SENTINEL_DOM is static page text, SENTINEL_FORM is the
      // host form's own prefilled field value (README "Sentinel strings"),
      // and SENTINEL_QUERY / a path segment are added by this navigation.
      await page.goto(`/${pageName}.html/SENTINEL_PATH?secret=SENTINEL_QUERY`);
      await expect(page.getByTestId('sentinel-dom')).toHaveText('SENTINEL_DOM');
      await expect(page.getByTestId('host-form-field')).toHaveValue('SENTINEL_FORM');

      const marker = `boundary-${pageName}-${randomUUID()}`;
      await sendReport(page, marker);
      await expect(page.getByTestId('feedback-status')).toHaveText(/^Received · #\d+$/);

      const outbound = await (await request.get('/__outbound')).json();
      const headerBlob = JSON.stringify(outbound.headers ?? {});
      const bodyBlob: string = outbound.body ?? '';

      for (const sentinel of ['SENTINEL_PATH', 'SENTINEL_QUERY', 'SENTINEL_DOM', 'SENTINEL_FORM']) {
        expect(headerBlob).not.toContain(sentinel);
        expect(bodyBlob).not.toContain(sentinel);
      }

      // A default same-origin fetch POST would carry this page's own URL
      // (path and query, sentinels included) in `Referer`; mountFeedback
      // sends `referrerPolicy: 'no-referrer'` specifically to prevent
      // that (design §5 "Transport").
      const headerNames = Object.keys(outbound.headers ?? {}).map((name) => name.toLowerCase());
      expect(headerNames).not.toContain('referer');

      // Sanity: this really was the report just sent, not a stale capture.
      expect(bodyBlob).toContain(marker);
    });
  });
}
