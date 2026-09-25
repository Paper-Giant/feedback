import { describe, expect, it } from 'vitest';
import { LIMITS, validatePayload } from '../../dist/core/index.js';
import type { ValidatePayloadOptions } from '../../dist/core/index.js';

const opts: ValidatePayloadOptions = {
  areas: { 'checkout-wizard': 'app/x/page.tsx', 'dashboard': null },
  allowReference: false,
};

const staffOpts: ValidatePayloadOptions = { ...opts, allowReference: true };

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'feedback/v1',
    report_id: '11111111-1111-4111-8111-111111111111',
    kind: 'bug',
    what_happened: 'Something broke.',
    ...overrides,
  };
}

function errorFor(result: ReturnType<typeof validatePayload>, field: string) {
  if (result.ok) return undefined;
  return result.errors.find((e) => e.field === field);
}

describe('validatePayload() — structure', () => {
  it('accepts a minimal valid payload with only the required fields', () => {
    const result = validatePayload(basePayload(), opts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.area).toBe('unknown');
      expect(result.value.client).toEqual({});
      expect(result.value.expected).toBeUndefined();
      expect(result.value.reference).toBeUndefined();
      expect(result.value.diagnostic).toBeUndefined();
    }
  });

  it('rejects a non-object root payload', () => {
    for (const bad of [null, 'x', 42, [], true]) {
      const result = validatePayload(bad, opts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toEqual([{ field: 'payload', code: 'invalid_type' }]);
    }
  });

  it('accumulates every violation in one call rather than stopping at the first', () => {
    const result = validatePayload(
      basePayload({ kind: 'nope', what_happened: '', reference: 'x', extra: 1 }),
      opts,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(['extra', 'kind', 'reference', 'what_happened']);
    }
  });
});

describe('validatePayload() — unknown fields are rejected, including server-derived ones', () => {
  const forbidden = ['title', 'source_hint', 'reported_build_skew', 'hints_at', 'receiving_commit'];

  for (const field of forbidden) {
    it(`rejects a browser-supplied "${field}" as an unknown field`, () => {
      const result = validatePayload(basePayload({ [field]: 'anything' }), opts);
      expect(result.ok).toBe(false);
      expect(errorFor(result, field)).toEqual({ field, code: 'unknown_field' });
    });
  }

  it('rejects an arbitrary unknown top-level field', () => {
    const result = validatePayload(basePayload({ mystery: true }), opts);
    expect(errorFor(result, 'mystery')).toEqual({ field: 'mystery', code: 'unknown_field' });
  });

  it('rejects an arbitrary unknown client field', () => {
    const result = validatePayload(basePayload({ client: { foo: 'bar' } }), opts);
    expect(errorFor(result, 'client.foo')).toEqual({ field: 'client.foo', code: 'unknown_field' });
  });
});

describe('validatePayload() — schema, report_id, kind', () => {
  it('rejects a missing schema', () => {
    const payload = basePayload();
    delete payload.schema;
    const result = validatePayload(payload, opts);
    expect(errorFor(result, 'schema')).toEqual({ field: 'schema', code: 'missing' });
  });

  it('rejects a wrong schema literal', () => {
    const result = validatePayload(basePayload({ schema: 'feedback/v2' }), opts);
    expect(errorFor(result, 'schema')).toEqual({ field: 'schema', code: 'invalid_format' });
  });

  it('rejects a missing report_id', () => {
    const payload = basePayload();
    delete payload.report_id;
    const result = validatePayload(payload, opts);
    expect(errorFor(result, 'report_id')).toEqual({ field: 'report_id', code: 'missing' });
  });

  it('rejects a report_id that is not a UUID', () => {
    const result = validatePayload(basePayload({ report_id: 'not-a-uuid' }), opts);
    expect(errorFor(result, 'report_id')).toEqual({ field: 'report_id', code: 'invalid_format' });
  });

  it('accepts an uppercase UUID and lowercases it (case-insensitive by design)', () => {
    // Uses a letter-bearing UUID (not an all-digit one, which .toUpperCase()
    // would leave unchanged) so this test actually exercises case handling.
    const upper = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    const lower = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(upper).not.toBe(upper.toLowerCase()); // sanity: this UUID has letters
    const result = validatePayload(basePayload({ report_id: upper }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.report_id).toBe(lower);
  });

  it('accepts a mixed-case UUID and lowercases it', () => {
    const mixed = '8B203879-7383-4600-bae3-a44a205e91f0';
    const result = validatePayload(basePayload({ report_id: mixed }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.report_id).toBe(mixed.toLowerCase());
  });

  it('rejects a missing kind', () => {
    const payload = basePayload();
    delete payload.kind;
    const result = validatePayload(payload, opts);
    expect(errorFor(result, 'kind')).toEqual({ field: 'kind', code: 'missing' });
  });

  it('rejects a kind outside help/bug/idea', () => {
    const result = validatePayload(basePayload({ kind: 'complaint' }), opts);
    expect(errorFor(result, 'kind')).toEqual({ field: 'kind', code: 'invalid_enum' });
  });

  for (const kind of ['help', 'bug', 'idea']) {
    it(`accepts kind "${kind}"`, () => {
      const result = validatePayload(basePayload({ kind }), opts);
      expect(result.ok).toBe(true);
    });
  }
});

describe('validatePayload() — what_happened (required, 1..5000)', () => {
  it('rejects an empty string as too_short', () => {
    const result = validatePayload(basePayload({ what_happened: '' }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({ field: 'what_happened', code: 'too_short' });
  });

  it('accepts exactly 1 character', () => {
    const result = validatePayload(basePayload({ what_happened: 'x' }), opts);
    expect(result.ok).toBe(true);
  });

  it('accepts exactly 5000 characters', () => {
    const result = validatePayload(basePayload({ what_happened: 'x'.repeat(5000) }), opts);
    expect(result.ok).toBe(true);
  });

  it('rejects 5001 characters (the cap exceeded by exactly one) as too_long', () => {
    const result = validatePayload(basePayload({ what_happened: 'x'.repeat(5001) }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({ field: 'what_happened', code: 'too_long' });
  });

  it('rejects a non-string value', () => {
    const result = validatePayload(basePayload({ what_happened: 42 }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({ field: 'what_happened', code: 'invalid_type' });
  });

  it('rejects a whitespace-only value as too_short (it carries no actual report)', () => {
    const result = validatePayload(basePayload({ what_happened: '   \t  ' }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({ field: 'what_happened', code: 'too_short' });
  });

  it('rejects a value that is only newlines as too_short', () => {
    const result = validatePayload(basePayload({ what_happened: '\n\n\n' }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({ field: 'what_happened', code: 'too_short' });
  });
});

describe('validatePayload() — expected (bugs only, <= 2000)', () => {
  it('accepts expected on a bug within the cap', () => {
    const result = validatePayload(basePayload({ kind: 'bug', expected: 'x'.repeat(2000) }), opts);
    expect(result.ok).toBe(true);
  });

  it('rejects 2001 characters (the cap exceeded by exactly one) as too_long', () => {
    const result = validatePayload(basePayload({ kind: 'bug', expected: 'x'.repeat(2001) }), opts);
    expect(errorFor(result, 'expected')).toEqual({ field: 'expected', code: 'too_long' });
  });

  it('rejects expected on kind "help"', () => {
    const result = validatePayload(basePayload({ kind: 'help', expected: 'x' }), opts);
    expect(errorFor(result, 'expected')).toEqual({ field: 'expected', code: 'not_allowed' });
  });

  it('rejects expected on kind "idea"', () => {
    const result = validatePayload(basePayload({ kind: 'idea', expected: 'x' }), opts);
    expect(errorFor(result, 'expected')).toEqual({ field: 'expected', code: 'not_allowed' });
  });

  it('omits expected from the validated value when absent', () => {
    const result = validatePayload(basePayload({ kind: 'bug' }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect('expected' in result.value).toBe(false);
  });

  it('treats an empty-string expected as absent, with no error, on a bug', () => {
    const result = validatePayload(basePayload({ kind: 'bug', expected: '' }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect('expected' in result.value).toBe(false);
  });

  it('treats a whitespace-only expected as absent, with no error, on a bug', () => {
    const result = validatePayload(basePayload({ kind: 'bug', expected: '   \t\n  ' }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect('expected' in result.value).toBe(false);
  });

  it('treats a whitespace-only expected as absent on kind "help" too — no not_allowed error, since it is treated as though the field were never sent', () => {
    const result = validatePayload(basePayload({ kind: 'help', expected: '   ' }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect('expected' in result.value).toBe(false);
  });

  it('treats a whitespace-only expected as absent on kind "idea" too', () => {
    const result = validatePayload(basePayload({ kind: 'idea', expected: '\n' }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect('expected' in result.value).toBe(false);
  });
});

describe('validatePayload() — reference (staff-only, <= 64)', () => {
  it('rejects reference when allowReference is false', () => {
    const result = validatePayload(basePayload({ reference: 'ABC-123' }), opts);
    expect(errorFor(result, 'reference')).toEqual({ field: 'reference', code: 'not_allowed' });
  });

  it('accepts reference when allowReference is true', () => {
    const result = validatePayload(basePayload({ reference: 'ABC-123' }), staffOpts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.reference).toBe('ABC-123');
  });

  it('accepts exactly 64 characters', () => {
    const result = validatePayload(basePayload({ reference: 'x'.repeat(64) }), staffOpts);
    expect(result.ok).toBe(true);
  });

  it('rejects 65 characters (the cap exceeded by exactly one) as too_long', () => {
    const result = validatePayload(basePayload({ reference: 'x'.repeat(65) }), staffOpts);
    expect(errorFor(result, 'reference')).toEqual({ field: 'reference', code: 'too_long' });
  });

  it('rejects a newline in reference — unlike prose fields, reference must be single-line', () => {
    const result = validatePayload(basePayload({ reference: 'ABC-123\nABC-124' }), staffOpts);
    expect(errorFor(result, 'reference')).toEqual({ field: 'reference', code: 'control_characters' });
  });

  it('rejects a tab in reference', () => {
    const result = validatePayload(basePayload({ reference: 'ABC-123\tABC-124' }), staffOpts);
    expect(errorFor(result, 'reference')).toEqual({ field: 'reference', code: 'control_characters' });
  });
});

describe('validatePayload() — diagnostic (<= 256, namespaced key:value)', () => {
  it('accepts a well-formed diagnostic', () => {
    const result = validatePayload(basePayload({ diagnostic: 'ui:wizard-continue-noop' }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.diagnostic).toBe('ui:wizard-continue-noop');
  });

  it('rejects a diagnostic missing the namespace colon', () => {
    const result = validatePayload(basePayload({ diagnostic: 'no-colon-here' }), opts);
    expect(errorFor(result, 'diagnostic')).toEqual({ field: 'diagnostic', code: 'invalid_format' });
  });

  it('rejects an uppercase namespace prefix', () => {
    const result = validatePayload(basePayload({ diagnostic: 'UI:thing' }), opts);
    expect(errorFor(result, 'diagnostic')).toEqual({ field: 'diagnostic', code: 'invalid_format' });
  });

  it('rejects an empty value after the colon', () => {
    const result = validatePayload(basePayload({ diagnostic: 'ui:' }), opts);
    expect(errorFor(result, 'diagnostic')).toEqual({ field: 'diagnostic', code: 'invalid_format' });
  });

  it('accepts exactly 256 characters in a valid format', () => {
    // prefix(55) + ":" + suffix(200) = 256, suffix at its own 200-char max
    const diagnostic = `${'a'.repeat(55)}:${'b'.repeat(200)}`;
    expect(diagnostic.length).toBe(256);
    const result = validatePayload(basePayload({ diagnostic }), opts);
    expect(result.ok).toBe(true);
  });

  it('rejects 257 characters (the cap exceeded by exactly one) as too_long even though the format is otherwise valid', () => {
    const diagnostic = `${'a'.repeat(56)}:${'b'.repeat(200)}`;
    expect(diagnostic.length).toBe(257);
    const result = validatePayload(basePayload({ diagnostic }), opts);
    expect(errorFor(result, 'diagnostic')).toEqual({ field: 'diagnostic', code: 'too_long' });
  });
});

describe('validatePayload() — area (never an error; unrecognised normalises to "unknown")', () => {
  it('defaults to "unknown" when absent', () => {
    const result = validatePayload(basePayload(), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.area).toBe('unknown');
  });

  it('normalises an unrecognised area to "unknown" without an error', () => {
    const result = validatePayload(basePayload({ area: 'nonexistent-page' }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.area).toBe('unknown');
  });

  it('preserves a configured area key', () => {
    const result = validatePayload(basePayload({ area: 'checkout-wizard' }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.area).toBe('checkout-wizard');
  });

  it('preserves a configured area key even when its hint is null', () => {
    const result = validatePayload(basePayload({ area: 'dashboard' }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.area).toBe('dashboard');
  });

  it('normalises a non-string area value to "unknown" without an error', () => {
    const result = validatePayload(basePayload({ area: 123 }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.area).toBe('unknown');
  });
});

describe('validatePayload() — client', () => {
  it('accepts an absent client as {}', () => {
    const result = validatePayload(basePayload(), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.client).toEqual({});
  });

  it('rejects a non-object client', () => {
    const result = validatePayload(basePayload({ client: 'nope' }), opts);
    expect(errorFor(result, 'client')).toEqual({ field: 'client', code: 'invalid_type' });
  });

  for (const field of ['release', 'browser', 'viewport', 'locale', 'timezone'] as const) {
    it(`accepts client.${field} at exactly ${LIMITS.client} characters`, () => {
      const result = validatePayload(basePayload({ client: { [field]: 'x'.repeat(LIMITS.client) } }), opts);
      expect(result.ok).toBe(true);
    });

    it(`rejects client.${field} at ${LIMITS.client + 1} characters (the cap exceeded by exactly one)`, () => {
      const result = validatePayload(
        basePayload({ client: { [field]: 'x'.repeat(LIMITS.client + 1) } }),
        opts,
      );
      expect(errorFor(result, `client.${field}`)).toEqual({
        field: `client.${field}`,
        code: 'too_long',
      });
    });
  }

  it('accepts a well-formed 40-lowercase-hex commit', () => {
    const commit = '9f4c2a1d7e803bd2a61549c0e176fed32208aabc';
    expect(commit).toHaveLength(40);
    const result = validatePayload(basePayload({ client: { commit } }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.client.commit).toBe(commit);
  });

  it('rejects a commit with 39 hex characters', () => {
    const commit = '9f4c2a1d7e803bd2a61549c0e176fed32208aab';
    expect(commit).toHaveLength(39);
    const result = validatePayload(basePayload({ client: { commit } }), opts);
    expect(errorFor(result, 'client.commit')).toEqual({ field: 'client.commit', code: 'invalid_format' });
  });

  it('rejects a commit with 41 hex characters', () => {
    const commit = '9f4c2a1d7e803bd2a61549c0e176fed32208aabc';
    const commit41 = `${commit}a`;
    const result = validatePayload(basePayload({ client: { commit: commit41 } }), opts);
    expect(errorFor(result, 'client.commit')).toEqual({ field: 'client.commit', code: 'invalid_format' });
  });

  it('rejects an uppercase-hex commit', () => {
    const commit = '9F4C2A1D7E803BD2A61549C0E176FED32208AAB';
    const result = validatePayload(basePayload({ client: { commit } }), opts);
    expect(errorFor(result, 'client.commit')).toEqual({ field: 'client.commit', code: 'invalid_format' });
  });
});

describe('validatePayload() — control characters (only \\n and \\t are allowed)', () => {
  it('accepts newlines and tabs in what_happened', () => {
    const result = validatePayload(basePayload({ what_happened: 'line one\nline two\tindented' }), opts);
    expect(result.ok).toBe(true);
  });

  it('rejects a carriage return in what_happened', () => {
    const result = validatePayload(basePayload({ what_happened: 'line one\r\nline two' }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({
      field: 'what_happened',
      code: 'control_characters',
    });
  });

  it('rejects a NUL byte in what_happened', () => {
    const result = validatePayload(basePayload({ what_happened: 'a\u0000b' }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({
      field: 'what_happened',
      code: 'control_characters',
    });
  });

  it('rejects an ESC character in expected', () => {
    const result = validatePayload(basePayload({ expected: 'a\u001Bb' }), opts);
    expect(errorFor(result, 'expected')).toEqual({ field: 'expected', code: 'control_characters' });
  });

  it('rejects a control character in reference', () => {
    const result = validatePayload(basePayload({ reference: 'a\u0007b' }), staffOpts);
    expect(errorFor(result, 'reference')).toEqual({ field: 'reference', code: 'control_characters' });
  });

  it('rejects a C1 control character (U+0090) in client.browser', () => {
    const result = validatePayload(basePayload({ client: { browser: 'a\u0090b' } }), opts);
    expect(errorFor(result, 'client.browser')).toEqual({
      field: 'client.browser',
      code: 'control_characters',
    });
  });

  it('rejects U+2028 LINE SEPARATOR in what_happened', () => {
    const result = validatePayload(basePayload({ what_happened: `a${'\u2028'}b` }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({
      field: 'what_happened',
      code: 'control_characters',
    });
  });

  it('rejects U+2029 PARAGRAPH SEPARATOR in what_happened', () => {
    const result = validatePayload(basePayload({ what_happened: `a${'\u2029'}b` }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({
      field: 'what_happened',
      code: 'control_characters',
    });
  });

  it('rejects U+2028 in client.browser too', () => {
    const result = validatePayload(basePayload({ client: { browser: `a${'\u2028'}b` } }), opts);
    expect(errorFor(result, 'client.browser')).toEqual({
      field: 'client.browser',
      code: 'control_characters',
    });
  });
});

describe('validatePayload() — well-formed Unicode (no lone surrogates)', () => {
  it('rejects a lone high surrogate in what_happened', () => {
    const loneHigh = String.fromCharCode(0xd800);
    const result = validatePayload(basePayload({ what_happened: `a${loneHigh}b` }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({
      field: 'what_happened',
      code: 'invalid_format',
    });
  });

  it('rejects a lone low surrogate in what_happened', () => {
    const loneLow = String.fromCharCode(0xdc00);
    const result = validatePayload(basePayload({ what_happened: `a${loneLow}b` }), opts);
    expect(errorFor(result, 'what_happened')).toEqual({
      field: 'what_happened',
      code: 'invalid_format',
    });
  });

  it('accepts a valid surrogate pair (an actual astral character, e.g. an emoji)', () => {
    const emoji = String.fromCodePoint(0x1f600); // a well-formed surrogate pair
    const result = validatePayload(basePayload({ what_happened: `Report: ${emoji}` }), opts);
    expect(result.ok).toBe(true);
  });

  it('rejects a lone surrogate in client.browser', () => {
    const loneHigh = String.fromCharCode(0xd800);
    const result = validatePayload(basePayload({ client: { browser: `a${loneHigh}b` } }), opts);
    expect(errorFor(result, 'client.browser')).toEqual({
      field: 'client.browser',
      code: 'invalid_format',
    });
  });

  it('rejects a lone surrogate in reference', () => {
    const loneHigh = String.fromCharCode(0xd800);
    const result = validatePayload(basePayload({ reference: `a${loneHigh}b` }), staffOpts);
    expect(errorFor(result, 'reference')).toEqual({ field: 'reference', code: 'invalid_format' });
  });
});

describe('validatePayload() — NFC normalisation', () => {
  it('normalises a decomposed (NFD) combining sequence before capping length', () => {
    // "é" as "e" + U+0301 COMBINING ACUTE ACCENT (2 code points) normalises
    // to the single precomposed U+00E9 character (1 code point).
    const decomposed = `é`.repeat(5000); // 10000 code points decomposed, 5000 composed
    const result = validatePayload(basePayload({ what_happened: decomposed }), opts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.from(result.value.what_happened)).toHaveLength(5000);
      expect(result.value.what_happened).toBe('é'.repeat(5000));
    }
  });
});
