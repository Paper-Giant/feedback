import { describe, expect, it, vi } from 'vitest';
import { createFeedbackHandler } from '../../dist/server/index.js';
import { parseFeedbackResponse } from '../../dist/core/index.js';
import { baseConfig, expectRefusal, makeIdentity, makeRequest, outcomeSink, validPayload } from './helpers.js';

// Build plan P6 steps 9-10; design §4/§5. Step 9's `fields` must be the
// distinct invalid field names, in order, capped at 20. Step 10
// (FeedbackTicketTooLargeError -> 422 too_long) goes through the real
// `renderTicket` (core) — no test seam: task review of P6 found the
// handler previously carried an `@internal renderTicket` config override
// for this, which would have shipped in the published `.d.ts` and let a
// host substitute a renderer that reads title/source-hint/build-skew
// straight off the payload, defeating design §4's "the server derives
// these, never the browser" rule. `too_long` IS reachable through real
// input after all: while no *payload* field alone can push the rendered
// body over the ceiling (test/core/limits.test.ts proves every field at
// its cap still renders under it), a *host-configured* area source hint
// has no such cap — `renderTicket` embeds it verbatim — so an oversized
// one does the job below.

describe('9. validation', () => {
  it('refuses with 422 invalid and the distinct invalid field names, without rendering or calling the sink', async () => {
    const config = baseConfig();
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest({ body: JSON.stringify(validPayload({ what_happened: undefined })) }));

    const parsed = await expectRefusal(response, 422, 'invalid');
    expect(parsed).toMatchObject({ code: 'invalid', fields: ['what_happened'] });
    expect(config.sink.create).not.toHaveBeenCalled();
  });

  it('lists more than one distinct field when more than one is wrong', async () => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(
      makeRequest({ body: JSON.stringify(validPayload({ what_happened: undefined, kind: 'not-a-kind' })) }),
    );
    const parsed = await expectRefusal(response, 422, 'invalid');
    expect(parsed).toMatchObject({ fields: expect.arrayContaining(['what_happened', 'kind']) });
    expect((parsed as { fields: string[] }).fields).toHaveLength(2);
  });

  it('collapses every unknown property — any name, top-level or nested under client — into one canonical "unknown_field" entry', async () => {
    // Task review of P6: an unknown property's own field name is the
    // attacker's arbitrary JSON key, not a name validatePayload chose —
    // 25 distinct hostile-shaped keys here (digits, a very long name, and
    // a markup-shaped one), none of which are safe to echo back, and none
    // of which should ever appear in the response. They all collapse to
    // the one literal 'unknown_field' instead.
    const hostileTopLevelKeys = {
      bogus1: 'x',
      bogus2: 'x',
      [`very_long_${'x'.repeat(80)}`]: 'x',
      '<script>alert(1)</script>': 'x',
      "'; DROP TABLE reports; --": 'x',
    };
    const handler = createFeedbackHandler(baseConfig());

    const response = await handler(
      makeRequest({
        body: JSON.stringify(
          validPayload({
            ...hostileTopLevelKeys,
            client: { bogus_client_field: 'y', another_bogus_one: 'z' },
          }),
        ),
      }),
    );

    const parsed = await expectRefusal(response, 422, 'invalid');
    expect(parsed).toMatchObject({ fields: ['unknown_field'] });
  });

  it('the 20-field cap and dedup still apply when unknown_field is mixed with genuine field errors', async () => {
    // The full canonical vocabulary validatePayload can name (schema,
    // report_id, kind, what_happened, expected, reference, diagnostic,
    // client, client.release, client.commit, client.browser,
    // client.viewport, client.locale, client.timezone) plus the collapsed
    // 'unknown_field' placeholder is at most 15 distinct entries — well
    // under the 20 cap, so this proves dedup/ordering rather than the cap
    // itself (a literal 20-distinct-canonical-field payload does not
    // exist to construct).
    const handler = createFeedbackHandler(baseConfig());

    const response = await handler(
      makeRequest({
        body: JSON.stringify({
          schema: 'not-feedback/v1',
          report_id: 'not-a-uuid',
          kind: 'not-a-kind',
          what_happened: '',
          reference: 'z'.repeat(1000),
          diagnostic: 'not a valid diagnostic',
          bogus_top_level_a: 'x',
          bogus_top_level_b: 'x',
          client: {
            release: 1,
            commit: 'not-hex',
            browser: 2,
            viewport: 3,
            locale: 4,
            timezone: 5,
            bogus_client_field: 'y',
          },
        }),
      }),
    );

    const parsed = await expectRefusal(response, 422, 'invalid');
    const fields = (parsed as { fields: string[] }).fields;
    expect(fields.length).toBe(new Set(fields).size); // no duplicates
    expect(fields.length).toBeLessThanOrEqual(20);
    expect(fields).toContain('unknown_field');
    expect(fields).toEqual(
      expect.arrayContaining([
        'schema',
        'report_id',
        'kind',
        'what_happened',
        'reference',
        'diagnostic',
        'client.release',
        'client.commit',
        'client.browser',
        'client.viewport',
        'client.locale',
        'client.timezone',
      ]),
    );
    // Exactly one entry stands in for every one of the (at least) three
    // distinct raw unknown keys above.
    expect(fields.filter((field) => field === 'unknown_field')).toHaveLength(1);
  });

  // Task review of P6, done-when: "handler -> parseFeedbackResponse
  // round-trip tests with digits, long names and markup-shaped names —
  // every response must parse non-null." Each of these, sent unfixed,
  // would have failed core/response.ts's field pattern
  // (/^[a-z_.]{1,40}$/) and made parseFeedbackResponse return null for
  // the whole body — a definitive 422 `invalid` refusal indistinguishable,
  // to a browser, from "delivery unconfirmed".
  it.each([
    ['digits in the name', { bogus123: 'x', another9: 'y' }],
    ['a name over the 40-character field-pattern limit', { [`x`.repeat(60)]: 'x' }],
    ['a markup-shaped name', { '<img src=x onerror=alert(1)>': 'x' }],
    ['a name with punctuation the field pattern forbids', { "'; DROP TABLE reports; --": 'x' }],
    ['an empty-string key', { '': 'x' }],
  ])('parses non-null through parseFeedbackResponse for an unknown field with %s', async (_name, bogus) => {
    const handler = createFeedbackHandler(baseConfig());
    const response = await handler(makeRequest({ body: JSON.stringify(validPayload(bogus)) }));

    const raw = await response.json();
    const parsed = parseFeedbackResponse(raw);

    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({ status: 'not_sent', code: 'invalid', fields: ['unknown_field'] });
  });

  it('rejects a staff-only reference field when the identity does not allow it', async () => {
    const config = baseConfig({ identify: vi.fn(async () => makeIdentity({ allowReference: false })) });
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest({ body: JSON.stringify(validPayload({ reference: 'ABC-123' })) }));

    const parsed = await expectRefusal(response, 422, 'invalid');
    expect(parsed).toMatchObject({ fields: ['reference'] });
  });

  it('accepts the same reference field when the identity does allow it', async () => {
    const config = baseConfig({ identify: vi.fn(async () => makeIdentity({ allowReference: true })) });
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest({ body: JSON.stringify(validPayload({ reference: 'ABC-123' })) }));

    expect(response.status).toBe(201);
  });
});

describe('10. ticket rendering', () => {
  it('refuses with 422 too_long when a configured area source hint pushes the rendered body past the ceiling, without calling the sink', async () => {
    const config = baseConfig({ areas: { big: 'x'.repeat(60001) } });
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest({ body: JSON.stringify(validPayload({ area: 'big' })) }));

    await expectRefusal(response, 422, 'too_long');
    expect(config.sink.create).not.toHaveBeenCalled();
  });

  it('an ordinary area hint renders fine — too_long is specific to an oversized one, not every configured area', async () => {
    const config = baseConfig({ areas: { small: 'app/some/page.tsx' } });
    const handler = createFeedbackHandler(config);

    const response = await handler(makeRequest({ body: JSON.stringify(validPayload({ area: 'small' })) }));

    expect(response.status).not.toBe(422);
    expect(response.status).toBe(201);
  });

  it('passes sink.create a ticket built from the validated payload, the identity and receivedAt from now()', async () => {
    const identity = makeIdentity({ ref: 'render-test-ref' });
    const receivedAt = new Date('2026-01-02T03:04:05.000Z');
    const sink = outcomeSink({ ok: true, number: 1, droppedLabels: [] });
    const config = baseConfig({
      identify: vi.fn(async () => identity),
      sink,
      now: () => receivedAt,
    });
    const handler = createFeedbackHandler(config);

    await handler(makeRequest({ body: JSON.stringify(validPayload({ kind: 'bug' })) }));

    expect(sink.create).toHaveBeenCalledTimes(1);
    const ticket = vi.mocked(sink.create).mock.calls[0]![0];
    // received_at, formatted per ticket.ts's formatReceivedAt (no milliseconds).
    expect(ticket.body).toContain('"received_at": "2026-01-02T03:04:05Z"');
    expect(ticket.body).toContain('"ref": "render-test-ref"');
    expect(ticket.labels).toEqual(
      expect.arrayContaining(['source:in-app', `app:${config.app}`, `env:${config.environment}`, 'kind:bug']),
    );
  });
});
