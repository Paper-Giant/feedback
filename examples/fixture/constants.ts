/**
 * Values shared between the host server (`server.ts`) and the Playwright
 * specs that talk to it and to the stub directly (`tests/api.spec.ts`).
 * Kept in one place so the "intake repository" name can't drift between
 * the two.
 */

export const HOST_PORT = Number(process.env.PORT ?? 4321);
export const STUB_PORT = Number(process.env.STUB_PORT ?? 4322);
export const STUB_URL = process.env.STUB_URL ?? `http://localhost:${STUB_PORT}`;

/** The fake "owner/repo" the placeholder route files issues into on the stub. */
export const INTAKE_OWNER = process.env.FIXTURE_OWNER ?? 'papergiant-intake';
export const INTAKE_REPO = process.env.FIXTURE_REPO ?? 'fixture-intake';

/**
 * The deadline `githubSink()` (task P5) gets in `server.ts`, task P6.
 * Short — the stub's `hang` behaviour never responds at all, and tests
 * that exercise it (P9's "unconfirmed within the short timeout" case)
 * should not have to wait `githubSink()`'s own 10-second default.
 */
export const SINK_TIMEOUT_MS = Number(process.env.FEEDBACK_FIXTURE_SINK_TIMEOUT_MS ?? 1500);
