// @vitest-environment jsdom
import './test-setup.js';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createFakeController } from './fake-controller.js';

const { mountFeedbackMock, mountLauncherMock } = vi.hoisted(() => ({
  mountFeedbackMock: vi.fn(),
  mountLauncherMock: vi.fn(),
}));

vi.mock('../../src/browser/index.js', () => ({
  mountFeedback: mountFeedbackMock,
  mountLauncher: mountLauncherMock,
}));

import { FeedbackProvider, useFeedback, type UseFeedbackResult } from '../../src/react/index.js';

describe('useFeedback() — outside a <FeedbackProvider>', () => {
  it('throws a clear error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Consumer() {
      useFeedback();
      return null;
    }
    try {
      expect(() => render(<Consumer />)).toThrow(/FeedbackProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('useFeedback() — before the controller has mounted', () => {
  it('available is false, open() and isOpen() return false, and neither throws, when read during a server render (effects never run there at all)', () => {
    mountFeedbackMock.mockClear();
    let captured: UseFeedbackResult | null = null;
    function Consumer() {
      captured = useFeedback();
      return null;
    }

    renderToString(
      <FeedbackProvider notice="n">
        <Consumer />
      </FeedbackProvider>,
    );

    expect(mountFeedbackMock).not.toHaveBeenCalled();
    expect(captured).not.toBeNull();
    expect(captured!.available).toBe(false);
    expect(captured!.open()).toBe(false);
    expect(captured!.isOpen()).toBe(false);
  });

  it('becomes available, and open()/isOpen() reach the real controller, once the effect has run', () => {
    const controller = createFakeController();
    mountFeedbackMock.mockClear();
    mountFeedbackMock.mockReturnValue(controller);

    let captured: UseFeedbackResult | null = null;
    function Consumer() {
      captured = useFeedback();
      return null;
    }

    render(
      <FeedbackProvider notice="n">
        <Consumer />
      </FeedbackProvider>,
    );

    expect(captured!.available).toBe(true);
    expect(captured!.open()).toBe(true);
    expect(controller.open).toHaveBeenCalledTimes(1);
  });
});
