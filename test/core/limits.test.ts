import { describe, expect, it } from 'vitest';
import { KINDS, LIMITS, MAX_BODY_LENGTH, renderTicket, validatePayload } from '../../dist/core/index.js';
import type { FeedbackHostConfig, FeedbackIdentity } from '../../dist/core/index.js';

// "Maximum sizes: all fields at their caps render under the 60000 ceiling"
// (build plan P2's done-when). A plain filler character at every cap is
// NOT the worst case: `fence()` grows with the longest run of `~`/`` ` ``
// in the text, and `neutralise()` grows with the number of @/#/GH-/www./
// "://" occurrences, so a *maximally adversarial* prose field is far
// larger once rendered than the same field filled with an inert filler.
// This file exercises both the plain and the adversarial cases.

const host: FeedbackHostConfig = {
  app: 'example-app',
  displayName: 'Example',
  productRepository: 'example-org/example-app',
  environment: 'uat',
  areas: { 'checkout-wizard': 'app/(app)/orders/[order_id]/steps/[step_id]/page.tsx' },
  receivingCommit: '9f4c2a1d7e803bd2a61549c0e176fed32208aabc',
};

const identity: FeedbackIdentity = {
  ref: '8b203879-7383-4600-bae3-a44a205e91f0',
  role: 'org_admin',
  surface: 'staff',
  organisationRef: '5d0c7e1a-1111-2222-3333-444455556666',
  lookupUrl: 'https://app.example/staff/people/8b203879-7383-4600-bae3-a44a205e91f0',
  allowReference: true,
};

const receivedAt = new Date('2026-09-29T04:12:00.000Z');

/** Repeats `pattern` and truncates to exactly `len` characters. */
function fillPattern(pattern: string, len: number): string {
  return pattern.repeat(Math.ceil(len / pattern.length)).slice(0, len);
}

const diagnostic = `${'a'.repeat(55)}:${'b'.repeat(200)}`; // LIMITS.diagnostic (256), valid format

function maxFieldPayload(whatHappened: string, expected: string): Record<string, unknown> {
  return {
    schema: 'feedback/v1',
    report_id: '11111111-1111-4111-8111-111111111111',
    kind: 'bug',
    what_happened: whatHappened,
    expected,
    reference: 'z'.repeat(LIMITS.reference),
    diagnostic,
    area: 'checkout-wizard',
    client: {
      release: 'r'.repeat(LIMITS.client),
      commit: '9f4c2a1d7e803bd2a61549c0e176fed32208aabc',
      browser: 'b'.repeat(LIMITS.client),
      viewport: 'v'.repeat(LIMITS.client),
      locale: 'l'.repeat(LIMITS.client),
      timezone: 't'.repeat(LIMITS.client),
    },
  };
}

function renderMaxPayload(whatHappened: string, expected: string) {
  const result = validatePayload(maxFieldPayload(whatHappened, expected), {
    areas: host.areas,
    allowReference: true,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return renderTicket({ payload: result.value, identity, host, receivedAt });
}

describe('maximum sizes', () => {
  it('renders under the body ceiling when every field is filled with an inert character at its cap', () => {
    expect(diagnostic.length).toBe(LIMITS.diagnostic);

    const ticket = renderMaxPayload(
      'x'.repeat(LIMITS.what_happened),
      'y'.repeat(LIMITS.expected),
    );

    expect(ticket.body.length).toBeLessThan(MAX_BODY_LENGTH);
  });

  it('renders under the body ceiling when what_happened/expected are entirely tildes (fence() worst case)', () => {
    // fence() must open a fence strictly longer than the longest ~ run in
    // the text; an all-tilde field forces the fence itself to roughly
    // double the field's own length. Measured: ~22,988 characters for this
    // exact payload — comfortably under the ceiling, but the largest of
    // the cases here by a wide margin.
    const ticket = renderMaxPayload(
      '~'.repeat(LIMITS.what_happened),
      '~'.repeat(LIMITS.expected),
    );

    expect(ticket.body.length).toBeLessThan(MAX_BODY_LENGTH);
    expect(ticket.body.length).toBeGreaterThan(20000); // proves this is actually exercising the blow-up
  });

  it('renders under the body ceiling when what_happened/expected are entirely backticks (fence() worst case, the other fence character)', () => {
    const ticket = renderMaxPayload(
      '`'.repeat(LIMITS.what_happened),
      '`'.repeat(LIMITS.expected),
    );

    expect(ticket.body.length).toBeLessThan(MAX_BODY_LENGTH);
  });

  it('renders under the body ceiling when what_happened/expected are packed with "://" (neutralise() URL-separator worst case)', () => {
    const ticket = renderMaxPayload(
      fillPattern('a://', LIMITS.what_happened),
      fillPattern('a://', LIMITS.expected),
    );

    expect(ticket.body.length).toBeLessThan(MAX_BODY_LENGTH);
  });

  it('renders under the body ceiling when what_happened/expected are packed with "@" mentions (neutralise() mention worst case)', () => {
    const ticket = renderMaxPayload(
      fillPattern('@a', LIMITS.what_happened),
      fillPattern('@a', LIMITS.expected),
    );

    expect(ticket.body.length).toBeLessThan(MAX_BODY_LENGTH);
  });

  it('renders every kind at maximum size without throwing', () => {
    for (const kind of KINDS) {
      const payload: Record<string, unknown> = {
        schema: 'feedback/v1',
        report_id: '11111111-1111-4111-8111-111111111111',
        kind,
        what_happened: 'x'.repeat(LIMITS.what_happened),
        reference: 'z'.repeat(LIMITS.reference),
        area: 'checkout-wizard',
        client: {
          release: 'r'.repeat(LIMITS.client),
          browser: 'b'.repeat(LIMITS.client),
          viewport: 'v'.repeat(LIMITS.client),
          locale: 'l'.repeat(LIMITS.client),
          timezone: 't'.repeat(LIMITS.client),
        },
      };
      if (kind === 'bug') payload.expected = 'y'.repeat(LIMITS.expected);

      const result = validatePayload(payload, { areas: host.areas, allowReference: true });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      expect(() => renderTicket({ payload: result.value, identity, host, receivedAt })).not.toThrow();
    }
  });
});
