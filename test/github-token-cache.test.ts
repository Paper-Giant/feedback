import { describe, expect, it, vi } from 'vitest';
import { FeedbackCredentialError, githubAppAuth } from '../dist/github/index.js';
import { generateTestKey } from './helpers/rsa-keys.js';

// Design §"Credential": the installation token is cached until five
// minutes before `expires_at`; concurrent callers share one in-flight
// mint; a failed mint is not cached, so the next call retries; the mint
// request narrows to the one repository and `issues: write`.

const key = generateTestKey();

function mintResponse(token: string, expiresAtIso: string): Response {
  return new Response(JSON.stringify({ token, expires_at: expiresAtIso }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

function baseOptions(overrides: Partial<Parameters<typeof githubAppAuth>[0]> = {}) {
  return {
    clientId: 'Iv1.client-id',
    installationId: '424242',
    privateKey: key.pkcs1Pem,
    repository: 'example-intake/example-app-feedback',
    apiBaseUrl: 'https://fake.example',
    ...overrides,
  };
}

describe('githubAppAuth token cache', () => {
  it('reuses the cached token within its life', async () => {
    let now = Date.parse('2026-09-25T00:00:00Z');
    const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn(async () => mintResponse('tok-1', expiresAt));

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

    const first = await auth.token();
    now += 5_000;
    const second = await auth.token();

    expect(first).toBe('tok-1');
    expect(second).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes once the cached token is within five minutes of expiring', async () => {
    let now = Date.parse('2026-09-25T00:00:00Z');
    const expiresAtMs = now + 60 * 60 * 1000;
    let mintCount = 0;
    const fetchMock = vi.fn(async () => {
      mintCount += 1;
      return mintResponse(`tok-${mintCount}`, new Date(expiresAtMs).toISOString());
    });

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

    expect(await auth.token()).toBe('tok-1');

    now = expiresAtMs - 4 * 60 * 1000; // inside the 5-minute refresh margin
    expect(await auth.token()).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not refresh while still outside the five-minute margin', async () => {
    let now = Date.parse('2026-09-25T00:00:00Z');
    const expiresAtMs = now + 60 * 60 * 1000;
    const fetchMock = vi.fn(async () => mintResponse('tok-1', new Date(expiresAtMs).toISOString()));

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

    await auth.token();
    now = expiresAtMs - 6 * 60 * 1000; // still outside the margin
    await auth.token();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends exactly one mint request for ten concurrent callers', async () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return mintResponse('tok-concurrent', expiresAt);
    });

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

    const results = await Promise.all(Array.from({ length: 10 }, () => auth.token()));

    expect(calls).toBe(1);
    expect(results).toEqual(Array.from({ length: 10 }, () => 'tok-concurrent'));
  });

  it('retries on the next call after a failed mint, which is not cached', async () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response('server error', { status: 500 });
      }
      return mintResponse('tok-recovered', new Date(now + 60 * 60 * 1000).toISOString());
    });

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

    await expect(auth.token()).rejects.toBeInstanceOf(FeedbackCredentialError);
    await expect(auth.token()).resolves.toBe('tok-recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a concurrent batch retries together after a failed mint', async () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new TypeError('network down');
      }
      return mintResponse('tok-after-retry', new Date(now + 60 * 60 * 1000).toISOString());
    });

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

    const firstBatch = await Promise.allSettled([auth.token(), auth.token(), auth.token()]);
    expect(firstBatch.every((result) => result.status === 'rejected')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(auth.token()).resolves.toBe('tok-after-retry');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('mints with a request narrowed to the one repository and issues: write, with the pinned headers', async () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn(async () => mintResponse('tok-1', expiresAt));

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));
    await auth.token();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://fake.example/app/installations/424242/access_tokens');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(headers['User-Agent']).toBe('papergiant-feedback');
    expect(headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      repositories: ['example-app-feedback'],
      permissions: { issues: 'write' },
    });
  });

  it('aborts the mint request after the deadline and fails as a credential error', async () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'TimeoutError'));
          });
        }),
    );

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now, timeoutMs: 25 }));

    await expect(auth.token()).rejects.toBeInstanceOf(FeedbackCredentialError);
  });

  it('aborts the mint request while reading the response body, and fails as a credential error within the deadline', async () => {
    // The connect/headers phase can complete (a 201) well before the
    // deadline while the body is still streaming in; the same
    // AbortSignal.timeout must still cover that read, or a stalled body
    // would hang token() forever instead of failing within timeoutMs.
    const now = Date.parse('2026-09-25T00:00:00Z');
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

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now, timeoutMs: 25 }));

    const started = Date.now();
    await expect(auth.token()).rejects.toBeInstanceOf(FeedbackCredentialError);
    const elapsed = Date.now() - started;

    // Bounded by the deadline (allowing generous scheduling jitter), not
    // hanging indefinitely.
    expect(elapsed).toBeLessThan(2000);
  });

  it.each([301, 303, 307])(
    'rejects a %i redirect on the mint request instead of following it',
    async (status) => {
      const now = Date.parse('2026-09-25T00:00:00Z');
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.redirect === 'error') {
          return Promise.reject(new TypeError('redirect mode is set to error'));
        }
        return Promise.resolve(new Response(null, { status, headers: { location: 'https://evil.example' } }));
      });

      const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

      await expect(auth.token()).rejects.toBeInstanceOf(FeedbackCredentialError);
    },
  );

  it('invalidate() clears the cached token, so the next call mints again', async () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
    let mintCount = 0;
    const fetchMock = vi.fn(async () => {
      mintCount += 1;
      return mintResponse(`tok-${mintCount}`, expiresAt);
    });

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

    expect(await auth.token()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    auth.invalidate?.();

    expect(await auth.token()).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the token once, without caching it, when expires_at is unparseable', async () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    let mintCount = 0;
    const fetchMock = vi.fn(async () => {
      mintCount += 1;
      return new Response(JSON.stringify({ token: `tok-${mintCount}`, expires_at: 'not-a-date' }), {
        status: 201,
      });
    });

    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

    expect(await auth.token()).toBe('tok-1');
    // Nothing was cached, so the very next call mints again rather than
    // reusing a token whose real lifetime could not be determined.
    expect(await auth.token()).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('validates "repository" synchronously at construction, before any token() call', () => {
    expect(() =>
      githubAppAuth(baseOptions({ repository: 'not-owner-slash-name' })),
    ).toThrow(FeedbackCredentialError);
    expect(() => githubAppAuth(baseOptions({ repository: 'owner/' }))).toThrow(FeedbackCredentialError);
    expect(() => githubAppAuth(baseOptions({ repository: '/name' }))).toThrow(FeedbackCredentialError);
  });

  it('does not cache a failed private-key parse; the next call retries parsing', async () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn(async () => mintResponse('tok-after-fixed-key', expiresAt));

    // A mutable options object: `getKey()` must read `privateKey` live
    // (not a value captured once at construction), or fixing it here
    // between calls would have no effect.
    const options = baseOptions({
      privateKey: 'not-a-real-key',
      fetch: fetchMock,
      now: () => now,
    });
    const auth = githubAppAuth(options);

    await expect(auth.token()).rejects.toBeInstanceOf(FeedbackCredentialError);
    expect(fetchMock).not.toHaveBeenCalled();

    options.privateKey = key.pkcs1Pem;
    await expect(auth.token()).resolves.toBe('tok-after-fixed-key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects with FeedbackCredentialError carrying the status only, for a non-201 mint response', async () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    const fetchMock = vi.fn(async () => new Response('nope', { status: 403 }));
    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

    try {
      await auth.token();
      expect.unreachable('token() should have rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(FeedbackCredentialError);
      expect((error as InstanceType<typeof FeedbackCredentialError>).status).toBe(403);
    }
  });

  it('cancels the response body on a non-201 mint response, to release the connection', async () => {
    const now = Date.parse('2026-09-25T00:00:00Z');
    const response = new Response('nope', { status: 403 });
    const cancelSpy = vi.spyOn(response.body!, 'cancel').mockResolvedValue(undefined);
    const fetchMock = vi.fn(async () => response);
    const auth = githubAppAuth(baseOptions({ fetch: fetchMock, now: () => now }));

    await expect(auth.token()).rejects.toBeInstanceOf(FeedbackCredentialError);

    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });
});
