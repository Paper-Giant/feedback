import { describe, expect, it, vi } from 'vitest';
import { createFeedbackHandler } from '../../dist/server/index.js';
import { baseConfig, expectRefusal, makeIdentity, makeRequest, okLimiter, throwingLimiter } from './helpers.js';

// Design §5 "Identity" / "Limits"; build plan P6 steps 7-8. The limiter is
// called only after identify has accepted the person, keyed by
// `identity.ref` — and a throw from either fails closed.

describe('7. identify', () => {
  it('refuses with 401 when identify resolves null, without calling the limiter or sink', async () => {
    const config = baseConfig({ identify: vi.fn(async () => null) });
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest());

    await expectRefusal(response, 401, 'unauthenticated');
    expect(config.limiter.take).not.toHaveBeenCalled();
    expect(config.sink.create).not.toHaveBeenCalled();
    expect(config.log).not.toHaveBeenCalled();
  });

  it('refuses with 401 when identify resolves undefined (a JavaScript host that forgot to return)', async () => {
    const config = baseConfig({ identify: vi.fn(async () => undefined as never) });
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest());

    await expectRefusal(response, 401, 'unauthenticated');
    expect(config.limiter.take).not.toHaveBeenCalled();
    expect(config.sink.create).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty ref', { ref: '', role: 'staff', surface: 'staff', allowReference: false }],
    ['no ref', { role: 'staff', surface: 'staff', allowReference: false }],
    ['a non-boolean allowReference', { ref: 'p1', role: 'staff', surface: 'staff', allowReference: 'yes' }],
    ['a string', 'p1'],
  ])('refuses with 401 and logs FEEDBACK_IDENTIFY_FAILED when identify returns %s', async (_name, value) => {
    const log = vi.fn();
    const config = baseConfig({ identify: vi.fn(async () => value as never), log });
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest());

    await expectRefusal(response, 401, 'unauthenticated');
    expect(config.limiter.take).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({ event: 'FEEDBACK_IDENTIFY_FAILED' });
  });

  it('refuses with 401 and logs FEEDBACK_IDENTIFY_FAILED when identify throws', async () => {
    const log = vi.fn();
    const config = baseConfig({
      identify: vi.fn(async () => {
        throw new Error('session lookup exploded');
      }),
      log,
    });
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest());

    await expectRefusal(response, 401, 'unauthenticated');
    expect(config.limiter.take).not.toHaveBeenCalled();
    expect(config.sink.create).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: 'FEEDBACK_IDENTIFY_FAILED' });
  });

  it('is called with the request', async () => {
    const identify = vi.fn(async () => makeIdentity());
    const handler = createFeedbackHandler(baseConfig({ identify }));
    const request = makeRequest();

    await handler(request);

    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith(request);
  });
});

describe('8. limiter', () => {
  it('is called with identity.ref only after identify accepts the person', async () => {
    const limiter = okLimiter();
    const identity = makeIdentity({ ref: 'ref-under-test' });
    const handler = createFeedbackHandler(baseConfig({ identify: vi.fn(async () => identity), limiter }));

    await handler(makeRequest());

    expect(limiter.take).toHaveBeenCalledTimes(1);
    expect(limiter.take).toHaveBeenCalledWith('ref-under-test');
  });

  it('refuses with 429 rate_limited when the limiter reports limited, without calling the sink', async () => {
    const config = baseConfig({ limiter: okLimiter('limited') });
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest());

    await expectRefusal(response, 429, 'rate_limited');
    expect(config.sink.create).not.toHaveBeenCalled();
  });

  it('refuses with 503 limiter_unavailable and logs FEEDBACK_LIMITER_FAILED when the limiter throws', async () => {
    const log = vi.fn();
    const limiter = throwingLimiter(new Error('db down'));
    const config = baseConfig({ limiter, log });
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest());

    await expectRefusal(response, 503, 'limiter_unavailable');
    expect(config.sink.create).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: 'FEEDBACK_LIMITER_FAILED' });
  });

  it('a LimiterError thrown by the limiter is treated the same as any other throw', async () => {
    // Limiter is a fail-closed contract regardless of the error's class
    // (design §5 "Limits": "a throw means refuse").
    const limiter = throwingLimiter('not even an Error instance');
    const handler = createFeedbackHandler(baseConfig({ limiter }));
    const response = await handler(makeRequest());
    await expectRefusal(response, 503, 'limiter_unavailable');
  });

  // The Limiter interface's return type promises exactly 'ok' | 'limited',
  // but that's compile-time only — a malformed third-party Limiter can
  // still resolve to anything at runtime. Only an exact 'ok' may proceed
  // (task review of P6): everything else here refuses the same way a
  // throw does, never silently lets the request through.
  it.each([
    ['undefined (a host that forgot to return)', undefined],
    ['null', null],
    ['true', true],
    ['false', false],
    ['an unexpected string', 'maybe'],
    ['a number', 1],
    ['an empty object', {}],
    ['the string "Ok" (case matters — not the exact literal "ok")', 'Ok'],
  ])(
    'refuses with 503 limiter_unavailable and logs FEEDBACK_LIMITER_FAILED when the limiter resolves %s instead of exactly "ok" or "limited"',
    async (_name, value) => {
      const log = vi.fn();
      const limiter = { take: vi.fn(async () => value as never) };
      const config = baseConfig({ limiter, log });
      const handler = createFeedbackHandler(config);

      const response = await handler(makeRequest());

      await expectRefusal(response, 503, 'limiter_unavailable');
      expect(config.sink.create).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith({ event: 'FEEDBACK_LIMITER_FAILED' });
    },
  );
});
