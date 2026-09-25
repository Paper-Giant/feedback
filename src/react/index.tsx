"use client";

/**
 * @papergiant/feedback/react — <FeedbackProvider>, <FeedbackButton>,
 * <FeedbackArea> and useFeedback() (task P8; design §3, §3.1, §4).
 *
 * The "use client" directive above must survive the build unchanged, so
 * that bundlers which honour React Server Component boundaries treat this
 * entry as client-only (test/use-client.test.ts checks the built file).
 *
 * This module only imports `react` — never `react-dom` — so it can be
 * imported in an environment with no DOM (test/import-safety.test.ts):
 * React itself does not touch `document`/`window` at import time, and
 * nothing in this file calls `mountFeedback`/`mountLauncher` outside a
 * `useEffect` callback, which never runs during a server render (React's
 * `renderToString` never invokes effects) and never runs during render
 * itself.
 *
 * Decisions the design and build plan left to this task (recorded here so
 * they don't have to be reconstructed from the diff):
 *
 * - Recreation surface: the controller is destroyed and re-mounted
 *   whenever `endpoint`, `notice`, `allowReference`, `areas` (by content),
 *   `build.release`, `build.commit` **or `launcher`** (by content) differ
 *   from the previous render — each compared as its own explicit
 *   primitive `useEffect` dependency (never a `JSON.stringify` of a whole
 *   object: key order must not be able to force a spurious recreation,
 *   and an object literal a host writes inline on every render, with the
 *   same content, must not either). The build plan only requires the
 *   first five; `launcher` is folded into the same recreation surface
 *   (rather than given its own effect) so there is exactly one effect
 *   that owns the controller's lifetime — simpler to reason about and to
 *   keep leak-free than coordinating two independent effects with their
 *   own Strict Mode double-invoke timing. `copy` and `theme` are read
 *   once per (re)creation and are not watched for later changes — they
 *   are install-time configuration in every host this package targets,
 *   not runtime state. **A recreation closes an open dialog and discards
 *   its in-progress draft and `report_id`** (`mountFeedback` has no
 *   concept of migrating state into a new instance) — so every option in
 *   this surface must be a constant, an env-derived value, or otherwise
 *   stable for the app's lifetime, never something derived from a hook
 *   that changes while a host might plausibly have the dialog open
 *   (routing state, a query result, etc.).
 * - `enabled` (default `true`) is a separate, eighth, always-explicit
 *   dependency: `false` mounts nothing at all (no `mountFeedback`, no
 *   launcher) and every consumer degrades safely instead of throwing —
 *   `useFeedback()` returns `available: false`/`enabled: false` and a
 *   no-op `open()`, `<FeedbackButton>` renders `null`, `<FeedbackArea>`
 *   does nothing. This exists for a host that always renders the
 *   provider and its buttons, everywhere, but only actually wants the
 *   feature live in some environments — a `<FeedbackButton>` with no
 *   provider around it at all would throw and could take an unrelated
 *   part of the host's UI down with it (e.g. a dialog header) purely
 *   because a key wasn't configured; `enabled={false}` is how a host
 *   avoids ever reaching that case while still wiring the provider and
 *   its buttons unconditionally. Toggling it false→true mounts a fresh
 *   controller (a new draft and `report_id`, areas re-applied from
 *   whatever's currently on the stack); true→false destroys it, same as
 *   an ordinary recreation.
 * - `onEvent` and `isHostModalOpen` are read through a ref on every call,
 *   so a host passing a fresh inline function each render never forces a
 *   recreation and never calls a stale callback — this matters in
 *   practice because `onEvent` is exactly the kind of prop that's given a
 *   new arrow function on every parent render. Whether `isHostModalOpen`
 *   was *provided at all* is still decided once, at (re)creation time —
 *   `mountFeedback` behaves differently when the option is present versus
 *   absent (the default DOM-querying fallback only runs when it's
 *   omitted), and that presence isn't in the recreation surface above, so
 *   toggling it without also changing one of the other eight has no
 *   effect until the next recreation. This is documented, not silently
 *   inconsistent. The ref itself (`optionsRef`) is written in a
 *   `useInsertionEffect`, not during render — React runs insertion
 *   effects before any layout or passive effect on the *same* commit, so
 *   this is still always fresh by the time anything reads it, without a
 *   render-phase side effect (a render can be thrown away or run twice
 *   without committing; a ref write should only ever happen for a commit
 *   that actually took).
 * - `useFeedback()` and `<FeedbackArea>` both throw a clear error when
 *   used with no `<FeedbackProvider>` ancestor at all, rather than
 *   degrading to a no-op — the same convention as e.g. `useRouter()`. A
 *   missing provider is a configuration bug the host should see
 *   immediately, in every environment, not just development. This is
 *   distinct from a *present but disabled* provider (`enabled={false}`),
 *   which every consumer degrades through safely instead — see above.
 * - `useFeedback()` is safe to call *before* the controller exists (the
 *   provider has mounted but its effect hasn't run yet, e.g. reading it
 *   during the same commit the provider itself mounts in): `available` is
 *   `false`, `open()` returns `false` and `isOpen()` returns `false`,
 *   none of them throw.
 * - `<FeedbackArea>` tracks a stack of mounted areas on the provider
 *   itself (not on each `<FeedbackArea>` instance), keyed by a mount
 *   order id rather than by name, so two areas with the same name nest
 *   correctly. Pushing always applies the new top; popping only calls
 *   `controller.setArea()` again when the popped entry *was* the top —
 *   unmounting a non-top area changes the stack but not the current area.
 *   Its effect depends only on the stable `pushArea`/`popArea` callbacks
 *   plus `name` and `enabled` — deliberately *not* on the whole context
 *   value or on `available` — so a `<FeedbackArea>` that's already
 *   mounted doesn't pop and re-push itself (a spurious `setArea(null)`
 *   in between) purely because the controller just finished mounting and
 *   `available` flipped to `true`.
 *   "Most recently mounted wins" means most recently mounted in React's
 *   own commit effect order, **not** JSX or DOM position. Within one
 *   commit, React runs passive-effect setup in a strict post-order
 *   traversal: a component's own effect fires only after every effect in
 *   its entire subtree has already fired (children before parents), and
 *   for siblings, one sibling's whole subtree finishes before the next
 *   sibling's begins (left to right, i.e. JSX order at each level) —
 *   this is also exactly why an area declared before the controller
 *   exists is already on the stack by the time the provider's own effect
 *   creates it and applies the current top: the provider is an ancestor
 *   of every `<FeedbackArea>` a host renders inside it, so its own effect
 *   always fires last. Two consequences worth pinning down because they
 *   are easy to get backwards:
 *     1. If a layout renders its own `<FeedbackArea>` as a plain sibling
 *        of `{children}`, *sibling order* — not which one is the
 *        "parent" — decides which wins. Placed **after** `{children}`,
 *        the layout's own area's effect fires after everything in
 *        `{children}`'s subtree (an earlier sibling's whole subtree
 *        completes first), so the layout's area ends up on top and
 *        "beats" whatever the page declared. Placed **before**
 *        `{children}`, it's the reverse.
 *     2. A `<FeedbackArea>` several component levels deep still fires
 *        within the very same commit as one much shallower, if both
 *        mount together — depth doesn't decide the order, commit effect
 *        order does, and that order is driven by sibling position, all
 *        the way from the root down to wherever each `<FeedbackArea>`
 *        actually sits.
 *   Because this is genuinely easy to get backwards, hosts should stick
 *   to **one `<FeedbackArea>` per page, and none in layouts** —
 *   test/react/feedback-area.test.tsx pins both consequences above with
 *   real nested-component examples, not just as documentation.
 * - `<FeedbackButton>` always renders `type="button"` regardless of any
 *   `type` passed in — nested inside a host `<form>`, a feedback trigger
 *   must never submit it — and calls a caller-supplied `onClick` (if any)
 *   first; if that handler calls `event.preventDefault()`, this button
 *   does not call `open()` at all, so a host can veto opening (e.g. to
 *   confirm something first) the same way it would veto any other
 *   default browser action. It renders `null` while the provider is
 *   disabled (`enabled={false}`).
 * - Component return types are explicitly annotated `ReactElement` /
 *   `ReactElement | null` (imported from `react`), rather than left for
 *   TypeScript to infer. An inferred return type for a component that
 *   returns JSX resolves through the global `JSX`/`React.JSX` namespace,
 *   and whichever exact name tsc resolves that to gets written verbatim
 *   into this package's emitted `.d.ts` — which then fails to compile for
 *   a consumer on an older `@types/react` that doesn't define `React.JSX`
 *   (pre-18.2.7) with `skipLibCheck` off. `ReactElement` itself has been
 *   a stable, directly-importable name across those versions, so
 *   annotating with it keeps the emitted declarations portable regardless
 *   of which `@types/react` generated them.
 */

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { mountFeedback, mountLauncher } from '../browser/index.js';
import type {
  FeedbackBuild,
  FeedbackController,
  FeedbackCopy,
  FeedbackEvent,
  FeedbackMountOptions,
  FeedbackTheme,
  IsHostModalOpen,
  LauncherHandle,
  MountLauncherOptions,
} from '../browser/index.js';

// Re-exported so a host can type against this entry alone, without also
// importing `@papergiant/feedback/browser`. `FeedbackKind` isn't part of
// `browser/index.ts`'s own public surface, so it isn't re-exported here
// either — this task builds only against that module's public API.
export type {
  FeedbackBuild,
  FeedbackController,
  FeedbackCopy,
  FeedbackEvent,
  FeedbackMountOptions,
  FeedbackTheme,
  IsHostModalOpen,
  LauncherHandle,
  MountLauncherOptions,
};

const OUTSIDE_PROVIDER_MESSAGE =
  '@papergiant/feedback/react: this must be rendered inside a <FeedbackProvider>.';
const DEFAULT_BUTTON_LABEL = 'Feedback';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AreaStackEntry {
  id: number;
  name: string;
}

interface FeedbackContextValue {
  controllerRef: { current: FeedbackController | null };
  available: boolean;
  enabled: boolean;
  pushArea: (name: string) => number;
  popArea: (id: number) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

function useFeedbackContext(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error(OUTSIDE_PROVIDER_MESSAGE);
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// <FeedbackProvider>
// ---------------------------------------------------------------------------

export interface FeedbackProviderProps extends FeedbackMountOptions {
  /**
   * Also renders a side-tab launcher (`mountLauncher()`). `true` uses its
   * defaults; an object customises `label`/`side`. Default `false`.
   */
  launcher?: boolean | MountLauncherOptions;
  /**
   * Default `true`. `false` mounts nothing — no controller, no launcher —
   * and every consumer degrades safely instead of throwing: `available`
   * and `enabled` are both `false`, `open()`/`isOpen()` are safe no-ops,
   * `<FeedbackButton>` renders `null`, `<FeedbackArea>` does nothing. The
   * provider itself still exists, so nothing nested inside it throws for
   * lack of one.
   */
  enabled?: boolean;
  children?: ReactNode;
}

interface LatestOptions {
  endpoint: FeedbackMountOptions['endpoint'];
  notice: FeedbackMountOptions['notice'];
  allowReference: FeedbackMountOptions['allowReference'];
  areas: FeedbackMountOptions['areas'];
  build: FeedbackMountOptions['build'];
  copy: FeedbackMountOptions['copy'];
  theme: FeedbackMountOptions['theme'];
  isHostModalOpen: FeedbackMountOptions['isHostModalOpen'];
  onEvent: FeedbackMountOptions['onEvent'];
  launcher: FeedbackProviderProps['launcher'];
  enabled: boolean;
}

/**
 * A single, explicit, order-independent key for `launcher` — not a
 * `JSON.stringify` of the whole option (see the file header): only its
 * two known sub-fields are ever read, in a fixed order this function
 * picks itself, so a host's own key order in an inline object literal can
 * never matter.
 */
function launcherKey(launcher: FeedbackProviderProps['launcher']): string {
  if (!launcher) return 'off';
  if (launcher === true) return 'on';
  return `on:${launcher.label ?? ''}\u0000${launcher.side ?? ''}`;
}

export function FeedbackProvider(props: FeedbackProviderProps): ReactElement {
  const {
    children,
    launcher,
    enabled = true,
    endpoint,
    notice,
    allowReference,
    areas,
    build,
    copy,
    theme,
    isHostModalOpen,
    onEvent,
  } = props;

  const latest: LatestOptions = {
    endpoint,
    notice,
    allowReference,
    areas,
    build,
    copy,
    theme,
    isHostModalOpen,
    onEvent,
    launcher,
    enabled,
  };
  const optionsRef = useRef<LatestOptions>(latest);
  // Written in an insertion effect, not during render (file header):
  // React guarantees this runs, for every committed render, before any
  // layout or passive effect in the same commit — including the mount
  // effect below, on the very first render too — so callers of
  // `optionsRef.current` (that effect's closures) always see a value that
  // belongs to a render that actually committed.
  useInsertionEffect(() => {
    optionsRef.current = latest;
  });

  const controllerRef = useRef<FeedbackController | null>(null);
  const [available, setAvailable] = useState(false);

  const areaStackRef = useRef<AreaStackEntry[]>([]);
  const areaIdRef = useRef(0);

  const applyTopArea = useCallback((): void => {
    const controller = controllerRef.current;
    if (!controller) return;
    const stack = areaStackRef.current;
    const top = stack.length > 0 ? stack[stack.length - 1].name : null;
    controller.setArea(top);
  }, []);

  const pushArea = useCallback(
    (name: string): number => {
      const id = ++areaIdRef.current;
      areaStackRef.current = [...areaStackRef.current, { id, name }];
      applyTopArea();
      return id;
    },
    [applyTopArea],
  );

  const popArea = useCallback(
    (id: number): void => {
      const stack = areaStackRef.current;
      const wasTop = stack.length > 0 && stack[stack.length - 1].id === id;
      areaStackRef.current = stack.filter((entry) => entry.id !== id);
      if (wasTop) applyTopArea();
    },
    [applyTopArea],
  );

  // Explicit, individually-compared fields — not a `JSON.stringify` of a
  // whole object — so neither a host's own key order nor a fresh object
  // literal with the same content can force a recreation (file header).
  const areasKey = JSON.stringify(areas ?? []);
  const buildRelease = build?.release ?? null;
  const buildCommit = build?.commit ?? null;
  const launcherFingerprint = launcherKey(launcher);

  useEffect(() => {
    const initial = optionsRef.current;
    if (!initial.enabled) {
      // Nothing to mount, and nothing to clean up either — `available`
      // is already `false` (either it started that way, or the cleanup
      // from the previous, enabled, run already set it).
      return undefined;
    }

    // Decided once per controller lifetime: whether `isHostModalOpen` was
    // provided at all changes `mountFeedback`'s own fallback behaviour
    // (see the file header), so it can't be swapped for "present vs.
    // absent" on every render the way a callback's *content* can.
    const hasIsHostModalOpen = initial.isHostModalOpen !== undefined;

    const controller = mountFeedback({
      endpoint: initial.endpoint,
      notice: initial.notice,
      allowReference: initial.allowReference,
      areas: initial.areas,
      build: initial.build,
      copy: initial.copy,
      theme: initial.theme,
      isHostModalOpen: hasIsHostModalOpen ? () => optionsRef.current.isHostModalOpen!() : undefined,
      onEvent: (event: FeedbackEvent) => optionsRef.current.onEvent?.(event),
    });

    controllerRef.current = controller;
    setAvailable(true);
    applyTopArea();

    let launcherHandle: LauncherHandle | null = null;
    const launcherOption = initial.launcher;
    if (launcherOption) {
      launcherHandle = mountLauncher(controller, launcherOption === true ? {} : launcherOption);
    }

    return () => {
      launcherHandle?.destroy();
      controller.destroy();
      controllerRef.current = null;
      setAvailable(false);
    };
    // The dependency list below *is* the deliberate, documented
    // recreation surface (file header) — everything the effect reads
    // beyond it comes through `optionsRef`, so it's read fresh without
    // forcing a rerun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, endpoint ?? '', notice, allowReference ?? false, areasKey, buildRelease, buildCommit, launcherFingerprint, applyTopArea]);

  const contextValue = useMemo<FeedbackContextValue>(
    () => ({ controllerRef, available, enabled, pushArea, popArea }),
    [available, enabled, pushArea, popArea],
  );

  return <FeedbackContext.Provider value={contextValue}>{children}</FeedbackContext.Provider>;
}

// ---------------------------------------------------------------------------
// useFeedback()
// ---------------------------------------------------------------------------

export interface UseFeedbackResult {
  /** Safe before the controller exists, and while disabled (returns `false`). Never throws on refusal. */
  open: (from?: Element | null) => boolean;
  isOpen: () => boolean;
  /** Whether the provider's controller has mounted yet (always `false` while disabled). */
  available: boolean;
  /** The provider's own `enabled` prop (default `true`). */
  enabled: boolean;
}

export function useFeedback(): UseFeedbackResult {
  const ctx = useFeedbackContext();
  return useMemo<UseFeedbackResult>(
    () => ({
      open: (from?: Element | null) => ctx.controllerRef.current?.open(from ?? undefined) ?? false,
      isOpen: () => ctx.controllerRef.current?.isOpen() ?? false,
      available: ctx.available,
      enabled: ctx.enabled,
    }),
    [ctx],
  );
}

// ---------------------------------------------------------------------------
// <FeedbackButton>
// ---------------------------------------------------------------------------

export type FeedbackButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export const FeedbackButton = forwardRef<HTMLButtonElement, FeedbackButtonProps>(function FeedbackButton(
  { children, onClick, ...rest },
  ref,
): ReactElement | null {
  const { open, enabled } = useFeedback();

  if (!enabled) return null;

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    onClick?.(event);
    // A host can veto opening — e.g. to confirm something first — the
    // same way it would veto any other default browser action.
    if (event.defaultPrevented) return;
    open(event.currentTarget);
  }

  return (
    <button {...rest} ref={ref} type="button" onClick={handleClick}>
      {children ?? DEFAULT_BUTTON_LABEL}
    </button>
  );
});
FeedbackButton.displayName = 'FeedbackButton';

// ---------------------------------------------------------------------------
// <FeedbackArea>
// ---------------------------------------------------------------------------

export interface FeedbackAreaProps {
  name: string;
}

export function FeedbackArea({ name }: FeedbackAreaProps): ReactElement | null {
  const { pushArea, popArea, enabled } = useFeedbackContext();
  useEffect(() => {
    if (!enabled) return undefined;
    const id = pushArea(name);
    return () => popArea(id);
    // Deliberately not depending on the whole context value or on
    // `available` (file header) — `pushArea`/`popArea` are already
    // referentially stable for the provider's lifetime, so this only
    // re-runs when `name` or `enabled` actually changes, not every time
    // the controller happens to finish mounting.
  }, [pushArea, popArea, name, enabled]);
  return null;
}
