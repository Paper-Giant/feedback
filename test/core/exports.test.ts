import { describe, expect, it } from 'vitest';
import { KINDS, LIMITS, assertHostAreas } from '../../dist/core/index.js';
import * as rootEntry from '../../dist/index.js';

// P7 (the browser dialog) needs KINDS and LIMITS to build its kind
// selector and maxlength/counter UI from the same source of truth
// validatePayload enforces, and P6 (the handler) needs assertHostAreas to
// fail fast on a misconfigured host. All three must be reachable from
// both @papergiant/feedback/core and the package root.

describe('KINDS', () => {
  it('lists exactly help, bug, idea', () => {
    expect(KINDS).toEqual(['help', 'bug', 'idea']);
  });

  it('is exported from the root entry too, and is the same values', () => {
    expect(rootEntry.KINDS).toEqual(['help', 'bug', 'idea']);
  });
});

describe('LIMITS', () => {
  it('matches the caps validatePayload enforces (design §4)', () => {
    expect(LIMITS).toEqual({
      what_happened: 5000,
      expected: 2000,
      reference: 64,
      diagnostic: 256,
      client: 100,
    });
  });

  it('is exported from the root entry too, and is the same values', () => {
    expect(rootEntry.LIMITS).toEqual(LIMITS);
  });
});

describe('assertHostAreas()', () => {
  it('does not throw for an areas map with no "unknown" key', () => {
    expect(() => assertHostAreas({ 'checkout-wizard': 'app/x/page.tsx' })).not.toThrow();
  });

  it('does not throw for an empty areas map', () => {
    expect(() => assertHostAreas({})).not.toThrow();
  });

  it('throws when "unknown" is configured, even with a null hint', () => {
    expect(() => assertHostAreas({ unknown: null })).toThrow();
  });

  it('throws when "unknown" is configured with a non-null hint', () => {
    expect(() => assertHostAreas({ unknown: 'some/hint.tsx' })).toThrow();
  });

  it('is exported from the root entry too', () => {
    expect(() => rootEntry.assertHostAreas({ unknown: null })).toThrow();
  });
});
