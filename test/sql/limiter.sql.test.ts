import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// Integration tests for sql/postgres-limiter.sql (task P4; design §5
// "Limits") against a *real* Postgres server. They run only when
// FEEDBACK_TEST_DATABASE_URL is set — see test/sql/README.md for how to
// stand up a throwaway local cluster, and .github/workflows/ci.yml for how
// CI provides one via a service container.
//
// `postgres` (the npm package) is a dev-only dependency: nothing in src/
// depends on it, and it never ships in the published tarball (see
// test/pack.test.ts).

const DATABASE_URL = process.env.FEEDBACK_TEST_DATABASE_URL;

const SQL_FILE = fileURLToPath(new URL('../../sql/postgres-limiter.sql', import.meta.url));
const SERVER_ROLE = 'feedback_server';
const OTHER_ROLE = 'feedback_other';

// Must match the literal in sql/postgres-limiter.sql's
// `pg_advisory_xact_lock` call exactly — the lock-presence test below
// takes this same key itself to prove the function really does contend on
// it (see the review fix that added this test).
const ADVISORY_LOCK_KEY = 84172935521;

async function loadMigration(): Promise<string> {
  const raw = await readFile(SQL_FILE, 'utf8');
  if (!raw.includes('__FEEDBACK_SERVER_ROLE__')) {
    throw new Error('sql/postgres-limiter.sql no longer contains the __FEEDBACK_SERVER_ROLE__ placeholder');
  }
  return raw.replaceAll('__FEEDBACK_SERVER_ROLE__', SERVER_ROLE);
}

/**
 * Runs one query on `subjects.length` genuinely separate physical
 * connections, all in flight at once — not `postgres.js`'s own pipelined
 * pooling, which would still process pipelined queries on one connection
 * in arrival order and so would not exercise the advisory lock the way
 * real concurrent server instances would.
 */
async function callConcurrently(subjects: string[]): Promise<boolean[]> {
  const clients = subjects.map(() =>
    postgres(DATABASE_URL as string, {
      username: SERVER_ROLE,
      password: '',
      max: 1,
      onnotice: () => {},
    }),
  );
  try {
    // Pre-connect every client (the TCP handshake and auth) before firing
    // the concurrent calls below. Without this, postgres.js lazily opens
    // each connection on first use, and that staggered connection setup
    // alone can spread "ten concurrent calls" out enough that even a
    // *missing* advisory lock would still, by luck, let only one through —
    // which would make this test pass for the wrong reason. Pre-connecting
    // means the ten `feedback_rate_take` calls really are dispatched at
    // once, so only the lock itself can be why just one succeeds.
    await Promise.all(clients.map((client) => client`select 1`));

    const rows = await Promise.all(
      clients.map((client, i) => client`select public.feedback_rate_take(${subjects[i]}) as ok`),
    );
    return rows.map(([row]) => row.ok as boolean);
  } finally {
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
  }
}

describe.skipIf(!DATABASE_URL)('sql/postgres-limiter.sql (requires FEEDBACK_TEST_DATABASE_URL)', () => {
  const adminSql = postgres(DATABASE_URL as string, { max: 5, onnotice: () => {} });
  const serverSql = postgres(DATABASE_URL as string, {
    username: SERVER_ROLE,
    password: '',
    max: 5,
    onnotice: () => {},
  });
  const otherSql = postgres(DATABASE_URL as string, {
    username: OTHER_ROLE,
    password: '',
    max: 1,
    onnotice: () => {},
  });

  /**
   * Idempotent reset to the standard fixture: this cluster/database may be
   * reused across runs (see test/sql/README.md), so drop anything a
   * previous run — or a preceding test that deliberately mangles state —
   * left behind, then rebuild the table, function and both roles fresh
   * from the real file with the placeholder resolved. Used by `beforeAll`
   * and by any test that must leave the fixture exactly as the rest of the
   * suite expects it (the default-privileges and broken-placeholder tests
   * below).
   */
  async function resetToBaseline(): Promise<void> {
    await adminSql.unsafe(`
      do $$
      begin
        if exists (select 1 from pg_roles where rolname = '${SERVER_ROLE}') then
          execute 'drop owned by ${SERVER_ROLE}';
          execute 'drop role ${SERVER_ROLE}';
        end if;
        if exists (select 1 from pg_roles where rolname = '${OTHER_ROLE}') then
          execute 'drop owned by ${OTHER_ROLE}';
          execute 'drop role ${OTHER_ROLE}';
        end if;
      end
      $$;

      drop function if exists public.feedback_rate_take(text);
      drop schema if exists feedback_private cascade;

      create role ${SERVER_ROLE} login;
      create role ${OTHER_ROLE} login;
    `);

    const migration = await loadMigration();
    await adminSql.unsafe(migration);
  }

  beforeAll(resetToBaseline, 30_000);

  afterAll(async () => {
    await adminSql.unsafe(`
      drop function if exists public.feedback_rate_take(text);
      drop schema if exists feedback_private cascade;
      drop owned by ${SERVER_ROLE};
      drop owned by ${OTHER_ROLE};
      drop role if exists ${SERVER_ROLE};
      drop role if exists ${OTHER_ROLE};
    `);
    await Promise.all([adminSql.end(), serverSql.end(), otherSql.end()]);
  }, 30_000);

  beforeEach(async () => {
    await adminSql`truncate table feedback_private.rate_events`;
  });

  it('rejects null, empty and over-256-character subjects', async () => {
    // P0001 is plpgsql's default SQLSTATE for a bare `raise exception`
    // (no explicit SQLSTATE given) — the specific error the function's
    // own validation raises, not just "some error or other".
    await expect(serverSql`select public.feedback_rate_take(null) as ok`).rejects.toMatchObject({
      code: 'P0001',
    });
    await expect(serverSql`select public.feedback_rate_take('') as ok`).rejects.toMatchObject({
      code: 'P0001',
    });
    await expect(
      serverSql`select public.feedback_rate_take(${'x'.repeat(257)}) as ok`,
    ).rejects.toMatchObject({ code: 'P0001' });

    // 256 characters exactly is still allowed.
    const [row] = await serverSql`select public.feedback_rate_take(${'x'.repeat(256)}) as ok`;
    expect(row.ok).toBe(true);
  });

  it('refuses the sixth call for a subject within ten minutes, leaving another subject unaffected', async () => {
    const now = new Date();
    const rows = Array.from({ length: 5 }, (_, i) => ({
      subject: 'alice',
      at: new Date(now.getTime() - (i + 1) * 1000),
    }));
    await adminSql`insert into feedback_private.rate_events ${adminSql(rows, 'subject', 'at')}`;

    const [sixth] = await serverSql`select public.feedback_rate_take('alice') as ok`;
    expect(sixth.ok).toBe(false);

    const [other] = await serverSql`select public.feedback_rate_take('bob') as ok`;
    expect(other.ok).toBe(true);
  });

  it('refuses the 101st call across subjects within the hour', async () => {
    const now = new Date();
    const rows = Array.from({ length: 100 }, (_, i) => ({
      subject: `bulk-${i}`,
      at: new Date(now.getTime() - (i + 1) * 1000),
    }));
    await adminSql`insert into feedback_private.rate_events ${adminSql(rows, 'subject', 'at')}`;

    const [hundredAndFirst] = await serverSql`select public.feedback_rate_take('brand-new-subject') as ok`;
    expect(hundredAndFirst.ok).toBe(false);
  });

  it('prunes rows older than an hour before counting, so a stale app window does not block a fresh call', async () => {
    const now = new Date();
    const staleRows = Array.from({ length: 100 }, (_, i) => ({
      subject: `stale-${i}`,
      at: new Date(now.getTime() - 90 * 60_000 - i * 1000), // 90+ minutes ago
    }));
    await adminSql`insert into feedback_private.rate_events ${adminSql(staleRows, 'subject', 'at')}`;

    const [beforeCount] = await adminSql`select count(*)::int as n from feedback_private.rate_events`;
    expect(beforeCount.n).toBe(100);

    const [result] = await serverSql`select public.feedback_rate_take('fresh-after-prune') as ok`;
    expect(result.ok).toBe(true);

    const [afterCount] = await adminSql`select count(*)::int as n from feedback_private.rate_events`;
    // The 100 stale rows were pruned; only the one just-recorded row remains.
    expect(afterCount.n).toBe(1);
  });

  it('refuses a role with no grant (permission denied)', async () => {
    await expect(otherSql`select public.feedback_rate_take('someone') as ok`).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('a role without grants cannot read or write feedback_private.rate_events directly', async () => {
    await expect(otherSql`select * from feedback_private.rate_events`).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      otherSql`insert into feedback_private.rate_events (subject) values ('probe')`,
    ).rejects.toMatchObject({ code: '42501' });
    await expect(otherSql`delete from feedback_private.rate_events`).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('the schema itself denies USAGE, independent of any table-level grant', async () => {
    // Grant SELECT on the table directly — bypassing this file's own
    // scheme entirely — to isolate the claim: even with a table grant in
    // hand, lacking USAGE on feedback_private alone is enough to deny
    // access. Proves the schema-level revoke is doing real work, not
    // merely redundant with the table-level one.
    await adminSql.unsafe(`grant select on feedback_private.rate_events to ${OTHER_ROLE}`);
    try {
      await expect(otherSql`select * from feedback_private.rate_events`).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await adminSql.unsafe(`revoke select on feedback_private.rate_events from ${OTHER_ROLE}`);
    }
  });

  it('at a subject already at four uses, ten concurrent connections let exactly one succeed', async () => {
    const now = new Date();
    const rows = Array.from({ length: 4 }, (_, i) => ({
      subject: 'concurrent-subject',
      at: new Date(now.getTime() - (i + 1) * 1000),
    }));
    await adminSql`insert into feedback_private.rate_events ${adminSql(rows, 'subject', 'at')}`;

    const results = await callConcurrently(Array(10).fill('concurrent-subject'));

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r) => !r)).toHaveLength(9);

    const [finalCount] = await adminSql`
      select count(*)::int as n from feedback_private.rate_events where subject = 'concurrent-subject'
    `;
    expect(finalCount.n).toBe(5);
  });

  it('at the database already at ninety-nine in the hour, ten concurrent connections from different subjects let exactly one succeed', async () => {
    const now = new Date();
    const rows = Array.from({ length: 99 }, (_, i) => ({
      subject: `app-fill-${i}`,
      at: new Date(now.getTime() - (i + 1) * 1000),
    }));
    await adminSql`insert into feedback_private.rate_events ${adminSql(rows, 'subject', 'at')}`;

    const subjects = Array.from({ length: 10 }, (_, i) => `app-boundary-${i}`);
    const results = await callConcurrently(subjects);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r) => !r)).toHaveLength(9);

    const [finalCount] = await adminSql`select count(*)::int as n from feedback_private.rate_events`;
    expect(finalCount.n).toBe(100);
  });

  it('genuinely holds the advisory lock: a concurrent caller blocks until it is released, and none remains afterwards', async () => {
    const lockConn = postgres(DATABASE_URL as string, { max: 1, onnotice: () => {} });

    try {
      await lockConn`select 1`; // pre-connect

      await lockConn`begin`;
      // Take the exact same fixed key the function itself takes.
      await lockConn`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
      // The lock is now held by lockConn's open transaction.

      const blocked = (async () => {
        const start = Date.now();
        const [row] = await serverSql`select public.feedback_rate_take('lock-presence-subject') as ok`;
        return { ok: row.ok as boolean, elapsedMs: Date.now() - start };
      })();

      // Hold the lock for ~2s before releasing, so a genuinely blocked
      // caller (and only a genuinely blocked caller) measures >= ~1.8s.
      await lockConn`select pg_sleep(2)`;
      await lockConn`commit`; // releases the lock

      const result = await blocked;
      expect(result.elapsedMs).toBeGreaterThanOrEqual(1800);
      expect(result.ok).toBe(true);

      const [remaining] = await adminSql`
        select count(*)::int as n from pg_locks where locktype = 'advisory'
      `;
      expect(remaining.n).toBe(0);
    } finally {
      await lockConn.end({ timeout: 5 });
    }
  }, 15_000);

  it('search_path is pinned against a pg_temp shadow of "timestamptz" (regression: the reviewer-found privilege-escalation finding)', async () => {
    // Reproduces exactly what the review found against the unfixed
    // function: a caller holding only EXECUTE creates a pg_temp domain
    // literally named `timestamptz`, with a CHECK constraint that would
    // run arbitrary code — here, recording that it fired — the moment a
    // value is declared or assigned as that type. If the function's
    // search_path let pg_temp be consulted before pg_catalog for type
    // names, its unqualified (or, now, its qualified-but-still-testable)
    // `timestamptz` declarations would resolve to this trap and run it
    // with the function owner's privileges. Fixed, pg_catalog resolves
    // first and the trap is never reached.
    const trapConn = postgres(DATABASE_URL as string, {
      username: SERVER_ROLE,
      password: '',
      max: 1,
      onnotice: () => {},
    });

    try {
      await trapConn`select 1`; // pre-connect: everything below shares this one session

      await trapConn.unsafe(`
        create temporary table pg_temp_trap_calls (n int not null);
        insert into pg_temp_trap_calls (n) values (0);

        create function pg_temp.trap() returns boolean
        language plpgsql
        as $$
        begin
          update pg_temp_trap_calls set n = n + 1;
          return true;
        end;
        $$;

        create domain pg_temp.timestamptz as pg_catalog.timestamptz
          check (pg_temp.trap());
      `);

      const [result] = await trapConn`select public.feedback_rate_take('pg-temp-trap-subject') as ok`;
      expect(result.ok).toBe(true);

      const [trap] = await trapConn`select n from pg_temp_trap_calls`;
      expect(trap.n).toBe(0);
    } finally {
      await trapConn.end({ timeout: 5 });
    }
  });

  it('pins search_path to exactly "pg_catalog, pg_temp" on the function itself', async () => {
    const [row] = await adminSql`
      select proconfig from pg_proc where oid = 'public.feedback_rate_take(text)'::regprocedure
    `;
    expect(row.proconfig).toEqual(['search_path=pg_catalog, pg_temp']);
  });

  describe('transaction isolation', () => {
    // The advisory lock alone does not stop two REPEATABLE READ or
    // SERIALIZABLE transactions from both admitting a caller past the
    // limit: each transaction's snapshot is fixed at its own start, not
    // at the moment it finally acquires the lock, so it can still see a
    // stale (pre-insert) count even after waiting its turn. The function
    // refuses to run under anything but READ COMMITTED rather than risk
    // that silently.

    it('the normal autocommit path still works (it is READ COMMITTED already)', async () => {
      const [row] = await serverSql`select public.feedback_rate_take('isolation-autocommit') as ok`;
      expect(row.ok).toBe(true);
    });

    it('raises inside a REPEATABLE READ transaction', async () => {
      const conn = postgres(DATABASE_URL as string, {
        username: SERVER_ROLE,
        password: '',
        max: 1,
        onnotice: () => {},
      });
      try {
        await conn`select 1`;
        await conn`begin isolation level repeatable read`;
        await expect(
          conn`select public.feedback_rate_take('isolation-repeatable-read') as ok`,
        ).rejects.toMatchObject({
          code: 'P0001',
          message: expect.stringContaining('READ COMMITTED'),
        });
        await conn`rollback`;
      } finally {
        await conn.end({ timeout: 5 });
      }
    });

    it('raises inside a SERIALIZABLE transaction', async () => {
      const conn = postgres(DATABASE_URL as string, {
        username: SERVER_ROLE,
        password: '',
        max: 1,
        onnotice: () => {},
      });
      try {
        await conn`select 1`;
        await conn`begin isolation level serializable`;
        await expect(
          conn`select public.feedback_rate_take('isolation-serializable') as ok`,
        ).rejects.toMatchObject({
          code: 'P0001',
          message: expect.stringContaining('READ COMMITTED'),
        });
        await conn`rollback`;
      } finally {
        await conn.end({ timeout: 5 });
      }
    });
  });

  it('Supabase-style default privileges: the hardening-block revoke still denies anon/authenticated even though they got EXECUTE automatically', async () => {
    const DEFAULT_PRIV_ROLES = ['anon', 'authenticated'] as const;

    try {
      // Simulate a Supabase host's platform-level default privileges:
      // every NEW function the connecting (migration) role creates in
      // `public` automatically grants EXECUTE to these roles, independent
      // of anything sql/postgres-limiter.sql itself does. Set this
      // *before* the function is (re-)created, exactly like a real
      // Supabase project already has it configured before any migration
      // ever runs.
      await adminSql.unsafe(`
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'anon') then
            execute 'drop owned by anon';
            execute 'drop role anon';
          end if;
          if exists (select 1 from pg_roles where rolname = 'authenticated') then
            execute 'drop owned by authenticated';
            execute 'drop role authenticated';
          end if;
        end
        $$;

        create role anon login;
        create role authenticated login;

        alter default privileges for role current_user in schema public
          grant execute on functions to anon, authenticated;

        drop function if exists public.feedback_rate_take(text);
        drop schema if exists feedback_private cascade;
      `);

      const migration = await loadMigration();
      await adminSql.unsafe(migration);

      // Before the hardening-block revoke is applied, the default-privilege
      // roles really can already execute — proving this scenario is a real
      // default-privilege grant, not a no-op that would pass either way.
      const preRevokeConn = postgres(DATABASE_URL as string, {
        username: 'anon',
        password: '',
        max: 1,
        onnotice: () => {},
      });
      try {
        await preRevokeConn`select 1`;
        const [row] =
          await preRevokeConn`select public.feedback_rate_take('default-priv-preexisting') as ok`;
        expect(row.ok).toBe(true);
      } finally {
        await preRevokeConn.end({ timeout: 5 });
      }

      // Now apply exactly the revoke a Supabase host is required to
      // uncomment from the file's PRIVILEGE HARDENING block.
      await adminSql.unsafe(
        'revoke execute on function public.feedback_rate_take(text) from anon, authenticated;',
      );

      for (const role of DEFAULT_PRIV_ROLES) {
        const conn = postgres(DATABASE_URL as string, {
          username: role,
          password: '',
          max: 1,
          onnotice: () => {},
        });
        try {
          await conn`select 1`;
          await expect(
            conn`select public.feedback_rate_take('default-priv-after-revoke') as ok`,
          ).rejects.toMatchObject({ code: '42501' });
        } finally {
          await conn.end({ timeout: 5 });
        }
      }

      // The server role was never granted by the default-privilege rule
      // above (it only names anon/authenticated) and is unaffected either
      // way — it still works throughout.
      const [row] =
        await serverSql`select public.feedback_rate_take('default-priv-server-role-unaffected') as ok`;
      expect(row.ok).toBe(true);
    } finally {
      // Remove the simulated Supabase default-privilege rule and roles,
      // then rebuild the standard fixture so the rest of the suite sees
      // exactly the state it expects.
      await adminSql.unsafe(`
        alter default privileges for role current_user in schema public
          revoke execute on functions from anon, authenticated;
        drop owned by anon;
        drop owned by authenticated;
        drop role if exists anon;
        drop role if exists authenticated;
      `);
      await resetToBaseline();
    }
  }, 30_000);

  it('applying the file with the placeholder unresolved fails, and — wrapped in a transaction — leaves nothing created', async () => {
    // Start from a clean slate so "nothing was created" is meaningful.
    await adminSql.unsafe(`
      drop function if exists public.feedback_rate_take(text);
      drop schema if exists feedback_private cascade;
    `);

    // The raw file, deliberately NOT run through loadMigration() — the
    // __FEEDBACK_SERVER_ROLE__ placeholder is left unresolved, exactly as
    // a host would see it if they applied the file as downloaded.
    const rawFile = await readFile(SQL_FILE, 'utf8');
    expect(rawFile).toContain('__FEEDBACK_SERVER_ROLE__');

    // A dedicated, single (`max: 1`) connection for the whole
    // begin/fail/rollback/verify sequence below. adminSql is a *pooled*
    // client (`max: 5`): an explicit `begin` and its matching `rollback`
    // must run on the exact same physical connection, and a pool gives no
    // such guarantee across separate awaited calls — using adminSql here
    // (an earlier version of this test did) intermittently left one of
    // its pooled connections aborted-but-never-rolled-back, which then
    // broke a *later*, unrelated query that the pool happened to route to
    // that same stuck connection.
    const conn = postgres(DATABASE_URL as string, { max: 1, onnotice: () => {} });

    try {
      await conn`select 1`; // pre-connect

      // Applied inside an explicit transaction, the way a real migration
      // runner applies a migration file (this project's own runner
      // included — see docs/handoffs, migration-runner-transactions).
      await expect(conn.unsafe(`begin;\n${rawFile}\ncommit;`)).rejects.toMatchObject({
        message: expect.stringContaining('does not exist'),
      });

      // The failed GRANT leaves this session's transaction aborted; clean
      // it up, on this same connection, before querying.
      await conn`rollback`;

      const [schema] = await conn`
        select 1 as found from pg_namespace where nspname = 'feedback_private'
      `;
      expect(schema).toBeUndefined();

      const [fn] = await conn`select to_regprocedure('public.feedback_rate_take(text)') as fn`;
      expect(fn.fn).toBeNull();
    } finally {
      await conn.end({ timeout: 5 });
      await resetToBaseline();
    }
  }, 30_000);
});

if (!DATABASE_URL) {
  describe('sql/postgres-limiter.sql', () => {
    it.skip(
      'SKIPPED: set FEEDBACK_TEST_DATABASE_URL to a Postgres connection string to run these tests ' +
        '(see test/sql/README.md for a throwaway local cluster, or run CI, which provides one)',
      () => {},
    );
  });
}
