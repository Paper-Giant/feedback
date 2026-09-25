/**
 * @papergiant/feedback/browser — host-modal layer detection and the
 * nest/refuse decision (task P7; design §3 "Host modals").
 *
 * Split in two on purpose:
 *  - `decideModalPlacement` is pure (a list of already-known layer
 *    elements plus the launcher element in, a placement out) and is
 *    unit-tested directly — it only calls `Node.contains()`, which jsdom
 *    implements faithfully with no layout engine required.
 *  - `queryOpenHostModalLayers` does the real DOM query and a visibility
 *    check that genuinely needs layout (`getClientRects`,
 *    `checkVisibility`), which jsdom cannot provide — it is exercised by
 *    the real-browser (P9) suite instead.
 */

/**
 * The default open-host-modal-layer selector (design §3): `dialog:modal`
 * (a native dialog actually shown with `showModal()` — `:modal` excludes
 * one merely `open` via `show()` or the `open` attribute, which is not a
 * layer), `[aria-modal="true"]`, `[role="dialog"][data-state="open"]`
 * (Radix `Dialog`'s own state attribute, present regardless of whether
 * the content author also set `aria-modal`), or
 * `[role="alertdialog"][data-state="open"]` (Radix `AlertDialog`, e.g.
 * a host's confirm dialogs — it sets `role="alertdialog"` but, unlike
 * `Dialog`, no `aria-modal`, so it would otherwise be invisible to this
 * selector).
 *
 * Caveat, review-noted rather than fixed: an open *non-modal* Radix
 * `Popover` also renders `role="dialog"` with `data-state="open"` (Radix
 * reuses the same primitive internally) and so would count as a layer
 * here even though it never traps focus or blocks scrolling the way a
 * modal does. 0.1 has no known host using a Popover as a launcher's
 * container, so this is left as a known limitation rather than papered
 * over with a heuristic that would need real hosts to validate.
 */
export const HOST_MODAL_LAYER_SELECTOR =
  'dialog:modal, [aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

/**
 * Used only if `HOST_MODAL_LAYER_SELECTOR` itself throws (review fix,
 * item 7) — an engine with no `:modal` support rejects the *whole*
 * selector list as a `SyntaxError`, not just that one clause, since
 * `:modal` here isn't wrapped in a forgiving selector like `:is()`.
 * `dialog[open]` is a coarser stand-in (it also matches a non-modal
 * `show()` dialog, which `:modal` deliberately excludes), acceptable
 * only as a last resort: every engine this package targets (current
 * Chromium, Firefox, Safari) supports `:modal`, so this path is
 * defensive for an older or unusual engine, not something CI exercises.
 */
export const HOST_MODAL_LAYER_SELECTOR_FALLBACK =
  'dialog[open], [aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export type ModalPlacement =
  | { kind: 'body' }
  | { kind: 'nested'; container: Element }
  | { kind: 'refused'; reason: 'outside_host_modal' | 'too_many_host_modals' };

/**
 * Decides where `mountFeedback`'s host element goes, from an already
 * gathered list of open host-modal layer elements and the element the
 * dialog was opened from (design §3 "Host modals"):
 *
 *  - no layers → mount to `<body>`;
 *  - exactly one layer, and it contains `from` → nest inside it;
 *  - exactly one layer, and it does not contain `from` (or `from` is
 *    absent, so containment can't be shown) → refuse;
 *  - more than one layer → refuse, regardless of containment — "one
 *    level of nesting only: a launcher inside a modal that is itself
 *    inside another open modal is refused like a launcher outside one."
 *    Layers are counted, not DOM ancestry, because a host (Radix
 *    included) may portal a nested dialog to `<body>`, making it a
 *    DOM sibling of the outer one rather than a descendant.
 */
export function decideModalPlacement(
  layers: readonly Element[],
  from: Element | null | undefined,
): ModalPlacement {
  if (layers.length === 0) {
    return { kind: 'body' };
  }
  if (layers.length > 1) {
    return { kind: 'refused', reason: 'too_many_host_modals' };
  }
  const [layer] = layers;
  if (layer && from && layer.contains(from)) {
    return { kind: 'nested', container: layer };
  }
  return { kind: 'refused', reason: 'outside_host_modal' };
}

function isVisibleLayer(el: Element): boolean {
  const withCheck = el as Element & { checkVisibility?: (opts?: Record<string, boolean>) => boolean };
  if (typeof withCheck.checkVisibility === 'function') {
    try {
      return withCheck.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    } catch {
      // Fall through to the layout-based check below.
    }
  }
  if (el.getClientRects().length > 0) return true;
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * Queries the live document for open host-modal layers: connected,
 * visible, and outside every element in `exclude` (a host passes its own
 * previously-mounted host element(s) here so an already-open feedback
 * dialog never counts as a host modal on a later `open()` call).
 */
export function queryOpenHostModalLayers(exclude: readonly Element[] = []): Element[] {
  if (typeof document === 'undefined') return [];
  let matches: Element[];
  try {
    matches = Array.from(document.querySelectorAll(HOST_MODAL_LAYER_SELECTOR));
  } catch {
    matches = Array.from(document.querySelectorAll(HOST_MODAL_LAYER_SELECTOR_FALLBACK));
  }
  return matches.filter((el) => {
    if (!el.isConnected) return false;
    if (exclude.some((host) => host === el || host.contains(el))) return false;
    return isVisibleLayer(el);
  });
}
