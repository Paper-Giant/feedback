import { describe, expect, it, vi } from 'vitest';
import { createFeedbackHandler } from '../../dist/server/index.js';
import { parseFeedbackResponse } from '../../dist/core/index.js';
import { baseConfig, expectStandardHeaders, makeRequest, outcomeSink, throwingSink, validPayload } from './helpers.js';

// Build plan P6 step 11; design §5 "Delivery states". Every SinkOutcome
// shape githubSink() (task P5) can produce is mapped here, plus the sink
// throwing unexpectedly (the design's contract says it never does, but the
// handler treats that the same as any other non-definitive/inconclusive
// outcome — "it may have dispatched").

const REPORT_ID = '11111111-1111-4111-8111-111111111111';

describe('11. delivery — received', () => {
  it('201s with the receipt and logs FEEDBACK_DELIVERED with report_id and number', async () => {
    const log = vi.fn();
    const sink = outcomeSink({ ok: true, number: 123, url: 'https://github.com/o/r/issues/123', droppedLabels: [] });
    const handler = createFeedbackHandler(baseConfig({ sink, log }));

    const response = await handler(makeRequest());

    expect(response.status).toBe(201);
    expectStandardHeaders(response);
    const parsed = parseFeedbackResponse(await response.json());
    expect(parsed).toEqual({ status: 'received', receipt: '#123' });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: 'FEEDBACK_DELIVERED', report_id: REPORT_ID, number: 123 });
  });

  it('passes the rendered ticket to sink.create', async () => {
    const sink = outcomeSink({ ok: true, number: 1, droppedLabels: [] });
    const handler = createFeedbackHandler(baseConfig({ sink, app: 'fixture', displayName: 'Fixture', environment: 'test' }));

    await handler(makeRequest({ body: JSON.stringify(validPayload({ kind: 'bug' })) }));

    expect(sink.create).toHaveBeenCalledTimes(1);
    const ticket = vi.mocked(sink.create).mock.calls[0]![0];
    expect(ticket.title).toContain('Fixture');
    expect(ticket.title).toContain('Bug');
    expect(ticket.labels).toEqual(
      expect.arrayContaining(['source:in-app', 'app:fixture', 'env:test', 'kind:bug']),
    );
  });
});

describe('11. delivery — definitive refusal (not_sent)', () => {
  it('maps sink code "credential" to not_sent code "credential", status 502', async () => {
    const log = vi.fn();
    const sink = outcomeSink({ ok: false, definitive: true, code: 'credential' });
    const handler = createFeedbackHandler(baseConfig({ sink, log }));

    const response = await handler(makeRequest());

    expect(response.status).toBe(502);
    const parsed = parseFeedbackResponse(await response.json());
    expect(parsed).toEqual({ status: 'not_sent', code: 'credential' });
    expect(log).toHaveBeenCalledWith({
      event: 'FEEDBACK_DELIVERY_FAILED',
      report_id: REPORT_ID,
      code: 'credential',
      status: null,
    });
  });

  it('maps sink code "rate_limited" to not_sent code "rate_limited", status 502', async () => {
    const sink = outcomeSink({ ok: false, definitive: true, code: 'rate_limited', status: 429 });
    const handler = createFeedbackHandler(baseConfig({ sink }));

    const response = await handler(makeRequest());

    expect(response.status).toBe(502);
    const parsed = parseFeedbackResponse(await response.json());
    expect(parsed).toEqual({ status: 'not_sent', code: 'rate_limited' });
  });

  it.each(['bad_request', 'unauthorised', 'forbidden', 'not_found', 'gone', 'validation'])(
    'maps every other definitive sink code (%s) to not_sent code "tracker_refused"',
    async (code) => {
      const sink = outcomeSink({ ok: false, definitive: true, code, status: 422 });
      const handler = createFeedbackHandler(baseConfig({ sink }));

      const response = await handler(makeRequest());

      expect(response.status).toBe(502);
      const parsed = parseFeedbackResponse(await response.json());
      expect(parsed).toEqual({ status: 'not_sent', code: 'tracker_refused' });
    },
  );

  it('logs the sink status when present, null when absent', async () => {
    const log = vi.fn();
    const sink = outcomeSink({ ok: false, definitive: true, code: 'forbidden', status: 403 });
    const handler = createFeedbackHandler(baseConfig({ sink, log }));

    await handler(makeRequest());

    expect(log).toHaveBeenCalledWith({
      event: 'FEEDBACK_DELIVERY_FAILED',
      report_id: REPORT_ID,
      code: 'forbidden',
      status: 403,
    });
  });
});

describe('11. delivery — non-definitive (unconfirmed)', () => {
  it.each(['timeout', 'network', 'unparseable_success', 'server_error', 'unexpected_status'])(
    'maps a non-definitive sink code (%s) to 202 unconfirmed with the report_id',
    async (code) => {
      const log = vi.fn();
      const sink = outcomeSink({ ok: false, definitive: false, code, status: 500 });
      const handler = createFeedbackHandler(baseConfig({ sink, log }));

      const response = await handler(makeRequest());

      expect(response.status).toBe(202);
      expectStandardHeaders(response);
      const parsed = parseFeedbackResponse(await response.json());
      expect(parsed).toEqual({ status: 'unconfirmed', report_id: REPORT_ID });
      expect(log).toHaveBeenCalledWith({
        event: 'FEEDBACK_DELIVERY_UNCONFIRMED',
        report_id: REPORT_ID,
        code,
        status: 500,
      });
    },
  );

  it('treats a throwing sink.create as unconfirmed, since it may have dispatched', async () => {
    const log = vi.fn();
    const sink = throwingSink(new Error('fetch blew up'));
    const handler = createFeedbackHandler(baseConfig({ sink, log }));

    const response = await handler(makeRequest());

    expect(response.status).toBe(202);
    const parsed = parseFeedbackResponse(await response.json());
    expect(parsed).toEqual({ status: 'unconfirmed', report_id: REPORT_ID });
    expect(log).toHaveBeenCalledTimes(1);
    const event = vi.mocked(log).mock.calls[0]![0];
    expect(event.event).toBe('FEEDBACK_DELIVERY_UNCONFIRMED');
    expect(event.report_id).toBe(REPORT_ID);
  });
});
