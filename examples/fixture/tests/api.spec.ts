import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { HOST_PORT, INTAKE_OWNER, INTAKE_REPO, STUB_URL } from '../constants.ts';

// Task P6 rewrites this from P10a's placeholder-route smoke tests (which
// posted with Playwright's `request` fixture — a plain HTTP client with no
// Origin, Sec-Fetch-Site or Referer) into real coverage of the handler
// createFeedbackHandler (P6) now serves at POST /api/feedback: every test
// that exercises a *same-origin* request posts from an actual loaded page
// (`page.evaluate(() => fetch(...))`), so those headers are the real thing
// and the CSRF checks in design §5 are actually exercised, not bypassed.
// The one deliberately *cross-origin* case uses the `request` fixture on
// purpose, to set a foreign Origin the handler must refuse.

interface FetchResult {
  ok: boolean;
  status?: number;
  contentType?: string | null;
  json?: unknown;
  text?: string;
  error?: string;
}

function buildPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'feedback/v1',
    report_id: randomUUID(),
    kind: 'bug',
    what_happened: `api-spec ${randomUUID()}`,
    area: 'vanilla',
    ...overrides,
  };
}

/** Posts `payload` to /api/feedback from inside the loaded page, so Origin
 * and Sec-Fetch-Site are exactly what a real same-origin dialog would send. */
async function postFromPage(page: Page, payload: unknown): Promise<FetchResult> {
  return page.evaluate(async (body) => {
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { ok: true, status: response.status, contentType: response.headers.get('content-type'), json, text };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }, payload);
}

interface RecordedIssue {
  number: number;
  owner: string;
  repo: string;
  headers: Record<string, string>;
  body: { title?: string; body?: string; labels?: string[] } | { __unparseable: string } | null;
}

async function findRecordedIssue(request: APIRequestContext, marker: string) {
  const response = await request.get(`${STUB_URL}/__issues`);
  const { issues }: { issues: RecordedIssue[] } = await response.json();
  return issues.find((issue) => {
    const body = issue.body;
    return body && typeof body === 'object' && 'body' in body && typeof body.body === 'string' && body.body.includes(marker);
  });
}

test.describe('createFeedbackHandler via the fixture host (task P6)', () => {
  test.beforeEach(async ({ request }) => {
    // Both control slots are single-shot already, but this guards a
    // pending behaviour left by a prior run that never sent its request.
    // /__reset also recreates the limiter (server.ts, task P6), so a
    // test's rate-limit usage never bleeds into the next one.
    await request.post(`${STUB_URL}/__control`, { data: { behaviour: 'succeed' } });
    await request.post(`${STUB_URL}/__reset`);
    await request.post('/__reset');
    await request.post('/__host-control', { data: { behaviour: 'pass' } });
  });

  test('received: the stub records exactly the rendered ticket, with the four labels and a #n receipt', async ({
    page,
    request,
  }) => {
    await page.goto('/vanilla.html');
    const marker = `received-${randomUUID()}`;
    const payload = buildPayload({ what_happened: marker, kind: 'bug' });

    const result = await postFromPage(page, payload);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.json).toMatchObject({ status: 'received' });
    const receipt = (result.json as { receipt: string }).receipt;
    expect(receipt).toMatch(/^#\d+$/);

    const recorded = await findRecordedIssue(request, marker);
    expect(recorded).toBeTruthy();
    expect(recorded!.owner).toBe(INTAKE_OWNER);
    expect(recorded!.repo).toBe(INTAKE_REPO);
    expect(String(recorded!.number)).toBe(receipt.slice(1));

    const body = recorded!.body as { title: string; body: string; labels: string[] };
    expect(body.title).toContain('Fixture');
    expect(body.title).toContain('Bug');
    expect(body.labels).toEqual(['source:in-app', 'app:fixture', 'env:test', 'kind:bug']);
    expect(body.body).toContain('## 1. Reporter said');
    expect(body.body).toContain('## 2. Recorded or derived by the server');
    expect(body.body).toContain('## 3. Reported by the browser');
    expect(body.body).toContain(marker);
  });

  test('a cross-origin request is refused with forbidden_origin', async ({ request }) => {
    const marker = `cross-origin-${randomUUID()}`;
    const response = await request.post('/api/feedback', {
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      data: buildPayload({ what_happened: marker }),
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ status: 'not_sent', code: 'forbidden_origin' });

    const recorded = await findRecordedIssue(request, marker);
    expect(recorded).toBeFalsy();
  });

  test('the fixture-anon=1 cookie makes identify() return null: unauthenticated', async ({ page, context }) => {
    await context.addCookies([
      { name: 'fixture-anon', value: '1', url: `http://localhost:${HOST_PORT}` },
    ]);
    await page.goto('/vanilla.html');

    const result = await postFromPage(page, buildPayload());

    expect(result.status).toBe(401);
    expect(result.json).toEqual({ status: 'not_sent', code: 'unauthenticated' });
  });

  test('the sixth report from the same identity in the window is rate_limited', async ({ page }) => {
    await page.goto('/vanilla.html');

    for (let i = 0; i < 5; i++) {
      const result = await postFromPage(page, buildPayload({ what_happened: `rate-limit-${i}-${randomUUID()}` }));
      expect(result.status, `request ${i + 1} of 5 should be received`).toBe(201);
    }

    const sixth = await postFromPage(page, buildPayload({ what_happened: `rate-limit-6th-${randomUUID()}` }));
    expect(sixth.status).toBe(429);
    expect(sixth.json).toEqual({ status: 'not_sent', code: 'rate_limited' });
  });

  test('a definitive stub refusal (422) maps to tracker_refused', async ({ page, request }) => {
    await request.post(`${STUB_URL}/__control`, { data: { behaviour: 'status:422' } });
    await page.goto('/vanilla.html');

    const result = await postFromPage(page, buildPayload());

    expect(result.status).toBe(502);
    expect(result.json).toEqual({ status: 'not_sent', code: 'tracker_refused' });
  });

  test('the stub hanging produces unconfirmed within the short sink timeout', async ({ page, request }) => {
    await request.post(`${STUB_URL}/__control`, { data: { behaviour: 'hang' } });
    await page.goto('/vanilla.html');

    const startedAt = Date.now();
    const result = await postFromPage(page, buildPayload());
    const elapsedMs = Date.now() - startedAt;

    expect(result.status).toBe(202);
    expect(result.json).toMatchObject({ status: 'unconfirmed' });
    expect((result.json as { report_id: string }).report_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // The fixture's SINK_TIMEOUT_MS is short (default 1500ms) specifically
    // so this test doesn't have to wait out githubSink()'s own 10s default.
    expect(elapsedMs).toBeLessThan(10_000);
  });

  test('record-then-drop (GitHub-side ambiguity): unconfirmed, and the stub recorded exactly one issue', async ({
    page,
    request,
  }) => {
    const marker = `record-then-drop-${randomUUID()}`;
    await request.post(`${STUB_URL}/__control`, { data: { behaviour: 'record-then-drop' } });
    await page.goto('/vanilla.html');

    const result = await postFromPage(page, buildPayload({ what_happened: marker }));

    expect(result.status).toBe(202);
    expect(result.json).toMatchObject({ status: 'unconfirmed' });

    const issuesResponse = await request.get(`${STUB_URL}/__issues`);
    const { issues }: { issues: RecordedIssue[] } = await issuesResponse.json();
    const matching = issues.filter((issue) => {
      const body = issue.body;
      return body && typeof body === 'object' && 'body' in body && typeof body.body === 'string' && body.body.includes(marker);
    });
    expect(matching).toHaveLength(1);
  });

  test.describe('host-side response ambiguity (browser <-> host leg, after the stub already did its job)', () => {
    test('drop-response: the page fetch rejects, but the stub still recorded the issue', async ({ page, request }) => {
      const marker = `host-drop-${randomUUID()}`;
      await request.post('/__host-control', { data: { behaviour: 'drop-response' } });
      await page.goto('/vanilla.html');

      const result = await postFromPage(page, buildPayload({ what_happened: marker }));

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();

      const recorded = await findRecordedIssue(request, marker);
      expect(recorded).toBeTruthy();
    });

    test('corrupt-response: the page gets an unparseable body, but the stub still recorded the issue', async ({
      page,
      request,
    }) => {
      const marker = `host-corrupt-${randomUUID()}`;
      await request.post('/__host-control', { data: { behaviour: 'corrupt-response' } });
      await page.goto('/vanilla.html');

      const result = await postFromPage(page, buildPayload({ what_happened: marker }));

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.contentType).toContain('application/json');
      expect(result.json).toBeNull();
      expect(result.text).toBe('{"status":"rec');

      const recorded = await findRecordedIssue(request, marker);
      expect(recorded).toBeTruthy();
    });

    test('html-response: the page gets HTML instead of JSON, but the stub still recorded the issue', async ({
      page,
      request,
    }) => {
      const marker = `host-html-${randomUUID()}`;
      await request.post('/__host-control', { data: { behaviour: 'html-response' } });
      await page.goto('/vanilla.html');

      const result = await postFromPage(page, buildPayload({ what_happened: marker }));

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.contentType).toContain('text/html');
      expect(result.json).toBeNull();
      expect(result.text).toContain('not json');

      const recorded = await findRecordedIssue(request, marker);
      expect(recorded).toBeTruthy();
    });

    test('pass (default): behaves exactly like an unconfigured request', async ({ page, request }) => {
      const marker = `host-pass-${randomUUID()}`;
      await request.post('/__host-control', { data: { behaviour: 'pass' } });
      await page.goto('/vanilla.html');

      const result = await postFromPage(page, buildPayload({ what_happened: marker }));

      expect(result.status).toBe(201);
      expect(result.json).toMatchObject({ status: 'received' });
    });
  });
});
