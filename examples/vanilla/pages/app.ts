import { mountFeedback, mountLauncher } from '@papergiant/feedback/browser';
import type { FeedbackController } from '@papergiant/feedback/browser';

/**
 * Task P10: the framework-free surface, end to end, with no React
 * installed anywhere in this project (see package.json — no `react` or
 * `react-dom` dependency at all, and `no-react-check.ts` asserts as much).
 */

declare global {
  interface Window {
    __feedbackController?: FeedbackController;
  }
}

const controller: FeedbackController = mountFeedback({
  endpoint: '/api/feedback',
  notice:
    'This is the @papergiant/feedback vanilla example — reports go to a tiny local handler, never a real tracker.',
  allowReference: true,
  areas: ['vanilla'],
  build: { release: 'vanilla-example-dev', commit: null },
});

window.__feedbackController = controller;

// The in-page button (data-testid="launcher") — passes itself as `from`,
// same as `examples/fixture/pages/vanilla.ts`.
document.querySelectorAll<HTMLButtonElement>('[data-testid="launcher"]').forEach((button) => {
  button.addEventListener('click', () => controller.open(button));
});

// The optional side-tab launcher (task P10 bullet 4: "mountFeedback() +
// mountLauncher()") — renders its own button (`[data-feedback-launcher]`),
// fixed to the right edge, and wires itself up to the same controller.
mountLauncher(controller);
