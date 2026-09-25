import { createRoot } from 'react-dom/client';
// Task P8: the React wrapper, imported from the package's *built*
// dist/react/index.js via the `@papergiant/feedback/react` Vite alias
// (see ../vite.config.ts) — P10 switches this to the packed tarball,
// mirroring how ./shared/mount-feedback.ts (vanilla.ts's own import) does
// the same for `@papergiant/feedback/browser`.
import { FeedbackButton, FeedbackProvider } from '@papergiant/feedback/react';

const NOTICE =
  "This is the @papergiant/feedback test fixture — reports go to a local stub, never a real tracker.";

function App() {
  return (
    <FeedbackProvider
      endpoint="/api/feedback"
      notice={NOTICE}
      allowReference
      build={{ release: 'fixture-dev', commit: null }}
    >
      <main>
        <h1>Feedback fixture — react19</h1>
        <p data-testid="sentinel-dom">SENTINEL_DOM</p>

        <form data-testid="host-form" onSubmit={(event) => event.preventDefault()}>
          <label>
            Host note
            <input data-testid="host-form-field" defaultValue="SENTINEL_FORM" />
          </label>
        </form>

        <FeedbackButton data-testid="launcher">Give feedback</FeedbackButton>
      </main>
    </FeedbackProvider>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
createRoot(container).render(<App />);
