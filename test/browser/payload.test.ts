import { describe, expect, it } from 'vitest';
import { assembleOutboundPayload, createEmptyDraft } from '../../dist/browser/index.js';
import type { FeedbackDraft } from '../../dist/browser/index.js';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';

function baseDraft(overrides: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return { ...createEmptyDraft(REPORT_ID), kind: 'bug', whatHappened: 'It broke.', ...overrides };
}

describe('createEmptyDraft()', () => {
  it('starts with kind "help", every text field blank, and no area', () => {
    expect(createEmptyDraft(REPORT_ID)).toEqual({
      reportId: REPORT_ID,
      kind: 'help',
      whatHappened: '',
      expected: '',
      reference: '',
      area: null,
    });
  });
});

describe('assembleOutboundPayload()', () => {
  it('sends only the allowed top-level keys for a minimal bug report', () => {
    const payload = assembleOutboundPayload(baseDraft(), { areas: [], allowReference: false, client: {} });
    expect(Object.keys(payload).sort()).toEqual(['area', 'kind', 'report_id', 'schema', 'what_happened']);
    expect(payload).toEqual({
      schema: 'feedback/v1',
      report_id: REPORT_ID,
      kind: 'bug',
      what_happened: 'It broke.',
      area: 'unknown',
    });
  });

  it('never includes a "client" key when no client facts are given', () => {
    const payload = assembleOutboundPayload(baseDraft(), { areas: [], allowReference: false, client: {} });
    expect(payload).not.toHaveProperty('client');
  });

  it('includes only the client facts that are present, omitting empty build values', () => {
    const payload = assembleOutboundPayload(baseDraft(), {
      areas: [],
      allowReference: false,
      client: { release: '2026.09.29-9f4c2a1', browser: 'Chrome 128 · macOS', viewport: '1280x800', locale: 'en-AU', timezone: 'Australia/Melbourne' },
    });
    expect(Object.keys(payload.client ?? {}).sort()).toEqual(['browser', 'locale', 'release', 'timezone', 'viewport']);
    expect(payload.client).not.toHaveProperty('commit');
  });

  it('includes commit only when non-empty', () => {
    const withCommit = assembleOutboundPayload(baseDraft(), {
      areas: [],
      allowReference: false,
      client: { commit: '9f4c2a1d7e803bd2a61549c0e176fed32208aabc' },
    });
    expect(withCommit.client).toEqual({ commit: '9f4c2a1d7e803bd2a61549c0e176fed32208aabc' });

    const withoutCommit = assembleOutboundPayload(baseDraft(), { areas: [], allowReference: false, client: { commit: '' } });
    expect(withoutCommit.client).toBeUndefined();
  });

  describe('area resolution — decided before the request is built', () => {
    it('sends the area key when it is in the configured list', () => {
      const payload = assembleOutboundPayload(baseDraft({ area: 'checkout-wizard' }), {
        areas: ['checkout-wizard', 'dashboard'],
        allowReference: false,
        client: {},
      });
      expect(payload.area).toBe('checkout-wizard');
    });

    it('replaces an area not in the configured list with "unknown"', () => {
      const payload = assembleOutboundPayload(baseDraft({ area: 'nonexistent-page' }), {
        areas: ['checkout-wizard'],
        allowReference: false,
        client: {},
      });
      expect(payload.area).toBe('unknown');
    });

    it('sends "unknown" when no area was ever set', () => {
      const payload = assembleOutboundPayload(baseDraft({ area: null }), {
        areas: ['checkout-wizard'],
        allowReference: false,
        client: {},
      });
      expect(payload.area).toBe('unknown');
    });

    it('replaces a stale area left over after the host reconfigures its area list', () => {
      const payload = assembleOutboundPayload(baseDraft({ area: 'old-page' }), {
        areas: ['new-page'],
        allowReference: false,
        client: {},
      });
      expect(payload.area).toBe('unknown');
    });
  });

  describe('expected — bug-only', () => {
    it('includes expected for a bug with non-blank expected text', () => {
      const payload = assembleOutboundPayload(baseDraft({ kind: 'bug', expected: 'It should continue.' }), {
        areas: [],
        allowReference: false,
        client: {},
      });
      expect(payload.expected).toBe('It should continue.');
    });

    it('omits expected for a bug when the field is blank', () => {
      const payload = assembleOutboundPayload(baseDraft({ kind: 'bug', expected: '   ' }), {
        areas: [],
        allowReference: false,
        client: {},
      });
      expect(payload).not.toHaveProperty('expected');
    });

    it('omits expected entirely for help and idea kinds, even if text was typed', () => {
      for (const kind of ['help', 'idea'] as const) {
        const payload = assembleOutboundPayload(baseDraft({ kind, expected: 'Some leftover text.' }), {
          areas: [],
          allowReference: false,
          client: {},
        });
        expect(payload).not.toHaveProperty('expected');
      }
    });
  });

  describe('reference — gated on allowReference', () => {
    it('includes reference when allowReference is true and the field is non-blank', () => {
      const payload = assembleOutboundPayload(baseDraft({ reference: 'ABC 123' }), {
        areas: [],
        allowReference: true,
        client: {},
      });
      expect(payload.reference).toBe('ABC 123');
    });

    it('omits reference when allowReference is false, even if the field has text', () => {
      const payload = assembleOutboundPayload(baseDraft({ reference: 'ABC 123' }), {
        areas: [],
        allowReference: false,
        client: {},
      });
      expect(payload).not.toHaveProperty('reference');
    });

    it('omits reference when blank, even if allowed', () => {
      const payload = assembleOutboundPayload(baseDraft({ reference: '   ' }), {
        areas: [],
        allowReference: true,
        client: {},
      });
      expect(payload).not.toHaveProperty('reference');
    });
  });

  describe('report_id', () => {
    it('is stable across calls with the same draft (a resubmission after unconfirmed reuses it)', () => {
      const draft = baseDraft();
      const first = assembleOutboundPayload(draft, { areas: [], allowReference: false, client: {} });
      const second = assembleOutboundPayload(draft, { areas: [], allowReference: false, client: {} });
      expect(first.report_id).toBe(REPORT_ID);
      expect(second.report_id).toBe(REPORT_ID);
    });

    it('changes when the draft carries a new report id (minted fresh after Received)', () => {
      const first = assembleOutboundPayload(baseDraft({ reportId: REPORT_ID }), { areas: [], allowReference: false, client: {} });
      const second = assembleOutboundPayload(baseDraft({ reportId: '22222222-2222-4222-8222-222222222222' }), {
        areas: [],
        allowReference: false,
        client: {},
      });
      expect(first.report_id).not.toBe(second.report_id);
    });
  });

  it('always sets schema to "feedback/v1"', () => {
    const payload = assembleOutboundPayload(baseDraft(), { areas: [], allowReference: false, client: {} });
    expect(payload.schema).toBe('feedback/v1');
  });
});
