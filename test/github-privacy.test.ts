import { describe, expect, it, vi } from 'vitest';
import {
  FeedbackCredentialError,
  githubAppAuth,
  githubSink,
  parsePrivateKey,
  tokenAuth,
  type FeedbackTicket,
} from '../dist/github/index.js';
import { generateTestKey } from './helpers/rsa-keys.js';

// Design §"Delivery states" / §"Credential": the host only ever gets log
// events with ids and outcome codes — never report text — and every
// thrown error is a fixed, static message. This file plants a marker in
// the ticket title and body (and, for the key tests, in the "key"
// input) and asserts it never appears in a log call or an error message
// across every outcome this module produces.

const SECRET_TITLE = 'MARKER-TITLE-df93b0a2-what-the-reporter-typed';
const SECRET_BODY = 'MARKER-BODY-4c1a9e77-the-reporter-said-something-private';

const ticket: FeedbackTicket = {
  title: SECRET_TITLE,
  body: SECRET_BODY,
  labels: ['source:in-app', 'app:example-app', 'env:uat', 'kind:bug'],
};

function assertNoLeak(...values: unknown[]): void {
  for (const value of values) {
    const serialised = typeof value === 'string' ? value : JSON.stringify(value);
    expect(serialised ?? '').not.toContain(SECRET_TITLE);
    expect(serialised ?? '').not.toContain(SECRET_BODY);
  }
}

describe('no reporter content ever reaches a log call or an error message', () => {
  it('a dropped-label log call carries only an event name and a count', async () => {
    const log = vi.fn();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            number: 1,
            html_url: 'https://github.com/owner/intake/issues/1',
            labels: [{ name: ticket.labels[0] }],
          }),
          { status: 201 },
        ),
    );
    const sink = githubSink({ auth: { token: async () => 'tok' }, intake: 'owner/intake', fetch: fetchMock, log });

    const outcome = await sink.create(ticket);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toEqual({ event: 'FEEDBACK_LABELS_DROPPED', count: 3 });
    assertNoLeak(log.mock.calls, outcome);
  });

  it('no log call and no outcome ever carries the title or body, across every mapped outcome', async () => {
    const log = vi.fn();

    const scenarios: Array<() => Promise<unknown>> = [
      // Credential failure: the underlying auth error message happens to
      // carry the marker (as a hostile or careless auth implementation
      // might); the sink's own outcome must still never carry it.
      async () =>
        githubSink({
          auth: {
            token: async () => {
              throw new Error(SECRET_BODY);
            },
          },
          intake: 'owner/intake',
          fetch: vi.fn(),
          log,
        }).create(ticket),

      // Definitive refusal whose response body happens to echo the marker.
      async () =>
        githubSink({
          auth: { token: async () => 'tok' },
          intake: 'owner/intake',
          fetch: vi.fn(async () => new Response(JSON.stringify({ message: SECRET_BODY }), { status: 422 })),
          log,
        }).create(ticket),

      // Inconclusive server error whose body happens to echo the marker.
      async () =>
        githubSink({
          auth: { token: async () => 'tok' },
          intake: 'owner/intake',
          fetch: vi.fn(async () => new Response(SECRET_BODY, { status: 500 })),
          log,
        }).create(ticket),

      // A network error whose message happens to include the marker.
      async () =>
        githubSink({
          auth: { token: async () => 'tok' },
          intake: 'owner/intake',
          fetch: vi.fn(async () => {
            throw new Error(SECRET_BODY);
          }),
          log,
        }).create(ticket),
    ];

    for (const run of scenarios) {
      const outcome = await run();
      assertNoLeak(outcome);
    }
    assertNoLeak(log.mock.calls);
  });

  it('a private-key parse failure never echoes reporter-shaped input', async () => {
    const hostileInput = `not a key — ${SECRET_BODY}`;

    await expect(parsePrivateKey(hostileInput)).rejects.toBeInstanceOf(FeedbackCredentialError);
    try {
      await parsePrivateKey(hostileInput);
      expect.unreachable('parsePrivateKey should have thrown');
    } catch (error) {
      assertNoLeak((error as Error).message);
    }
  });

  it('a token-mint failure never echoes the response body', async () => {
    const key = generateTestKey();
    const auth = githubAppAuth({
      clientId: 'Iv1.client',
      installationId: '1',
      privateKey: key.pkcs1Pem,
      repository: 'owner/name',
      apiBaseUrl: 'https://fake.example',
      fetch: vi.fn(async () => new Response(JSON.stringify({ message: SECRET_BODY }), { status: 401 })),
    });

    try {
      await auth.token();
      expect.unreachable('token() should have rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(FeedbackCredentialError);
      assertNoLeak((error as Error).message);
    }
  });

  it('tokenAuth and a clean create() never call log', async () => {
    const log = vi.fn();
    const secretToken = `pat-${SECRET_BODY}`;
    const auth = tokenAuth(secretToken);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            number: 1,
            html_url: 'https://github.com/owner/intake/issues/1',
            labels: ticket.labels.map((name) => ({ name })),
          }),
          { status: 201 },
        ),
    );
    const sink = githubSink({ auth, intake: 'owner/intake', fetch: fetchMock, log });

    const outcome = await sink.create(ticket);

    expect(outcome).toMatchObject({ ok: true, droppedLabels: [] });
    expect(log).not.toHaveBeenCalled();
  });
});
