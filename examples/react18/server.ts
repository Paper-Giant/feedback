/**
 * Task P10: a tiny host for the React 18 consumer — Hono on Node, serving
 * the built Vite page (`pages/index.html`, built to `dist-pages/` by `npm
 * run build:pages`) plus `POST /api/feedback`.
 *
 * Deliberately minimal, unlike `examples/fixture/server.ts`: no GitHub
 * stub, no delivery-ambiguity controls. This consumer exists to prove the
 * package works end to end under an independently installed React 18, not
 * to re-prove the delivery matrix P9 already covers in the fixture — so
 * the sink here is an in-memory stub (`createFeedbackHandler`'s `sink` is
 * just `{ create(ticket) }`; it never has to be `githubSink()`), and
 * `identify` is a static identity, always signed in.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFeedbackHandler, type FeedbackHandlerSink } from '@papergiant/feedback/server';
import type { FeedbackIdentity } from '@papergiant/feedback';
import { memoryLimiter } from '@papergiant/feedback/limit';
import { HOST_PORT } from './constants.ts';

const IDENTITY: FeedbackIdentity = {
  ref: 'react18-example-person',
  role: 'staff',
  surface: 'staff',
  allowReference: true,
};

async function identify(): Promise<FeedbackIdentity | null> {
  return IDENTITY;
}

// A minimal in-memory stub sink — no real GitHub call, no network. Every
// `create()` "succeeds", handing back an incrementing issue number so the
// dialog can show "Received · #n" (design §5's success case).
let nextNumber = 1;
const stubSink: FeedbackHandlerSink = {
  async create() {
    return { ok: true, number: nextNumber++, url: `https://example.test/issues/${nextNumber - 1}`, droppedLabels: [] };
  },
};

// A fresh limiter per `/__reset`, so one test's rate-limit usage never
// bleeds into the next — same convention as the fixture's `server.ts`.
let innerLimiter = memoryLimiter({ singleInstance: true });
const limiter = { take: (subject: string) => innerLimiter.take(subject) };

const feedbackHandler = createFeedbackHandler({
  app: 'react18-example',
  displayName: 'React 18 example',
  productRepository: 'papergiant/feedback-example-react18',
  environment: 'test',
  origins: [`http://localhost:${HOST_PORT}`],
  identify,
  limiter,
  sink: stubSink,
  areas: { r18: 'examples/react18/pages/index.html' },
  receivingCommit: null,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, 'dist-pages');
const PAGES_DIR_RELATIVE_TO_CWD = path.relative(process.cwd(), PAGES_DIR) || '.';

const app = new Hono();

app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('connection', 'close');
});

app.get('/', async (c) => {
  try {
    const html = await readFile(path.join(PAGES_DIR, 'index.html'), 'utf8');
    return c.html(html);
  } catch {
    return c.text('index.html is not built — run `npm run build:pages` first.', 500);
  }
});

app.post('/api/feedback', (c) => feedbackHandler(c.req.raw));

app.post('/__reset', (c) => {
  innerLimiter = memoryLimiter({ singleInstance: true });
  return c.json({ ok: true });
});

app.use('*', serveStatic({ root: PAGES_DIR_RELATIVE_TO_CWD }));

serve({ fetch: app.fetch, port: HOST_PORT }, (info) => {
  console.log(`[react18 example] listening on http://localhost:${info.port}`);
});
