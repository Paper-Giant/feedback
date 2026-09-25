import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { STUB_URL } from '../constants.ts';

/**
 * Real-browser proof for build plan P9's "Delivery" group — the full
 * matrix, driven through the actual dialog UI (not a mocked response, per
 * `tests/review-fixes.spec.ts`'s duplicate-warning tests, and not a raw
 * `fetch()`, per `tests/api.spec.ts`'s handler-refusal tests): every case
 * below goes through a real click on Send against the real handler
 * (task P6), the real stub GitHub, and — for the host-side cases — the
 * real host response tampering documented in `server.ts` and the
 * README's "Host-side response ambiguity".
 *
 * *Not sent* (a definitive refusal): the draft is kept and the right
 * message is shown, for each of the three ways P9 names —
 * `status:422` (a definitive stub refusal → `tracker_refused`),
 * `fixture-anon=1` (identify() returns null → `unauthenticated`), and a
 * sixth report inside the ten-minute window (→ `rate_limited`).
 *
 * *Unconfirmed*, from host-to-GitHub ambiguity (`record-then-drop`, and
 * `hang` against the fixture's short sink timeout) and from
 * browser-to-host ambiguity (`drop-response`, `corrupt-response`,
 * `html-response`): each shows the duplicate warning, keeps the draft,
 * reuses the same `report_id` on "Send anyway" (read from `/__outbound`,
 * since that is the raw wire body, not something read back off the
 * form), and proves no automatic retry happened — the stub's recorded
 * issue count does not move until the person clicks Send again, and a
 * running count of the page's own `POST /api/feedback` calls never
 * exceeds one per click.
 */

async function resetHarness(page: Page): Promise<void> {
  await page.request.post(`${STUB_URL}/__reset`);
  await page.request.post('/__reset');
}

async function openDialog(page: Page): Promise<void> {
  await page.getByTestId('launcher').click();
  await expect(page.getByTestId('feedback-dialog')).toBeVisible();
}

async function fillDraft(page: Page, marker: string): Promise<void> {
  await page.getByTestId('feedback-kind-bug').check();
  await page.getByTestId('feedback-what').fill(marker);
}

async function lastOutboundReportId(page: Page): Promise<string> {
  const outbound = await (await page.request.get('/__outbound')).json();
  const body = JSON.parse(outbound.body as string) as { report_id: string };
  return body.report_id;
}

async function issuesMatching(page: Page, marker: string): Promise<Array<{ body: { body?: string } }>> {
  const { issues } = await (await page.request.get(`${STUB_URL}/__issues`)).json();
  return issues.filter(
    (issue: { body?: { body?: string } }) => typeof issue.body?.body === 'string' && issue.body.body.includes(marker),
  );
}

/** Counts this page's own `POST /api/feedback` calls, so "no automatic
 * retry" is checked against real network traffic, not only against the
 * stub's recorded-issue count (which a genuine retry could also leave
 * looking like exactly one, if the retry itself failed the same way). */
function countFeedbackPosts(page: Page): { count: () => number } {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/feedback') count += 1;
  });
  return { count: () => count };
}

for (const pageName of ['vanilla', 'react19'] as const) {
  test.describe(`${pageName} page — delivery matrix (not sent)`, () => {
    test.beforeEach(async ({ page }) => {
      await resetHarness(page);
    });

    test('a definitive stub refusal (422 → tracker_refused): "Not sent", the credential message, and the draft is kept', async ({
      page,
      request,
    }) => {
      await request.post(`${STUB_URL}/__control`, { data: { behaviour: 'status:422' } });
      await page.goto(`/${pageName}.html`);
      const marker = `not-sent-refused-${pageName}-${randomUUID()}`;
      await openDialog(page);
      await fillDraft(page, marker);
      await page.getByTestId('feedback-send').click();

      const status = page.getByTestId('feedback-status');
      await expect(status).toContainText('Not sent');
      await expect(status).toContainText('This can’t be sent right now');
      await expect(page.getByTestId('feedback-what')).toHaveValue(marker);
      await expect(page.getByTestId('feedback-duplicate-warning')).toBeHidden();
      await expect(page.getByTestId('feedback-send')).toHaveText('Send');

      const recorded = await issuesMatching(page, marker);
      expect(recorded).toHaveLength(0);
    });

    test('the fixture-anon=1 cookie (unauthenticated): "Not sent", the credential message, and the draft is kept', async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: 'fixture-anon', value: '1', url: baseURL! }]);
      await page.goto(`/${pageName}.html`);
      const marker = `not-sent-unauth-${pageName}-${randomUUID()}`;
      await openDialog(page);
      await fillDraft(page, marker);
      await page.getByTestId('feedback-send').click();

      const status = page.getByTestId('feedback-status');
      await expect(status).toContainText('Not sent');
      await expect(status).toContainText('This can’t be sent right now');
      await expect(page.getByTestId('feedback-what')).toHaveValue(marker);
      await expect(page.getByTestId('feedback-duplicate-warning')).toBeHidden();

      const recorded = await issuesMatching(page, marker);
      expect(recorded).toHaveLength(0);
    });

    test('the sixth report in ten minutes (rate_limited): "Not sent", the rate-limit message, and the draft is kept', async ({
      page,
    }) => {
      await page.goto(`/${pageName}.html`);

      // Five reports through the real UI, each received, to actually
      // exhaust the per-subject quota rather than assume it — the same
      // shared, single-instance limiter server.ts wires up for every
      // page (design §5: "one quota domain per database" — here, per
      // fixture identity, shared across pages).
      for (let i = 0; i < 5; i += 1) {
        await openDialog(page);
        await fillDraft(page, `rate-limit-warm-${pageName}-${i}-${randomUUID()}`);
        await page.getByTestId('feedback-send').click();
        await expect(page.getByTestId('feedback-status'), `warm-up send ${i + 1} of 5 should be received`).toHaveText(
          /^Received · #\d+$/,
        );
        await page.getByTestId('feedback-cancel').click();
      }

      const marker = `rate-limit-sixth-${pageName}-${randomUUID()}`;
      await openDialog(page);
      await fillDraft(page, marker);
      await page.getByTestId('feedback-send').click();

      const status = page.getByTestId('feedback-status');
      await expect(status).toContainText('Not sent');
      await expect(status).toContainText('Too many reports for now');
      await expect(page.getByTestId('feedback-what')).toHaveValue(marker);

      const recorded = await issuesMatching(page, marker);
      expect(recorded).toHaveLength(0);
    });
  });

  test.describe(`${pageName} page — delivery matrix (unconfirmed, host-to-GitHub ambiguity)`, () => {
    test.beforeEach(async ({ page }) => {
      await resetHarness(page);
    });

    test('record-then-drop: unconfirmed, draft kept, duplicate warning, one issue recorded until Send anyway reuses the same report_id (then two)', async ({
      page,
      request,
    }) => {
      const tracker = countFeedbackPosts(page);
      await page.goto(`/${pageName}.html`);
      const marker = `unconfirmed-record-drop-${pageName}-${randomUUID()}`;
      await openDialog(page);
      await fillDraft(page, marker);

      await request.post(`${STUB_URL}/__control`, { data: { behaviour: 'record-then-drop' } });
      await page.getByTestId('feedback-send').click();

      const status = page.getByTestId('feedback-status');
      await expect(status).toContainText('Delivery unconfirmed');
      await expect(status).toContainText(/duplicate/i);
      await expect(page.getByTestId('feedback-duplicate-warning')).toBeVisible();
      await expect(page.getByTestId('feedback-what')).toHaveValue(marker);
      await expect(page.getByTestId('feedback-send')).toHaveText('Send anyway');
      expect(tracker.count()).toBe(1);

      // GitHub actually did the work — the stub recorded it — but the
      // connection was dropped before the browser found out.
      let recorded = await issuesMatching(page, marker);
      expect(recorded).toHaveLength(1);
      const reportId1 = await lastOutboundReportId(page);

      // No automatic retry: the recorded count does not move on its own.
      await page.waitForTimeout(300);
      recorded = await issuesMatching(page, marker);
      expect(recorded).toHaveLength(1);
      expect(tracker.count()).toBe(1);

      // "Send anyway" — the stub's single-shot behaviour already reverted
      // to "succeed", so this one actually goes through.
      await page.getByTestId('feedback-send').click();
      await expect(status).toHaveText(/^Received · #\d+$/);
      await expect(page.getByTestId('feedback-duplicate-warning')).toBeHidden();
      expect(tracker.count()).toBe(2);

      recorded = await issuesMatching(page, marker);
      expect(recorded).toHaveLength(2);
      const reportId2 = await lastOutboundReportId(page);
      expect(reportId2).toBe(reportId1);
      for (const issue of recorded) {
        expect(issue.body.body).toContain(reportId1);
      }
    });

    test('hang: unconfirmed within the short sink timeout, draft kept, duplicate warning, no issue recorded until Send anyway reuses the same report_id', async ({
      page,
      request,
    }) => {
      const tracker = countFeedbackPosts(page);
      await page.goto(`/${pageName}.html`);
      const marker = `unconfirmed-hang-${pageName}-${randomUUID()}`;
      await openDialog(page);
      await fillDraft(page, marker);

      await request.post(`${STUB_URL}/__control`, { data: { behaviour: 'hang' } });
      const startedAt = Date.now();
      await page.getByTestId('feedback-send').click();

      const status = page.getByTestId('feedback-status');
      await expect(status).toContainText('Delivery unconfirmed');
      expect(Date.now() - startedAt).toBeLessThan(10_000);
      await expect(page.getByTestId('feedback-duplicate-warning')).toBeVisible();
      await expect(page.getByTestId('feedback-what')).toHaveValue(marker);
      await expect(page.getByTestId('feedback-send')).toHaveText('Send anyway');
      expect(tracker.count()).toBe(1);

      // "hang" never records anything on the stub — GitHub itself never
      // got a reply out either — so unlike the other ambiguity cases
      // there is nothing recorded yet at all.
      let recorded = await issuesMatching(page, marker);
      expect(recorded).toHaveLength(0);
      const reportId1 = await lastOutboundReportId(page);

      await page.getByTestId('feedback-send').click();
      await expect(status).toHaveText(/^Received · #\d+$/);
      expect(tracker.count()).toBe(2);

      recorded = await issuesMatching(page, marker);
      expect(recorded).toHaveLength(1);
      const reportId2 = await lastOutboundReportId(page);
      expect(reportId2).toBe(reportId1);
      expect(recorded[0]!.body.body).toContain(reportId1);
    });
  });

  test.describe(`${pageName} page — delivery matrix (unconfirmed, browser-to-host ambiguity)`, () => {
    test.beforeEach(async ({ page }) => {
      await resetHarness(page);
    });

    const hostCases: Array<{ behaviour: 'drop-response' | 'corrupt-response' | 'html-response'; name: string }> = [
      { behaviour: 'drop-response', name: 'drop-response' },
      { behaviour: 'corrupt-response', name: 'corrupt-response' },
      { behaviour: 'html-response', name: 'html-response' },
    ];

    for (const { behaviour, name } of hostCases) {
      test(`${name}: unconfirmed, draft kept, duplicate warning, one issue recorded (GitHub already did the work) until Send anyway reuses the same report_id (then two)`, async ({
        page,
        request,
      }) => {
        const tracker = countFeedbackPosts(page);
        await page.goto(`/${pageName}.html`);
        const marker = `unconfirmed-host-${name}-${pageName}-${randomUUID()}`;
        await openDialog(page);
        await fillDraft(page, marker);

        await request.post('/__host-control', { data: { behaviour } });
        await page.getByTestId('feedback-send').click();

        const status = page.getByTestId('feedback-status');
        await expect(status).toContainText('Delivery unconfirmed');
        await expect(page.getByTestId('feedback-duplicate-warning')).toBeVisible();
        await expect(page.getByTestId('feedback-what')).toHaveValue(marker);
        await expect(page.getByTestId('feedback-send')).toHaveText('Send anyway');
        expect(tracker.count()).toBe(1);

        // The real handler ran and the stub really created the issue —
        // it's only the *response back to the browser* that server.ts
        // tampered with (README "Host-side response ambiguity").
        let recorded = await issuesMatching(page, marker);
        expect(recorded).toHaveLength(1);
        const reportId1 = await lastOutboundReportId(page);

        await page.waitForTimeout(300);
        recorded = await issuesMatching(page, marker);
        expect(recorded).toHaveLength(1);
        expect(tracker.count()).toBe(1);

        // "Send anyway" — /__host-control's single-shot behaviour already
        // reverted to "pass", so this one is a normal round trip.
        await page.getByTestId('feedback-send').click();
        await expect(status).toHaveText(/^Received · #\d+$/);
        expect(tracker.count()).toBe(2);

        recorded = await issuesMatching(page, marker);
        expect(recorded).toHaveLength(2);
        const reportId2 = await lastOutboundReportId(page);
        expect(reportId2).toBe(reportId1);
        for (const issue of recorded) {
          expect(issue.body.body).toContain(reportId1);
        }
      });
    }
  });
}
