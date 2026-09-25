// @vitest-environment jsdom
import './test-setup.js';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createFakeController, createFakeLauncherHandle, type FakeController } from './fake-controller.js';

const { mountFeedbackMock, mountLauncherMock } = vi.hoisted(() => ({
  mountFeedbackMock: vi.fn(),
  mountLauncherMock: vi.fn(),
}));

vi.mock('../../src/browser/index.js', () => ({
  mountFeedback: mountFeedbackMock,
  mountLauncher: mountLauncherMock,
}));

import { FeedbackProvider } from '../../src/react/index.js';

// React's development Strict Mode double-invokes mount effects
// (mount -> cleanup -> mount again) to surface exactly the kind of bug a
// naive "create in useEffect, destroy in its cleanup" implementation
// would have if the cleanup didn't actually undo everything the effect
// did. Vitest runs with NODE_ENV=test (not "production"), which is what
// turns this behaviour on.

describe('<FeedbackProvider> — React Strict Mode', () => {
  it('leaves exactly one live (non-destroyed) controller, with no leak', () => {
    const created: FakeController[] = [];
    mountFeedbackMock.mockClear();
    mountFeedbackMock.mockImplementation(() => {
      const controller = createFakeController();
      created.push(controller);
      return controller;
    });

    render(
      <StrictMode>
        <FeedbackProvider notice="n">
          <p>host content</p>
        </FeedbackProvider>
      </StrictMode>,
    );

    // Strict Mode's double-invoke on mount is exactly mount -> cleanup ->
    // mount again: precisely two constructions, and the first of the two
    // must have been destroyed again before the second replaced it — no
    // leaked live controller, and never more than one live at a time.
    expect(created).toHaveLength(2);
    expect(created[0].destroyed).toBe(true);
    expect(created[1].destroyed).toBe(false);
  });

  it('leaves exactly one live launcher handle, with no double launcher', () => {
    const createdControllers: FakeController[] = [];
    const createdHandles: ReturnType<typeof createFakeLauncherHandle>[] = [];
    mountFeedbackMock.mockClear();
    mountLauncherMock.mockClear();
    mountFeedbackMock.mockImplementation(() => {
      const controller = createFakeController();
      createdControllers.push(controller);
      return controller;
    });
    mountLauncherMock.mockImplementation(() => {
      const handle = createFakeLauncherHandle();
      createdHandles.push(handle);
      return handle;
    });

    render(
      <StrictMode>
        <FeedbackProvider notice="n" launcher />
      </StrictMode>,
    );

    expect(createdControllers).toHaveLength(2);
    expect(createdHandles).toHaveLength(2);
    expect(createdHandles[0].destroyed).toBe(true);
    expect(createdHandles[1].destroyed).toBe(false);
  });
});
