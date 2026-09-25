import { describe, expect, it } from 'vitest';
import { createFeedbackHandler } from '../../dist/server/index.js';
import { baseConfig } from './helpers.js';

// Build plan P6, "Done when": "construction refuses bad origins and an
// unknown area key." Construction is synchronous, so a misconfigured host
// fails at start-up rather than on the first request.

describe('createFeedbackHandler() construction', () => {
  it('returns a function for a valid config', () => {
    const handler = createFeedbackHandler(baseConfig());
    expect(typeof handler).toBe('function');
  });

  it('throws for an empty origins array', () => {
    expect(() => createFeedbackHandler(baseConfig({ origins: [] }))).toThrow(/origins/i);
  });

  it('throws for an origin with a path', () => {
    expect(() => createFeedbackHandler(baseConfig({ origins: ['http://localhost:3000/app'] }))).toThrow();
  });

  it('throws for an origin with a trailing slash', () => {
    expect(() => createFeedbackHandler(baseConfig({ origins: ['http://localhost:3000/'] }))).toThrow();
  });

  it('throws for an origin with a query string', () => {
    expect(() => createFeedbackHandler(baseConfig({ origins: ['http://localhost:3000?x=1'] }))).toThrow();
  });

  it('throws for an origin missing a scheme', () => {
    expect(() => createFeedbackHandler(baseConfig({ origins: ['localhost:3000'] }))).toThrow();
  });

  it('throws for an unparseable origin', () => {
    expect(() => createFeedbackHandler(baseConfig({ origins: ['not a url at all'] }))).toThrow();
  });

  it('throws when any one of several origins is bad, even if the others are fine', () => {
    expect(() =>
      createFeedbackHandler(baseConfig({ origins: ['https://a.example', 'https://b.example/bad'] })),
    ).toThrow();
  });

  it('accepts several distinct well-formed origins', () => {
    const handler = createFeedbackHandler(
      baseConfig({ origins: ['https://a.example', 'https://b.example:8443'] }),
    );
    expect(typeof handler).toBe('function');
  });

  it('throws when areas configures the reserved "unknown" key with a null hint', () => {
    expect(() => createFeedbackHandler(baseConfig({ areas: { unknown: null } }))).toThrow();
  });

  it('throws when areas configures the reserved "unknown" key with a string hint', () => {
    expect(() => createFeedbackHandler(baseConfig({ areas: { unknown: 'some/hint.tsx' } }))).toThrow();
  });

  it('accepts an areas map with ordinary keys', () => {
    const handler = createFeedbackHandler(baseConfig({ areas: { 'checkout-wizard': 'app/page.tsx' } }));
    expect(typeof handler).toBe('function');
  });
});
