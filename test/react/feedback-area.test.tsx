// @vitest-environment jsdom
import './test-setup.js';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { createFakeController } from './fake-controller.js';

const { mountFeedbackMock, mountLauncherMock } = vi.hoisted(() => ({
  mountFeedbackMock: vi.fn(),
  mountLauncherMock: vi.fn(),
}));

vi.mock('../../src/browser/index.js', () => ({
  mountFeedback: mountFeedbackMock,
  mountLauncher: mountLauncherMock,
}));

import { FeedbackProvider, FeedbackArea, useFeedback } from '../../src/react/index.js';

function setup() {
  const controller = createFakeController();
  mountFeedbackMock.mockClear();
  mountFeedbackMock.mockReturnValue(controller);
  return controller;
}

describe('<FeedbackArea> — outside a <FeedbackProvider>', () => {
  it('throws a clear error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<FeedbackArea name="x" />)).toThrow(/FeedbackProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('<FeedbackArea> — renders nothing', () => {
  it('renders no DOM node of its own', () => {
    setup();
    const { container } = render(
      <FeedbackProvider notice="n">
        <div data-testid="only-child">host</div>
        <FeedbackArea name="checkout-wizard" />
      </FeedbackProvider>,
    );
    // The only element in the tree is the host's own — <FeedbackArea>
    // contributed nothing to the DOM.
    expect(container.querySelectorAll('*')).toHaveLength(1);
  });
});

describe('<FeedbackArea> — applied before the controller exists', () => {
  it('is applied to the controller once it mounts', () => {
    const controller = setup();
    render(
      <FeedbackProvider notice="n">
        <FeedbackArea name="checkout-wizard" />
      </FeedbackProvider>,
    );
    expect(controller.setArea).toHaveBeenCalledWith('checkout-wizard');
  });
});

describe('<FeedbackArea> — review item 2: no spurious re-push when the controller finishes mounting', () => {
  it('a plain mount calls setArea with the name exactly once, and never with null', () => {
    // Under the earlier, buggy implementation (the effect depending on
    // the whole context value), this area would pop and re-push itself
    // the instant `available` flipped from false to true — a spurious
    // 'only' -> null -> 'only' sequence, three calls instead of one.
    const controller = setup();
    render(
      <FeedbackProvider notice="n">
        <FeedbackArea name="only" />
      </FeedbackProvider>,
    );
    expect(controller.setArea).toHaveBeenCalledTimes(1);
    expect(controller.setArea).toHaveBeenCalledWith('only');
    expect(controller.setArea).not.toHaveBeenCalledWith(null);
  });
});

describe('<FeedbackArea> — stack semantics', () => {
  it('the most recently mounted area wins; unmounting it restores the one below; unmounting a non-top area leaves the current area unchanged', () => {
    const controller = setup();

    function Harness() {
      const [showA, setShowA] = useState(true);
      const [showB, setShowB] = useState(false);
      return (
        <FeedbackProvider notice="n">
          {showA && <FeedbackArea name="area-a" />}
          {showB && <FeedbackArea name="area-b" />}
          <button data-testid="toggle-a" onClick={() => setShowA((v) => !v)} />
          <button data-testid="toggle-b" onClick={() => setShowB((v) => !v)} />
        </FeedbackProvider>
      );
    }

    const { getByTestId } = render(<Harness />);

    // Mount A -> A.
    expect(controller.setArea).toHaveBeenLastCalledWith('area-a');
    controller.setArea.mockClear();

    // Mount B (on top of A) -> B.
    act(() => {
      getByTestId('toggle-b').click();
    });
    expect(controller.setArea).toHaveBeenLastCalledWith('area-b');
    controller.setArea.mockClear();

    // Unmount A while B (the top) stays mounted -> current area (B)
    // unaffected; setArea is not called again.
    act(() => {
      getByTestId('toggle-a').click();
    });
    expect(controller.setArea).not.toHaveBeenCalled();

    // Remount A: it goes back on top (most-recently-mounted wins) -> A.
    act(() => {
      getByTestId('toggle-a').click();
    });
    expect(controller.setArea).toHaveBeenLastCalledWith('area-a');
    controller.setArea.mockClear();

    // Unmount A (currently the top) -> restores the one below (B).
    act(() => {
      getByTestId('toggle-a').click();
    });
    expect(controller.setArea).toHaveBeenLastCalledWith('area-b');
  });

  it('unmounting the last area restores no area (null)', () => {
    const controller = setup();
    function Harness() {
      const [mounted, setMounted] = useState(true);
      return (
        <FeedbackProvider notice="n">
          {mounted && <FeedbackArea name="only-area" />}
          <button data-testid="toggle" onClick={() => setMounted((v) => !v)} />
        </FeedbackProvider>
      );
    }
    const { getByTestId } = render(<Harness />);
    controller.setArea.mockClear();
    act(() => {
      getByTestId('toggle').click();
    });
    expect(controller.setArea).toHaveBeenLastCalledWith(null);
  });
});

describe('<FeedbackArea> — review item 4: commit effect order, not JSX/DOM nesting depth', () => {
  it('a layout\'s own <FeedbackArea> placed AFTER {children} beats the page\'s, even though the page\'s is the one actually nested inside a child component', () => {
    // React runs mount effects in post-order: a sibling's whole subtree
    // completes before the next sibling's begins. Layout renders its own
    // <FeedbackArea> as the LATER sibling of {children} here, so Page's
    // subtree (the earlier sibling) finishes first, and Layout's own
    // area — mounted second — ends up on top.
    const controller = setup();
    function Layout({ children }: { children: ReactNode }) {
      return (
        <>
          {children}
          <FeedbackArea name="layout" />
        </>
      );
    }
    function Page() {
      return <FeedbackArea name="page" />;
    }
    render(
      <FeedbackProvider notice="n">
        <Layout>
          <Page />
        </Layout>
      </FeedbackProvider>,
    );
    expect(controller.setArea).toHaveBeenLastCalledWith('layout');
  });

  it('a layout\'s own <FeedbackArea> placed BEFORE {children} loses to the page\'s', () => {
    const controller = setup();
    function Layout({ children }: { children: ReactNode }) {
      return (
        <>
          <FeedbackArea name="layout" />
          {children}
        </>
      );
    }
    function Page() {
      return <FeedbackArea name="page" />;
    }
    render(
      <FeedbackProvider notice="n">
        <Layout>
          <Page />
        </Layout>
      </FeedbackProvider>,
    );
    expect(controller.setArea).toHaveBeenLastCalledWith('page');
  });

  it('nested-in-one-commit: a <FeedbackArea> several component levels deep still loses to an earlier, much shallower sibling — depth does not decide the order, commit effect (sibling) order does', () => {
    const controller = setup();
    function Layout({ children }: { children: ReactNode }) {
      // Layout's own area is the FIRST sibling here (shallow: a direct
      // child of Layout) — {children}'s entire, deeper subtree is the
      // second sibling, and so fires afterwards, all within this same
      // single commit (nothing here is toggled by state; everything
      // mounts together).
      return (
        <>
          <FeedbackArea name="layout" />
          {children}
        </>
      );
    }
    function Wrapper({ children }: { children: ReactNode }) {
      return <div>{children}</div>;
    }
    function Page() {
      // Two component levels deeper than Layout's own <FeedbackArea>.
      return (
        <Wrapper>
          <FeedbackArea name="page-deep" />
        </Wrapper>
      );
    }
    render(
      <FeedbackProvider notice="n">
        <Layout>
          <Page />
        </Layout>
      </FeedbackProvider>,
    );
    // 'page-deep' wins despite being deeper, because it's still part of
    // the *later* sibling relative to Layout's own (shallower) area.
    expect(controller.setArea).toHaveBeenLastCalledWith('page-deep');
  });
});
