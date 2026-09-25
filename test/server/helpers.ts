/**
 * Shared fixtures for `test/server/*.test.ts` (task P6). Not itself a
 * `*.test.ts` file, so vitest's `test/**\/*.test.ts` include pattern never
 * picks it up directly.
 */
import { expect, vi } from 'vitest';
import type { FeedbackHandlerConfig, FeedbackHandlerSink } from '../../dist/server/index.js';
import type { FeedbackIdentity, FeedbackResponse } from '../../dist/core/index.js';
import { parseFeedbackResponse } from '../../dist/core/index.js';
import type { Limiter, LimiterOutcome } from '../../dist/limit/index.js';
import type { SinkOutcome } from '../../dist/github/index.js';

/** The one origin every test config allows by default. */
export const ORIGIN = 'http://localhost:3000';

export function makeIdentity(overrides: Partial<FeedbackIdentity> = {}): FeedbackIdentity {
  return {
    ref: 'person-1',
    role: 'staff',
    surface: 'staff',
    allowReference: true,
    ...overrides,
  };
}

export function okLimiter(outcome: LimiterOutcome = 'ok'): Limiter {
  return { take: vi.fn(async () => outcome) };
}

export function throwingLimiter(error: unknown = new Error('limiter down')): Limiter {
  return {
    take: vi.fn(async () => {
      throw error;
    }),
  };
}

export function outcomeSink(outcome: SinkOutcome): FeedbackHandlerSink {
  return { create: vi.fn(async () => outcome) };
}

export function okSink(number = 42): FeedbackHandlerSink {
  return outcomeSink({
    ok: true,
    number,
    url: `https://github.com/owner/intake/issues/${number}`,
    droppedLabels: [],
  });
}

export function throwingSink(error: unknown = new Error('sink exploded')): FeedbackHandlerSink {
  return {
    create: vi.fn(async () => {
      throw error;
    }),
  };
}

/** A payload that validates cleanly against `baseConfig()`'s `areas: {}`. */
export function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'feedback/v1',
    report_id: '11111111-1111-4111-8111-111111111111',
    kind: 'bug',
    what_happened: 'Everything is on fire.',
    expected: 'It should not be on fire.',
    ...overrides,
  };
}

export function baseConfig(overrides: Partial<FeedbackHandlerConfig> = {}): FeedbackHandlerConfig {
  return {
    app: 'fixture',
    displayName: 'Fixture',
    productRepository: 'owner/product',
    environment: 'test',
    origins: [ORIGIN],
    identify: vi.fn(async () => makeIdentity()),
    limiter: okLimiter(),
    sink: okSink(),
    areas: {},
    receivingCommit: 'a'.repeat(40),
    log: vi.fn(),
    ...overrides,
  };
}

export interface MakeRequestOptions {
  method?: string;
  /** `null` omits the header entirely; a string sets it (`'null'` sends the literal Origin value browsers send for an opaque origin). */
  origin?: string | null;
  contentType?: string | null;
  /** Omitted (`undefined`) defaults to `'same-origin'` — the handler now
   * requires the header (task review of P6), so every test not
   * specifically exercising this check needs a request that passes it.
   * Pass `null` to omit the header entirely (the refusal case), or any
   * other string to test a different value. */
  secFetchSite?: string | null;
  headers?: Record<string, string>;
  /** Defaults to `JSON.stringify(validPayload())` for a body-carrying method, `undefined` otherwise. */
  body?: BodyInit | undefined;
}

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

export function makeRequest(opts: MakeRequestOptions = {}): Request {
  const method = opts.method ?? 'POST';
  const headers = new Headers();

  if (opts.contentType !== null) {
    headers.set('content-type', opts.contentType ?? 'application/json');
  }
  if (opts.origin !== null) {
    headers.set('origin', opts.origin ?? ORIGIN);
  }
  const secFetchSite = opts.secFetchSite === undefined ? 'same-origin' : opts.secFetchSite;
  if (secFetchSite !== null) {
    headers.set('sec-fetch-site', secFetchSite);
  }
  if (opts.headers) {
    for (const [key, value] of Object.entries(opts.headers)) headers.set(key, value);
  }

  const body = opts.body !== undefined ? opts.body : BODYLESS_METHODS.has(method) ? undefined : JSON.stringify(validPayload());

  return new Request('https://host.example/api/feedback', {
    method,
    headers,
    body,
    // Required by Node's fetch (undici) whenever a body is present — even
    // a plain string — once any RequestInit in this process has used a
    // streaming body; harmless for a non-streaming body either way.
    ...(body !== undefined ? { duplex: 'half' as const } : {}),
  });
}

/** The three headers every response must carry, and the CORS headers it must never carry. */
export function expectStandardHeaders(response: Response): void {
  expect(response.headers.get('content-type')).toBe('application/json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  for (const key of response.headers.keys()) {
    expect(key.toLowerCase().startsWith('access-control-')).toBe(false);
  }
}

/** Asserts a `not_sent` refusal: status, headers, and the parsed body (via
 * `parseFeedbackResponse`, which must not return `null`). Returns the
 * parsed body for further assertions (e.g. on `fields`). */
export async function expectRefusal(
  response: Response,
  expectedStatus: number,
  expectedCode: string,
): Promise<FeedbackResponse> {
  expect(response.status).toBe(expectedStatus);
  expectStandardHeaders(response);
  const parsed = parseFeedbackResponse(await response.json());
  expect(parsed).not.toBeNull();
  expect(parsed).toMatchObject({ status: 'not_sent', code: expectedCode });
  return parsed as FeedbackResponse;
}

/** A ReadableStream<Uint8Array> whose `pull()` calls are counted and whose
 * `cancel()` is observed, for proving the handler never reads past its cap. */
export function countingStream(chunks: Uint8Array[]): {
  stream: ReadableStream<Uint8Array>;
  pullCount: () => number;
  cancelled: () => boolean;
} {
  let pullCount = 0;
  let cancelled = false;
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount++;
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index++;
    },
    cancel() {
      cancelled = true;
    },
  });

  return { stream, pullCount: () => pullCount, cancelled: () => cancelled };
}
