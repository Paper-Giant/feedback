import { describe, expect, it } from 'vitest';
import { scheduleDeferredScrollRestore } from '../../dist/browser/index.js';
import type { AnimationFrameScheduler } from '../../dist/browser/index.js';

/**
 * `scheduleDeferredScrollRestore` is the extracted, unit-testable core of
 * the fix for gate R round 2 finding 2: pending scroll-restoration frames
 * outliving `close()`/`destroy()`. A fake, manually-driven
 * `AnimationFrameScheduler` stands in for the real
 * `requestAnimationFrame`/`cancelAnimationFrame` — no real browser (or
 * jsdom, which this package doesn't depend on) is needed to exercise the
 * cancellation and staleness behaviour precisely and deterministically.
 */
function createFakeScheduler(): AnimationFrameScheduler & {
  /** Runs the oldest still-pending callback, as if a frame elapsed. Throws if none is pending. */
  runNextFrame(): void;
  pendingCount(): number;
} {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    requestAnimationFrame(callback: () => void): number {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number): void {
      pending.delete(id);
    },
    runNextFrame(): void {
      const [id, callback] = [...pending.entries()][0] ?? [];
      if (id === undefined || !callback) throw new Error('runNextFrame(): nothing pending');
      pending.delete(id);
      callback();
    },
    pendingCount(): number {
      return pending.size;
    },
  };
}

describe('scheduleDeferredScrollRestore() (review fix, gate R round 2 finding 2)', () => {
  it('with nothing cancelled, restore() runs on both deferred passes', () => {
    const scheduler = createFakeScheduler();
    let calls = 0;
    scheduleDeferredScrollRestore(
      () => {
        calls += 1;
      },
      () => false,
      scheduler,
    );

    expect(scheduler.pendingCount()).toBe(1);
    scheduler.runNextFrame(); // first pass
    expect(calls).toBe(1);
    expect(scheduler.pendingCount()).toBe(1); // second pass now queued
    scheduler.runNextFrame(); // second pass
    expect(calls).toBe(2);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('cancel() before the first frame fires prevents both passes — restore() never runs', () => {
    const scheduler = createFakeScheduler();
    let calls = 0;
    const handle = scheduleDeferredScrollRestore(
      () => {
        calls += 1;
      },
      () => false,
      scheduler,
    );

    handle.cancel();
    expect(scheduler.pendingCount()).toBe(0);
    expect(calls).toBe(0);
  });

  it('cancel() after the first pass has already run, but before the second fires, prevents only the second — this is the exact race the review reported (a pending frame outliving destroy())', () => {
    const scheduler = createFakeScheduler();
    let calls = 0;
    const handle = scheduleDeferredScrollRestore(
      () => {
        calls += 1;
      },
      () => false,
      scheduler,
    );

    scheduler.runNextFrame(); // first pass runs, schedules the second
    expect(calls).toBe(1);
    expect(scheduler.pendingCount()).toBe(1);

    handle.cancel(); // e.g. destroy() running between the two frames
    expect(scheduler.pendingCount()).toBe(0);
    expect(calls).toBe(1); // the second pass's restore() never ran
  });

  it('cancel() is idempotent and safe to call with nothing pending', () => {
    const scheduler = createFakeScheduler();
    const handle = scheduleDeferredScrollRestore(
      () => {},
      () => false,
      scheduler,
    );
    scheduler.runNextFrame();
    scheduler.runNextFrame();
    expect(() => {
      handle.cancel();
      handle.cancel();
    }).not.toThrow();
  });

  it('isStale() is consulted on every pass: even without cancel(), a stale check on the first pass skips restore() and never schedules the second', () => {
    const scheduler = createFakeScheduler();
    let calls = 0;
    let stale = true;
    scheduleDeferredScrollRestore(
      () => {
        calls += 1;
      },
      () => stale,
      scheduler,
    );

    scheduler.runNextFrame();
    expect(calls).toBe(0);
    expect(scheduler.pendingCount()).toBe(0); // the second pass was never scheduled

    // Flipping isStale() back afterwards changes nothing — there's nothing left to run.
    stale = false;
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('isStale() true only on the second pass: the first restore() runs, the second does not — the belt-and-braces case when cancellation itself raced a frame that had already started', () => {
    const scheduler = createFakeScheduler();
    let calls = 0;
    let stale = false;
    scheduleDeferredScrollRestore(
      () => {
        calls += 1;
      },
      () => stale,
      scheduler,
    );

    scheduler.runNextFrame(); // isStale() false here — first restore() runs
    expect(calls).toBe(1);

    stale = true; // e.g. destroy() flips `destroyed` between the two frames
    scheduler.runNextFrame(); // isStale() true here — second restore() skipped
    expect(calls).toBe(1);
  });
});
