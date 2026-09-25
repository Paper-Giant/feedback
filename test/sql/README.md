# SQL tests

`limiter.sql.test.ts` exercises `sql/postgres-limiter.sql` against a real
Postgres server — table pruning, both rate-limit windows, the permission
grant, and concurrency at both boundaries (advisory-lock serialisation
under ten simultaneous connections). It needs a real server because none
of that is meaningfully testable against a mock.

**The test runs only when `FEEDBACK_TEST_DATABASE_URL` is set.** Without
it, `npm test` prints one clearly named skipped test and otherwise runs
normally — this is expected in a plain local checkout; CI always sets it
(see `.github/workflows/ci.yml`, a Postgres 16 service container).

The test file creates its own `feedback_private` schema,
`public.feedback_rate_take` function, and `feedback_server` /
`feedback_other` roles at the start of the run (idempotently — it drops
anything of the same name left over from a previous run first) and drops
them again afterwards, so the same server, and even the same database, can
be reused run after run.

## Throwaway local cluster

Requires local Postgres server binaries — `initdb`, `pg_ctl`, `createdb`,
`psql` — on your `PATH` or under `/usr/local/bin`. Any Postgres >= 14
works (this package's floor); CI runs 16. On macOS with Homebrew:

```sh
brew install postgresql@14   # or any version >= 14
```

Then, in a shell that stays open for the duration (or export `PGDATA`
and `PGPORT` so later commands can find it):

```sh
export PGDATA="$(mktemp -d)/feedback-limiter-pg"
export PGPORT=55891   # any free local port — check first with `lsof -i :$PGPORT`

initdb -D "$PGDATA" -U postgres --auth=trust --no-locale --encoding=UTF8
pg_ctl -D "$PGDATA" -o "-p $PGPORT -h 127.0.0.1" -l "$PGDATA/log" start

createdb -h 127.0.0.1 -p "$PGPORT" -U postgres feedback_limiter_test

export FEEDBACK_TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PGPORT/feedback_limiter_test"
npm test
# or, to run only the SQL tests: npx vitest run test/sql/limiter.sql.test.ts

# When you're done, stop and delete the throwaway cluster:
pg_ctl -D "$PGDATA" -m fast stop
rm -rf "$PGDATA"
```

`--auth=trust` is what lets the test file connect as `feedback_server` and
`feedback_other` — roles it creates with no password — without you having
to manage passwords for roles that exist only for the duration of a test
run. Do not use `--auth=trust` on any cluster reachable from outside your
own machine; this recipe is for a throwaway local cluster only, on a
loopback address, that you delete when you're done.
