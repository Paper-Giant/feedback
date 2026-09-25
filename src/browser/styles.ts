/**
 * @papergiant/feedback/browser — the dialog's stylesheet (task P7; design
 * §3 "Dialog"). A single CSS string, adopted into the shadow root as a
 * constructable `CSSStyleSheet` when available, or injected via a
 * `<style>` element otherwise (design: "fallback to a `<style>` element
 * if `adoptedStyleSheets` is unavailable").
 *
 * Themed entirely through `--feedback-*` custom properties, each with an
 * inline fallback so the dialog looks reasonable with no `theme` option
 * at all; a host's `theme` values are set as inline custom properties on
 * the host element itself (see `applyTheme` below), which inherit into
 * the shadow tree across the shadow boundary like any other inherited
 * custom property.
 */
import type { FeedbackTheme } from './types.js';

export const FEEDBACK_STYLES = /* css */ `
  :host {
    all: initial;
    font-family: var(--feedback-font, inherit);
    /* No color-scheme: light dark here (review fix): every fallback
       colour below is a fixed light value, and declaring dark support
       with no matching dark fallbacks makes native form controls (radio
       buttons in particular) render with dark-mode chrome against this
       light background. A host wanting dark mode supplies dark
       --feedback-* values via the theme option; this stylesheet has no
       opinion on which scheme is active. */
  }

  * {
    box-sizing: border-box;
  }

  dialog {
    position: fixed;
    inset: 0 max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) auto;
    top: max(1rem, env(safe-area-inset-top));
    margin: 0;
    width: min(26rem, 100vw - 2rem);
    max-width: calc(100vw - 2rem);
    max-height: min(
      calc(100dvh - 2rem),
      calc(var(--feedback-vv-height, 100dvh) - 2rem)
    );
    padding: 1.25rem;
    border: 1px solid var(--feedback-border, #d8dbe0);
    border-radius: var(--feedback-radius, 0.75rem);
    background: var(--feedback-background, #ffffff);
    color: var(--feedback-foreground, #16181d);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.16);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  dialog::backdrop {
    background: rgb(20 22 26 / 0.28);
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    font-weight: 600;
  }

  .notice {
    margin: 0 0 1rem;
    font-size: 0.8rem;
    color: var(--feedback-muted, #5a5f6a);
  }

  fieldset {
    margin: 0 0 1rem;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0 0 0.4rem;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .kind-options {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .kind-options label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.875rem;
  }

  .field {
    margin: 0 0 1rem;
  }

  .field[hidden] {
    display: none;
  }

  label {
    display: block;
    margin: 0 0 0.35rem;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .hint {
    margin: 0.25rem 0 0;
    font-size: 0.75rem;
    color: var(--feedback-muted, #5a5f6a);
  }

  textarea,
  input[type='text'] {
    display: block;
    width: 100%;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--feedback-border, #d8dbe0);
    border-radius: calc(var(--feedback-radius, 0.75rem) * 0.4);
    background: var(--feedback-background, #ffffff);
    color: var(--feedback-foreground, #16181d);
    font: inherit;
    font-size: 0.875rem;
    overscroll-behavior: contain;
  }

  textarea {
    min-height: 6rem;
    resize: vertical;
  }

  textarea:focus-visible,
  input:focus-visible,
  button:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--feedback-accent, #2f6fed);
    outline-offset: 2px;
  }

  .counter {
    margin: 0.25rem 0 0;
    text-align: right;
    font-size: 0.7rem;
    color: var(--feedback-muted, #5a5f6a);
  }

  .field-error {
    margin: 0.25rem 0 0;
    font-size: 0.75rem;
    color: var(--feedback-danger, #c4293a);
  }

  .error-summary {
    margin: 0 0 1rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--feedback-danger, #c4293a);
    border-radius: calc(var(--feedback-radius, 0.75rem) * 0.4);
    background: color-mix(in srgb, var(--feedback-danger, #c4293a) 8%, transparent);
  }

  .error-summary[hidden] {
    display: none;
  }

  .error-summary p {
    margin: 0 0 0.35rem;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .error-summary ul {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.8rem;
  }

  .error-summary a {
    color: var(--feedback-danger, #c4293a);
  }

  details {
    margin: 0 0 1rem;
    font-size: 0.8rem;
  }

  summary {
    cursor: pointer;
    font-weight: 500;
  }

  .details-list {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
    color: var(--feedback-muted, #5a5f6a);
  }

  .status {
    margin: 0 0 0.75rem;
    font-size: 0.8rem;
  }

  .status[data-tone='danger'] {
    color: var(--feedback-danger, #c4293a);
  }

  .duplicate-warning {
    margin: 0 0 0.75rem;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--feedback-danger, #c4293a);
    border-radius: calc(var(--feedback-radius, 0.75rem) * 0.4);
    font-size: 0.8rem;
  }

  .duplicate-warning[hidden] {
    display: none;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
  }

  button {
    font: inherit;
    font-size: 0.875rem;
    padding: 0.45rem 0.9rem;
    border-radius: calc(var(--feedback-radius, 0.75rem) * 0.4);
    border: 1px solid transparent;
    cursor: pointer;
  }

  button[data-cancel] {
    background: transparent;
    border-color: var(--feedback-border, #d8dbe0);
    color: var(--feedback-foreground, #16181d);
  }

  button[data-send] {
    background: var(--feedback-accent, #2f6fed);
    color: #ffffff;
  }

  /* aria-disabled, not the disabled property, is what Send actually
     carries while sending (dialog.ts's setSendingUi — a real disable
     yanks focus to <body> in Chromium/Firefox); both get the same busy
     styling (review fix). */
  button[disabled],
  button[aria-disabled='true'] {
    opacity: 0.6;
    cursor: progress;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 359px) {
    dialog {
      width: calc(100vw - 1.5rem);
      inset: 0.75rem 0.75rem 0.75rem auto;
      top: 0.75rem;
      padding: 1rem;
    }
  }

  @media (forced-colors: active) {
    dialog {
      border: 1px solid CanvasText;
    }
    textarea,
    input[type='text'],
    button {
      border-color: CanvasText;
    }
    button[data-send] {
      forced-color-adjust: none;
      background: Highlight;
      color: HighlightText;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      animation: none !important;
      transition: none !important;
    }
  }
`;

// Only the shape this stylesheet actually reads (review fix): `theme`'s
// type already restricts it to the 8 known keys, but a host on plain JS
// (or an `as any` cast) could pass anything, and `CSSStyleDeclaration.
// setProperty` will happily set an arbitrary custom property — this is
// the runtime backstop.
const THEME_KEY_PATTERN = /^--feedback-[a-z-]+$/;

/** Applies a host's `theme` overrides as inline custom properties on the host element. */
export function applyTheme(el: HTMLElement, theme: FeedbackTheme | undefined): void {
  if (!theme) return;
  for (const [key, value] of Object.entries(theme)) {
    if (!THEME_KEY_PATTERN.test(key)) continue;
    if (typeof value === 'string' && value.trim() !== '') {
      el.style.setProperty(key, value);
    }
  }
}

/**
 * Adopts `FEEDBACK_STYLES` into `root`, preferring a constructable
 * `CSSStyleSheet` (design: "a constructable `CSSStyleSheet` adopted into
 * the shadow root") and falling back to an appended `<style>` element
 * when `adoptedStyleSheets`/`replaceSync` aren't available.
 */
export function adoptFeedbackStyles(root: ShadowRoot): void {
  const ctor = (globalThis as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
  if (ctor && typeof ctor.prototype.replaceSync === 'function' && 'adoptedStyleSheets' in root) {
    try {
      const sheet = new ctor();
      sheet.replaceSync(FEEDBACK_STYLES);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return;
    } catch {
      // Fall through to the <style> fallback below.
    }
  }
  const doc = root.ownerDocument ?? document;
  const style = doc.createElement('style');
  style.textContent = FEEDBACK_STYLES;
  root.appendChild(style);
}
