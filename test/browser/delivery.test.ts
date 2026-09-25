import { describe, expect, it } from 'vitest';
import { nextDuplicateRisk, resolveDeliveryOutcome, shouldRotateReportId } from '../../dist/browser/index.js';
import { NOT_SENT_CODES } from '../../dist/core/index.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('resolveDeliveryOutcome()', () => {
  it('received: shows the receipt and clears the draft, with no duplicate risk next', () => {
    const outcome = resolveDeliveryOutcome({ status: 'received', receipt: '#123' });
    expect(outcome).toEqual({
      display: { kind: 'received', receipt: '#123' },
      clearDraft: true,
      duplicateRiskNext: false,
    });
  });

  it('not_sent: keeps the draft, no duplicate risk next, for every not-sent code', () => {
    for (const code of NOT_SENT_CODES) {
      const outcome = resolveDeliveryOutcome({ status: 'not_sent', code });
      expect(outcome.display).toEqual({ kind: 'not_sent', code, fields: undefined });
      expect(outcome.clearDraft).toBe(false);
      expect(outcome.duplicateRiskNext).toBe(false);
    }
  });

  it('not_sent with fields (invalid): carries the field list through', () => {
    const outcome = resolveDeliveryOutcome({ status: 'not_sent', code: 'invalid', fields: ['what_happened'] });
    expect(outcome.display).toEqual({ kind: 'not_sent', code: 'invalid', fields: ['what_happened'] });
    expect(outcome.clearDraft).toBe(false);
  });

  it('unconfirmed (explicit reply): keeps the draft and warns the next Send may duplicate', () => {
    const outcome = resolveDeliveryOutcome({ status: 'unconfirmed', report_id: '11111111-1111-4111-8111-111111111111' });
    expect(outcome).toEqual({
      display: { kind: 'unconfirmed', duplicateRisk: true },
      clearDraft: false,
      duplicateRiskNext: true,
    });
  });

  it('null (network error, timeout, or an unparseable body) is treated identically to an explicit unconfirmed reply', () => {
    const fromNull = resolveDeliveryOutcome(null);
    const fromExplicit = resolveDeliveryOutcome({ status: 'unconfirmed', report_id: '11111111-1111-4111-8111-111111111111' });
    expect(fromNull.display).toEqual(fromExplicit.display);
    expect(fromNull.clearDraft).toBe(fromExplicit.clearDraft);
    expect(fromNull.duplicateRiskNext).toBe(fromExplicit.duplicateRiskNext);
  });

  it('never signals a retry — the return value carries no request, timer or callback', () => {
    const outcome = resolveDeliveryOutcome(null);
    // A pure decision object with exactly these three keys: nothing here
    // could cause a caller to schedule another attempt on its own.
    expect(Object.keys(outcome).sort()).toEqual(['clearDraft', 'display', 'duplicateRiskNext']);
  });
});

describe('nextDuplicateRisk() (review fix)', () => {
  it('starts false and stays false through an ordinary not_sent', () => {
    const risk = nextDuplicateRisk(false, resolveDeliveryOutcome({ status: 'not_sent', code: 'rate_limited' }));
    expect(risk).toBe(false);
  });

  it('an unconfirmed reply sets it true', () => {
    const risk = nextDuplicateRisk(false, resolveDeliveryOutcome({ status: 'unconfirmed', report_id: UUID }));
    expect(risk).toBe(true);
  });

  it('a network error (null) sets it true, exactly like an explicit unconfirmed reply', () => {
    const risk = nextDuplicateRisk(false, resolveDeliveryOutcome(null));
    expect(risk).toBe(true);
  });

  it('received clears it', () => {
    const risk = nextDuplicateRisk(true, resolveDeliveryOutcome({ status: 'received', receipt: '#1' }));
    expect(risk).toBe(false);
  });

  it('a not_sent that follows an unconfirmed does NOT clear the risk — the review-reported bug', () => {
    // The exact sequence the review asked for: unconfirmed -> resend ->
    // not_sent -> the *next* Send still warns.
    let risk = false;
    risk = nextDuplicateRisk(risk, resolveDeliveryOutcome({ status: 'unconfirmed', report_id: UUID }));
    expect(risk).toBe(true);

    risk = nextDuplicateRisk(risk, resolveDeliveryOutcome({ status: 'not_sent', code: 'invalid', fields: ['what_happened'] }));
    expect(risk).toBe(true); // still warns — a not_sent must not silently clear an earlier ambiguity

    // A second not_sent in a row still doesn't clear it either.
    risk = nextDuplicateRisk(risk, resolveDeliveryOutcome({ status: 'not_sent', code: 'rate_limited' }));
    expect(risk).toBe(true);

    // Only an explicit received finally clears it.
    risk = nextDuplicateRisk(risk, resolveDeliveryOutcome({ status: 'received', receipt: '#42' }));
    expect(risk).toBe(false);
  });

  it('a second unconfirmed in a row leaves it true (idempotent, not additive)', () => {
    let risk = nextDuplicateRisk(false, resolveDeliveryOutcome({ status: 'unconfirmed', report_id: UUID }));
    risk = nextDuplicateRisk(risk, resolveDeliveryOutcome({ status: 'unconfirmed', report_id: UUID }));
    expect(risk).toBe(true);
  });
});

describe('shouldRotateReportId() (review fix, gate R finding 6)', () => {
  it('sequence A — an ordinary definitive refusal (no prior risk): rotates', () => {
    let risk = false;
    const outcome = resolveDeliveryOutcome({ status: 'not_sent', code: 'rate_limited' });
    risk = nextDuplicateRisk(risk, outcome);
    expect(shouldRotateReportId(outcome, risk)).toBe(true);
  });

  it('sequence B — unconfirmed -> not_sent -> retry: sticky (does not rotate) while risk remains, then rotates once received', () => {
    let risk = false;

    const unconfirmed = resolveDeliveryOutcome({ status: 'unconfirmed', report_id: UUID });
    risk = nextDuplicateRisk(risk, unconfirmed);
    // unconfirmed is never itself a rotation candidate (only not_sent is).
    expect(shouldRotateReportId(unconfirmed, risk)).toBe(false);

    const notSent = resolveDeliveryOutcome({ status: 'not_sent', code: 'invalid', fields: ['what_happened'] });
    risk = nextDuplicateRisk(risk, notSent);
    // The exact sequence the review asked for: the not_sent that follows
    // the unconfirmed must NOT rotate — same id reused on retry.
    expect(shouldRotateReportId(notSent, risk)).toBe(false);

    // A second not_sent in a row, still under the same outstanding risk,
    // still doesn't rotate.
    const notSentAgain = resolveDeliveryOutcome({ status: 'not_sent', code: 'rate_limited' });
    risk = nextDuplicateRisk(risk, notSentAgain);
    expect(shouldRotateReportId(notSentAgain, risk)).toBe(false);

    // received finally clears the risk (resetDraftAfterReceipt mints a
    // fresh id unconditionally on received — shouldRotateReportId is
    // never consulted for it, but confirm it wouldn't say otherwise).
    const received = resolveDeliveryOutcome({ status: 'received', receipt: '#7' });
    risk = nextDuplicateRisk(risk, received);
    expect(shouldRotateReportId(received, risk)).toBe(false);
    expect(risk).toBe(false);
  });

  it('never rotates for received or unconfirmed, regardless of the risk flag — only not_sent is a rotation candidate', () => {
    const received = resolveDeliveryOutcome({ status: 'received', receipt: '#1' });
    expect(shouldRotateReportId(received, true)).toBe(false);
    expect(shouldRotateReportId(received, false)).toBe(false);

    const unconfirmed = resolveDeliveryOutcome({ status: 'unconfirmed', report_id: UUID });
    expect(shouldRotateReportId(unconfirmed, true)).toBe(false);
    expect(shouldRotateReportId(unconfirmed, false)).toBe(false);
  });
});
