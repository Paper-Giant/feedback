/**
 * @papergiant/feedback/browser — `mountLauncher()` (task P7; build plan
 * P7: "an optional `mountLauncher()` renders a side tab"). A fixed side
 * tab button, vertically centred and safe-area aware, that calls
 * `controller.open(button)` — so a launcher mounted this way always
 * passes itself as `from`, letting the host-modal containment check in
 * `../modal-layers.js` work with no extra host wiring.
 */
import type { FeedbackController, LauncherHandle, MountLauncherOptions } from './types.js';

const DEFAULT_LABEL = 'Feedback';

export function mountLauncher(controller: FeedbackController, options: MountLauncherOptions = {}): LauncherHandle {
  const side = options.side ?? 'right';
  const label = options.label ?? DEFAULT_LABEL;
  const otherSide = side === 'right' ? 'left' : 'right';

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('data-feedback-launcher', '');
  button.setAttribute('aria-label', label);

  const style = button.style;
  style.setProperty('position', 'fixed');
  style.setProperty('top', '50%');
  style.setProperty(side, `env(safe-area-inset-${side}, 0px)`);
  style.setProperty(
    'transform',
    side === 'right' ? 'translateY(-50%) rotate(-90deg) translateX(50%)' : 'translateY(-50%) rotate(90deg) translateX(-50%)',
  );
  style.setProperty('transform-origin', side === 'right' ? 'right center' : 'left center');
  style.setProperty('z-index', '2147483000');
  style.setProperty('padding', '0.5rem 1rem');
  style.setProperty('border', '1px solid #d8dbe0');
  style.setProperty('border-bottom', 'none');
  style.setProperty('border-radius', '0.5rem 0.5rem 0 0');
  style.setProperty('background', '#ffffff');
  style.setProperty('color', '#16181d');
  style.setProperty('font', 'inherit');
  style.setProperty('font-size', '0.8125rem');
  style.setProperty('cursor', 'pointer');
  style.setProperty('box-shadow', '0 2px 8px rgb(0 0 0 / 0.12)');
  // Explicit, so a page whose default button style sets the opposite edge
  // can't accidentally pull the tab off-screen.
  style.setProperty(otherSide, 'auto');

  function onClick(): void {
    controller.open(button);
  }
  button.addEventListener('click', onClick);

  document.body.appendChild(button);

  return {
    destroy(): void {
      button.removeEventListener('click', onClick);
      button.remove();
    },
  };
}
