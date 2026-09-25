import { describe, expect, it } from 'vitest';
import { NOT_SENT_CODES, parseFeedbackResponse } from '../../dist/core/index.js';

const UUID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('parseFeedbackResponse', () => {
  it('accepts a received reply with a receipt', () => {
    expect(parseFeedbackResponse({ status: 'received', receipt: '#123' })).toEqual({
      status: 'received',
      receipt: '#123',
    });
  });

  it('accepts every not-sent code, with and without fields', () => {
    for (const code of NOT_SENT_CODES) {
      expect(parseFeedbackResponse({ status: 'not_sent', code })).toEqual({ status: 'not_sent', code });
    }
    expect(parseFeedbackResponse({ status: 'not_sent', code: 'invalid', fields: ['what_happened'] })).toEqual({
      status: 'not_sent',
      code: 'invalid',
      fields: ['what_happened'],
    });
  });

  it('accepts an unconfirmed reply with a report id', () => {
    expect(parseFeedbackResponse({ status: 'unconfirmed', report_id: UUID })).toEqual({
      status: 'unconfirmed',
      report_id: UUID,
    });
  });

  it.each([
    ['null', null],
    ['a string', '{"status":"received"}'],
    ['an array', [{ status: 'received', receipt: '#1' }]],
    ['an unknown status', { status: 'ok' }],
    ['a receipt without #', { status: 'received', receipt: '123' }],
    ['a receipt #0', { status: 'received', receipt: '#0' }],
    ['a receipt with text', { status: 'received', receipt: '#12 <b>' }],
    ['an unknown code', { status: 'not_sent', code: 'nope' }],
    ['fields that are not strings', { status: 'not_sent', code: 'invalid', fields: [1] }],
    ['fields with markup', { status: 'not_sent', code: 'invalid', fields: ['<img>'] }],
    ['an unconfirmed reply without an id', { status: 'unconfirmed' }],
    ['an unconfirmed reply with a bad id', { status: 'unconfirmed', report_id: 'x' }],
  ])('returns null for %s', (_name, body) => {
    expect(parseFeedbackResponse(body)).toBeNull();
  });
});
