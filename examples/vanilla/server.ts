/**
 * Task P10: a tiny host for the vanilla (no-React) consumer — same shape
 * as `examples/react18/server.ts` (see its header for why the sink here is
 * an in-memory stub rather than `githubSink()`), serving the built Vite
 * page plus `POST /api/feedback` via `@papergiant/feedback/server`.
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
  ref: 'vanilla-example-person',
  role: 'staff',
  surface: 'staff',
  allowReference: true,
};

async function identify(): Promise<FeedbackIdentity | null> {
  return IDENTITY;
}

let nextNumber = 1;
const stubSink: FeedbackHandlerSink = {
  async create() {
    return { ok: true, number: nextNumber++, url: `https://example.test/issues/${nextNumber - 1}`, droppedLabels: [] };
  },
};

let innerLimiter = memoryLimiter({ singleInstance: true });
const limiter = { take: (subject: string) => innerLimiter.take(subject) };

const feedbackHandler = createFeedbackHandler({
  app: 'vanilla-example',
  displayName: 'Vanilla example',
  productRepository: 'papergiant/feedback-example-vanilla',
  environment: 'test',
  origins: [`http://localhost:${HOST_PORT}`],
  identify,
  limiter,
  sink: stubSink,
  areas: { vanilla: 'examples/vanilla/pages/index.html' },
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
  console.log(`[vanilla example] listening on http://localhost:${info.port}`);
});
