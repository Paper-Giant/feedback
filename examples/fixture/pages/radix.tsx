import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog as DialogPrimitive } from 'radix-ui';
// Task P8: the React wrapper, imported from the package's *built*
// dist/react/index.js via the `@papergiant/feedback/react` Vite alias
// (see ../vite.config.ts) — P10 switches this to the packed tarball.
import { FeedbackArea, FeedbackButton, FeedbackProvider, useFeedback } from '@papergiant/feedback/react';
import type { FeedbackController, FeedbackEvent } from '@papergiant/feedback/react';

/**
 * Mirrors a host's always-open wizard dialog: a Radix
 * dialog that is always open (`open` is the literal `true`, not state) and
 * whose `onOpenChange(false)` — fired by Escape, an outside click, or a
 * close control — navigates away instead of closing. Design §3 "Host
 * modals" is written against exactly this shape: a launcher can live
 * *inside* this content (`launcher-inside`), and feedback must nest inside
 * it rather than refuse, guarding Escape and scroll so this dialog's own
 * handlers never see them.
 *
 * Task P8: every launcher on this page is a `<FeedbackButton>`, and the
 * whole tree is wrapped once in a single `<FeedbackProvider>` (`App`,
 * below) — there is exactly one controller and one dialog on this page,
 * shared by all three launcher positions, matching how a real host (one
 * provider per app shell) is expected to use this package. The provider
 * (and every `<FeedbackButton>`/`<FeedbackArea>` inside it) is mounted
 * unconditionally, always — review item 1's `enabled` prop, not a
 * conditionally-rendered provider, is what the `unmount-feedback` test
 * hook (in `App`, below) uses to tear the controller down and bring it
 * back, exactly the way a host is expected to use it in production
 * (`enabled={false}`, the provider and its buttons still always rendered).
 */

declare global {
  interface Window {
    __hostSpies?: { escapeCalls: number; openChangeCalls: number; navigateCalls: string[] };
    __feedbackEvents?: FeedbackEvent[];
  }
}

window.__hostSpies = { escapeCalls: 0, openChangeCalls: 0, navigateCalls: [] };
window.__feedbackEvents = [];

const NOTICE =
  "This is the @papergiant/feedback test fixture — reports go to a local stub, never a real tracker.";
// Matches the `radix` key in server.ts's `createFeedbackHandler({ areas: {...} })`
// map, so a report sent from here round-trips through the real server-side
// area check too, not just the browser-side one — see radix.spec.ts's
// "<FeedbackArea> is sent as the report area" test.
const AREA = 'radix';

function fakeNavigate(href: string): void {
  window.__hostSpies!.navigateCalls.push(href);
}

/** Radix's own document-capture Escape handler reached this content. */
function recordEscapeAttempt(): void {
  window.__hostSpies!.escapeCalls += 1;
}

/** Radix asked to close (Escape, an outside click, or a close control). */
function recordOpenChangeAttempt(): void {
  window.__hostSpies!.openChangeCalls += 1;
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgb(0 0 0 / 0.4)',
};

const contentStyle: CSSProperties = {
  position: 'fixed',
  top: '5vh',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(520px, 90vw)',
  // The content element itself is the scroller, matching a host's own
  // wizard-dialog stylesheet's `.modal` (`height:
  // 100dvh; overflow-y: auto; overscroll-behavior: contain`) — grown
  // content must overflow *this* element, not some inner box, or "the
  // outer dialog at its own scroll boundary" can never be produced.
  maxHeight: '90vh',
  overflow: 'auto',
  overscrollBehavior: 'contain',
  background: 'white',
  border: '1px solid #333',
  borderRadius: 8,
  padding: 16,
  boxSizing: 'border-box',
};

const nestedContentStyle: CSSProperties = {
  ...contentStyle,
  top: '15vh',
  border: '1px solid #900',
};

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function NestedDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button data-testid="open-nested" type="button" onClick={() => setOpen(true)}>
        Open nested dialog
      </button>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay style={overlayStyle} />
          <DialogPrimitive.Content style={nestedContentStyle}>
            <DialogPrimitive.Title>Nested dialog</DialogPrimitive.Title>
            <DialogPrimitive.Description>
              A second, nested Radix dialog — for the depth-refusal case. A launcher opened from in
              here is beyond the one level of nesting feedback allows, and must refuse.
            </DialogPrimitive.Description>
            <p>
              {/* Renders `null` on its own (via the provider's `enabled`)
                  if feedback is ever disabled — no prop-drilling needed. */}
              <FeedbackButton data-testid="launcher-nested-2">
                Give feedback (nested — should refuse)
              </FeedbackButton>
            </p>
            <DialogPrimitive.Close data-testid="close-nested" type="button">
              Close nested dialog
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

/**
 * `examples/fixture/tests/review-fixes.spec.ts`'s "Item 1 (zombie
 * controller recovery)" test is the one thing left in this fixture that
 * still reaches the controller imperatively, via
 * `window.__feedbackController.isOpen()`/`.open(button)` — everything
 * else on this page goes through `<FeedbackButton>`. Rather than rewrite
 * that real-browser proof of `mountFeedback()`'s own self-healing
 * behaviour (task P7) around clicks, this republishes the same two
 * methods `useFeedback()` already exposes onto `window`, under the same
 * global the vanilla page's imperative `mountFeedback()` call
 * (`shared/mount-feedback.ts`) already populates for real — `close`,
 * `setArea` and `destroy` below are unused no-op stubs, kept only so
 * this satisfies that global's `FeedbackController` type; nothing in
 * this fixture calls them here.
 */
function FeedbackWindowBridge() {
  const { open, isOpen } = useFeedback();
  useEffect(() => {
    const bridge: FeedbackController = {
      open,
      isOpen,
      close: () => {},
      setArea: () => {},
      destroy: () => {},
    };
    window.__feedbackController = bridge;
    return () => {
      if (window.__feedbackController === bridge) {
        window.__feedbackController = undefined;
      }
    };
  }, [open, isOpen]);
  return null;
}

/**
 * The whole host page, rendered as `<FeedbackProvider>`'s child in `App`
 * below. `<FeedbackButton>`/`<FeedbackArea>` need nothing special here —
 * they degrade to rendering/doing nothing on their own whenever the
 * provider's `enabled` prop is `false`, so this component doesn't need to
 * know or care whether feedback is currently enabled.
 */
function RadixHost() {
  const [grow, setGrow] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  return (
    <>
      <FeedbackWindowBridge />
      <h1>Feedback fixture — radix</h1>
      <p data-testid="sentinel-dom">SENTINEL_DOM</p>

      {/* Present in the DOM behind the overlay — for the refusal case: a
          launcher outside the open host modal must refuse to open. */}
      <FeedbackButton data-testid="launcher-outside">Give feedback (outside — should refuse)</FeedbackButton>

      <DialogPrimitive.Root
        open
        onOpenChange={(open) => {
          // `open` is the literal `true` above, so this dialog never
          // actually closes — but Radix still calls this on Escape, an
          // outside click, or a Close control, and the host in this
          // fixture treats any of those as "leave the wizard".
          if (!open) {
            recordOpenChangeAttempt();
            fakeNavigate('/left-the-wizard');
          }
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay style={overlayStyle} />
          <DialogPrimitive.Content
            style={contentStyle}
            onEscapeKeyDown={() => {
              // Once feedback (P7/P8) nests here and stops Escape's
              // propagation at the window in the capture phase first,
              // this should never fire while feedback is open.
              recordEscapeAttempt();
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              // Matches a host's wizard dialog: name the experience without
              // opening a keyboard or selecting anything inside the form.
              titleRef.current?.focus({ preventScroll: true });
            }}
          >
            <DialogPrimitive.Title ref={titleRef} tabIndex={-1} style={srOnly}>
              Host wizard (always open)
            </DialogPrimitive.Title>
            <DialogPrimitive.Description style={srOnly}>
              This dialog never closes on its own; closing navigates away instead.
            </DialogPrimitive.Description>

            {/* task P8: the page's area, set for as long as this content
                is mounted (design §4: "set by dropping <FeedbackArea
                name=... /> into a page"). */}
            <FeedbackArea name={AREA} />

            <form data-testid="host-form" onSubmit={(event) => event.preventDefault()}>
              <label>
                Host draft
                <textarea data-testid="host-draft" defaultValue="SENTINEL_FORM" />
              </label>
            </form>

            <p>
              <FeedbackButton data-testid="launcher-inside">Give feedback (inside — should nest)</FeedbackButton>
            </p>

            <p>
              <button data-testid="grow-host" type="button" onClick={() => setGrow((current) => !current)}>
                Toggle host content height
              </button>
            </p>

            {/* Enough content to test the outer dialog both non-overflowing
                (short) and at its own scroll boundary (grown). No height
                cap here — the content element (contentStyle above) is the
                one that must do the scrolling, not this div. */}
            <div data-testid="host-scroll-content">
              {grow ? (
                Array.from({ length: 60 }, (_, index) => (
                  <p key={index}>Filler paragraph {index + 1} — grows the host dialog past its own bound.</p>
                ))
              ) : (
                <p>Short content — the host dialog does not need to scroll like this.</p>
              )}
            </div>

            <NestedDialog />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

function App() {
  // Test-only hook (host-modals.spec.ts "the guard is gone once feedback
  // is disabled"): flips `<FeedbackProvider>`'s `enabled` prop to `false`,
  // which destroys the controller (review item 1) — no unmounting or
  // restructuring of the tree at all, so Radix's own Escape handler on
  // `RadixHost` below is never affected by this, one way or the other.
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);

  return (
    <>
      <FeedbackProvider
        enabled={feedbackEnabled}
        endpoint="/api/feedback"
        notice={NOTICE}
        allowReference
        areas={[AREA]}
        build={{ release: 'fixture-dev', commit: null }}
        onEvent={(event) => {
          window.__feedbackEvents!.push(event);
        }}
      >
        <RadixHost />
      </FeedbackProvider>
      <button
        data-testid="unmount-feedback"
        type="button"
        style={srOnly}
        onClick={() => setFeedbackEnabled(false)}
      >
        Disable feedback (test hook)
      </button>
    </>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
createRoot(container).render(<App />);
