import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { FeedbackArea, FeedbackButton, FeedbackProvider } from '@papergiant/feedback/react';

/**
 * Task P10: proves `@papergiant/feedback` works under an independently
 * installed React 18 — a page with a top-level `<FeedbackButton>`, a
 * `<FeedbackArea name="r18">`, and a second `<FeedbackButton>` nested
 * inside an always-open Radix `Dialog` (mirrors a host's always-open
 * wizard dialog, same shape as `examples/fixture/pages/radix.tsx`, trimmed to what this
 * consumer's own tests need).
 */

declare global {
  interface Window {
    /** `React.version` for `tests/app.spec.ts`'s "resolves React 18" check. */
    __REACT_VERSION__?: string;
    __hostSpies?: { escapeCalls: number; openChangeCalls: number };
  }
}

window.__REACT_VERSION__ = React.version;
window.__hostSpies = { escapeCalls: 0, openChangeCalls: 0 };

const NOTICE =
  'This is the @papergiant/feedback React 18 example — reports go to a tiny local handler, never a real tracker.';
const AREA = 'r18';

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgb(0 0 0 / 0.4)',
};

const contentStyle: React.CSSProperties = {
  position: 'fixed',
  top: '10vh',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(480px, 90vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  overscrollBehavior: 'contain',
  background: 'white',
  border: '1px solid #333',
  borderRadius: 8,
  padding: 16,
  boxSizing: 'border-box',
};

/** Mirrors a host's always-open wizard dialog (see
 * `examples/fixture/pages/radix.tsx`'s `RadixHost`, trimmed to the one
 * thing this consumer's tests need: proving a `<FeedbackButton>` nested
 * inside it opens feedback nested, and that Escape closes only feedback. */
function Wizard() {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        // `open` above is the literal `true`, so this dialog never
        // actually closes — but Radix still calls this on Escape or an
        // outside click; recorded so the test can assert it never fires
        // while feedback (nested inside) handles its own Escape first.
        if (!open) window.__hostSpies!.openChangeCalls += 1;
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay style={overlayStyle} />
        <DialogPrimitive.Content
          style={contentStyle}
          onEscapeKeyDown={() => {
            window.__hostSpies!.escapeCalls += 1;
          }}
        >
          <DialogPrimitive.Title>Example wizard (always open)</DialogPrimitive.Title>
          <DialogPrimitive.Description>
            Mirrors a host's always-open wizard dialog: closing navigates away instead of actually closing, and a
            feedback launcher lives inside it.
          </DialogPrimitive.Description>
          <p>
            <FeedbackButton data-testid="launcher-in-dialog">Give feedback (in dialog)</FeedbackButton>
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function App() {
  return (
    <FeedbackProvider endpoint="/api/feedback" notice={NOTICE} allowReference areas={[AREA]}>
      <main>
        <h1>@papergiant/feedback — React 18 example</h1>
        <FeedbackArea name={AREA} />
        {/* An ordinary, top-level launcher — the ordinary case, not
            exercised by a nested-modal test. Because `Wizard` below is
            always open (mirrors a host's always-open wizard dialog, per the task), its Radix
            overlay covers the whole page and this button sits behind it,
            same as the fixture's `launcher-outside`
            (examples/fixture/pages/radix.tsx) — design §3: a launcher
            outside an open host modal refuses to open. That refusal path
            is already proven in the fixture's own
            tests/host-modals.spec.ts; this consumer's tests
            (tests/app.spec.ts) exercise the reachable in-dialog button
            instead. */}
        <p>
          <FeedbackButton data-testid="launcher">Give feedback</FeedbackButton>
        </p>
        <Wizard />
      </main>
    </FeedbackProvider>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
