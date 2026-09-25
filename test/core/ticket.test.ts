import { describe, expect, it } from 'vitest';
import {
  FeedbackTicketTooLargeError,
  MAX_BODY_LENGTH,
  renderTicket,
  validatePayload,
} from '../../dist/core/index.js';
import type {
  FeedbackHostConfig,
  FeedbackIdentity,
  ValidatedFeedbackPayload,
} from '../../dist/core/index.js';

const host: FeedbackHostConfig = {
  app: 'example-app',
  displayName: 'Example',
  productRepository: 'example-org/example-app',
  environment: 'uat',
  areas: { 'checkout-wizard': 'app/x/page.tsx', 'dashboard': null },
  receivingCommit: '9f4c2a1d7e803bd2a61549c0e176fed32208aabc',
};

const placeIdentity: FeedbackIdentity = {
  ref: 'c2d3e4f5-6789-4abc-9def-0123456789ab',
  role: 'place_member',
  surface: 'customer',
  allowReference: false,
};

const staffIdentity: FeedbackIdentity = {
  ref: '8b203879-7383-4600-bae3-a44a205e91f0',
  role: 'org_admin',
  surface: 'staff',
  organisationRef: '5d0c7e1a-1111-2222-3333-444455556666',
  lookupUrl: 'https://app.example/staff/people/8b203879-7383-4600-bae3-a44a205e91f0',
  allowReference: true,
};

const receivedAt = new Date('2026-09-29T04:12:00.000Z');

function validate(payload: Record<string, unknown>, identity: FeedbackIdentity) {
  const result = validatePayload(payload, { areas: host.areas, allowReference: identity.allowReference });
  if (!result.ok) throw new Error(`unexpected validation failure: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function jsonBlockAfter(body: string, heading: string): unknown {
  const index = body.lastIndexOf(heading);
  expect(index).toBeGreaterThanOrEqual(0);
  const match = body.slice(index).match(/```json\n([\s\S]*?)\n```/);
  expect(match).not.toBeNull();
  return JSON.parse((match as RegExpMatchArray)[1]);
}

describe('renderTicket() — title', () => {
  it('builds the title from displayName, capitalised kind, and area', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x', area: 'checkout-wizard' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    expect(ticket.title).toBe('[Example] Bug · checkout-wizard');
  });

  it('falls back to "unknown" in the title when no area was set', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'idea', what_happened: 'x' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    expect(ticket.title).toBe('[Example] Idea · unknown');
  });

  it('title-cases each kind correctly', () => {
    for (const [kind, label] of [['help', 'Help'], ['bug', 'Bug'], ['idea', 'Idea']] as const) {
      const payload = validate(
        { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind, what_happened: 'x' },
        placeIdentity,
      );
      const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
      expect(ticket.title).toBe(`[Example] ${label} · unknown`);
    }
  });
});

describe('renderTicket() — labels', () => {
  it('emits exactly the four design-specified labels, in order', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    expect(ticket.labels).toEqual(['source:in-app', 'app:example-app', 'env:uat', 'kind:bug']);
  });
});

describe('renderTicket() — absent optional metadata stays absent, never null', () => {
  it('omits reported_build_skew entirely when the client sent no commit', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect('reported_build_skew' in recorded).toBe(false);
  });

  it('sets reported_build_skew to false when the client commit matches the receiving commit', () => {
    const payload = validate(
      {
        schema: 'feedback/v1',
        report_id: '11111111-1111-4111-8111-111111111111',
        kind: 'bug',
        what_happened: 'x',
        client: { commit: host.receivingCommit },
      },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect(recorded.reported_build_skew).toBe(false);
  });

  it('sets reported_build_skew to true when the client commit differs', () => {
    const payload = validate(
      {
        schema: 'feedback/v1',
        report_id: '11111111-1111-4111-8111-111111111111',
        kind: 'bug',
        what_happened: 'x',
        client: { commit: `${'0'.repeat(39)}a` },
      },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect(recorded.reported_build_skew).toBe(true);
  });

  it('omits receiving_commit and reported_build_skew entirely when the host does not know its own commit', () => {
    const hostWithNoCommit: FeedbackHostConfig = { ...host, receivingCommit: null };
    const payload = validate(
      {
        schema: 'feedback/v1',
        report_id: '11111111-1111-4111-8111-111111111111',
        kind: 'bug',
        what_happened: 'x',
        client: { commit: `${'0'.repeat(39)}a` },
      },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host: hostWithNoCommit, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    // A build-skew comparison against an unknown receiving commit would be
    // meaningless (and, rendered as a bare boolean, indistinguishable from
    // a real "yes, it differs" — so it must be absent, not `true`).
    expect('receiving_commit' in recorded).toBe(false);
    expect('reported_build_skew' in recorded).toBe(false);
  });

  it('still omits reported_build_skew when neither the client nor the host reports a commit', () => {
    const hostWithNoCommit: FeedbackHostConfig = { ...host, receivingCommit: null };
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host: hostWithNoCommit, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect('receiving_commit' in recorded).toBe(false);
    expect('reported_build_skew' in recorded).toBe(false);
  });

  it('still includes source_hint and hints_at for a configured area when the host has no receiving commit', () => {
    const hostWithNoCommit: FeedbackHostConfig = { ...host, receivingCommit: null };
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x', area: 'checkout-wizard' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host: hostWithNoCommit, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect(recorded.source_hint).toBe('app/x/page.tsx');
    expect(recorded.hints_at).toBe('receiving_commit');
    expect('receiving_commit' in recorded).toBe(false);
  });

  it('omits source_hint and hints_at for an area with no configured hint', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x', area: 'dashboard' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect('source_hint' in recorded).toBe(false);
    expect('hints_at' in recorded).toBe(false);
  });

  it('includes source_hint and hints_at for an area with a configured hint', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x', area: 'checkout-wizard' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect(recorded.source_hint).toBe('app/x/page.tsx');
    expect(recorded.hints_at).toBe('receiving_commit');
  });

  it('omits organisation_ref and reporter_lookup when identity carries neither', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect('organisation_ref' in recorded).toBe(false);
    expect('reporter_lookup' in recorded).toBe(false);
  });

  it('includes organisation_ref and reporter_lookup when identity carries both', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x' },
      staffIdentity,
    );
    const ticket = renderTicket({ payload, identity: staffIdentity, host, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect(recorded.organisation_ref).toBe(staffIdentity.organisationRef);
    expect(recorded.reporter_lookup).toBe(staffIdentity.lookupUrl);
  });

  it('omits reference_unverified and diagnostic from section 3 when both are absent', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    const reported = jsonBlockAfter(ticket.body, '## 3. Reported by the browser — unverified claims') as Record<string, unknown>;
    expect('reference_unverified' in reported).toBe(false);
    expect('diagnostic' in reported).toBe(false);
  });

  it('never renders an absent optional value as the literal null', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'help', what_happened: 'x' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    expect(ticket.body).not.toContain('null');
  });
});

describe('renderTicket() — body ceiling', () => {
  it('throws a typed FeedbackTicketTooLargeError when the rendered body exceeds MAX_BODY_LENGTH', () => {
    // Bypass validatePayload's caps deliberately: renderTicket's own
    // ceiling assertion is a defence-in-depth backstop, independent of
    // validation, and this proves it fires on its own.
    const oversized: ValidatedFeedbackPayload = {
      schema: 'feedback/v1',
      report_id: '11111111-1111-4111-8111-111111111111',
      kind: 'bug',
      what_happened: 'x'.repeat(MAX_BODY_LENGTH + 1000),
      area: 'unknown',
      client: {},
    };
    expect(() => renderTicket({ payload: oversized, identity: placeIdentity, host, receivedAt })).toThrow(
      FeedbackTicketTooLargeError,
    );
  });

  it('the thrown error reports its actual length and the limit', () => {
    const oversized: ValidatedFeedbackPayload = {
      schema: 'feedback/v1',
      report_id: '11111111-1111-4111-8111-111111111111',
      kind: 'bug',
      what_happened: 'x'.repeat(MAX_BODY_LENGTH + 1000),
      area: 'unknown',
      client: {},
    };
    try {
      renderTicket({ payload: oversized, identity: placeIdentity, host, receivedAt });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FeedbackTicketTooLargeError);
      const e = error as FeedbackTicketTooLargeError;
      expect(e.limit).toBe(MAX_BODY_LENGTH);
      expect(e.length).toBeGreaterThan(MAX_BODY_LENGTH);
      expect(e.code).toBe('feedback_ticket_too_large');
    }
  });
});

describe('renderTicket() — received_at formatting', () => {
  it('formats without milliseconds, matching design §4\'s example', () => {
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt: new Date('2026-09-29T04:12:00.123Z') });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect(recorded.received_at).toBe('2026-09-29T04:12:00Z');
  });
});

describe('renderTicket() — client.* strings are neutralised (design §4: fences are not relied on)', () => {
  it('defuses @mentions, issue references and URLs inside client.browser', () => {
    const payload = validate(
      {
        schema: 'feedback/v1',
        report_id: '11111111-1111-4111-8111-111111111111',
        kind: 'bug',
        what_happened: 'x',
        client: { browser: '@octocat #1 https://evil.example' },
      },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    const reported = jsonBlockAfter(ticket.body, '## 3. Reported by the browser — unverified claims') as Record<
      string,
      unknown
    >;
    expect(reported.browser).not.toBe('@octocat #1 https://evil.example');
    expect(reported.browser).not.toContain('@octocat');
    expect(reported.browser).not.toContain('#1');
    expect(reported.browser).not.toContain('https://evil.example');
    expect(reported.browser).toContain('https[:]//evil.example');
  });

  it('defuses a "GH-12"-shaped client.release', () => {
    const payload = validate(
      {
        schema: 'feedback/v1',
        report_id: '11111111-1111-4111-8111-111111111111',
        kind: 'bug',
        what_happened: 'x',
        client: { release: 'GH-12' },
      },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    const reported = jsonBlockAfter(ticket.body, '## 3. Reported by the browser — unverified claims') as Record<
      string,
      unknown
    >;
    expect(reported.release).not.toBe('GH-12');
    expect(reported.release).not.toContain('GH-12');
  });

  it('leaves a well-formed 40-lowercase-hex client.commit unchanged (neutralisation is a no-op for it)', () => {
    const commit = '9f4c2a1d7e803bd2a61549c0e176fed32208aabc';
    const payload = validate(
      {
        schema: 'feedback/v1',
        report_id: '11111111-1111-4111-8111-111111111111',
        kind: 'bug',
        what_happened: 'x',
        client: { commit },
      },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host, receivedAt });
    const reported = jsonBlockAfter(ticket.body, '## 3. Reported by the browser — unverified claims') as Record<
      string,
      unknown
    >;
    expect(reported.commit).toBe(commit);
  });
});

describe("renderTicket() — the 'unknown' area is reserved and never carries a source hint", () => {
  it('emits no source_hint/hints_at when a (misconfigured) host configures a hint under "unknown"', () => {
    const misconfiguredHost: FeedbackHostConfig = {
      ...host,
      areas: { ...host.areas, unknown: 'should-never-be-used.tsx' },
    };
    const payload = validate(
      { schema: 'feedback/v1', report_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', what_happened: 'x' },
      placeIdentity,
    );
    const ticket = renderTicket({ payload, identity: placeIdentity, host: misconfiguredHost, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect('source_hint' in recorded).toBe(false);
    expect('hints_at' in recorded).toBe(false);
    expect(ticket.body).not.toContain('should-never-be-used');
  });

  it('also emits nothing when the browser explicitly sends area: "unknown" against a misconfigured host', () => {
    const misconfiguredHost: FeedbackHostConfig = {
      ...host,
      areas: { ...host.areas, unknown: 'should-never-be-used.tsx' },
    };
    const payload = validatePayload(
      {
        schema: 'feedback/v1',
        report_id: '11111111-1111-4111-8111-111111111111',
        kind: 'bug',
        what_happened: 'x',
        area: 'unknown',
      },
      { areas: misconfiguredHost.areas, allowReference: false },
    );
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    const ticket = renderTicket({ payload: payload.value, identity: placeIdentity, host: misconfiguredHost, receivedAt });
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<string, unknown>;
    expect('source_hint' in recorded).toBe(false);
  });
});
