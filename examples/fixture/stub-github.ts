/**
 * Stub GitHub — task P10a.
 *
 * A minimal stand-in for the two GitHub API calls the package's sink (P5)
 * makes: minting an installation access token and creating an issue.
 * Plain `node:http`, no framework — this only needs to be a predictable
 * target for the host server and for tests, not a real HTTP framework
 * exercise.
 *
 * Endpoints:
 *   POST /app/installations/:id/access_tokens  -> 201 { token, expires_at }
 *   POST /repos/:owner/:repo/issues            -> behaviour-dependent (see below)
 *   POST /__control  { "behaviour": "..." }    -> sets the *next* issues behaviour
 *   GET  /__issues                             -> { issues: [...] } recorded so far
 *   POST /__reset                              -> clears issues, resets numbering and behaviour
 *
 * Behaviours (see README.md for the full contract):
 *   - "succeed" (default): records the issue, responds 201 with an
 *     incrementing `number`.
 *   - "status:<code>" (e.g. "status:422", "status:503"): responds with that
 *     status and an error body. Nothing is recorded — on real GitHub, a
 *     rejected request never created an issue.
 *   - "hang": never responds, and nothing is recorded. The caller is
 *     expected to time out or abort.
 *   - "record-then-drop": records the issue (it gets a number, and shows
 *     up in GET /__issues) and then destroys the socket with no response
 *     at all — simulating a connection lost *after* GitHub did the work,
 *     which is exactly the "delivery unconfirmed" case in the design.
 *   - "drop-labels": records the issue and responds 201, but the response
 *     omits one of the requested labels, simulating GitHub silently
 *     dropping a label the caller wasn't allowed to set.
 *
 * A behaviour set via /__control applies to exactly the next issue-creation
 * request, then reverts to "succeed" — set it, make one request, done.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type Behaviour =
  | 'succeed'
  | { kind: 'status'; code: number }
  | 'hang'
  | 'record-then-drop'
  | 'drop-labels';

type RecordedIssue = {
  number: number;
  owner: string;
  repo: string;
  headers: Record<string, string>;
  body: unknown;
};

const PORT = Number(process.env.STUB_PORT ?? 4322);

let nextBehaviour: Behaviour = 'succeed';
let issues: RecordedIssue[] = [];
let nextIssueNumber = 1;

function parseBehaviour(raw: string): Behaviour | null {
  if (raw === 'succeed' || raw === 'hang' || raw === 'record-then-drop' || raw === 'drop-labels') {
    return raw;
  }
  const match = /^status:(\d{3})$/.exec(raw);
  if (match) return { kind: 'status', code: Number(match[1]) };
  return null;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function headersToRecord(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.join(', ');
  }
  return out;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function requestedLabelNames(body: unknown): string[] {
  const labels = (body as { labels?: unknown } | null)?.labels;
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => (typeof label === 'string' ? label : (label as { name?: string } | null)?.name))
    .filter((name): name is string => Boolean(name));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const method = req.method ?? 'GET';

  const tokenMatch = /^\/app\/installations\/([^/]+)\/access_tokens$/.exec(url.pathname);
  if (method === 'POST' && tokenMatch) {
    await readBody(req); // drained, unused — the stub does not verify the JWT
    const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    sendJson(res, 201, { token: `stub-installation-token-${tokenMatch[1]}`, expires_at: expiresAt });
    return;
  }

  const issueMatch = /^\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(url.pathname);
  if (method === 'POST' && issueMatch) {
    const [, owner, repo] = issueMatch;
    const raw = await readBody(req);

    // Single-shot: consume whatever was configured, then revert to the
    // default so the next unrelated request isn't affected by it too.
    const behaviour = nextBehaviour;
    nextBehaviour = 'succeed';

    let parsedBody: unknown = null;
    try {
      parsedBody = raw ? JSON.parse(raw) : null;
    } catch {
      parsedBody = { __unparseable: raw };
    }

    if (behaviour === 'hang') {
      // Never respond, never record. The caller must time out or abort.
      return;
    }

    if (typeof behaviour === 'object' && behaviour.kind === 'status') {
      sendJson(res, behaviour.code, { message: `stub: simulated ${behaviour.code}` });
      return;
    }

    // succeed | record-then-drop | drop-labels: GitHub did the work.
    const number = nextIssueNumber++;
    issues.push({ number, owner, repo, headers: headersToRecord(req), body: parsedBody });

    if (behaviour === 'record-then-drop') {
      req.socket.destroy();
      return;
    }

    const requested = requestedLabelNames(parsedBody);
    const returnedLabels = behaviour === 'drop-labels' ? requested.slice(0, Math.max(requested.length - 1, 0)) : requested;

    sendJson(res, 201, {
      number,
      html_url: `https://github.com/${owner}/${repo}/issues/${number}`,
      labels: returnedLabels.map((name) => ({ name })),
    });
    return;
  }

  if (method === 'GET' && url.pathname === '/__issues') {
    sendJson(res, 200, { issues });
    return;
  }

  if (method === 'POST' && url.pathname === '/__reset') {
    issues = [];
    nextIssueNumber = 1;
    nextBehaviour = 'succeed';
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && url.pathname === '/__control') {
    const raw = await readBody(req);
    let requested: string | undefined;
    try {
      requested = JSON.parse(raw)?.behaviour;
    } catch {
      requested = undefined;
    }
    const parsed = requested ? parseBehaviour(requested) : null;
    if (!parsed) {
      sendJson(res, 400, { error: 'unknown behaviour', got: requested ?? null });
      return;
    }
    nextBehaviour = parsed;
    sendJson(res, 200, { ok: true, behaviour: requested });
    return;
  }

  sendJson(res, 404, { error: 'not found', method, path: url.pathname });
});

server.listen(PORT, () => {
  console.log(`[stub github] listening on http://localhost:${PORT}`);
});
