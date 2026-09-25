// @vitest-environment jsdom
import './test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { createFakeController, createFakeLauncherHandle } from './fake-controller.js';

const { mountFeedbackMock, mountLauncherMock } = vi.hoisted(() => ({
  mountFeedbackMock: vi.fn(),
  mountLauncherMock: vi.fn(),
}));

vi.mock('../../src/browser/index.js', () => ({
  mountFeedback: mountFeedbackMock,
  mountLauncher: mountLauncherMock,
}));

// vi.mock() above is hoisted above this import (and above the transitive
// `../browser/index.js` import inside src/react/index.tsx, which resolves
// to the same file), so the provider sees the mocked module.
import { FeedbackProvider } from '../../src/react/index.js';

describe('<FeedbackProvider> — mounting', () => {
  it('mounts no controller during a server render', () => {
    mountFeedbackMock.mockClear();
    const html = renderToString(
      <FeedbackProvider notice="Reports go to a private repository.">
        <p>host content</p>
      </FeedbackProvider>,
    );
    expect(html).toContain('host content');
    expect(mountFeedbackMock).not.toHaveBeenCalled();
  });

  it('mounts exactly one controller after mount — with its children already committed to the DOM, not during render — passing endpoint/notice/allowReference/areas/build through', () => {
    const controller = createFakeController();
    mountFeedbackMock.mockClear();
    // review item 11: assert *inside* the mock implementation, at the
    // exact moment mountFeedback() is called, that the provider's own
    // children are already attached to document.body — proof this runs
    // in an effect, after the commit, rather than during render (a call
    // made during render would fire before anything is in the document
    // at all).
    let childInDomWhenCalled = false;
    mountFeedbackMock.mockImplementation(() => {
      childInDomWhenCalled = document.body.querySelector('[data-testid="provider-child"]') !== null;
      return controller;
    });

    render(
      <FeedbackProvider
        endpoint="/api/feedback"
        notice="Reports go to a private repository."
        allowReference
        areas={['checkout-wizard']}
        build={{ release: '2026.09.29-abc', commit: 'abc' }}
      >
        <p data-testid="provider-child">host content</p>
      </FeedbackProvider>,
    );

    expect(mountFeedbackMock).toHaveBeenCalledTimes(1);
    expect(childInDomWhenCalled).toBe(true);
    const passed = mountFeedbackMock.mock.calls[0][0];
    expect(passed.endpoint).toBe('/api/feedback');
    expect(passed.notice).toBe('Reports go to a private repository.');
    expect(passed.allowReference).toBe(true);
    expect(passed.areas).toEqual(['checkout-wizard']);
    expect(passed.build).toEqual({ release: '2026.09.29-abc', commit: 'abc' });
  });

  it('destroys the controller on unmount', () => {
    const controller = createFakeController();
    mountFeedbackMock.mockClear();
    mountFeedbackMock.mockReturnValue(controller);

    const { unmount } = render(
      <FeedbackProvider notice="n">
        <p>host content</p>
      </FeedbackProvider>,
    );

    expect(controller.destroyed).toBe(false);
    unmount();
    expect(controller.destroyed).toBe(true);
    expect(controller.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('<FeedbackProvider> — launcher option', () => {
  it('does not call mountLauncher when launcher is omitted', () => {
    mountFeedbackMock.mockClear();
    mountLauncherMock.mockClear();
    mountFeedbackMock.mockReturnValue(createFakeController());
    render(<FeedbackProvider notice="n" />);
    expect(mountLauncherMock).not.toHaveBeenCalled();
  });

  it('calls mountLauncher(controller) with no options when launcher is true', () => {
    const controller = createFakeController();
    mountFeedbackMock.mockClear();
    mountLauncherMock.mockClear();
    mountFeedbackMock.mockReturnValue(controller);
    mountLauncherMock.mockReturnValue(createFakeLauncherHandle());

    render(<FeedbackProvider notice="n" launcher />);

    expect(mountLauncherMock).toHaveBeenCalledTimes(1);
    expect(mountLauncherMock).toHaveBeenCalledWith(controller, {});
  });

  it('forwards a launcher options object through to mountLauncher', () => {
    const controller = createFakeController();
    mountFeedbackMock.mockClear();
    mountLauncherMock.mockClear();
    mountFeedbackMock.mockReturnValue(controller);
    mountLauncherMock.mockReturnValue(createFakeLauncherHandle());

    render(<FeedbackProvider notice="n" launcher={{ label: 'Help', side: 'left' }} />);

    expect(mountLauncherMock).toHaveBeenCalledWith(controller, { label: 'Help', side: 'left' });
  });

  it('destroys the launcher handle (before the controller) on unmount', () => {
    const controller = createFakeController();
    const launcherHandle = createFakeLauncherHandle();
    mountFeedbackMock.mockClear();
    mountLauncherMock.mockClear();
    mountFeedbackMock.mockReturnValue(controller);
    mountLauncherMock.mockReturnValue(launcherHandle);

    const { unmount } = render(<FeedbackProvider notice="n" launcher />);
    unmount();

    expect(launcherHandle.destroyed).toBe(true);
    expect(controller.destroyed).toBe(true);
  });
});
