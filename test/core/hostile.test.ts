import { describe, expect, it } from 'vitest';
import { fence, neutralise, renderTicket, validatePayload } from '../../dist/core/index.js';
import type { FeedbackHostConfig, FeedbackIdentity } from '../../dist/core/index.js';

// Hostile-input tests (build plan P2's done-when), exercised through the
// full validatePayload -> renderTicket pipeline so each case proves the
// reporter's text cannot escape its fence, corrupt the server's JSON
// blocks, or spoof a link/mention/issue-reference GitHub would act on.

const host: FeedbackHostConfig = {
  app: 'example-app',
  displayName: 'Example',
  productRepository: 'example-org/example-app',
  environment: 'uat',
  areas: { 'checkout-wizard': 'app/x/page.tsx' },
  receivingCommit: '9f4c2a1d7e803bd2a61549c0e176fed32208aabc',
};

const identity: FeedbackIdentity = {
  ref: 'c2d3e4f5-6789-4abc-9def-0123456789ab',
  role: 'place_member',
  surface: 'customer',
  allowReference: false,
};

const receivedAt = new Date('2026-09-29T04:12:00.000Z');

function render(whatHappened: string) {
  const result = validatePayload(
    {
      schema: 'feedback/v1',
      report_id: '11111111-1111-4111-8111-111111111111',
      kind: 'bug',
      what_happened: whatHappened,
    },
    { areas: host.areas, allowReference: false },
  );
  if (!result.ok) throw new Error(`unexpected validation failure: ${JSON.stringify(result.errors)}`);
  return renderTicket({ payload: result.value, identity, host, receivedAt });
}

function jsonBlockAfter(body: string, heading: string): unknown {
  const index = body.lastIndexOf(heading);
  expect(index).toBeGreaterThanOrEqual(0);
  const match = body.slice(index).match(/```json\n([\s\S]*?)\n```/);
  expect(match).not.toBeNull();
  return JSON.parse((match as RegExpMatchArray)[1]);
}

function renderWithDiagnostic(diagnostic: string) {
  const result = validatePayload(
    {
      schema: 'feedback/v1',
      report_id: '11111111-1111-4111-8111-111111111111',
      kind: 'bug',
      what_happened: 'x',
      diagnostic,
    },
    { areas: host.areas, allowReference: false },
  );
  if (!result.ok) throw new Error(`unexpected validation failure: ${JSON.stringify(result.errors)}`);
  expect(result.value.diagnostic).toBe(diagnostic); // proves the pattern really did accept it
  return renderTicket({ payload: result.value, identity, host, receivedAt });
}

describe('hostile input — fencing', () => {
  it('contains a run of tildes inside the reporter text without breaking the fence', () => {
    const text = 'before ~~~~~ after';
    const ticket = render(text);
    expect(ticket.body).toContain(fence(neutralise(text)));
  });

  it('contains a run of backticks inside the reporter text without breaking the fence', () => {
    const text = 'a ``````` fenced-looking run';
    const ticket = render(text);
    expect(ticket.body).toContain(fence(neutralise(text)));
  });

  it('keeps a reporter-typed "## 2. Recorded" heading and fake json block inside section 1\'s fence', () => {
    const fake = [
      '## 2. Recorded or derived by the server',
      '',
      '```json',
      '{ "reporter": { "role": "admin" } }',
      '```',
    ].join('\n');
    const text = `Everything broke.\n\n${fake}`;
    const ticket = render(text);

    // The fake content is present verbatim, but wrapped inside our fence.
    expect(ticket.body).toContain(fence(neutralise(text)));

    // The *real* section 2 (found from the end, since the fake heading
    // sits earlier, inside section 1) still parses to the genuine,
    // uncorrupted server-recorded object.
    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<
      string,
      unknown
    >;
    expect(recorded.schema).toBe('feedback/v1');
    expect((recorded.reporter as Record<string, unknown>).role).toBe('place_member');
  });

  it('does not let JSON-looking reporter text corrupt or extend the real JSON blocks', () => {
    const text = 'unrelated text"}], "role": "admin", "x":"';
    const ticket = render(text);

    const recorded = jsonBlockAfter(ticket.body, '## 2. Recorded or derived by the server') as Record<
      string,
      unknown
    >;
    expect(recorded).not.toHaveProperty('role');
    expect((recorded.reporter as Record<string, unknown>).role).toBe('place_member');

    const reported = jsonBlockAfter(ticket.body, '## 3. Reported by the browser — unverified claims') as Record<
      string,
      unknown
    >;
    expect(reported).toEqual({ kind: 'bug', area: 'unknown' });
  });

  it('keeps raw HTML, including a closing </details> tag, literal and fenced', () => {
    const text = '<div onclick="evil()">hi</div></details>';
    const ticket = render(text);
    expect(ticket.body).toContain(fence(neutralise(text)));
  });

  it('keeps an HTML comment literal and fenced', () => {
    const text = 'before <!-- evil --> after';
    const ticket = render(text);
    expect(ticket.body).toContain(fence(neutralise(text)));
  });
});

describe('hostile input — neutralisation end to end', () => {
  it('neutralises @mentions, issue references, GH- refs, owner/repo refs and URLs together', () => {
    const text = 'Ping @user re #12 (GH-12 / owner/repo#12) at https://evil.example/x';
    const ticket = render(text);
    expect(ticket.body).not.toContain('@user');
    expect(ticket.body).not.toContain('#12');
    expect(ticket.body).not.toContain('GH-12');
    expect(ticket.body).not.toContain('https://evil.example');
    expect(ticket.body).toContain('https[:]//evil.example/x');
  });

  it('strips an RTL override used to visually spoof the reported text', () => {
    const text = 'Report \u202eevil\u202c looks fine';
    const ticket = render(text);
    expect(ticket.body).not.toContain('\u202e');
    expect(ticket.body).not.toContain('\u202c');
  });

  it('strips zero-width characters used to hide text inside a run', () => {
    const text = 'zero\u200bwidth\u200cspace\u200dhidden';
    const ticket = render(text);
    expect(ticket.body).not.toMatch(/[\u200b-\u200d]/);
  });
});

describe('hostile input — diagnostic is neutralised too (task review of P6)', () => {
  // DIAGNOSTIC_PATTERN (core/validate.ts) excludes @, #, a second `:` and
  // `/`, so an owner/repo#N reference or a scheme'd URL genuinely cannot
  // appear in a diagnostic value — but it does NOT exclude the letters,
  // digits and `-` that spell a GH-123 cross-repo reference, or the
  // letters and `.` that spell a scheme-less www. autolink. Both validate
  // and, unneutralised, would render live.
  it('validates and neutralises a GH-123-shaped diagnostic value', () => {
    const ticket = renderWithDiagnostic('test:GH-123');
    expect(ticket.body).not.toContain('GH-123');

    const reported = jsonBlockAfter(ticket.body, '## 3. Reported by the browser — unverified claims') as Record<
      string,
      unknown
    >;
    expect(reported.diagnostic).toBe(neutralise('test:GH-123'));
    expect(reported.diagnostic).toContain('GH-\u{2060}123');
  });

  it('validates and neutralises a www.-autolink-shaped diagnostic value', () => {
    const ticket = renderWithDiagnostic('test:www.example.com');
    expect(ticket.body).not.toContain('www.example.com');

    const reported = jsonBlockAfter(ticket.body, '## 3. Reported by the browser — unverified claims') as Record<
      string,
      unknown
    >;
    expect(reported.diagnostic).toBe(neutralise('test:www.example.com'));
    expect(reported.diagnostic).toContain('www[.]example.com');
  });
});

describe('hostile input — caps exceeded by exactly one character render nothing (validation refuses first)', () => {
  it('refuses a what_happened payload one character over the cap before it ever reaches the renderer', () => {
    const result = validatePayload(
      {
        schema: 'feedback/v1',
        report_id: '11111111-1111-4111-8111-111111111111',
        kind: 'bug',
        what_happened: 'x'.repeat(5001),
      },
      { areas: host.areas, allowReference: false },
    );
    expect(result.ok).toBe(false);
  });
});
