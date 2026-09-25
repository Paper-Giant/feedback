import { describe, expect, it } from 'vitest';
import { createFeedbackHandler } from '../../dist/server/index.js';
import {
  baseConfig,
  countingStream,
  expectRefusal,
  expectStandardHeaders,
  makeRequest,
  ORIGIN,
  throwingLimiter,
} from './helpers.js';

// Build plan P6, "Done when": "a test per refusal (status, the sink never
// called, and the limiter never called for anything refused before or by
// identify)"; the ordering in design §5 is steps 1-6 below, each checked
// against the previous step so a wrong-order refactor would fail here
// even when every individual check still "works" in isolation.

describe('1. method', () => {
  it('refuses a GET with 405 and an Allow: POST header', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const response = await handler(makeRequest({ method: 'GET' }));

    await expectRefusal(response, 405, 'method_not_allowed');
    expect(response.headers.get('allow')).toBe('POST');
    expect(config.identify).not.toHaveBeenCalled();
    expect(config.limiter.take).not.toHaveBeenCalled();
    expect(config.sink.create).not.toHaveBeenCalled();
  });

  it('refuses PUT, DELETE and PATCH the same way', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const response = await handler(makeRequest({ method, body: '{}' }));
      await expectRefusal(response, 405, 'method_not_allowed');
    }
  });

  it('accepts lowercase "post" (method is compared case-insensitively)', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const response = await handler(makeRequest({ method: 'post' }));
    // Not a 405 — it proceeds far enough to reach delivery.
    expect(response.status).not.toBe(405);
  });
});

describe('2. credentials not allowed', () => {
  it('refuses a request carrying Authorization, before checking content type or origin', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const response = await handler(
      makeRequest({ contentType: 'text/plain', origin: 'https://evil.example', headers: { authorization: 'Bearer x' } }),
    );

    await expectRefusal(response, 400, 'credentials_not_allowed');
    expect(config.identify).not.toHaveBeenCalled();
    expect(config.limiter.take).not.toHaveBeenCalled();
    expect(config.sink.create).not.toHaveBeenCalled();
  });

  it('refuses a request carrying X-Api-Key', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const response = await handler(makeRequest({ headers: { 'x-api-key': 'k' } }));
    await expectRefusal(response, 400, 'credentials_not_allowed');
  });

  it('is case-insensitive on both header names', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const response = await handler(makeRequest({ headers: { 'X-API-KEY': 'k' } }));
    await expectRefusal(response, 400, 'credentials_not_allowed');
  });
});

describe('3. media type', () => {
  it('refuses a missing Content-Type', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const response = await handler(makeRequest({ contentType: null }));
    await expectRefusal(response, 415, 'unsupported_media_type');
    expect(config.identify).not.toHaveBeenCalled();
  });

  it('refuses text/plain', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ contentType: 'text/plain' }));
    await expectRefusal(response, 415, 'unsupported_media_type');
  });

  it('accepts application/json with no parameters', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ contentType: 'application/json' }));
    expect(response.status).not.toBe(415);
  });

  it('accepts application/json; charset=utf-8', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ contentType: 'application/json; charset=utf-8' }));
    expect(response.status).not.toBe(415);
  });

  it('accepts charset=UTF-8 and the media type in any case', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ contentType: 'APPLICATION/JSON;CHARSET=UTF-8' }));
    expect(response.status).not.toBe(415);
  });

  it('refuses a different charset', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ contentType: 'application/json; charset=utf-16' }));
    await expectRefusal(response, 415, 'unsupported_media_type');
  });

  it('refuses an unrecognised second parameter', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ contentType: 'application/json; boundary=x' }));
    await expectRefusal(response, 415, 'unsupported_media_type');
  });

  it('refuses more than one parameter', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(
      makeRequest({ contentType: 'application/json; charset=utf-8; boundary=x' }),
    );
    await expectRefusal(response, 415, 'unsupported_media_type');
  });

  it('refuses application/json with a trailing empty parameter', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ contentType: 'application/json;' }));
    await expectRefusal(response, 415, 'unsupported_media_type');
  });

  it('refuses application/json+ld and other near misses', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ contentType: 'application/json+ld' }));
    await expectRefusal(response, 415, 'unsupported_media_type');
  });
});

describe('4. origin and Sec-Fetch-Site', () => {
  it('refuses a missing Origin header, checked before body size', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const response = await handler(
      makeRequest({ origin: null, headers: { 'content-length': '999999999' } }),
    );
    await expectRefusal(response, 403, 'forbidden_origin');
    expect(config.identify).not.toHaveBeenCalled();
  });

  it('refuses the literal Origin: null (an opaque-origin request)', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ origin: 'null' }));
    await expectRefusal(response, 403, 'forbidden_origin');
  });

  it('refuses an origin not in the configured list', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ origin: 'https://evil.example' }));
    await expectRefusal(response, 403, 'forbidden_origin');
  });

  it('refuses an origin differing only by scheme', async () => {
    const handler = createFeedbackHandler(baseConfig({ origins: ['https://app.example'] }));
    const response = await handler(makeRequest({ origin: 'http://app.example' }));
    await expectRefusal(response, 403, 'forbidden_origin');
  });

  it('refuses an origin with a trailing slash even if the bare origin is configured', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ origin: `${ORIGIN}/` }));
    await expectRefusal(response, 403, 'forbidden_origin');
  });

  it('accepts an exactly configured origin', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ origin: ORIGIN }));
    expect(response.status).not.toBe(403);
  });

  it('accepts whichever of several configured origins is sent', async () => {
    const handler = createFeedbackHandler(baseConfig({ origins: [ORIGIN, 'https://other.example'] }));
    const response = await handler(makeRequest({ origin: 'https://other.example' }));
    expect(response.status).not.toBe(403);
  });

  it('refuses Sec-Fetch-Site: cross-site', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ secFetchSite: 'cross-site' }));
    await expectRefusal(response, 403, 'forbidden_origin');
  });

  it('refuses Sec-Fetch-Site: same-site', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ secFetchSite: 'same-site' }));
    await expectRefusal(response, 403, 'forbidden_origin');
  });

  it('refuses Sec-Fetch-Site: none', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ secFetchSite: 'none' }));
    await expectRefusal(response, 403, 'forbidden_origin');
  });

  it('accepts Sec-Fetch-Site: same-origin', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ secFetchSite: 'same-origin' }));
    expect(response.status).not.toBe(403);
  });

  it('refuses a request with no Sec-Fetch-Site header at all (the signed design requires it, exactly same-origin)', async () => {
    // Task review of P6: an earlier revision accepted a missing header on
    // the theory that the exact Origin check above was gate enough — that
    // is not what was signed off. This does mean a browser with no Fetch
    // Metadata support (Safari before 16.4) can never satisfy this check;
    // accepted as a deliberate narrowing to browsers new enough to send it.
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const response = await handler(makeRequest({ secFetchSite: null }));
    await expectRefusal(response, 403, 'forbidden_origin');
    expect(config.identify).not.toHaveBeenCalled();
    expect(config.limiter.take).not.toHaveBeenCalled();
    expect(config.sink.create).not.toHaveBeenCalled();
  });
});

describe('5. body size', () => {
  it('refuses a Content-Length over the cap without reading the body', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const { stream, pullCount } = countingStream([new Uint8Array(10)]);

    const response = await handler(
      makeRequest({ headers: { 'content-length': '32769' }, body: stream as unknown as BodyInit }),
    );

    await expectRefusal(response, 413, 'too_large');
    expect(pullCount()).toBe(0);
    expect(config.identify).not.toHaveBeenCalled();
  });

  it('accepts a Content-Length exactly at the cap (413 is only for exceeding it)', async () => {
    // No streaming body needed here — a mismatched/absent body is fine;
    // this only proves the boundary itself isn't refused by the
    // Content-Length pre-check (bad_json is expected once it reads an
    // empty body, which is the correct outcome for "not 413").
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(
      makeRequest({ headers: { 'content-length': '32768' }, body: undefined }),
    );
    expect(response.status).not.toBe(413);
  });

  it('refuses a streamed body that exceeds the cap, cancelling the stream without reading past it', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);

    // Ten 20000-byte chunks (200000 bytes total) — if the handler ever
    // read the whole thing, pull() would be called ten times. The cap
    // (32768) is crossed on the second chunk (20000 + 20000 = 40000).
    const chunks = Array.from({ length: 10 }, () => new Uint8Array(20000));
    const { stream, pullCount, cancelled } = countingStream(chunks);

    const response = await handler(makeRequest({ body: stream as unknown as BodyInit }));

    await expectRefusal(response, 413, 'too_large');
    expect(cancelled()).toBe(true);
    // Well short of the 10 pulls a full read would need.
    expect(pullCount()).toBeLessThan(5);
    expect(config.identify).not.toHaveBeenCalled();
  });

  it('accepts a streamed body under the cap', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const { stream } = countingStream([new TextEncoder().encode(JSON.stringify({ ok: true }))]);
    const response = await handler(makeRequest({ body: stream as unknown as BodyInit }));
    expect(response.status).not.toBe(413);
  });
});

describe('body read errors (task review fix: never an unhandled rejection out of the handler)', () => {
  it('refuses with bad_json and logs FEEDBACK_BODY_UNREADABLE when the body stream errors mid-read', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const erroringStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('simulated upload failure'));
      },
    });

    const response = await handler(makeRequest({ body: erroringStream as unknown as BodyInit }));

    await expectRefusal(response, 400, 'bad_json');
    expect(config.identify).not.toHaveBeenCalled();
    expect(config.log).toHaveBeenCalledTimes(1);
    expect(config.log).toHaveBeenCalledWith({ event: 'FEEDBACK_BODY_UNREADABLE' });
  });

  it('refuses with bad_json and logs FEEDBACK_BODY_UNREADABLE when the request body is already locked (a host read it without cloning)', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const request = makeRequest();
    // Simulates the scenario the config's JSDoc warns about: something
    // upstream of this handler already called request.body.getReader()
    // (e.g. logging middleware) and never released the lock, instead of
    // reading a request.clone(). getReader() inside the handler then
    // throws synchronously, which readCappedBody (an async function)
    // turns into a rejected promise the handler must still catch.
    request.body?.getReader();

    const response = await handler(request);

    await expectRefusal(response, 400, 'bad_json');
    expect(config.identify).not.toHaveBeenCalled();
    expect(config.log).toHaveBeenCalledTimes(1);
    expect(config.log).toHaveBeenCalledWith({ event: 'FEEDBACK_BODY_UNREADABLE' });
  });

  it('never carries a CORS header, and carries the standard headers, on this refusal', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const erroringStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('simulated upload failure'));
      },
    });
    const response = await handler(makeRequest({ body: erroringStream as unknown as BodyInit }));
    expectStandardHeaders(response);
  });
});

describe('6. JSON parse / UTF-8', () => {
  it('refuses a body that is not valid JSON', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);
    const response = await handler(makeRequest({ body: 'this is not json' }));
    await expectRefusal(response, 400, 'bad_json');
    expect(config.identify).not.toHaveBeenCalled();
  });

  it('refuses an empty body', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ body: '' }));
    await expectRefusal(response, 400, 'bad_json');
  });

  it('refuses invalid UTF-8 bytes', async () => {
    const handler = createFeedbackHandler(baseConfig());
    // 0xFF is never a valid UTF-8 lead byte.
    const response = await handler(
      makeRequest({ body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) }),
    );
    await expectRefusal(response, 400, 'bad_json');
  });

  it('refuses valid JSON that is not an object (a bare string)', async () => {
    // This reaches validatePayload, not bad_json — included here to pin
    // down the boundary: JSON.parse succeeding is what step 6 checks for.
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ body: '"just a string"' }));
    const parsed = await expectRefusal(response, 422, 'invalid');
    expect(parsed).toMatchObject({ code: 'invalid' });
  });
});

describe('response headers on every refusal', () => {
  it('never carries a CORS header, even for a cross-origin refusal', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ origin: 'https://evil.example' }));
    expectStandardHeaders(response);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('limiter is never reached when a step before it refuses', () => {
  it('does not call a throwing limiter when the request never gets past origin', async () => {
    const limiter = throwingLimiter();
    const handler = createFeedbackHandler(baseConfig({ limiter }));
    const response = await handler(makeRequest({ origin: 'https://evil.example' }));
    await expectRefusal(response, 403, 'forbidden_origin');
    expect(limiter.take).not.toHaveBeenCalled();
  });
});
