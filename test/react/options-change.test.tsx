// @vitest-environment jsdom
import './test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createFakeController, type FakeController } from './fake-controller.js';

const { mountFeedbackMock, mountLauncherMock } = vi.hoisted(() => ({
  mountFeedbackMock: vi.fn(),
  mountLauncherMock: vi.fn(),
}));

vi.mock('../../src/browser/index.js', () => ({
  mountFeedback: mountFeedbackMock,
  mountLauncher: mountLauncherMock,
}));

import { FeedbackProvider } from '../../src/react/index.js';

/**
 * "Changing options after mount: document the behaviour (recreate the
 * controller on a change of endpoint/notice/allowReference/areas/build,
 * keeping it simple and leak-free) and test it." (build plan, P8).
 * `launcher` is folded into the same recreation surface in this
 * implementation — see the decision recorded in src/react/index.tsx's
 * file header — so it's covered here too.
 */

function setup() {
  const created: FakeController[] = [];
  mountFeedbackMock.mockClear();
  mountFeedbackMock.mockImplementation(() => {
    const controller = createFakeController();
    created.push(controller);
    return controller;
  });
  return created;
}

describe('<FeedbackProvider> — options changes', () => {
  it('recreates the controller when endpoint changes', () => {
    const created = setup();
    const { rerender } = render(<FeedbackProvider notice="n" endpoint="/a" />);
    expect(created).toHaveLength(1);

    rerender(<FeedbackProvider notice="n" endpoint="/b" />);
    expect(created).toHaveLength(2);
    expect(created[0].destroyed).toBe(true);
    expect(created[1].destroyed).toBe(false);
  });

  it('recreates the controller when notice changes', () => {
    const created = setup();
    const { rerender } = render(<FeedbackProvider notice="first notice" />);
    rerender(<FeedbackProvider notice="second notice" />);
    expect(created).toHaveLength(2);
    expect(created[0].destroyed).toBe(true);
  });

  it('recreates the controller when allowReference changes', () => {
    const created = setup();
    const { rerender } = render(<FeedbackProvider notice="n" allowReference={false} />);
    rerender(<FeedbackProvider notice="n" allowReference={true} />);
    expect(created).toHaveLength(2);
    expect(created[0].destroyed).toBe(true);
  });

  it('recreates the controller when areas changes (by content, not just by reference)', () => {
    const created = setup();
    const { rerender } = render(<FeedbackProvider notice="n" areas={['a']} />);
    // A brand-new array with the *same* contents must not recreate —
    // otherwise a host passing `areas={['a']}` inline on every render
    // (easy to do by accident) would thrash the controller forever.
    rerender(<FeedbackProvider notice="n" areas={['a']} />);
    expect(created).toHaveLength(1);

    rerender(<FeedbackProvider notice="n" areas={['a', 'b']} />);
    expect(created).toHaveLength(2);
    expect(created[0].destroyed).toBe(true);
  });

  it('recreates the controller when build changes (by content, not just by reference)', () => {
    const created = setup();
    const { rerender } = render(<FeedbackProvider notice="n" build={{ release: 'r1', commit: 'c1' }} />);
    rerender(<FeedbackProvider notice="n" build={{ release: 'r1', commit: 'c1' }} />);
    expect(created).toHaveLength(1);

    rerender(<FeedbackProvider notice="n" build={{ release: 'r2', commit: 'c1' }} />);
    expect(created).toHaveLength(2);
  });

  it('review item 5: build object key order does not matter — {commit, release} and {release, commit} with the same values are one controller', () => {
    // A hand-rolled `JSON.stringify` of the whole `build` object would be
    // sensitive to which order a host happens to write its two fields in
    // (V8 preserves insertion order, but nothing requires it, and it's
    // exactly the kind of accidental-recreation bug explicit fields
    // avoid by construction — src/react/index.tsx reads `.release`/
    // `.commit` individually rather than serialising the object at all).
    const created = setup();
    const { rerender } = render(<FeedbackProvider notice="n" build={{ commit: 'c1', release: 'r1' }} />);
    expect(created).toHaveLength(1);

    rerender(<FeedbackProvider notice="n" build={{ release: 'r1', commit: 'c1' }} />);
    expect(created).toHaveLength(1);
    expect(created[0].destroyed).toBe(false);
  });

  it('review item 5: launcher object key order does not matter — {side, label} and {label, side} with the same values are one controller', () => {
    const created = setup();
    const { rerender } = render(<FeedbackProvider notice="n" launcher={{ side: 'left', label: 'Help' }} />);
    expect(created).toHaveLength(1);

    rerender(<FeedbackProvider notice="n" launcher={{ label: 'Help', side: 'left' }} />);
    expect(created).toHaveLength(1);
    expect(created[0].destroyed).toBe(false);
  });

  it('does NOT recreate the controller when only onEvent changes — a fresh inline callback every render is common and must not thrash the controller', () => {
    const created = setup();
    const events: string[] = [];
    const { rerender } = render(<FeedbackProvider notice="n" onEvent={() => events.push('first')} />);
    rerender(<FeedbackProvider notice="n" onEvent={() => events.push('second')} />);
    expect(created).toHaveLength(1);

    // And the *latest* callback is the one actually used.
    const passedOptions = mountFeedbackMock.mock.calls[0][0];
    passedOptions.onEvent({ type: 'opened' });
    expect(events).toEqual(['second']);
  });

  it('does NOT recreate the controller when only copy or theme changes', () => {
    const created = setup();
    const { rerender } = render(<FeedbackProvider notice="n" copy={{ heading: 'Give feedback' }} />);
    rerender(<FeedbackProvider notice="n" copy={{ heading: 'Tell us something' }} />);
    rerender(
      <FeedbackProvider notice="n" copy={{ heading: 'Tell us something' }} theme={{ '--feedback-accent': '#000' }} />,
    );
    expect(created).toHaveLength(1);
  });
});
