/**
 * Task P7: replaces the P10a placeholder (`./placeholder-dialog.ts`, now
 * removed) with the real `mountFeedback()`, imported from the package's
 * *built* `dist/browser/index.js` via the `@papergiant/feedback/browser`
 * Vite alias (see `../../vite.config.ts`) — P10 switches this to the
 * packed tarball. Every launcher button on every fixture page already
 * calls `window.__openFeedback?.(fromElement)`; this file is the only
 * thing that changes what that does.
 */
import { mountFeedback } from '@papergiant/feedback/browser';
import type { FeedbackController, FeedbackEvent } from '@papergiant/feedback/browser';

declare global {
  interface Window {
    __openFeedback?: (fromElement?: HTMLElement | null) => void;
    __feedbackController?: FeedbackController;
    __feedbackEvents?: FeedbackEvent[];
  }
}

const events: FeedbackEvent[] = [];
window.__feedbackEvents = events;

const controller = mountFeedback({
  endpoint: '/api/feedback',
  notice:
    "This is the @papergiant/feedback test fixture — reports go to a local stub, never a real tracker.",
  allowReference: true,
  areas: ['fixture-area'],
  build: { release: 'fixture-dev', commit: null },
  onEvent: (event) => {
    events.push(event);
  },
});

window.__feedbackController = controller;
window.__openFeedback = (fromElement) => {
  controller.open(fromElement ?? undefined);
};
