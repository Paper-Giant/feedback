// @vitest-environment jsdom
import './test-setup.js';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { createFakeController } from './fake-controller.js';

const { mountFeedbackMock, mountLauncherMock } = vi.hoisted(() => ({
  mountFeedbackMock: vi.fn(),
  mountLauncherMock: vi.fn(),
}));

vi.mock('../../src/browser/index.js', () => ({
  mountFeedback: mountFeedbackMock,
  mountLauncher: mountLauncherMock,
}));

import { FeedbackProvider, FeedbackButton } from '../../src/react/index.js';

function setup() {
  const controller = createFakeController();
  mountFeedbackMock.mockClear();
  mountFeedbackMock.mockReturnValue(controller);
  return controller;
}

describe('<FeedbackButton>', () => {
  it('defaults its label to "Feedback"', () => {
    setup();
    render(
      <FeedbackProvider notice="n">
        <FeedbackButton />
      </FeedbackProvider>,
    );
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeTruthy();
  });

  it('renders its own children as the label instead, when given', () => {
    setup();
    render(
      <FeedbackProvider notice="n">
        <FeedbackButton>Give feedback</FeedbackButton>
      </FeedbackProvider>,
    );
    expect(screen.getByRole('button', { name: 'Give feedback' })).toBeTruthy();
  });

  it('always renders type="button", even if a caller passes a different `type`', () => {
    // `type` is still a legitimate prop at the type level (it's part of
    // ButtonHTMLAttributes, forwarded like any other DOM attribute) — the
    // component overrides its *value* at render time rather than
    // narrowing it out of the props type, because nothing about a
    // forwarded `type="submit"` is a caller mistake worth a compile
    // error; it's just never allowed to reach the DOM (file header).
    setup();
    render(
      <FeedbackProvider notice="n">
        <FeedbackButton type="submit" />
      </FeedbackProvider>,
    );
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('forwards arbitrary button props', () => {
    setup();
    render(
      <FeedbackProvider notice="n">
        <FeedbackButton className="side-tab" data-testid="launcher-inside" aria-label="Open feedback" />
      </FeedbackProvider>,
    );
    const button = screen.getByTestId('launcher-inside');
    expect(button.className).toBe('side-tab');
    expect(button.getAttribute('aria-label')).toBe('Open feedback');
  });

  it('forwards a ref to the underlying <button> element', () => {
    setup();
    const ref = createRef<HTMLButtonElement>();
    render(
      <FeedbackProvider notice="n">
        <FeedbackButton ref={ref} />
      </FeedbackProvider>,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current).toBe(screen.getByRole('button'));
  });

  it('clicking it calls open() with its own DOM element as `from`', () => {
    const controller = setup();
    render(
      <FeedbackProvider notice="n">
        <FeedbackButton data-testid="launcher" />
      </FeedbackProvider>,
    );
    const button = screen.getByTestId('launcher');
    fireEvent.click(button);
    expect(controller.open).toHaveBeenCalledTimes(1);
    expect(controller.open).toHaveBeenCalledWith(button);
  });

  it('still calls a caller-supplied onClick handler', () => {
    setup();
    const onClick = vi.fn();
    render(
      <FeedbackProvider notice="n">
        <FeedbackButton onClick={onClick} data-testid="launcher" />
      </FeedbackProvider>,
    );
    fireEvent.click(screen.getByTestId('launcher'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('review item 3: a caller-supplied onClick that calls event.preventDefault() vetoes opening', () => {
    const controller = setup();
    const onClick = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <FeedbackProvider notice="n">
        <FeedbackButton onClick={onClick} data-testid="launcher" />
      </FeedbackProvider>,
    );
    fireEvent.click(screen.getByTestId('launcher'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(controller.open).not.toHaveBeenCalled();
  });

  it('an onClick that does NOT call preventDefault() still opens as normal', () => {
    const controller = setup();
    const onClick = vi.fn();
    render(
      <FeedbackProvider notice="n">
        <FeedbackButton onClick={onClick} data-testid="launcher" />
      </FeedbackProvider>,
    );
    fireEvent.click(screen.getByTestId('launcher'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(controller.open).toHaveBeenCalledTimes(1);
  });

  it('nested inside a host element, works with no extra wiring — the containing element receives the click bubble, and open() still receives the button, not the container', () => {
    const controller = setup();
    render(
      <FeedbackProvider notice="n">
        <div data-testid="host-dialog-content">
          <FeedbackButton data-testid="launcher-inside" />
        </div>
      </FeedbackProvider>,
    );
    const button = screen.getByTestId('launcher-inside');
    fireEvent.click(button);
    expect(controller.open).toHaveBeenCalledWith(button);
  });
});
