import { vi } from 'vitest';
import type { FeedbackController, LauncherHandle } from '../../src/browser/index.js';

/**
 * A `FeedbackController` double for the component tests in this
 * directory. `mountFeedback()` itself is proven for real in
 * test/browser/** and examples/fixture (real browser); these tests mock
 * it (per the build plan) so they can run in jsdom, which can't
 * `showModal()`, and so they can assert on the wrapper's own lifecycle
 * bookkeeping (create/destroy counts, ordering) directly.
 */
export interface FakeController extends FeedbackController {
  readonly destroyed: boolean;
}

export function createFakeController(): FakeController {
  let destroyed = false;
  return {
    open: vi.fn(() => true),
    close: vi.fn(),
    isOpen: vi.fn(() => false),
    setArea: vi.fn(),
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    get destroyed() {
      return destroyed;
    },
  };
}

export interface FakeLauncherHandle extends LauncherHandle {
  readonly destroyed: boolean;
}

export function createFakeLauncherHandle(): FakeLauncherHandle {
  let destroyed = false;
  return {
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    get destroyed() {
      return destroyed;
    },
  };
}
