import { describe, expect, it, vi } from 'vitest';
import { createFeedbackHandler } from '../../dist/server/index.js';
import { baseConfig, makeIdentity, makeRequest, outcomeSink, throwingSink, validPayload } from './helpers.js';

// Build plan P6, "Done when": "no reporter text reaches any log call."
// Design §5: "The host gets log events with ids and outcome codes only
// ... never report text." This plants unique sentinels in every
// reporter-controlled string the handler ever sees — prose fields, the
// identity ref, and a header value — and asserts none of them appears in
// any logged event, across every path this handler can log from.

const SENTINEL_WHAT = 'SENTINEL-WHAT-9f21b6f0-do-not-log-me';
const SENTINEL_EXPECTED = 'SENTINEL-EXPECTED-3a77c1de-do-not-log-me';
const SENTINEL_REFERENCE = 'SENTINEL-REFERENCE-6b0e4a55-do-not-log-me';
const SENTINEL_REF = 'sentinel-identity-ref-c4d9';
const SENTINEL_HEADER = 'sentinel-header-value-8e21';

function sentinelPayload(): Record<string, unknown> {
  return validPayload({
    what_happened: SENTINEL_WHAT,
    expected: SENTINEL_EXPECTED,
    reference: SENTINEL_REFERENCE,
  });
}

function assertNoLeak(calls: unknown[][]): void {
  const serialised = JSON.stringify(calls);
  expect(serialised).not.toContain(SENTINEL_WHAT);
  expect(serialised).not.toContain(SENTINEL_EXPECTED);
  expect(serialised).not.toContain(SENTINEL_REFERENCE);
  expect(serialised).not.toContain(SENTINEL_REF);
  expect(serialised).not.toContain(SENTINEL_HEADER);
}

describe('no reporter content ever reaches a log call', () => {
  it('FEEDBACK_DELIVERED carries no sentinel', async () => {
    const log = vi.fn();
    const identity = makeIdentity({ ref: SENTINEL_REF, allowReference: true });
    const handler = createFeedbackHandler(
      baseConfig({ identify: vi.fn(async () => identity), sink: outcomeSink({ ok: true, number: 1, droppedLabels: [] }), log }),
    );

    const response = await handler(
      makeRequest({ headers: { 'x-sentinel': SENTINEL_HEADER }, body: JSON.stringify(sentinelPayload()) }),
    );

    expect(response.status).toBe(201);
    expect(log).toHaveBeenCalledTimes(1);
    assertNoLeak(log.mock.calls);
  });

  it('FEEDBACK_DELIVERY_FAILED (definitive) carries no sentinel', async () => {
    const log = vi.fn();
    const identity = makeIdentity({ ref: SENTINEL_REF });
    const handler = createFeedbackHandler(
      baseConfig({
        identify: vi.fn(async () => identity),
        sink: outcomeSink({ ok: false, definitive: true, code: 'forbidden', status: 403 }),
        log,
      }),
    );

    await handler(makeRequest({ headers: { 'x-sentinel': SENTINEL_HEADER }, body: JSON.stringify(sentinelPayload()) }));

    expect(log).toHaveBeenCalledTimes(1);
    assertNoLeak(log.mock.calls);
  });

  it('FEEDBACK_DELIVERY_UNCONFIRMED (non-definitive) carries no sentinel', async () => {
    const log = vi.fn();
    const identity = makeIdentity({ ref: SENTINEL_REF });
    const handler = createFeedbackHandler(
      baseConfig({
        identify: vi.fn(async () => identity),
        sink: outcomeSink({ ok: false, definitive: false, code: 'timeout' }),
        log,
      }),
    );

    await handler(makeRequest({ headers: { 'x-sentinel': SENTINEL_HEADER }, body: JSON.stringify(sentinelPayload()) }));

    expect(log).toHaveBeenCalledTimes(1);
    assertNoLeak(log.mock.calls);
  });

  it('FEEDBACK_DELIVERY_UNCONFIRMED (sink threw) carries no sentinel', async () => {
    const log = vi.fn();
    const identity = makeIdentity({ ref: SENTINEL_REF });
    const handler = createFeedbackHandler(
      baseConfig({
        identify: vi.fn(async () => identity),
        sink: throwingSink(new Error(`network failure near ${SENTINEL_WHAT}`)),
        log,
      }),
    );

    await handler(makeRequest({ headers: { 'x-sentinel': SENTINEL_HEADER }, body: JSON.stringify(sentinelPayload()) }));

    expect(log).toHaveBeenCalledTimes(1);
    assertNoLeak(log.mock.calls);
  });

  it('FEEDBACK_IDENTIFY_FAILED carries no sentinel, even when the thrown error message echoes one', async () => {
    const log = vi.fn();
    const handler = createFeedbackHandler(
      baseConfig({
        identify: vi.fn(async () => {
          throw new Error(`identity blew up near ${SENTINEL_WHAT}`);
        }),
        log,
      }),
    );

    await handler(makeRequest({ headers: { 'x-sentinel': SENTINEL_HEADER }, body: JSON.stringify(sentinelPayload()) }));

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: 'FEEDBACK_IDENTIFY_FAILED' });
    assertNoLeak(log.mock.calls);
  });

  it('FEEDBACK_LIMITER_FAILED carries no sentinel, even when the identity ref is a sentinel', async () => {
    const log = vi.fn();
    const identity = makeIdentity({ ref: SENTINEL_REF });
    const handler = createFeedbackHandler(
      baseConfig({
        identify: vi.fn(async () => identity),
        limiter: {
          take: vi.fn(async () => {
            throw new Error(`limiter blew up for ${SENTINEL_REF}`);
          }),
        },
        log,
      }),
    );

    await handler(makeRequest({ headers: { 'x-sentinel': SENTINEL_HEADER }, body: JSON.stringify(sentinelPayload()) }));

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: 'FEEDBACK_LIMITER_FAILED' });
    assertNoLeak(log.mock.calls);
  });

  it('no log call at all for an "invalid" refusal (nothing to check, but proves the quiet path stays quiet)', async () => {
    const log = vi.fn();
    const handler = createFeedbackHandler(baseConfig({ log }));

    await handler(
      makeRequest({ body: JSON.stringify(validPayload({ what_happened: SENTINEL_WHAT, kind: 'not-a-kind' })) }),
    );

    expect(log).not.toHaveBeenCalled();
  });
});
