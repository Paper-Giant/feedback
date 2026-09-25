// No framework. See ./shared/mount-feedback.ts for what
// `window.__openFeedback` does (mountFeedback, task P7).
import './shared/mount-feedback.ts';

document.querySelectorAll<HTMLButtonElement>('[data-testid="launcher"]').forEach((button) => {
  button.addEventListener('click', () => window.__openFeedback?.(button));
});
