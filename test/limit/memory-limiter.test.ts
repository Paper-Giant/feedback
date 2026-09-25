import { describe, expect, it } from 'vitest';
import { LimiterError, memoryLimiter } from '../../src/limit/index.js';

// Unit tests for memoryLimiter() (task P4; design §5 "Limits"). Every test
// injects `now` so the sliding windows are exercised deterministically —
// no real timers.

describe('memoryLimiter subject validation', () => {
  // Matches sql/postgres-limiter.sql's feedback_rate_take, which rejects
  // the same bound — see the review fix that added this.
  it('throws LimiterError for an empty subject', async () => {
    const limiter = memoryLimiter();
    await expect(limiter.take('')).rejects.toBeInstanceOf(LimiterError);
  });

  it('throws LimiterError for a subject longer than 256 characters', async () => {
    const limiter = memoryLimiter();
    await expect(limiter.take('x'.repeat(257))).rejects.toBeInstanceOf(LimiterError);
  });

  it('allows a subject exactly 256 characters long', async () => {
    const limiter = memoryLimiter();
    await expect(limiter.take('x'.repeat(256))).resolves.toBe('ok');
  });

  it('does not record anything for a rejected subject', async () => {
    let now = 0;
    const limiter = memoryLimiter({
      perSubject: { limit: 1, windowMs: 1000 },
      now: () => now,
    });

    await expect(limiter.take('')).rejects.toBeInstanceOf(LimiterError);
    // The rejected call above must not have consumed the one slot in the
    // per-subject window for a real subject that happens to share state.
    expect(await limiter.take('real-subject')).toBe('ok');
  });
});

describe('memoryLimiter defaults', () => {
  it('exposes kind "memory" and defaults singleInstance to false', () => {
    const limiter = memoryLimiter();
    expect(limiter.kind).toBe('memory');
    expect(limiter.singleInstance).toBe(false);
  });

  it('exposes singleInstance as configured', () => {
    const limiter = memoryLimiter({ singleInstance: true });
    expect(limiter.singleInstance).toBe(true);
  });
});

describe('memoryLimiter per-subject window', () => {
  it('limits the sixth call for a subject inside the default 10-minute window', async () => {
    let now = 0;
    const limiter = memoryLimiter({ now: () => now });

    for (let i = 0; i < 5; i++) {
      expect(await limiter.take('alice')).toBe('ok');
    }
    expect(await limiter.take('alice')).toBe('limited');

    // A different subject is unaffected by alice's exhausted window.
    expect(await limiter.take('bob')).toBe('ok');
  });

  it('slides the window: an old event ages out while a newer one still counts', async () => {
    let now = 0;
    const limiter = memoryLimiter({
      perSubject: { limit: 2, windowMs: 1000 },
      perApp: { limit: 1000, windowMs: 1_000_000 },
      now: () => now,
    });

    expect(await limiter.take('a')).toBe('ok'); // t=0
    now = 500;
    expect(await limiter.take('a')).toBe('ok'); // t=500, now at the limit (2)
    now = 999;
    expect(await limiter.take('a')).toBe('limited'); // both events still in [ -1, 999 ]

    now = 1001; // cutoff=1: the t=0 event ages out, t=500 remains
    expect(await limiter.take('a')).toBe('ok');

    now = 1501; // cutoff=501: the t=500 event ages out too
    expect(await limiter.take('a')).toBe('ok');
  });
});

describe('memoryLimiter per-app window', () => {
  it('enforces the app-wide window across many different subjects', async () => {
    let now = 0;
    const limiter = memoryLimiter({
      perSubject: { limit: 1000, windowMs: 1000 },
      perApp: { limit: 3, windowMs: 1000 },
      now: () => now,
    });

    expect(await limiter.take('a')).toBe('ok');
    expect(await limiter.take('b')).toBe('ok');
    expect(await limiter.take('c')).toBe('ok');
    // d is a brand-new subject, nowhere near its own per-subject limit, but
    // the app-wide window is exhausted.
    expect(await limiter.take('d')).toBe('limited');

    now = 1001; // the app window slides past all three recorded events
    expect(await limiter.take('d')).toBe('ok');
  });

  it('checks both windows before recording, refusing on either', async () => {
    let now = 0;
    const limiter = memoryLimiter({
      perSubject: { limit: 1, windowMs: 1000 },
      perApp: { limit: 1000, windowMs: 1000 },
      now: () => now,
    });

    expect(await limiter.take('a')).toBe('ok');
    // a is over its own per-subject limit even though the app window has
    // plenty of room left.
    expect(await limiter.take('a')).toBe('limited');
  });
});

describe('memoryLimiter capacity (maxSubjects)', () => {
  it('refuses a new subject at capacity without evicting an active one', async () => {
    let now = 0;
    const limiter = memoryLimiter({
      maxSubjects: 2,
      perSubject: { limit: 2, windowMs: 10_000 },
      perApp: { limit: 1000, windowMs: 10_000 },
      now: () => now,
    });

    expect(await limiter.take('a')).toBe('ok'); // a: 1/2
    expect(await limiter.take('a')).toBe('ok'); // a: 2/2, at its own limit
    expect(await limiter.take('b')).toBe('ok'); // b: 1/2 — map now at capacity (2 subjects)

    // c is a genuinely new subject arriving at capacity: refused, and
    // never recorded (neither as a new entry nor against the app window).
    expect(await limiter.take('c')).toBe('limited');

    // a is still limited by its own exhausted window — if it had been
    // evicted to make room, this call would read as a fresh subject and
    // return 'ok' instead.
    expect(await limiter.take('a')).toBe('limited');
  });

  it('sweeps an expired subject to free its slot for a new one at capacity', async () => {
    let now = 0;
    const limiter = memoryLimiter({
      maxSubjects: 1,
      perSubject: { limit: 5, windowMs: 1000 },
      perApp: { limit: 1000, windowMs: 100_000 },
      now: () => now,
    });

    expect(await limiter.take('a')).toBe('ok');
    expect(await limiter.take('b')).toBe('limited'); // capacity reached, a still live

    now = 1001; // a's only event ages out of its 1000ms window
    expect(await limiter.take('b')).toBe('ok'); // the sweep frees a's slot for b
  });
});

describe('memoryLimiter concurrency', () => {
  it('fires six take() calls for one subject without awaiting in between and lets exactly five through', async () => {
    const limiter = memoryLimiter();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => limiter.take('alice')),
    );

    expect(results.filter((r) => r === 'ok')).toHaveLength(5);
    expect(results.filter((r) => r === 'limited')).toHaveLength(1);
  });

  it('fires ten concurrent take() calls at the app boundary and lets exactly one more through', async () => {
    let now = 0;
    const limiter = memoryLimiter({
      perSubject: { limit: 1000, windowMs: 10_000 },
      perApp: { limit: 100, windowMs: 10_000 },
      now: () => now,
    });

    // Pre-load 99 app-wide events across distinct subjects, synchronously,
    // one at a time (each call's own synchronous recording is what P4
    // requires — this loop does not itself test concurrency).
    for (let i = 0; i < 99; i++) {
      expect(await limiter.take(`subject-${i}`)).toBe('ok');
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => limiter.take(`concurrent-${i}`)),
    );

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'limited')).toHaveLength(9);
  });
});
