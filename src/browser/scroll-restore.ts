/**
 * @papergiant/feedback/browser — the deferred scroll-restore scheduler
 * `proceedOpen()` uses around `showModal()` (review fix, gate R round 2
 * finding 2).
 *
 * `showModal()`'s own internal default-focusing step can disturb an
 * ancestor's scroll position after this module's own code has already
 * run (see `dialog.ts`'s `proceedOpen`), so two deferred passes re-assert
 * the captured position a couple of frames later as a safety margin. Left
 * unmanaged, either pass can fire *after* the controller has been closed
 * or destroyed, stomping on a scroll position the host (or a person) set
 * legitimately in the meantime. Extracted here, independent of
 * `requestAnimationFrame`/`cancelAnimationFrame` themselves (accepted as
 * parameters), so the cancellation and staleness behaviour is
 * unit-testable with a fake scheduler rather than only in a real browser.
 */

export interface AnimationFrameScheduler {
  requestAnimationFrame: (callback: () => void) => number;
  cancelAnimationFrame: (id: number) => void;
}

export interface ScrollRestoreHandle {
  /** Cancels whichever of the two passes hasn't already run. Idempotent. */
  cancel(): void;
}

/**
 * Schedules two deferred passes of `restore()`. Before each pass actually
 * restores anything, it calls `isStale()` — covering the case where
 * `cancel()` raced a frame that had already started running (the
 * `openGeneration`/`destroyed` check in `dialog.ts`): a frame that fires
 * is not itself preventable once the browser has committed to running
 * it, but its *effect* still is.
 */
export function scheduleDeferredScrollRestore(
  restore: () => void,
  isStale: () => boolean,
  scheduler: AnimationFrameScheduler,
): ScrollRestoreHandle {
  let firstFrameId: number | undefined;
  let secondFrameId: number | undefined;

  firstFrameId = scheduler.requestAnimationFrame(() => {
    firstFrameId = undefined;
    if (isStale()) return;
    restore();
    secondFrameId = scheduler.requestAnimationFrame(() => {
      secondFrameId = undefined;
      if (isStale()) return;
      restore();
    });
  });

  return {
    cancel(): void {
      if (firstFrameId !== undefined) scheduler.cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== undefined) scheduler.cancelAnimationFrame(secondFrameId);
      firstFrameId = undefined;
      secondFrameId = undefined;
    },
  };
}
