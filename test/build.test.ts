import { describe, expect, it } from 'vitest';
import { buildFacts, releaseLabel, BuildFactsError } from '../src/build/index.js';

describe('buildFacts()', () => {
  describe('commit variable priority', () => {
    it('uses VERCEL_GIT_COMMIT_SHA when present', () => {
      const env = {
        VERCEL_GIT_COMMIT_SHA: 'abc123def456abc123def456abc123def456abc1',
      };
      const result = buildFacts({ env });
      expect(result.commit).toBe(
        'abc123def456abc123def456abc123def456abc1'
      );
    });

    it('skips empty VERCEL_GIT_COMMIT_SHA and uses GIT_COMMIT_SHA', () => {
      const env = {
        VERCEL_GIT_COMMIT_SHA: '',
        GIT_COMMIT_SHA: 'bcd234eef567bcd234eef567bcd234eef567bcd2',
      };
      const result = buildFacts({ env });
      expect(result.commit).toBe('bcd234eef567bcd234eef567bcd234eef567bcd2');
    });

    it('skips whitespace-only values', () => {
      const env = {
        VERCEL_GIT_COMMIT_SHA: '   ',
        GIT_COMMIT_SHA: 'cde345def678cde345def678cde345def678cde3',
      };
      const result = buildFacts({ env });
      expect(result.commit).toBe('cde345def678cde345def678cde345def678cde3');
    });

    it('uses SOURCE_COMMIT as the last default fallback', () => {
      const env = {
        SOURCE_COMMIT: '1234567890abcdef1234567890abcdef12345678',
      };
      const result = buildFacts({ env });
      expect(result.commit).toBe('1234567890abcdef1234567890abcdef12345678');
    });

    it('returns null when no commit variable is set', () => {
      const env = {};
      const result = buildFacts({ env });
      expect(result.commit).toBeNull();
    });
  });

  describe('custom commitVars', () => {
    it('checks custom variables in order', () => {
      const env = {
        MY_COMMIT: '1234567890abcdef1234567890abcdef12345678',
      };
      const result = buildFacts({ env, commitVars: ['MY_COMMIT'] });
      expect(result.commit).toBe(
        '1234567890abcdef1234567890abcdef12345678'
      );
    });

    it('respects custom variable priority order', () => {
      const env = {
        FIRST: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        SECOND: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      };
      const result = buildFacts({ env, commitVars: ['SECOND', 'FIRST'] });
      expect(result.commit).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    });
  });

  describe('commit normalization', () => {
    it('lowercases uppercase commit SHA', () => {
      const env = {
        VERCEL_GIT_COMMIT_SHA: 'ABC123DEF456ABC123DEF456ABC123DEF456ABC1',
      };
      const result = buildFacts({ env });
      expect(result.commit).toBe(
        'abc123def456abc123def456abc123def456abc1'
      );
    });

    it('lowercases mixed-case commit SHA', () => {
      const env = {
        GIT_COMMIT_SHA: 'AbC123DeF456AbC123DeF456AbC123DeF456AbC1',
      };
      const result = buildFacts({ env });
      expect(result.commit).toBe(
        'abc123def456abc123def456abc123def456abc1'
      );
    });
  });

  describe('commit validation', () => {
    it('throws BuildFactsError for malformed SHA with variable name', () => {
      const env = {
        VERCEL_GIT_COMMIT_SHA: 'not-a-valid-commit-sha-at-all',
      };
      expect(() => buildFacts({ env })).toThrow(BuildFactsError);
      expect(() => buildFacts({ env })).toThrow(
        /Invalid commit SHA from VERCEL_GIT_COMMIT_SHA/
      );
    });

    it('does not echo value in error at short length', () => {
      const env = {
        VERCEL_GIT_COMMIT_SHA: 'short',
      };
      const fn = () => buildFacts({ env });
      expect(fn).toThrow(BuildFactsError);
      const error = (() => {
        try {
          fn();
        } catch (e) {
          return e as BuildFactsError;
        }
      })();
      expect(error.message).not.toContain('short');
      expect(error.message).toContain('got 5');
    });

    it('does not echo value in error at long length', () => {
      const longValue = 'x'.repeat(1000);
      const env = {
        VERCEL_GIT_COMMIT_SHA: longValue,
      };
      const fn = () => buildFacts({ env });
      expect(fn).toThrow(BuildFactsError);
      const error = (() => {
        try {
          fn();
        } catch (e) {
          return e as BuildFactsError;
        }
      })();
      expect(error.message).not.toContain('x'.repeat(100));
      expect(error.message).toContain('got 1000');
    });

    it('throws when commit is too short', () => {
      const env = {
        GIT_COMMIT_SHA: 'abc123def456abc123def456abc123def456ab',
      };
      expect(() => buildFacts({ env })).toThrow(BuildFactsError);
      expect(() => buildFacts({ env })).toThrow(/Invalid commit SHA from GIT_COMMIT_SHA/);
    });

    it('throws when commit contains non-hex characters', () => {
      const env = {
        SOURCE_COMMIT: 'gggggggggggggggggggggggggggggggggggggg1',
      };
      expect(() => buildFacts({ env })).toThrow(BuildFactsError);
      expect(() => buildFacts({ env })).toThrow(/Invalid commit SHA from SOURCE_COMMIT/);
    });
  });

  describe('FEEDBACK_RELEASE', () => {
    it('uses FEEDBACK_RELEASE when set', () => {
      const env = {
        FEEDBACK_RELEASE: '1.0.0',
      };
      const result = buildFacts({ env });
      expect(result.release).toBe('1.0.0');
    });

    it('validates FEEDBACK_RELEASE format', () => {
      const env = {
        FEEDBACK_RELEASE: 'invalid!',
      };
      expect(() => buildFacts({ env })).toThrow(BuildFactsError);
      expect(() => buildFacts({ env })).toThrow(/Invalid FEEDBACK_RELEASE/);
    });

    it('accepts alphanumeric, dots, underscores, and dashes', () => {
      const env = {
        FEEDBACK_RELEASE: 'v1_2-3.4a',
      };
      const result = buildFacts({ env });
      expect(result.release).toBe('v1_2-3.4a');
    });

    it('treats empty FEEDBACK_RELEASE as unset', () => {
      const now = new Date('2026-09-29T12:00:00Z');
      const env = {
        FEEDBACK_RELEASE: '',
      };
      const result = buildFacts({ env, now });
      expect(result.release).toBe('2026.09.29-local');
    });

    it('treats whitespace-only FEEDBACK_RELEASE as unset', () => {
      const now = new Date('2026-09-29T12:00:00Z');
      const env = {
        FEEDBACK_RELEASE: '   ',
      };
      const result = buildFacts({ env, now });
      expect(result.release).toBe('2026.09.29-local');
    });

    it('rejects FEEDBACK_RELEASE longer than 64 chars', () => {
      const env = {
        FEEDBACK_RELEASE: 'a'.repeat(65),
      };
      expect(() => buildFacts({ env })).toThrow(BuildFactsError);
      expect(() => buildFacts({ env })).toThrow(/Invalid FEEDBACK_RELEASE/);
    });

    it('accepts FEEDBACK_RELEASE of exactly 64 chars', () => {
      const env = {
        FEEDBACK_RELEASE: 'a'.repeat(64),
      };
      const result = buildFacts({ env });
      expect(result.release).toBe('a'.repeat(64));
    });

    it('rejects FEEDBACK_RELEASE with special characters', () => {
      const env = {
        FEEDBACK_RELEASE: 'v1.0@beta',
      };
      expect(() => buildFacts({ env })).toThrow(BuildFactsError);
    });
  });

  describe('release generation from date and commit', () => {
    it('generates YYYY.MM.DD-<7-hex-commit> format', () => {
      const now = new Date('2026-09-29T12:00:00Z');
      const env = {
        VERCEL_GIT_COMMIT_SHA: '9f4c2a1d7e803bd2a61549c0e176fed32208aabc',
      };
      const result = buildFacts({ env, now });
      expect(result.release).toBe('2026.09.29-9f4c2a1');
    });

    it('uses UTC date boundaries correctly', () => {
      // Test both the start and end of a UTC day
      const now1 = new Date('2026-09-29T00:00:00Z');
      const now2 = new Date('2026-09-29T23:59:59Z');
      const env = {
        GIT_COMMIT_SHA: 'abc123def456abc123def456abc123def456abc1',
      };
      const result1 = buildFacts({ env, now: now1 });
      const result2 = buildFacts({ env, now: now2 });
      expect(result1.release).toMatch(/^2026\.09\.29-/);
      expect(result2.release).toMatch(/^2026\.09\.29-/);
    });

    it('pads month and day with zeros', () => {
      const now = new Date('2026-01-05T00:00:00Z');
      const env = {
        SOURCE_COMMIT: '1234567890abcdef1234567890abcdef12345678',
      };
      const result = buildFacts({ env, now });
      expect(result.release).toBe('2026.01.05-1234567');
    });

    it('generates YYYY.MM.DD-local when no commit', () => {
      const now = new Date('2026-09-29T12:00:00Z');
      const env = {};
      const result = buildFacts({ env, now });
      expect(result.release).toBe('2026.09.29-local');
    });
  });

  describe('production mode', () => {
    it('throws when production=true and no commit', () => {
      const env = {};
      expect(() => buildFacts({ env, production: true })).toThrow(
        BuildFactsError
      );
    });

    it('throws with a message listing checked variables', () => {
      const env = {};
      expect(() => buildFacts({ env, production: true })).toThrow(
        /VERCEL_GIT_COMMIT_SHA.*GIT_COMMIT_SHA.*SOURCE_COMMIT/
      );
    });

    it('throws with custom commitVars in the message', () => {
      const env = {};
      expect(() =>
        buildFacts({
          env,
          production: true,
          commitVars: ['MY_VAR', 'MY_OTHER_VAR'],
        })
      ).toThrow(/MY_VAR.*MY_OTHER_VAR/);
    });

    it('handles empty commitVars without "one of: " phrase', () => {
      const env = {};
      expect(() =>
        buildFacts({
          env,
          production: true,
          commitVars: [],
        })
      ).toThrow(/none configured/);
      expect(() =>
        buildFacts({
          env,
          production: true,
          commitVars: [],
        })
      ).not.toThrow(/one of: $/);
    });

    it('succeeds when production=true and commit is present', () => {
      const env = {
        VERCEL_GIT_COMMIT_SHA: 'abc123def456abc123def456abc123def456abc1',
      };
      const result = buildFacts({ env, production: true });
      expect(result.commit).toBe(
        'abc123def456abc123def456abc123def456abc1'
      );
    });

    it('succeeds when production=false and no commit', () => {
      const env = {};
      const result = buildFacts({ env, production: false });
      expect(result.commit).toBeNull();
      expect(result.release).toMatch(/local/);
    });
  });

  describe('BuildFactsError', () => {
    it('extends Error', () => {
      const error = new BuildFactsError('test');
      expect(error).toBeInstanceOf(Error);
    });

    it('has name = "BuildFactsError"', () => {
      const error = new BuildFactsError('test');
      expect(error.name).toBe('BuildFactsError');
    });
  });
});

describe('releaseLabel()', () => {
  it('formats default release with date and short commit', () => {
    const facts = {
      release: '2026.09.29-9f4c2a1',
      commit: '9f4c2a1d7e803bd2a61549c0e176fed32208aabc',
    };
    const label = releaseLabel(facts);
    expect(label).toBe('Release 2026.09.29 · 9f4c2a1');
  });

  it('formats default release with date and no commit', () => {
    const facts = {
      release: '2026.09.29-local',
      commit: null,
    };
    const label = releaseLabel(facts);
    expect(label).toBe('Release 2026.09.29');
  });

  it('uses middle dot U+00B7 as separator', () => {
    const facts = {
      release: '2026.09.29-abc1234',
      commit: 'abc1234567890abcdef1234567890abcdef123456',
    };
    const label = releaseLabel(facts);
    expect(label).toContain(' · ');
    expect(label).toBe('Release 2026.09.29 · abc1234');
  });

  it('formats custom release with commit', () => {
    const facts = {
      release: 'v1.0.0',
      commit: 'fedcba9876543210fedcba9876543210fedcba98',
    };
    const label = releaseLabel(facts);
    expect(label).toBe('Release v1.0.0 · fedcba9');
  });

  it('formats custom release without commit', () => {
    const facts = {
      release: 'nightly',
      commit: null,
    };
    const label = releaseLabel(facts);
    expect(label).toBe('Release nightly');
  });

  it('uses only first 7 characters of commit for default format', () => {
    const facts = {
      release: '2026.09.29-deadbee',
      commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    };
    const label = releaseLabel(facts);
    expect(label).toContain('deadbee');
    expect(label).not.toContain('deadbeefdeadbeef');
  });

  it('uses only first 7 characters of commit for custom release', () => {
    const facts = {
      release: 'beta-1',
      commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    };
    const label = releaseLabel(facts);
    expect(label).toBe('Release beta-1 · deadbee');
  });
});

describe('releaseLabel with a custom release that starts with a date', () => {
  const commit = '9f4c2a1d7e803bd2a61549c0e176fed32208aabc';
  it('renders a date-prefixed custom release whole', () => {
    expect(releaseLabel({ release: '2026.09.29-hotfix2', commit })).toBe('Release 2026.09.29-hotfix2 · 9f4c2a1');
  });
  it('renders a date-plus-other-hash release whole', () => {
    expect(releaseLabel({ release: '2026.09.29-abcdef0', commit })).toBe('Release 2026.09.29-abcdef0 · 9f4c2a1');
  });
  it('still collapses the exact default shape', () => {
    expect(releaseLabel({ release: '2026.09.29-9f4c2a1', commit })).toBe('Release 2026.09.29 · 9f4c2a1');
    expect(releaseLabel({ release: '2026.09.29-local', commit: null })).toBe('Release 2026.09.29');
  });
});
