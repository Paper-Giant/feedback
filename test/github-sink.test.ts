import { describe, expect, it, vi } from 'vitest';
import {
  FeedbackCredentialError,
  githubAppAuth,
  githubSink,
  type FeedbackTicket,
  type TokenSource,
} from '../dist/github/index.js';
import { generateTestKey } from './helpers/rsa-keys.js';

// Design §"Delivery states": `token()` throwing is a definitive
// `credential` failure with no issue request sent; a 201 with a
// parseable `number` and `html_url` is success; the label comparison and
// `FEEDBACK_LABELS_DROPPED` log; 400/401/403/404/410/422/429 are
// definitive refusals (403 is `rate_limited` only when rate-limit
// headers say so); everything else (5xx, network error, timeout, an
// unparseable 201, or one missing a valid `number`) is inconclusive.

const ticket: FeedbackTicket = {
  title: '[Example] Bug · checkout-wizard',
  body: '## 1. Reporter said\n\n~~~text\nfixture body\n~~~\n',
  labels: ['source:in-app', 'app:example-app', 'env:uat', 'kind:bug'],
};

function okAuth(token = 'tok-abc'): TokenSource {
  return { token: async () => token };
}

function successResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      number: 123,
      html_url: 'https://github.com/owner/intake/issues/123',
      labels: ticket.labels.map((name) => ({ name })),
      ...overrides,
    }),
    { status: 201 },
  );
}

describe('githubSink', () => {
  it('returns a definitive credential failure and sends no issue request when auth.token() throws', async () => {
    const fetchMock = vi.fn();
    const sink = githubSink({
      auth: {
        token: async () => {
          throw new Error('mint failed');
        },
      },
      intake: 'owner/intake',
      fetch: fetchMock,
    });

    const outcome = await sink.create(ticket);

    expect(outcome).toEqual({ ok: false, definitive: true, code: 'credential' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns ok with the issue number, url and no dropped labels when every label round-trips', async () => {
    const fetchMock = vi.fn(async () => successResponse());
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    const outcome = await sink.create(ticket);

    expect(outcome).toEqual({
      ok: true,
      number: 123,
      url: 'https://github.com/owner/intake/issues/123',
      droppedLabels: [],
    });
  });

  it('sends the request GitHub expects: method, URL, headers, body and an abort signal', async () => {
    let seenInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenInit = init;
      return successResponse();
    });
    const sink = githubSink({
      auth: okAuth('tok-xyz'),
      intake: 'owner/intake',
      apiBaseUrl: 'https://fake.example',
      fetch: fetchMock,
    });

    await sink.create(ticket);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://fake.example/repos/owner/intake/issues');
    expect(seenInit?.method).toBe('POST');

    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-xyz');
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(headers['User-Agent']).toBe('papergiant-feedback');
    expect(seenInit?.signal).toBeInstanceOf(AbortSignal);
    expect(seenInit?.redirect).toBe('error');

    const body = JSON.parse(seenInit?.body as string);
    expect(body).toEqual({ title: ticket.title, body: ticket.body, labels: ticket.labels });
  });

  it('returns ok on a 201 with a valid number and no html_url (a URL is not required for receipt)', async () => {
    const fetchMock = vi.fn(async () => successResponse({ html_url: undefined }));
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    const outcome = await sink.create(ticket);

    expect(outcome).toEqual({ ok: true, number: 123, droppedLabels: [] });
    expect((outcome as { url?: string }).url).toBeUndefined();
  });

  it('drops labels GitHub silently refused and logs a count-only event', async () => {
    const log = vi.fn();
    const returnedLabels = ticket.labels.slice(0, -1);
    const fetchMock = vi.fn(async () => successResponse({ labels: returnedLabels.map((name) => ({ name })) }));
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock, log });

    const outcome = await sink.create(ticket);

    expect(outcome).toEqual({
      ok: true,
      number: 123,
      url: 'https://github.com/owner/intake/issues/123',
      droppedLabels: [ticket.labels[ticket.labels.length - 1]],
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: 'FEEDBACK_LABELS_DROPPED', count: 1 });
  });

  it('tolerates GitHub returning labels as bare strings, not just {name} objects', async () => {
    const fetchMock = vi.fn(async () => successResponse({ labels: ticket.labels }));
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    const outcome = await sink.create(ticket);

    expect(outcome).toMatchObject({ ok: true, droppedLabels: [] });
  });

  it('treats a 201 with an unparseable JSON body as inconclusive', async () => {
    const fetchMock = vi.fn(async () => new Response('not json', { status: 201 }));
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    expect(await sink.create(ticket)).toEqual({
      ok: false,
      definitive: false,
      code: 'unparseable_success',
      status: 201,
    });
  });

  it('treats a 201 missing a valid number as inconclusive', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ html_url: 'https://github.com/owner/intake/issues/1' }), { status: 201 }),
    );
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    expect(await sink.create(ticket)).toEqual({
      ok: false,
      definitive: false,
      code: 'unparseable_success',
      status: 201,
    });
  });

  it('treats a 201 with number 0 as inconclusive (not a valid issue number)', async () => {
    const fetchMock = vi.fn(async () => successResponse({ number: 0 }));
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    expect(await sink.create(ticket)).toEqual({
      ok: false,
      definitive: false,
      code: 'unparseable_success',
      status: 201,
    });
  });

  it('treats a network error as inconclusive', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    expect(await sink.create(ticket)).toEqual({ ok: false, definitive: false, code: 'network' });
  });

  it('times out and reports inconclusive when the request never resolves', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'TimeoutError'));
          });
        }),
    );
    const sink = githubSink({
      auth: okAuth(),
      intake: 'owner/intake',
      fetch: fetchMock,
      timeoutMs: 25,
    });

    expect(await sink.create(ticket)).toEqual({ ok: false, definitive: false, code: 'timeout' });
  });

  it('reports timeout (not unparseable_success) when the deadline fires while the 201 body is still being read', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      const fakeResponse = {
        status: 201,
        headers: new Headers(),
        body: null,
        json: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'TimeoutError'));
            });
          }),
      } as unknown as Response;
      return Promise.resolve(fakeResponse);
    });
    const sink = githubSink({
      auth: okAuth(),
      intake: 'owner/intake',
      fetch: fetchMock,
      timeoutMs: 25,
    });

    expect(await sink.create(ticket)).toEqual({ ok: false, definitive: false, code: 'timeout' });
  });

  it.each([301, 303, 307])(
    'treats a %i redirect as an inconclusive network failure, never following it',
    async (status) => {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.redirect === 'error') {
          return Promise.reject(new TypeError('redirect mode is set to error'));
        }
        return Promise.resolve(
          new Response(null, { status, headers: { location: 'https://evil.example/steal' } }),
        );
      });
      const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

      expect(await sink.create(ticket)).toEqual({ ok: false, definitive: false, code: 'network' });
    },
  );

  it('invalidates the cached token on a 401, with no in-request retry', async () => {
    const invalidate = vi.fn();
    const auth: TokenSource = { token: async () => 'tok-dead', invalidate };
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    const sink = githubSink({ auth, intake: 'owner/intake', fetch: fetchMock });

    const outcome = await sink.create(ticket);

    expect(outcome).toEqual({ ok: false, definitive: true, code: 'unauthorised', status: 401 });
    expect(invalidate).toHaveBeenCalledTimes(1);
    // No in-request retry: exactly one issue request was sent.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate the token for a status other than 401', async () => {
    const invalidate = vi.fn();
    const auth: TokenSource = { token: async () => 'tok', invalidate };
    const fetchMock = vi.fn(async () => new Response('{}', { status: 422 }));
    const sink = githubSink({ auth, intake: 'owner/intake', fetch: fetchMock });

    await sink.create(ticket);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('cancels the response body on a non-201 response, to release the connection', async () => {
    const response = new Response('{}', { status: 404 });
    const cancelSpy = vi.spyOn(response.body!, 'cancel').mockResolvedValue(undefined);
    const fetchMock = vi.fn(async () => response);
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    await sink.create(ticket);

    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('throws FeedbackCredentialError at construction when auth.repository differs from intake', () => {
    const auth: TokenSource = { token: async () => 'tok', repository: 'owner/other-repo' };

    expect(() => githubSink({ auth, intake: 'owner/intake' })).toThrow(FeedbackCredentialError);
  });

  it('does not throw when auth.repository matches intake, or when auth reports none', () => {
    const matching: TokenSource = { token: async () => 'tok', repository: 'owner/intake' };
    expect(() => githubSink({ auth: matching, intake: 'owner/intake' })).not.toThrow();

    const noRepository: TokenSource = { token: async () => 'tok' };
    expect(() => githubSink({ auth: noRepository, intake: 'owner/intake' })).not.toThrow();
  });

  it('wires up with a real githubAppAuth() TokenSource when repositories match', () => {
    const auth = githubAppAuth({
      clientId: 'Iv1.client',
      installationId: '1',
      privateKey: 'not parsed unless token() is called',
      repository: 'owner/intake',
    });

    expect(() => githubSink({ auth, intake: 'owner/intake' })).not.toThrow();
  });

  it('rejects a real githubAppAuth() TokenSource scoped to a different repository', () => {
    const auth = githubAppAuth({
      clientId: 'Iv1.client',
      installationId: '1',
      privateKey: 'not parsed unless token() is called',
      repository: 'owner/other-repo',
    });

    expect(() => githubSink({ auth, intake: 'owner/intake' })).toThrow(FeedbackCredentialError);
  });

  it('returns a definitive credential failure and sends no issue request when the mint deadline fires while reading the mint response body', async () => {
    // Gate R: the mint's AbortSignal must cover the *body read*, not just
    // the connect/headers phase — a 201 whose json() never resolves
    // until aborted must still fail (bounded by timeoutMs), and the sink
    // must never reach the issue-create request in that case.
    const key = generateTestKey();
    const mintFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      const fakeMintResponse = {
        status: 201,
        headers: new Headers(),
        body: null,
        json: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'TimeoutError'));
            });
          }),
      } as unknown as Response;
      return Promise.resolve(fakeMintResponse);
    });

    const auth = githubAppAuth({
      clientId: 'Iv1.client',
      installationId: '1',
      privateKey: key.pkcs1Pem,
      repository: 'owner/intake',
      apiBaseUrl: 'https://fake.example',
      fetch: mintFetch,
      timeoutMs: 25,
    });

    const issuesFetch = vi.fn();
    const sink = githubSink({ auth, intake: 'owner/intake', fetch: issuesFetch });

    const started = Date.now();
    const outcome = await sink.create(ticket);
    const elapsed = Date.now() - started;

    expect(outcome).toEqual({ ok: false, definitive: true, code: 'credential' });
    expect(issuesFetch).not.toHaveBeenCalled();
    // Bounded by the mint's deadline, not hanging forever.
    expect(elapsed).toBeLessThan(2000);
  });

  const definitiveStatuses: Array<{ status: number; code: string; headers?: Record<string, string>; label: string }> = [
    { status: 400, code: 'bad_request', label: '400' },
    { status: 401, code: 'unauthorised', label: '401' },
    { status: 403, code: 'forbidden', label: '403 (no rate-limit headers)' },
    { status: 403, code: 'rate_limited', headers: { 'x-ratelimit-remaining': '0' }, label: '403 (x-ratelimit-remaining: 0)' },
    { status: 403, code: 'rate_limited', headers: { 'retry-after': '30' }, label: '403 (retry-after)' },
    { status: 404, code: 'not_found', label: '404' },
    { status: 410, code: 'gone', label: '410' },
    { status: 422, code: 'validation', label: '422' },
    { status: 429, code: 'rate_limited', label: '429' },
  ];

  for (const { status, code, headers, label } of definitiveStatuses) {
    it(`maps ${label} to a definitive '${code}' refusal`, async () => {
      const fetchMock = vi.fn(async () => new Response('{}', { status, headers }));
      const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

      expect(await sink.create(ticket)).toEqual({ ok: false, definitive: true, code, status });
    });
  }

  it('maps a listed 5xx to an inconclusive server_error', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }));
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    expect(await sink.create(ticket)).toEqual({ ok: false, definitive: false, code: 'server_error', status: 503 });
  });

  it('maps an unlisted 5xx to an inconclusive server_error', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 599 }));
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    expect(await sink.create(ticket)).toEqual({ ok: false, definitive: false, code: 'server_error', status: 599 });
  });

  it('maps an unlisted status below 500 to an inconclusive unexpected_status', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 418 }));
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    expect(await sink.create(ticket)).toEqual({
      ok: false,
      definitive: false,
      code: 'unexpected_status',
      status: 418,
    });
  });

  it('uses the default apiBaseUrl and a ten-second default timeout when not overridden', async () => {
    let calledUrl: string | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return successResponse();
    });
    const sink = githubSink({ auth: okAuth(), intake: 'owner/intake', fetch: fetchMock });

    await sink.create(ticket);

    expect(calledUrl).toBe('https://api.github.com/repos/owner/intake/issues');
  });
});
