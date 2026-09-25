// @vitest-environment jsdom
import './test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createFakeController, type FakeController } from './fake-controller.js';

const { mountFeedbackMock, mountLauncherMock } = vi.hoisted(() => ({
  mountFeedbackMock: vi.fn(),
  mountLauncherMock: vi.fn(),
}));

vi.mock('../../src/browser/index.js', () => ({
  mountFeedback: mountFeedbackMock,
  mountLauncher: mountLauncherMock,
}));

import { FeedbackArea, FeedbackButton, FeedbackProvider, useFeedback, type UseFeedbackResult } from '../../src/react/index.js';

function setup() {
  const created: FakeController[] = [];
  mountFeedbackMock.mockClear();
  mountLauncherMock.mockClear();
  mountFeedbackMock.mockImplementation(() => {
    const controller = createFakeController();
    created.push(controller);
    return controller;
  });
  return created;
}

/**
 * Build plan / review item 1: `enabled={false}` — a host keeps production
 * disabled, but still renders the provider and a `<FeedbackButton>`
 * unconditionally (e.g. in the wizard header), so nothing here may throw
 * just because the key wasn't configured for that environment.
 */

describe('<FeedbackProvider enabled={false}>', () => {
  it('mounts no controller and no launcher', () => {
    const created = setup();
    render(
      <FeedbackProvider notice="n" enabled={false} launcher>
        <p>host content</p>
      </FeedbackProvider>,
    );
    expect(created).toHaveLength(0);
    expect(mountLauncherMock).not.toHaveBeenCalled();
  });

  it('useFeedback() reports available: false, enabled: false, and a safe no-op open()', () => {
    setup();
    let captured: UseFeedbackResult | null = null;
    function Consumer() {
      captured = useFeedback();
      return null;
    }
    render(
      <FeedbackProvider notice="n" enabled={false}>
        <Consumer />
      </FeedbackProvider>,
    );
    expect(captured!.available).toBe(false);
    expect(captured!.enabled).toBe(false);
    expect(captured!.open()).toBe(false);
    expect(captured!.isOpen()).toBe(false);
  });

  it('<FeedbackButton> renders nothing (no throw)', () => {
    setup();
    const { container } = render(
      <FeedbackProvider notice="n" enabled={false}>
        <FeedbackButton data-testid="launcher">Give feedback</FeedbackButton>
      </FeedbackProvider>,
    );
    expect(screen.queryByTestId('launcher')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('<FeedbackArea> does nothing — no controller to call setArea on, and no throw', () => {
    setup();
    expect(() =>
      render(
        <FeedbackProvider notice="n" enabled={false}>
          <FeedbackArea name="checkout-wizard" />
        </FeedbackProvider>,
      ),
    ).not.toThrow();
    // No controller was ever created, so there's nothing to assert
    // setArea against — the point is only that nothing throws and
    // nothing is mounted (covered by the "mounts no controller" test).
  });
});

describe('<FeedbackProvider> — toggling enabled', () => {
  it('false → true mounts a controller', () => {
    const created = setup();
    const { rerender } = render(<FeedbackProvider notice="n" enabled={false} />);
    expect(created).toHaveLength(0);

    rerender(<FeedbackProvider notice="n" enabled={true} />);
    expect(created).toHaveLength(1);
    expect(created[0].destroyed).toBe(false);
  });

  it('true → false destroys the controller', () => {
    const created = setup();
    const { rerender } = render(<FeedbackProvider notice="n" enabled={true} />);
    expect(created).toHaveLength(1);
    expect(created[0].destroyed).toBe(false);

    rerender(<FeedbackProvider notice="n" enabled={false} />);
    expect(created[0].destroyed).toBe(true);
  });

  it('a <FeedbackButton> starts rendering once enabled flips true, and stops once it flips back', () => {
    setup();
    function Harness({ enabled }: { enabled: boolean }) {
      return (
        <FeedbackProvider notice="n" enabled={enabled}>
          <FeedbackButton data-testid="launcher" />
        </FeedbackProvider>
      );
    }
    const { rerender } = render(<Harness enabled={false} />);
    expect(screen.queryByTestId('launcher')).toBeNull();

    rerender(<Harness enabled={true} />);
    expect(screen.getByTestId('launcher')).toBeTruthy();

    rerender(<Harness enabled={false} />);
    expect(screen.queryByTestId('launcher')).toBeNull();
  });
});
