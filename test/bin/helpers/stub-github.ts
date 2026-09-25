/**
 * Test-only stub GitHub for `test/bin/*.test.ts` (task P11). A minimal
 * `node:http` stand-in for the three read-only GitHub calls `doctor`
 * makes: minting an installation token, reading a repository, and
 * reading a label. Each test gets its own instance on an OS-assigned
 * port (`listen(0)`), configured with `setMintStatus` / `setRepo` /
 * `setLabels` before spawning the CLI against it.
 *
 * Deliberately separate from `examples/fixture/stub-github.ts` (task
 * P10a), which only implements the token-mint and issue-create endpoints
 * `githubSink` needs — `doctor` never creates an issue, and needs two
 * endpoints (`GET /repos/{owner}/{name}` and
 * `GET /repos/{owner}/{name}/labels/{name}`) that stub doesn't have.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface RepoState {
  hasIssues: boolean;
  isPrivate: boolean;
}

export interface StubGithub {
  url: string;
  close(): Promise<void>;
  /** Every subsequent token-mint request responds with this HTTP status.
   * Defaults to 201 (success). */
  setMintStatus(status: number): void;
  /** Every subsequent `GET /repos/{owner}/{name}` responds with this
   * status (when set) or, by default, 200 with `hasIssues`/`isPrivate`. */
  setRepo(state: RepoState | { status: number }): void;
  /** The exact set of label names `GET .../labels/{name}` reports as
   * existing (200) — anything else is 404. Defaults to empty. */
  setLabels(names: readonly string[]): void;
  /** Overrides every subsequent `GET .../labels/{name}` response with
   * this status instead of the usual 200/404-by-membership logic — for
   * exercising an unexpected status (e.g. a 3xx) on that endpoint. `null`
   * (the default) restores the normal membership-based behaviour. */
  setLabelStatus(status: number | null): void;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

export async function createStubGithub(): Promise<StubGithub> {
  let mintStatus = 201;
  let repoState: RepoState | { status: number } = { hasIssues: true, isPrivate: true };
  let labels = new Set<string>();
  let labelStatus: number | null = null;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://stub.invalid');
      const method = req.method ?? 'GET';

      const mintMatch = /^\/app\/installations\/([^/]+)\/access_tokens$/.exec(url.pathname);
      if (method === 'POST' && mintMatch) {
        await readBody(req); // drained, unused — the stub does not verify the JWT
        if (mintStatus !== 201) {
          sendJson(res, mintStatus, { message: `stub: simulated ${mintStatus}` });
          return;
        }
        const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
        sendJson(res, 201, { token: 'stub-installation-token', expires_at: expiresAt });
        return;
      }

      const labelMatch = /^\/repos\/([^/]+)\/([^/]+)\/labels\/(.+)$/.exec(url.pathname);
      if (method === 'GET' && labelMatch) {
        if (labelStatus !== null) {
          sendJson(res, labelStatus, { message: `stub: simulated ${labelStatus}` });
          return;
        }
        const name = decodeURIComponent(labelMatch[3]);
        if (labels.has(name)) {
          sendJson(res, 200, { name });
        } else {
          sendJson(res, 404, { message: 'Not Found' });
        }
        return;
      }

      const repoMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (method === 'GET' && repoMatch) {
        const [, owner, name] = repoMatch;
        if ('status' in repoState) {
          sendJson(res, repoState.status, { message: `stub: simulated ${repoState.status}` });
          return;
        }
        sendJson(res, 200, {
          full_name: `${owner}/${name}`,
          has_issues: repoState.hasIssues,
          private: repoState.isPrivate,
        });
        return;
      }

      sendJson(res, 404, { error: 'not found', method, path: url.pathname });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    setMintStatus: (status) => {
      mintStatus = status;
    },
    setRepo: (state) => {
      repoState = state;
    },
    setLabels: (names) => {
      labels = new Set(names);
    },
    setLabelStatus: (status) => {
      labelStatus = status;
    },
  };
}
