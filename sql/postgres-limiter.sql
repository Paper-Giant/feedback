-- feedback-limiter v1
--
-- The rate limiter behind @papergiant/feedback's `rpcLimiter()`
-- (src/limit/index.ts, task P4). Plain Postgres >= 14; no Supabase
-- assumptions — no `auth` schema, no `auth.uid()`. The host is the only
-- thing that knows who the caller is; this function only ever receives an
-- opaque subject string the host has already decided is eligible to spend
-- quota (design §5: the host calls it from server code *after*
-- `identify()` has accepted the person).
--
-- Copy the TABLE and the FUNCTION below unchanged into your own migration.
-- Set the role in the final GRANT (replace the __FEEDBACK_SERVER_ROLE__
-- placeholder — see the note above that GRANT). Add any host-specific
-- revokes your database needs in the PRIVILEGE HARDENING block before that
-- GRANT.
--
-- Re-running this file with `create or replace function` keeps whatever
-- revokes and grants you already have in place — it only replaces the
-- function body. If you ever DROP the function and CREATE it again (rather
-- than CREATE OR REPLACE), Postgres resets it to your database's default
-- privileges, which silently discards the revokes below. Keep the REVOKE
-- and GRANT statements in the same migration as the function, every time,
-- so the two can never drift apart.
--
-- One database = one quota domain: every subject and every call to
-- `feedback_rate_take` in a given database shares the same app-wide
-- window. If two applications share a database, they share that window
-- too — give each application its own database (or its own copy of this
-- table and function under a different name) if that is not what you want.
--
-- Defaults (not configurable without editing the function body — see
-- "copy unchanged" above): 5 calls per subject per 10 minutes, 100 calls
-- per database per hour.
--
-- `feedback_private` is a schema, not merely a naming convention: creating
-- it keeps the rate-limit table out of `public` so a host that exposes an
-- entire schema to PostgREST (as Supabase's default `public`/`graphql_public`
-- exposure does) does not accidentally expose it too. Hosts must NOT add
-- `feedback_private` to their PostgREST-exposed schema list.

create schema if not exists feedback_private;

create table if not exists feedback_private.rate_events (
  subject text not null,
  at timestamptz not null default now()
);

create index if not exists rate_events_subject_at_idx
  on feedback_private.rate_events (subject, at);

create index if not exists rate_events_at_idx
  on feedback_private.rate_events (at);

-- `feedback_rate_take` is `security definer`, so it runs with the
-- privileges of whoever created it, not the caller's — which is exactly
-- why its `search_path` matters. `set search_path = pg_catalog, pg_temp`
-- (not `feedback_private`, which every reference below is already
-- schema-qualified against and so never needs to be searched) does two
-- things:
--
--   1. Every unqualified name this function resolves — including the
--      declared variable, parameter and return types below, which are
--      "belt and braces" schema-qualified as `pg_catalog.timestamptz`,
--      `pg_catalog.text`, `pg_catalog.int8` and `pg_catalog.bool` anyway
--      — is found in `pg_catalog`, the first schema in the path, before
--      anything else is even considered.
--   2. `pg_temp` is listed explicitly, in last place. This is not
--      decorative: Postgres always searches the caller's own temporary
--      schema FIRST for relation and type names — even before
--      `pg_catalog`, and even when `pg_temp` is *not* mentioned in
--      `search_path` at all, including `search_path = ''`. A caller who
--      holds only EXECUTE on this function (no other privilege) can
--      still create objects in their own `pg_temp`, including a domain
--      named `pg_temp.timestamptz` with a CHECK constraint that calls a
--      function of their choosing — and if this function's `search_path`
--      does not explicitly place `pg_temp` somewhere else, that domain
--      is what an unqualified `timestamptz` resolves to, running the
--      caller's CHECK-constraint code with THIS function's owner
--      privileges the moment a value is declared, assigned, or cast to
--      it. Listing `pg_temp` explicitly — anywhere in the path — turns
--      off that "search first no matter what" behaviour and makes it
--      searched only in the position given, which here is last, after
--      `pg_catalog` has already resolved every type this function uses.
--      (`pg_temp` is never implicitly first for function or operator
--      names, only for relations and types — but the fix costs nothing
--      and is one line, so it stays regardless.)
--
-- A caller needs no privilege on `feedback_private` itself to call this
-- function — only EXECUTE on the function, granted below.
--
-- It takes a transaction-scoped advisory lock so concurrent callers
-- serialise around the same check-then-insert instead of racing each
-- other past the limit — but the lock alone is not enough under every
-- isolation level. Under REPEATABLE READ or SERIALIZABLE, a transaction's
-- snapshot is fixed at the transaction's *start*, not at the moment this
-- function runs its SELECTs. Two callers can both open a transaction,
-- both eventually acquire the advisory lock one after the other, and yet
-- both still see the *same* stale count from before either of them
-- inserted — because their snapshots predate each other's commits — and
-- so both get admitted past a limit only one of them should have passed.
-- READ COMMITTED does not have this gap: it takes a fresh snapshot for
-- every statement, so the SELECTs below always see whatever was committed
-- by the time the advisory lock was actually acquired, which is exactly
-- what makes the lock's serialisation meaningful. This function therefore
-- refuses to run under anything but READ COMMITTED — a caller that wraps
-- it in a higher-isolation transaction gets a raised exception, which
-- `rpcLimiter()` turns into a fail-closed refusal, rather than a silent
-- overshoot. (Ordinary autocommit calls, which is how every documented
-- host in design §3.1 calls this function, are READ COMMITTED already —
-- it is Postgres's default — so this never fires in normal use; it only
-- catches a caller that deliberately or accidentally opens a stricter
-- transaction around the call.)
create or replace function public.feedback_rate_take(p_subject pg_catalog.text)
returns pg_catalog.bool
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_now pg_catalog.timestamptz := clock_timestamp();
  v_subject_window_start pg_catalog.timestamptz := v_now - interval '10 minutes';
  v_app_window_start pg_catalog.timestamptz := v_now - interval '1 hour';
  v_subject_count pg_catalog.int8;
  v_app_count pg_catalog.int8;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'feedback_rate_take: requires READ COMMITTED transaction isolation, got %',
      current_setting('transaction_isolation');
  end if;

  if p_subject is null or length(p_subject) = 0 or length(p_subject) > 256 then
    raise exception 'feedback_rate_take: p_subject must be between 1 and 256 characters';
  end if;

  -- Fixed, arbitrary 64-bit advisory-lock key: 84172935521. Every call
  -- contends on the same key (this function has exactly one quota domain
  -- per database — see "one database = one quota domain" above), so
  -- calls that would otherwise race past the limit instead queue here
  -- for the rest of the transaction. Released automatically at commit or
  -- rollback. If you go looking for it while debugging, a single-bigint
  -- pg_advisory_xact_lock shows up in pg_locks as locktype = 'advisory'
  -- with this key split across (classid, objid) as its high/low 32 bits:
  -- classid 19, objid 2568556897.
  perform pg_advisory_xact_lock(84172935521);

  delete from feedback_private.rate_events where at < v_app_window_start;

  select count(*) into v_subject_count
  from feedback_private.rate_events
  where subject = p_subject and at >= v_subject_window_start;

  -- Every row remaining after the delete above is already within the last
  -- hour, so a plain count of the table is the app-wide hourly count.
  select count(*) into v_app_count
  from feedback_private.rate_events;

  if v_subject_count >= 5 or v_app_count >= 100 then
    return false;
  end if;

  insert into feedback_private.rate_events (subject, at) values (p_subject, v_now);

  return true;
end;
$$;

revoke all on schema feedback_private from public;
revoke all on all tables in schema feedback_private from public;
revoke execute on function public.feedback_rate_take(text) from public;

-- PRIVILEGE HARDENING (host-specific)
--
-- Revoking PUBLIC above removes the implicit grant every new function and
-- schema gets, but it does not remove a *direct* grant a role already
-- holds from your database's own defaults (for example, from an
-- `alter default privileges` your platform ran before this migration).
-- Add explicit revokes for any such role here.
--
-- REQUIRED on Supabase, not merely an example: Supabase's own default
-- privileges grant EXECUTE on every new function created in `public`
-- directly to `anon`, `authenticated` and `service_role`, independent of
-- the PUBLIC revoke above. `service_role` is meant to keep it (that is
-- who the final GRANT below targets), but `anon` and `authenticated` are
-- exactly the roles a browser or a PostgREST-authenticated caller can
-- assume, so every Supabase host must uncomment this line:
-- revoke execute on function public.feedback_rate_take(text) from anon, authenticated;
--
-- A host with its own unauthenticated or read-only role:
-- revoke execute on function public.feedback_rate_take(text) from web_anon;

-- Replace __FEEDBACK_SERVER_ROLE__ with your server-only role (for example
-- `service_role` on Supabase) before applying this file. This is a plain
-- text placeholder, not a psql `:"variable"` — psql variable substitution
-- does not happen when this file's contents are pasted into a migration
-- and applied by a migration runner (Supabase's included), so a psql
-- variable would ship broken. Find-and-replace the token, then apply.
grant execute on function public.feedback_rate_take(text) to __FEEDBACK_SERVER_ROLE__;
